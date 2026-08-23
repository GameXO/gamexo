"""playo order holds

Playo's order-based flow is two-phase: `/order/create` blocks a court while the
customer is still in checkout, and `/order/confirm` turns that block into a booking
once payment clears. This adds what the block needs.

Three columns, no new table. A hold has to compete for a court against counter
bookings, dashboard bookings and other platforms — and `booking_no_overlap` is an
exclusion constraint on `booking`, which cannot see rows in any other table. Putting
holds anywhere else would mean the one guarantee this integration exists to provide
does not hold across it.

  * `hold_expires_at` — when an unconfirmed hold stops blocking the court. The
    exclusion constraint has no notion of a TTL, so an abandoned checkout would
    block a court forever; `service.release_expired_holds` flips expired holds to
    cancelled before every availability read and every create.

  * `partner_booking_ref` — Playo issues a `playoOrderId` with the order and a
    different `playoBookingId` afterwards, via `/booking/map`. Reconciliation
    matches on whichever the other side is quoting, so they are kept apart.

  * `integration_partner.external_venue_id` — the id Playo knows this venue by,
    checked against the `venueId` in every request. The API key already says which
    academy is being addressed; this catches a venue configured against the wrong
    key before it writes bookings into someone else's diary.

No data migration. `status` is a VARCHAR with no CHECK constraint (see
db/types.py::enum_type), so the new `held` value needs no DDL, and every existing
row keeps a status that is still valid.

Revision ID: 3c2068779043
Revises: f093cdbd55e9
Create Date: 2026-08-22 10:14:52.331907
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '3c2068779043'
down_revision: str | None = 'f093cdbd55e9'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('booking', sa.Column('partner_booking_ref', sa.String(length=120), nullable=True))
    op.add_column('booking', sa.Column('hold_expires_at', sa.DateTime(timezone=True), nullable=True))

    # The sweeper's query: expired holds, oldest first. Partial, because holds are a
    # handful of rows against a table of every booking ever taken — and this runs on
    # the availability path, which is the hottest read the gateway has.
    op.create_index(
        'ix_booking_expired_holds',
        'booking',
        ['tenant_id', 'hold_expires_at'],
        postgresql_where=sa.text("status = 'held'"),
    )

    op.add_column(
        'integration_partner', sa.Column('external_venue_id', sa.String(length=120), nullable=True)
    )


def downgrade() -> None:
    # Holds are not real bookings, and leaving them behind as `held` rows would keep
    # courts blocked with nothing left to expire them. Released first.
    #
    # FORCE lifted for the duration: this migration runs as the table owner with no
    # `app.current_tenant` bound, and FORCE binds the owner too — so the UPDATE would
    # match zero rows and silently leave every academy's courts blocked.
    op.execute('ALTER TABLE booking NO FORCE ROW LEVEL SECURITY')
    try:
        op.execute("UPDATE booking SET status = 'cancelled' WHERE status = 'held'")
    finally:
        op.execute('ALTER TABLE booking FORCE ROW LEVEL SECURITY')

    op.drop_column('integration_partner', 'external_venue_id')
    op.drop_index('ix_booking_expired_holds', table_name='booking')
    op.drop_column('booking', 'hold_expires_at')
    op.drop_column('booking', 'partner_booking_ref')
