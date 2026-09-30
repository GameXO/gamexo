"""booking.partner_cancel_requested_at: venue-side cancels of platform bookings

Revision ID: f3c81b6d2e45
Revises: a2d41e7c93b8
Create Date: 2026-09-29 10:00:00.000000

A booking sold on Playo (or Hudle, or District) was paid for on *their* side, and
only they can refund the customer. Their contract has no call for the venue to cancel
one, so a staff-side cancel here freed the court for resale while the customer still
held a valid ticket and the platform still paid the venue for it.

Staff now *request* the cancellation instead. The booking stays live — the court
stays blocked — and this column records when the request was made, until the
platform's own cancel call arrives and closes it through the ordinary path. Kept
after that too: "asked at 10:02, Playo cancelled at 14:40" is the history anyone
chasing a late refund needs.

Nullable with no default: NULL is "nobody asked", which is every existing row.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'f3c81b6d2e45'
down_revision: Union[str, None] = 'a2d41e7c93b8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'booking',
        sa.Column('partner_cancel_requested_at', sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('booking', 'partner_cancel_requested_at')
