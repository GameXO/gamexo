"""Engines, and the tenant-scoped session that makes isolation automatic."""

from __future__ import annotations

import uuid
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

from sqlalchemy import event
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import Session as SyncSession
from sqlalchemy.orm import with_loader_criteria
from sqlalchemy.pool import NullPool

from app.core.config import PoolMode, settings
from app.db.base import TenantScoped
from app.db.rls import set_current_tenant
from app.tenancy.context import bind_tenant, get_current_tenant_id


def _build_engine(url: str, *, pool_mode: PoolMode, echo: bool = False) -> AsyncEngine:
    """Create an engine configured for how it will actually be deployed.

    `external_pooler` targets PgBouncer or a Neon pooled endpoint running in
    transaction pooling mode, which is the assumed production shape: async workers
    plus scale-to-zero Postgres will exhaust direct connections otherwise.

    Two changes are required there, and both fail *under load* rather than at
    startup, which is why they are configured now instead of discovered later:

      * NullPool — the external pooler owns pooling. A second pool in the client
        holds connections the pooler has already handed elsewhere.
      * prepared_statement_cache_size=0 — in transaction mode a client gets a
        different backend per transaction, so a statement prepared in one is absent
        in the next. The symptom is an intermittent
        `prepared statement "__asyncpg_stmt_1__" does not exist`.
    """
    kwargs: dict[str, Any] = {"echo": echo, "future": True}
    engine_url = make_url(url)

    if pool_mode == "external_pooler":
        kwargs["poolclass"] = NullPool
        # A dialect-level option, so it goes on the URL rather than in connect_args
        # (asyncpg.connect() itself does not accept it).
        engine_url = engine_url.update_query_dict({"prepared_statement_cache_size": "0"})
        # NOTE: PgBouncer specifically may also need a unique prepared-statement name
        # function; Neon's pooled endpoint does not. See the SQLAlchemy asyncpg docs
        # under "Prepared Statement Cache" if you move off Neon.
    else:
        kwargs.update(
            pool_size=settings.db_pool_size,
            max_overflow=settings.db_max_overflow,
            # pool_pre_ping is deliberately OFF. It issues a `SELECT 1` on every
            # single checkout to prove the connection is alive — one extra round
            # trip per request, which is ~0.1 ms next to the database and ~45 ms
            # across it. `pool_recycle` below retires connections well inside the
            # window where an idle one would have been dropped, which covers the
            # same failure without paying for it on the hot path.
            pool_pre_ping=False,
            # Under Neon's idle timeout, and under most cloud NAT idle timeouts.
            pool_recycle=280,
        )

    return create_async_engine(engine_url, **kwargs)


async def warm_pool(target: int | None = None) -> None:
    """Open connections up front so the first requests do not pay for them.

    A cold connect to Neon Singapore is ~400 ms (~1.65 s to us-east-2), all of it
    TCP, TLS and auth. Without this the first burst of requests after a restart —
    which is exactly when someone is watching — each pay that individually.

    Failures are swallowed on purpose: an unreachable database at startup should
    surface as a failing request with a real error, not as a boot crash that makes
    the API impossible to start while you fix the connection string.
    """
    if settings.db_pool_mode == "external_pooler":
        return  # NullPool: nothing to hold open.

    size = target if target is not None else settings.db_pool_size
    opened: list[Any] = []
    try:
        for _ in range(size):
            opened.append(await engine.connect())
    except Exception:
        pass
    finally:
        # Closing returns each connection to the pool; the underlying socket stays
        # open, which is the whole point.
        for conn in opened:
            await conn.close()


engine: AsyncEngine = _build_engine(
    settings.database_url, pool_mode=settings.db_pool_mode, echo=settings.db_echo
)

SessionFactory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


def engine_for_tenant(tenant_id: uuid.UUID) -> AsyncEngine:
    """Resolve the engine serving a tenant.

    EXTENSION POINT — this is the only place in the codebase that maps a tenant to
    a database connection. Today every tenant shares the one pooled engine, which is
    the whole point of pooled multi-tenancy.

    To peel a single enterprise tenant into its own database later: add a nullable
    `tenant.database_url` column, and return a cached engine built from it here. No
    query, model, router or test changes — nothing else addresses a database.
    """
    del tenant_id  # pooled: every tenant shares one engine
    return engine


# ── Application-layer tenant enforcement ────────────────────────────────────
#
# RLS is the backstop that makes isolation true even when application code is wrong.
# These two listeners are the layer that stops it being wrong in the first place,
# and — more practically — mean no endpoint has to thread tenant_id by hand.
#
# They are registered on the *sync* Session class, which AsyncSession wraps.

# Key under which a session records the tenant it is bound to.
SESSION_TENANT_KEY = "gamexo_tenant_id"


def _session_tenant(session: SyncSession) -> uuid.UUID | None:
    """The tenant a session is bound to.

    Read from `session.info` rather than the ContextVar because a flush is not
    guaranteed to happen while the ambient context is still set — the autoflush at
    COMMIT is the obvious case, and it is exactly the one that matters. The session
    knows its own tenant for its whole lifetime; the ContextVar only knows it for
    the duration of a block.

    Falls back to the ambient tenant so a session created outside `tenant_session`
    still behaves correctly.
    """
    return session.info.get(SESSION_TENANT_KEY) or get_current_tenant_id()


@event.listens_for(SyncSession, "before_flush")
def _stamp_tenant_on_insert(session: SyncSession, flush_context: Any, instances: Any) -> None:
    """Fill in tenant_id on new rows, and refuse writes aimed at another tenant."""
    del flush_context, instances

    tenant_id = _session_tenant(session)
    if tenant_id is None:
        return

    for obj in session.new:
        if not isinstance(obj, TenantScoped):
            continue
        if obj.tenant_id is None:
            obj.tenant_id = tenant_id
        elif obj.tenant_id != tenant_id:
            # RLS WITH CHECK would also reject this, but as an opaque driver error
            # at COMMIT. Failing here names the offending object while the stack
            # trace still points at the code that built it.
            raise PermissionError(
                f"Refusing to insert {type(obj).__name__} for tenant {obj.tenant_id} "
                f"while the request is bound to tenant {tenant_id}."
            )

    for obj in session.dirty:
        if not isinstance(obj, TenantScoped) or not session.is_modified(obj):
            continue
        if obj.tenant_id != tenant_id:
            raise PermissionError(
                f"Refusing to update {type(obj).__name__} belonging to tenant "
                f"{obj.tenant_id} while the request is bound to tenant {tenant_id}."
            )


@event.listens_for(SyncSession, "do_orm_execute")
def _filter_selects_by_tenant(execute_state: Any) -> None:
    """Append `AND tenant_id = <current>` to every ORM SELECT.

    Applies to anything inheriting TenantScoped, including joined and eagerly loaded
    relationships, so a `selectinload` cannot pull in another tenant's children.

    `is_column_load` and `is_relationship_load` are excluded per SQLAlchemy's
    guidance: those are refresh/lazy-load operations against an object already
    fetched under the criteria, and re-applying it there breaks unloaded attribute
    access.
    """
    if (
        not execute_state.is_select
        or execute_state.is_column_load
        or execute_state.is_relationship_load
    ):
        return

    if execute_state.execution_options.get("skip_tenant_filter", False):
        return

    tenant_id = _session_tenant(execute_state.session)
    if tenant_id is None:
        return

    execute_state.statement = execute_state.statement.options(
        with_loader_criteria(
            TenantScoped,
            lambda cls: cls.tenant_id == tenant_id,
            include_aliases=True,
        )
    )


# ── Session acquisition ─────────────────────────────────────────────────────


@asynccontextmanager
async def tenant_session(tenant_id: uuid.UUID) -> AsyncIterator[AsyncSession]:
    """A session bound to one tenant, in both layers, for one transaction.

    `session.begin()` wrapping the whole body is load-bearing, not stylistic. The
    GUC set below is transaction-local; outside an explicit transaction, asyncpg
    autocommits each statement and the setting would either evaporate immediately or
    persist on the pooled connection past the request. Either way the next borrower
    of that connection gets the wrong tenant. The explicit transaction gives the GUC
    a well-defined lifetime that ends at COMMIT or ROLLBACK.
    """
    session_factory = async_sessionmaker(
        engine_for_tenant(tenant_id),
        class_=AsyncSession,
        expire_on_commit=False,
        autoflush=False,
        info={SESSION_TENANT_KEY: tenant_id},
    )
    async with session_factory() as session:
        # bind_tenant wraps session.begin(), not the other way round: the final
        # flush happens during COMMIT, as `begin()` unwinds. Nested the other way,
        # the ambient tenant is already reset by then and new rows flush with a NULL
        # tenant_id — which RLS rejects, correctly and confusingly.
        with bind_tenant(tenant_id):
            async with session.begin():
                await set_current_tenant(session, tenant_id)
                yield session


@asynccontextmanager
async def untenanted_session() -> AsyncIterator[AsyncSession]:
    """A session with no tenant bound.

    For the handful of legitimately cross-tenant operations: resolving a hostname to
    a tenant, platform-operator login, and tenant provisioning. Every tenant-scoped
    table returns zero rows through it — RLS sees a NULL GUC — so this is not a
    backdoor, it just reaches the two tables that have no tenant_id.
    """
    async with SessionFactory() as session:
        with bind_tenant(None):
            async with session.begin():
                await set_current_tenant(session, None)
                yield session


@asynccontextmanager
async def bind_session_to(
    session: AsyncSession, tenant_id: uuid.UUID
) -> AsyncIterator[AsyncSession]:
    """Bind an already-open untenanted session to a tenant, mid-transaction.

    For the flows that cannot know their tenant until they have read something:
    provisioning (the tenant is the row being created) and shared-origin login (the
    academy is looked up from the email). Both start untenanted by necessity and
    must become tenant-bound before they touch a table under RLS.

    All three bindings, because they are read by three different things:

      * the database GUC   — what the RLS policies evaluate
      * ``session.info``   — what the flush listeners read, *including* the autoflush
                             at COMMIT, which happens after this block has exited
      * the ContextVar     — what code inside the block reads via the ambient context

    Only the ContextVar unwinds on exit. That is deliberate: the GUC and
    ``session.info`` persist for the rest of the transaction, so a caller can still
    write tenant-scoped rows (an audit entry, say) after the block closes. The
    transaction itself is what bounds them — see `tenant_session` on why the GUC
    must never outlive one.
    """
    await set_current_tenant(session, tenant_id)
    session.info[SESSION_TENANT_KEY] = tenant_id
    with bind_tenant(tenant_id):
        yield session


async def dispose_engine() -> None:
    await engine.dispose()
