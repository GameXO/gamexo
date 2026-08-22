"""Reconcile the development database revision with this migration tree.

The referenced revision was applied to the shared development database, but its
file is not present in this checkout. The schema already contains the booking
reference changes represented by the preceding local revision, so this bridge
intentionally performs no DDL and lets later migrations continue safely.
"""

from collections.abc import Sequence


revision: str = '3c2068779043'
down_revision: str | None = 'f093cdbd55e9'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass