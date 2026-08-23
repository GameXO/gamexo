"""partner dialect

Which wire format an integration speaks.

The gateway now has one partner-agnostic core and a thin *dialect* per wire format:
`native` is our own REST contract, `playo` implements theirs. This column records
which one a partner was onboarded onto, so `deps.speaking` can refuse a key used
against the wrong base URL — a partner driving the wrong contract produces results
that look almost right, which is much harder to diagnose than a flat refusal.

Deliberately a plain VARCHAR with no CHECK. The set of dialects is a code-level
registry (`gateway/dialects/__init__.py::DIALECTS`) and onboarding a new partner
must never require a migration; the value is validated against that registry when a
partner is created.

Every existing row becomes `native`, which is what they already were — the Playo
integration is repointed by hand, or simply re-created, since no partner is live yet.

── Before merging ──────────────────────────────────────────────────────────────
The Neon dev database is stamped at `d2f5a91c47b8`, a revision that exists on
neither this branch nor in git history — it adds `booking.open_slot`, so it is a
migration written elsewhere and not yet pushed. This one is chained off
`3c2068779043` so the local chain stays resolvable and the test suite runs.

**When that revision lands, repoint `down_revision` below to `d2f5a91c47b8`.**
Leaving it as-is once both exist gives Alembic two heads, and `upgrade head` then
refuses to run at all.

Revision ID: 91ca6eeccf04
Revises: 3c2068779043
Create Date: 2026-08-23 09:12:31.884210
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '91ca6eeccf04'
down_revision: str | None = 'd2f5a91c47b8'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # server_default fills existing rows in the same statement; dropped afterwards so
    # the application default (models.py) is the only place the value is decided.
    op.add_column(
        'integration_partner',
        sa.Column('dialect', sa.String(length=50), nullable=False, server_default='native'),
    )
    op.alter_column('integration_partner', 'dialect', server_default=None)


def downgrade() -> None:
    op.drop_column('integration_partner', 'dialect')
