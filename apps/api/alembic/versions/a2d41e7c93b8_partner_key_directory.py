"""partner key directory, and publishable keys

Before this, a partner call to a shared origin could not resolve a tenant at all:

    GET /api/v1/gateway/availability      X-API-Key: gx_playo_….…
    → 400 tenant_unresolved
      "Could not determine the academy from host 'gamexo-i6mt.onrender.com'."

`_plan_resolution` accepts a host subdomain, `X-Tenant-ID` (which the production
guard forbids) or a JWT. A platform has none of the three, so every published
integration — Playo's included — hit that 400 in production. Verified against the
live deployment, not inferred.

The key already identifies exactly one academy: `uq_partner_key_prefix` is globally
unique for precisely that reason. What was missing is a way to *read* it before a
tenant exists, because `integration_partner` is tenant-scoped and an unbound session
sees zero rows through RLS.

── Why a directory table ───────────────────────────────────────────────────────
The same answer, for the same reason, as `account_directory`: something outside the
policy has to say which academy owns a credential, and the smallest such thing is a
two-column mirror carrying nothing secret. `key_prefix` is the public half of the key
— deliberately printable in logs and bug reports — and `tenant_id` is opaque. The
hashed secret never leaves `integration_partner`, and authentication still runs
afterwards inside the resolved tenant.

A SECURITY DEFINER function was the alternative and is the wrong tool here:
`integration_partner` is FORCE ROW LEVEL SECURITY, which binds the owner too, so the
function would still match zero rows without a tenant already bound — the very thing
being resolved.

── Why a trigger, not application code ─────────────────────────────────────────
Four operations move a prefix: create, rotate, re-point, delete. A mirror that
depends on four call sites remembering is a mirror that goes stale, and stale here
means a live integration that cannot find its academy — which presents as an outage,
not as a bug. The trigger cannot be bypassed by a script, a fixture or a future
endpoint.

Revision ID: a2d41e7c93b8
Revises: e5b9c14f2a70
Create Date: 2026-09-26 09:41:02.117364
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from alembic_rls import app_role

revision: str = 'a2d41e7c93b8'
down_revision: str | None = 'e5b9c14f2a70'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ── Publishable keys ────────────────────────────────────────────────────
    #
    # `secret` for every existing partner, so nothing that works today narrows.
    op.add_column(
        'integration_partner',
        sa.Column('key_kind', sa.String(length=16), server_default='secret', nullable=False),
    )
    op.add_column(
        'integration_partner',
        sa.Column(
            'allowed_origins',
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
    )

    op.create_table(
        'partner_key_directory',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text('gen_random_uuid()')),
        sa.Column('key_prefix', sa.String(length=32), nullable=False, unique=True),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('tenant.id', ondelete='CASCADE'), nullable=False),
        sa.Column('dialect', sa.String(length=50), nullable=False),
        sa.Column('allowed_origins', postgresql.JSONB(astext_type=sa.Text()),
                  server_default=sa.text("'[]'::jsonb"), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
    )

    # No RLS, by design — see the model docstring. The grant is issued by hand for
    # the same reason account_directory's is: `protect()` would attach a tenant
    # policy, and a policy here would defeat the entire purpose.
    op.execute(
        f"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE partner_key_directory "
        f"TO {app_role()}"
    )

    # ── The mirror ──────────────────────────────────────────────────────────
    #
    # SECURITY DEFINER so the trigger can write the directory regardless of the
    # caller's own grants, and `search_path` pinned so it cannot be redirected at
    # another schema's table.
    op.execute(
        """
        CREATE OR REPLACE FUNCTION sync_partner_key_directory()
        RETURNS trigger
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = public
        AS $$
        BEGIN
            IF (TG_OP = 'DELETE') THEN
                DELETE FROM partner_key_directory WHERE key_prefix = OLD.key_prefix;
                RETURN OLD;
            END IF;

            -- Rotation changes the prefix itself, so the old row has to go or it
            -- would keep resolving a key that no longer authenticates.
            IF (TG_OP = 'UPDATE' AND NEW.key_prefix IS DISTINCT FROM OLD.key_prefix) THEN
                DELETE FROM partner_key_directory WHERE key_prefix = OLD.key_prefix;
            END IF;

            INSERT INTO partner_key_directory
                (key_prefix, tenant_id, dialect, allowed_origins)
            VALUES (NEW.key_prefix, NEW.tenant_id, NEW.dialect, NEW.allowed_origins)
            ON CONFLICT (key_prefix) DO UPDATE
                SET tenant_id       = EXCLUDED.tenant_id,
                    dialect         = EXCLUDED.dialect,
                    allowed_origins = EXCLUDED.allowed_origins,
                    updated_at      = now();
            RETURN NEW;
        END;
        $$
        """
    )
    op.execute(
        """
        CREATE TRIGGER trg_sync_partner_key_directory
        AFTER INSERT OR UPDATE OR DELETE ON integration_partner
        FOR EACH ROW EXECUTE FUNCTION sync_partner_key_directory()
        """
    )

    # ── Backfill ────────────────────────────────────────────────────────────
    #
    # FORCE ROW LEVEL SECURITY binds the table owner too, and this migration runs
    # as that owner with no `app.current_tenant` set — so a straight INSERT ... SELECT
    # would read zero rows from integration_partner, report success, and leave every
    # existing integration unable to resolve its academy. Exactly the silent no-op
    # that stamped every account_directory username with an email in c3b81d47f602.
    op.execute("ALTER TABLE integration_partner NO FORCE ROW LEVEL SECURITY")
    try:
        op.execute(
            """
            INSERT INTO partner_key_directory
                (key_prefix, tenant_id, dialect, allowed_origins)
            SELECT key_prefix, tenant_id, dialect, allowed_origins
            FROM integration_partner
            ON CONFLICT (key_prefix) DO NOTHING
            """
        )
    finally:
        op.execute("ALTER TABLE integration_partner FORCE ROW LEVEL SECURITY")


def downgrade() -> None:
    op.drop_column('integration_partner', 'allowed_origins')
    op.drop_column('integration_partner', 'key_kind')
    op.execute("DROP TRIGGER IF EXISTS trg_sync_partner_key_directory ON integration_partner")
    op.execute("DROP FUNCTION IF EXISTS sync_partner_key_directory()")
    op.drop_table('partner_key_directory')
