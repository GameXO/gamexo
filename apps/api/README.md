# gamexo API

Multi-tenant backend for gamexo — white-label management for sports academies.
FastAPI + PostgreSQL, pooled multi-tenancy with Row-Level Security.

Design and the full entity catalog: [`docs/backend/architecture.md`](../../docs/backend/architecture.md).

## Quick start

```bash
# from the repo root — Postgres + API, migrations and seed run automatically
docker compose up

open http://localhost:8000/docs
```

The repo is a turborepo: the frontend is `apps/web`, this API is `apps/api`.

```bash
# tenant #1 is resolved, no auth needed
curl -H 'X-Tenant-ID: xcourt' http://localhost:8000/api/v1/health/tenant

# staff login — whatever SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD were set to.
# The values below are docker-compose.yml's; the seed script has no built-in
# credentials and refuses to run until both are set.
curl -H 'X-Tenant-ID: xcourt' -H 'Content-Type: application/json' \
     -d '{"email":"admin@xcourtsports.com","password":"xcourt-admin-dev"}' \
     http://localhost:8000/api/v1/auth/login
```

## Working locally without Docker for the API

```bash
docker compose up -d postgres      # Postgres on host port 5433
cd apps/api
cp .env.example .env
uv sync
uv run alembic upgrade head
uv run python -m app.seed.seed
uv run uvicorn app.main:app --reload
```

Host port **5433**, not 5432: a locally installed Postgres bound to `127.0.0.1`
takes precedence over Docker's `0.0.0.0` bind, and connections silently reach the
wrong server.

## Tests

```bash
docker compose up -d postgres
cd apps/api && uv run pytest
```

Runs against a separate `gamexo_test` database with the same two-role privilege
model as production — connecting as an owner or superuser would make every
isolation assertion pass vacuously.

If `apps/api/.env` is missing, `. ./devenv.sh` exports the same values for one-off
CLI work (Alembic, the seed, the worker).

`tests/test_tenant_isolation.py` is the file that matters. It attacks each layer
separately, and several tests use raw SQL specifically so the ORM's own filtering
is not what saves them. To confirm they are not vacuous:

```bash
docker compose exec postgres psql -U gamexo_migrator -d gamexo_test \
  -c "ALTER TABLE app_user DISABLE ROW LEVEL SECURITY;"
uv run pytest tests/test_tenant_isolation.py   # 8 failures
docker compose exec postgres psql -U gamexo_migrator -d gamexo_test \
  -c "ALTER TABLE app_user ENABLE ROW LEVEL SECURITY; ALTER TABLE app_user FORCE ROW LEVEL SECURITY;"
```

## How tenancy works

Every request resolves to exactly one academy before reaching a handler:

1. **Host subdomain** — `myacademy.gamexo.app` → `myacademy`. The production path.
2. **`X-Tenant-ID`** — a slug or UUID, for development and API testing. Gated on
   `ALLOW_TENANT_HEADER`; `core/config.py` refuses to boot a production app with it
   enabled, because it lets any caller name any academy.
3. **`X-Impersonate-Tenant`** — support access, honoured only for a fully verified
   platform-operator token, and audit-logged.

The JWT's `tid` claim is deliberately *not* a resolution source — it is checked
against the independently resolved tenant. If it were the source, a token minted
for academy A would resolve to A no matter whose hostname it arrived on, and
cross-tenant replay would be indistinguishable from normal traffic.

Isolation is then enforced twice:

- **Application** — `db/session.py` stamps `tenant_id` on INSERT and appends a
  tenant predicate to every ORM SELECT. No endpoint threads `tenant_id` by hand.
- **PostgreSQL RLS** — every tenant-scoped table has a policy with both `USING` and
  `WITH CHECK`. A query that forgets its filter returns nothing rather than
  everything.

Two database roles, and this is the part that is easy to get wrong:

| Role | Used by | Rights |
|---|---|---|
| `gamexo_migrator` | Alembic | Owns the schema. DDL. |
| `gamexo_app` | the API | DML only. `NOSUPERUSER`, `NOBYPASSRLS`, owns nothing. |

Postgres exempts a table's owner from its own policies unless `FORCE ROW LEVEL
SECURITY` is set, and exempts superusers and `BYPASSRLS` roles unconditionally. If
the API connected as the owner, the policies would be decorative.
`test_app_role_cannot_bypass_rls` asserts these properties directly.

## Layout

```
app/
  core/          config, security (JWT + bcrypt), error envelope
  db/            Base, TenantScoped mixin, engines, RLS helpers, tenant-scoped session
  tenancy/       context, host/header resolution, FastAPI dependencies
  auth/          login, refresh, me, RBAC guards, platform control plane
  models/        the registry — a model not imported here gets no table and no policy
  modules/
    branches/    the physical sites an academy trades from
    booking/     sports, courts, equipment, customers, bookings, availability
    finance/     invoices, per-tenant numbering, payments, memberships
    academy/     coaches, programmes, batches, students, sessions, attendance
    advertising/ ad spots and contracts
    admin/       settings, staff, notifications, channel config, jobs
    reporting/   the dashboard and Reports aggregates
  jobs/          worker.py — cron entrypoint over the jobs table
  seed/          tenant #1 plus representative data
alembic/         migrations, including the RLS and GRANT statements
alembic_rls.py   shared RLS/GRANT DDL used by every migration after the first
scripts/         export_openapi.py
tests/           500+ tests
```

## Branches

An academy trades from one or more physical sites. Every academy has at least one:
`provision_tenant` creates a default branch named after the business, and the
`b5d2e8a41c96` migration backfilled one for each existing academy from its
`tenant_settings` details.

- **A court belongs to exactly one branch** (`court.branch_id`, required). Omit it on
  `POST /courts` to use the default branch; `GET /courts?branch_id=` filters to one
  site, which is how the counter tablet shows only its own courts.
- **A booking snapshots its court's branch** (`booking.branch_id`) so moving a court
  later does not re-home history.
- **An invoice prints the branch it was raised at** (`invoice.branch_id`, nullable —
  ad contracts have no site). Booking and invoice detail responses carry a `branch`
  object (`BranchInfo`) with the GSTIN already resolved: the branch's own, or the
  academy's from Settings when it has none. Invoice emails use the same.
- **Exactly one default**, enforced by a partial unique index. Branch names are unique
  per academy, case-insensitively. A branch is never deleted, only deactivated; the
  default cannot be deactivated, nor can a branch that still has bookable courts.

| Endpoint | Who | |
|---|---|---|
| `GET /branches` | kiosk and up | Active branches, default first. Reception and up may pass `include_inactive`. |
| `POST /branches` | admin | Add a branch. `gstin` is format-checked (15 characters). |
| `PATCH /branches/{id}` | admin | Edit, deactivate, or make default. |

### Booking source

`booking.booked_via` records which desk took a booking: `counter` (the shared kiosk
login), `office_desk` (staff at the dashboard) or `partner` (arrived through the
gateway). It is stamped by the server from who is logged in and is never read from the
request body. It is `NULL` on bookings that predate the column and could not be
attributed. Not to be confused with `booking_type` (walk-in, advance, …) or
`source_platform` (which marketplace, for partner bookings).

## Sports and courts

A sport has a name, colours/icon, three rates and a default slot length, plus its own
**`image_url`** (cover photo — wins over the CDN's `sports/<slug>.jpg`, which is how a
sport the venue made up gets a picture), a **`description`** of the facility and an
**`images`** gallery (max 8). `GET /sports/catalogue` is the stock menu a sport is picked
from; selecting one creates the row. A court belongs to a sport and carries its own rates,
`images` (max 5), `amenities`, `is_bookable` and `operating_hours` (`{open, close}`,
`HH:MM`; a close at or before the open means it runs past midnight, and `24:00` is not
valid — it silently falls back to the default). A court with bookings cannot be deleted,
only disabled.

## Background worker

```bash
uv run python -m app.jobs.worker              # all active tenants, then exit
uv run python -m app.jobs.worker --tenant xcourt
```

Expires lapsed memberships, raises renewal reminders, advances booking states and drains the
`job` table. Cron-driven rather than a daemon; jobs are claimed with `FOR UPDATE SKIP LOCKED`
so running several workers is safe if the volume ever justifies it.

## Regenerating the frontend client

```bash
pnpm --filter figma-make-app run generate:api
```

Exports the OpenAPI schema straight from the app (no server needed) into
`apps/web/src/api/` and regenerates the TypeScript types. See that directory's README.

## Adding a model

1. Inherit `TenantScoped` (`app/db/base.py`) — that is what drives automatic
   `tenant_id` stamping, the read filter, and the RLS coverage check.
2. Import it in `app/models/__init__.py`.
3. `uv run alembic revision --autogenerate -m "..."`, then add the RLS block for the
   new table (use `protect(TABLES)` from `alembic_rls.py`).
4. Uniqueness is `UNIQUE (tenant_id, <field>)`, never bare. Composite indexes lead
   with `tenant_id`.
5. Money is `money()` from `db/types.py` (`NUMERIC(12,2)`), never float. Status enums
   use `enum_type()`, which stores the enum's *value* so the database, the API and
   the frontend's literal unions all read the same.

`test_every_business_table_is_tenant_scoped` fails the build if step 1 is skipped.

## Configuration

See [`.env.example`](.env.example) — every variable is documented there. The
settings model refuses to start a production app that has `ALLOW_TENANT_HEADER`
on, uses one role for both the app and migrations, or has a JWT secret under 32
characters.

`DB_POOL_MODE=external_pooler` targets PgBouncer or a Neon pooled endpoint:
`NullPool` plus a disabled prepared-statement cache. Both are needed in transaction
pooling mode, and both fail under load rather than at startup.
