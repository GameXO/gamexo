"""branches: multi-site academies, booking source, branch on invoices

Revision ID: b5d2e8a41c96
Revises: f3c81b6d2e45
Create Date: 2026-10-02 10:00:00.000000

An academy used to be exactly one site, so its address lived on `tenant_settings` and
the invoice header was a constant baked into the frontend bundle. This introduces the
`branch` table and hangs the located things off it:

* `court.branch_id`   — which site a court is at.
* `booking.branch_id` — copied from the court when booked, so moving a court later
                        does not re-home history.
* `invoice.branch_id` — whose address and GSTIN print on the bill. Nullable: ad
                        contracts and pre-existing non-booking invoices have no site.
* `booking.booked_via` — which desk took the booking (counter / office_desk /
                        partner), printed on the receipt as "Source".

Every existing academy gets one default branch built from the business details it
already had in `tenant_settings`, and every existing court, booking and booking
invoice is pointed at it, so nothing is orphaned and nothing visible changes until
an owner adds a second site.

`booked_via` is backfilled where it can honestly be: a partner booking is `partner`,
and one with a known creator is `counter` if that user is the shared kiosk login and
`office_desk` otherwise. Seeded rows and ones made by a platform operator have no
`app_user` behind them and stay NULL — "unknown" is better than a guess on a receipt.

── Why FORCE is lifted ─────────────────────────────────────────────────────────
`tenant_settings`, `court`, `booking`, `invoice` and `app_user` carry FORCE ROW LEVEL
SECURITY, which binds the table owner too. This migration runs as that owner with no
`app.current_tenant` set, so the policy would hide every row and each backfill would
silently update nothing — leaving NOT NULL to fail, or worse, not to. FORCE is lifted
around the data steps and restored in a `finally`, the same as earlier backfills.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from alembic_rls import protect, unprotect

revision: str = 'b5d2e8a41c96'
down_revision: Union[str, None] = 'f3c81b6d2e45'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

BACKFILL_TABLES = ("tenant_settings", "court", "booking", "invoice", "app_user")


def _force_rls(on: bool) -> None:
    keyword = "FORCE" if on else "NO FORCE"
    for table in BACKFILL_TABLES:
        op.execute(f"ALTER TABLE {table} {keyword} ROW LEVEL SECURITY")


def upgrade() -> None:
    op.create_table(
        'branch',
        sa.Column('name', sa.String(length=150), nullable=False),
        sa.Column('address', sa.Text(), nullable=True),
        sa.Column('city', sa.String(length=120), nullable=True),
        sa.Column('state', sa.String(length=120), nullable=True),
        sa.Column('pincode', sa.String(length=12), nullable=True),
        sa.Column('phone', sa.String(length=32), nullable=True),
        sa.Column('email', sa.String(length=320), nullable=True),
        sa.Column('gstin', sa.String(length=20), nullable=True),
        sa.Column('is_default', sa.Boolean(), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('tenant_id', sa.UUID(), nullable=False),
        sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint('char_length(name) > 0', name=op.f('ck_branch_name_not_blank')),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenant.id'], name=op.f('fk_branch_tenant_id'), ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_branch')),
    )
    op.create_index(op.f('ix_branch_tenant_id'), 'branch', ['tenant_id'], unique=False)
    op.create_index('uq_branch_tenant_name', 'branch', ['tenant_id', sa.text('lower(name)')], unique=True)
    op.create_index(
        'uq_branch_tenant_default', 'branch', ['tenant_id'], unique=True,
        postgresql_where=sa.text('is_default'),
    )

    # New nullable columns first; they are tightened once the backfill has run.
    op.add_column('court', sa.Column('branch_id', sa.UUID(), nullable=True))
    op.add_column('booking', sa.Column('branch_id', sa.UUID(), nullable=True))
    op.add_column('booking', sa.Column('booked_via', sa.String(length=32), nullable=True))
    op.add_column('invoice', sa.Column('branch_id', sa.UUID(), nullable=True))

    _force_rls(False)
    try:
        # One default branch per academy, from the business details it already had.
        # GSTIN is deliberately left NULL: a branch without its own falls back to the
        # academy's, so a later edit to the settings GSTIN keeps flowing through.
        op.execute(
            """
            INSERT INTO branch (tenant_id, name, address, city, phone, email, is_default, is_active)
            SELECT t.id,
                   COALESCE(NULLIF(btrim(ts.business_name), ''), t.name),
                   ts.address, ts.city, ts.phone, ts.email,
                   true, true
            FROM tenant t
            LEFT JOIN tenant_settings ts ON ts.tenant_id = t.id
            """
        )
        op.execute(
            """
            UPDATE court c SET branch_id = b.id
            FROM branch b
            WHERE b.tenant_id = c.tenant_id AND b.is_default
            """
        )
        op.execute(
            """
            UPDATE booking bk SET branch_id = c.branch_id
            FROM court c
            WHERE c.id = bk.court_id
            """
        )
        op.execute(
            """
            UPDATE booking bk SET booked_via = CASE
                WHEN bk.created_by_partner_id IS NOT NULL THEN 'partner'
                -- No matching app_user (seeded row, platform operator) leaves the
                -- subquery empty, so the result is NULL: unknown, not guessed.
                ELSE (
                    SELECT CASE WHEN u.role = 'kiosk' THEN 'counter' ELSE 'office_desk' END
                    FROM app_user u WHERE u.id = bk.created_by_user_id
                )
            END
            """
        )
        op.execute(
            """
            UPDATE invoice i SET branch_id = bk.branch_id
            FROM booking bk
            WHERE i.booking_id = bk.id
            """
        )
    finally:
        # In a finally so a failed backfill cannot leave the tables unprotected.
        _force_rls(True)

    op.alter_column('court', 'branch_id', nullable=False)
    op.alter_column('booking', 'branch_id', nullable=False)

    op.create_foreign_key(op.f('fk_court_branch_id'), 'court', 'branch', ['branch_id'], ['id'], ondelete='RESTRICT')
    op.create_foreign_key(op.f('fk_booking_branch_id'), 'booking', 'branch', ['branch_id'], ['id'], ondelete='RESTRICT')
    op.create_foreign_key(op.f('fk_invoice_branch_id'), 'invoice', 'branch', ['branch_id'], ['id'], ondelete='RESTRICT')
    op.create_index('ix_court_tenant_branch', 'court', ['tenant_id', 'branch_id'], unique=False)
    op.create_index('ix_booking_tenant_branch_start', 'booking', ['tenant_id', 'branch_id', 'starts_at'], unique=False)

    protect(("branch",))


def downgrade() -> None:
    unprotect(("branch",))

    op.drop_index('ix_booking_tenant_branch_start', table_name='booking')
    op.drop_index('ix_court_tenant_branch', table_name='court')
    op.drop_constraint(op.f('fk_invoice_branch_id'), 'invoice', type_='foreignkey')
    op.drop_constraint(op.f('fk_booking_branch_id'), 'booking', type_='foreignkey')
    op.drop_constraint(op.f('fk_court_branch_id'), 'court', type_='foreignkey')
    op.drop_column('invoice', 'branch_id')
    op.drop_column('booking', 'booked_via')
    op.drop_column('booking', 'branch_id')
    op.drop_column('court', 'branch_id')

    op.drop_index('uq_branch_tenant_default', table_name='branch')
    op.drop_index('uq_branch_tenant_name', table_name='branch')
    op.drop_index(op.f('ix_branch_tenant_id'), table_name='branch')
    op.drop_table('branch')
