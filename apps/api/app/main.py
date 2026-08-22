"""FastAPI application factory."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

from fastapi import APIRouter, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.routing import APIRoute
from fastapi.staticfiles import StaticFiles
from sqlalchemy.engine import make_url

from app.auth import platform_router
from app.auth import router as auth_router
from app.core import storage
from app.core.config import settings
from app.core.errors import register_exception_handlers
from app.core.timing import DbTimingMiddleware
from app.db.session import dispose_engine, warm_pool
from app.modules.academy import router as academy_router
from app.modules.admin import router as admin_router
from app.modules.advertising import router as advertising_router
from app.modules.booking import router as booking_router
from app.modules.finance import router as finance_router
from app.modules.gateway import admin_router as gateway_admin_router
from app.modules.gateway import router as gateway_router
from app.modules.onboarding import router as onboarding_router
from app.modules.payments import router as payments_router
from app.modules.reporting import router as reporting_router
from app.modules.uploads import router as uploads_router
from app.tenancy.deps import TenantCtx

# Importing the model registry populates Base.metadata. Without it, Alembic's
# autogenerate sees an empty schema.
from app import models  # noqa: F401

logger = logging.getLogger("gamexo")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    # Which database this process is talking to, in the terminal, at boot. Two
    # separate debugging sessions have been lost to guessing it from row counts.
    url = make_url(settings.database_url)
    logger.info(
        "gamexo API starting — db=%s/%s role=%s pool=%s",
        url.host,
        url.database,
        url.username,
        settings.db_pool_mode,
    )
    await warm_pool()
    yield
    await dispose_engine()


DESCRIPTION = """
Multi-tenant backend for **gamexo** — white-label management for sports academies.

### Tenancy

Every request is resolved to exactly one academy before it reaches a handler:

* **Production** — the host subdomain, e.g. `myacademy.gamexo.app`.
* **Development** — the `X-Tenant-ID` header with a tenant slug or UUID.
* **Support** — a platform operator token plus `X-Impersonate-Tenant`.

Isolation is enforced twice: the application binds each transaction to a tenant,
and PostgreSQL row-level security independently refuses to return another academy's
rows even if a query forgets to filter.
"""


def unique_operation_id(route: APIRoute) -> str:
    """`academy_listBatches` rather than `list_batches_api_v1_academy_batches_get`.

    FastAPI's default operation id appends the full path and method, which the
    TypeScript generator turns verbatim into function and type names. Deriving the
    id from the route's tag and handler name instead gives the frontend readable
    call sites, and keeps them stable when a path changes.
    """
    tag = route.tags[0] if route.tags else "default"
    head, *rest = route.name.split("_")
    camel = head + "".join(part.title() for part in rest)
    return f"{tag}_{camel}"


def create_app() -> FastAPI:
    app = FastAPI(
        generate_unique_id_function=unique_operation_id,
        title=settings.project_name,
        description=DESCRIPTION,
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
        # Sorted, explicit tags keep the generated TypeScript client's module
        # layout stable between regenerations.
        openapi_tags=[
            {
                "name": "academy",
                "description": "Coaches, programmes, batches, students, sessions and attendance.",
            },
            {
                "name": "admin",
                "description": "Settings, staff, notifications and the job queue.",
            },
            {"name": "advertising", "description": "Ad inventory and campaign contracts."},
            {"name": "auth", "description": "Academy staff authentication."},
            {
                "name": "booking",
                "description": "Sports, courts, equipment, customers and court bookings.",
            },
            {
                "name": "finance",
                "description": "Invoices, payments, membership plans and subscriptions.",
            },
            {
                "name": "payments",
                "description": (
                    "Payment gateway configuration. An academy connects its own "
                    "Razorpay/Cashfree/PhonePe account and chooses which gateway "
                    "collects on the dashboard and which on the counter tablet. "
                    "Key secrets are encrypted at rest and never returned."
                ),
            },
            {"name": "platform", "description": "Platform operator control plane."},
            {"name": "reporting", "description": "Dashboard and Reports aggregates."},
            {
                "name": "gateway",
                "description": (
                    "Externalisation gateway. Third-party platforms (Playo, Hudle) read "
                    "availability and claim slots under a revocable API key, so a court "
                    "is never sold twice. Availability reflects every booking; a partner "
                    "can only read or cancel bookings it created itself."
                ),
            },
            {"name": "health", "description": "Liveness and tenancy diagnostics."},
        ],
    )

    # Outermost of the two, so its numbers cover the whole request. Server-Timing
    # is a response header, and CORS must expose it or the browser hides it.
    app.add_middleware(DbTimingMiddleware)

    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_credentials=True,
            allow_methods=["*"],
            # X-Tenant-ID must be allow-listed explicitly or the browser strips it
            # from cross-origin requests and every dev call resolves to no tenant.
            allow_headers=["Authorization", "Content-Type", "X-Tenant-ID", "X-Impersonate-Tenant"],
            # Without this the timing headers exist on the wire but are unreadable
            # from the browser, which is the only place they are useful.
            expose_headers=["Server-Timing", "X-DB-Queries", "X-DB-Connects"],
        )

    register_exception_handlers(app)

    api = APIRouter(prefix=settings.api_v1_prefix)
    api.include_router(auth_router.router)
    api.include_router(platform_router.router)
    api.include_router(onboarding_router.router)
    api.include_router(booking_router.router)
    api.include_router(academy_router.router)
    api.include_router(advertising_router.router)
    api.include_router(admin_router.router)
    api.include_router(reporting_router.router)
    api.include_router(finance_router.router)
    api.include_router(gateway_router.router)
    api.include_router(gateway_admin_router.router)
    api.include_router(payments_router.router)
    api.include_router(uploads_router.router)
    api.include_router(_health_router())
    app.include_router(api)

    _mount_local_media(app)

    return app


def _mount_local_media(app: FastAPI) -> None:
    """Serve uploaded images from disk when R2 is not configured.

    Development and test only in practice — see core/storage.py on why the local
    backend exists. Mounted rather than routed because these are static bytes with
    no tenancy to resolve: the key already contains the tenant id, and the URL is
    the capability, exactly as it would be coming from a bucket.
    """
    if settings.r2_bucket:
        return

    directory = storage.local_upload_dir()
    directory.mkdir(parents=True, exist_ok=True)
    app.mount("/media", StaticFiles(directory=directory), name="media")


def _health_router() -> APIRouter:
    router = APIRouter(tags=["health"])

    @router.get(
        "/health",
        summary="Liveness probe",
        description=(
            "Names the database this process is actually talking to. Two schema-"
            "identical databases with the same tenant slug are indistinguishable "
            "from row counts alone, and guessing has cost real debugging time."
        ),
    )
    async def health() -> dict[str, str]:
        url = make_url(settings.database_url)
        return {
            "status": "ok",
            "environment": settings.environment,
            # Credentials deliberately absent: this endpoint is unauthenticated,
            # like /health/tenant below.
            "db_host": url.host or "?",
            "db_name": url.database or "?",
            "db_role": url.username or "?",
            "pool_mode": settings.db_pool_mode,
        }

    @router.get(
        "/health/tenant",
        summary="Which academy did this request resolve to?",
        description=(
            "Unauthenticated on purpose: it exercises tenant resolution alone, which "
            "is the piece you want to check first when a request lands in the wrong "
            "academy. It reveals nothing beyond the hostname the caller already used."
        ),
    )
    async def tenant_health(tenant: TenantCtx) -> dict[str, Any]:
        return {"tenant_id": str(tenant.id), "slug": tenant.slug, "resolved_via": tenant.source}

    return router


app = create_app()
