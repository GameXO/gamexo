"""self-serve onboarding: signup directory, onboarding state, court open slots

Revision ID: d2f5a91c47b8
Revises: 3c2068779043
Create Date: 2026-08-22 11:04:18.902317
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic_rls import app_role


revision: str = 'd2f5a91c47b8'
down_revision: Union[str, None] = '3c2068779043'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# What a turf gets before onboarding asks. Kept in sync with
# app/models/tenant.py::_default_services — this copy is frozen at this revision,
# the model's is live, and they are allowed to diverge as later revisions change
# the default for new rows without rewriting old ones.
DEFAULT_SERVICES = (
    '{"booking": true, "checkin": true, "inventory": true, "shop": true, '
    '"membership": false, "academy": false, "events": false, "advertising": false}'
)


def upgrade() -> None:
    # ── Onboarding state ─────────────────────────────────────────────────────
    op.add_column(
        'tenant',
        sa.Column('onboarding_completed_at', sa.DateTime(timezone=True), nullable=True),
    )
    # Every tenant that exists today was provisioned by hand and is already
    # configured. Leaving these NULL would drop their owners into the first-run
    # wizard on the next deploy.
    op.execute("UPDATE tenant SET onboarding_completed_at = now()")

    op.add_column(
        'tenant_settings',
        sa.Column(
            'enabled_services',
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text(f"'{DEFAULT_SERVICES}'::jsonb"),
            nullable=False,
        ),
    )

    # ── The login directory ──────────────────────────────────────────────────
    #
    # No RLS: this is read by an unbound session, before a tenant is known. It is
    # therefore NOT passed to alembic_rls.protect() — the grant is issued by hand
    # below, without the policy that would make it unreadable. See
    # models/user.py::AccountDirectory, and the UNSCOPED_TABLES allowlist in
    # tests/test_tenant_isolation.py, which asserts this is deliberate.
    op.create_table(
        'account_directory',
        sa.Column('email', sa.String(length=320), nullable=False),
        sa.Column('tenant_id', sa.UUID(), nullable=False),
        sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(
            ['tenant_id'], ['tenant.id'], name=op.f('fk_account_directory_tenant_id'), ondelete='CASCADE'
        ),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_account_directory')),
    )
    op.create_index(
        'ix_account_directory_tenant_id', 'account_directory', ['tenant_id'], unique=False
    )
    op.create_index(
        'uq_account_directory_email',
        'account_directory',
        [sa.text('lower(email)')],
        unique=True,
    )
    op.execute(
        f"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE account_directory TO {app_role()}"
    )

    # Backfill from the users that already exist. DISTINCT ON keeps the oldest row
    # per address: the unique index is on lower(email) platform-wide, and if the
    # same person is already employed at two academies exactly one of them can win.
    # Oldest, because that is the account they have been signing in to.
    #
    # FORCE is lifted around the read, and this is load-bearing. `app_user` is FORCE
    # ROW LEVEL SECURITY, which — unlike plain ENABLE — applies to the table's owner
    # as well, and this migration *is* the owner. With `app.current_tenant` unset the
    # policy evaluates `tenant_id = NULL` for every row, so the SELECT returns
    # nothing, the INSERT copies nothing, and it all succeeds silently. The symptom
    # would appear much later, as existing staff being unable to sign in on the
    # shared origin while new signups work fine.
    op.execute("ALTER TABLE app_user NO FORCE ROW LEVEL SECURITY")
    try:
        op.execute(
            """
            INSERT INTO account_directory (email, tenant_id)
            SELECT DISTINCT ON (lower(email)) lower(email), tenant_id
            FROM app_user
            ORDER BY lower(email), created_at
            """
        )
    finally:
        op.execute("ALTER TABLE app_user FORCE ROW LEVEL SECURITY")

    # ── Court configuration ──────────────────────────────────────────────────
    op.add_column('court', sa.Column('rating', sa.Numeric(precision=2, scale=1), nullable=True))
    op.add_column(
        'court',
        sa.Column('display_order', sa.Integer(), server_default=sa.text('0'), nullable=False),
    )
    op.add_column(
        'court',
        sa.Column(
            'open_slots_enabled', sa.Boolean(), server_default=sa.text('false'), nullable=False
        ),
    )
    op.add_column('court', sa.Column('slot_capacity', sa.Integer(), nullable=True))
    op.create_check_constraint(
        op.f('ck_court_rating_within_range'),
        'court',
        'rating IS NULL OR (rating >= 0 AND rating <= 5)',
    )
    op.create_check_constraint(
        op.f('ck_court_open_slots_needs_capacity'),
        'court',
        'NOT open_slots_enabled OR slot_capacity >= 1',
    )

    # ── Open-slot bookings ───────────────────────────────────────────────────
    #
    # The exclusion constraint has to stand aside for courts where overlapping
    # bookings are the point. It can only see columns on `booking`, so the court's
    # setting is denormalised onto each booking at creation time and the predicate
    # tests that instead. Capacity is enforced in application code, under a row lock
    # — see modules/booking/service.py::ensure_open_slot_available.
    op.add_column(
        'booking',
        sa.Column('open_slot', sa.Boolean(), server_default=sa.text('false'), nullable=False),
    )
    # Raw SQL: alembic's drop_constraint has no type_ for EXCLUDE.
    op.execute("ALTER TABLE booking DROP CONSTRAINT booking_no_overlap")
    op.execute(
        "ALTER TABLE booking ADD CONSTRAINT booking_no_overlap "
        "EXCLUDE USING gist ("
        "  tenant_id WITH =, court_id WITH =, time_range WITH &&"
        ") WHERE (status <> 'cancelled' AND NOT open_slot)"
    )


def downgrade() -> None:
    # Rebuilding the strict constraint fails if any open-slot court has taken
    # overlapping bookings — which is exactly the data this feature creates. Cancel
    # them rather than let the downgrade abort halfway: a rollback that leaves the
    # schema half-migrated is worse than one that visibly voids the bookings only
    # this feature made possible.
    op.execute(
        """
        UPDATE booking SET status = 'cancelled',
                           cancelled_at = now(),
                           cancellation_reason = 'Open slots rolled back'
        WHERE open_slot AND status <> 'cancelled'
        """
    )
    op.execute("ALTER TABLE booking DROP CONSTRAINT IF EXISTS booking_no_overlap")
    op.execute(
        "ALTER TABLE booking ADD CONSTRAINT booking_no_overlap "
        "EXCLUDE USING gist ("
        "  tenant_id WITH =, court_id WITH =, time_range WITH &&"
        ") WHERE (status <> 'cancelled')"
    )
    op.drop_column('booking', 'open_slot')

    op.drop_constraint(op.f('ck_court_open_slots_needs_capacity'), 'court', type_='check')
    op.drop_constraint(op.f('ck_court_rating_within_range'), 'court', type_='check')
    op.drop_column('court', 'slot_capacity')
    op.drop_column('court', 'open_slots_enabled')
    op.drop_column('court', 'display_order')
    op.drop_column('court', 'rating')

    op.drop_index('uq_account_directory_email', table_name='account_directory')
    op.drop_index('ix_account_directory_tenant_id', table_name='account_directory')
    op.drop_table('account_directory')

    op.drop_column('tenant_settings', 'enabled_services')
    op.drop_column('tenant', 'onboarding_completed_at')
