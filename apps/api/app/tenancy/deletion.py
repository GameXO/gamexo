"""Hard-deleting an academy, and everything it owned.

This is the most destructive operation the platform has, so the two things that make
it survivable are both here rather than at the call site:

  * **The order is derived, not written down.** SQLAlchemy already knows the foreign
    key graph, so `sorted_tables` gives a topological order and reversing it deletes
    children before parents. A hand-maintained list would be correct on the day it
    was written and silently wrong the first time somebody adds a table — and the
    failure mode of "wrong" here is a half-deleted academy.

  * **It runs bound to the tenant.** All 31 tenant-owned tables are FORCE ROW LEVEL
    SECURITY, which applies to the table owner too. Without `app.current_tenant` set,
    every one of these DELETEs matches zero rows, reports success, and leaves the
    data exactly where it was — the same silent no-op that stamped every
    `account_directory` username with an email address in revision c3b81d47f602. Any
    future caller that forgets `bind_session_to` gets a loud RESTRICT violation on
    the final DELETE rather than a quiet partial success, because the child rows will
    still be there.

Two tables carry a `tenant_id` and are deliberately *not* deleted here, because they
are not the academy's data and their foreign keys already say so:

  * `account_directory` — ON DELETE CASCADE. Goes with the tenant automatically.
  * `signup_intent` — ON DELETE SET NULL. This is the record that somebody paid us:
    it exists before the tenant does and outlives it, carrying the Razorpay order and
    payment ids. Deleting an academy must not erase the evidence of its purchase.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import delete, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFoundError
from app.db.base import Base, TenantScoped
from app.db.session import bind_session_to
from app.models.tenant import DeletedTenant, Tenant


#: Append-only ledgers. The app role holds no DELETE grant on either — that is how
#: "history is not editable" is enforced (see alembic_rls.protect(append_only=...)) —
#: so their rows go through the `purge_tenant_ledgers` SECURITY DEFINER function
#: instead. Named here rather than discovered, because a table quietly losing its
#: append-only grant should break this loudly rather than start being deleted
#: directly.
APPEND_ONLY = frozenset({"audit_log", "equipment_movement"})


def tables_to_clear() -> list[str]:
    """Every tenant-owned table, children first.

    Computed from the mapper registry each call rather than cached, because the whole
    point is that it tracks the models instead of a list somebody has to remember to
    update. It is a few dozen dictionary lookups against an import-time structure.
    """
    owned = {
        mapper.class_.__tablename__
        for mapper in Base.registry.mappers
        if issubclass(mapper.class_, TenantScoped)
    }
    return [t.name for t in reversed(Base.metadata.sorted_tables) if t.name in owned]


async def delete_tenant(
    session: AsyncSession,
    *,
    tenant_id: uuid.UUID,
    deleted_by_id: uuid.UUID | None = None,
    deleted_by_label: str | None = None,
) -> DeletedTenant:
    """Destroy an academy and everything it owned. Returns the tombstone.

    Does not commit — the caller owns the transaction, so a failure anywhere in the
    cascade takes the whole deletion with it and the academy is left untouched rather
    than partly gone.
    """
    tenant = (
        await session.execute(select(Tenant).where(Tenant.id == tenant_id))
    ).scalar_one_or_none()
    if tenant is None:
        raise NotFoundError("No academy with that id.")

    # Read the identity out before it stops existing.
    tombstone = DeletedTenant(
        tenant_id=tenant.id,
        slug=tenant.slug,
        name=tenant.name,
        plan_tier=tenant.plan_tier,
        status=str(tenant.status),
        deleted_at=datetime.now(UTC),
        deleted_by_id=deleted_by_id,
        deleted_by_label=deleted_by_label,
        row_counts={},
    )

    counts: dict[str, int] = {}
    async with bind_session_to(session, tenant.id):
        for name in tables_to_clear():
            table = Base.metadata.tables[name]
            # Counted before the delete rather than from `rowcount`, so the number in
            # the tombstone means "this much existed" even if a driver reports
            # affected rows differently.
            counts[name] = (
                await session.execute(
                    select(func.count()).select_from(table).where(
                        table.c.tenant_id == tenant.id
                    )
                )
            ).scalar_one()
            if not counts[name] or name in APPEND_ONLY:
                continue
            await session.execute(delete(table).where(table.c.tenant_id == tenant.id))

        # The append-only ledgers, through the one function allowed to touch them.
        # Called unconditionally: it is cheap, and skipping it when the counts look
        # like zero would mean trusting a count over the RESTRICT constraint that is
        # about to be enforced anyway.
        await session.execute(
            text("SELECT purge_tenant_ledgers(:tenant_id)"), {"tenant_id": tenant.id}
        )

    # Only the tables that actually held something, so the record is readable at a
    # glance instead of thirty-one zeroes.
    tombstone.row_counts = {k: v for k, v in counts.items() if v}
    session.add(tombstone)
    await session.flush()

    # Last, and outside the tenant binding: `tenant` carries no RLS. If any table was
    # missed, the RESTRICT foreign keys fail here and take the whole transaction with
    # them — which is exactly the outcome to want.
    await session.execute(delete(Tenant).where(Tenant.id == tenant.id))
    await session.flush()

    return tombstone
