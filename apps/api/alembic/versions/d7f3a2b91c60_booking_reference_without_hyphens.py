"""booking reference without hyphens

`XC-B-0042` becomes `XCB0042`. Same prefix, same series letter, same counter value —
only the separators go. Invoices, members, coaches and students are untouched and
keep theirs; they are read off a screen, not typed by a customer.

The booking reference is the one number a customer keys in themselves, at the
counter, on a touchscreen keyboard with no hyphen key. `normalise_reference` already
accepted `XCB0042` as input, so people were typing the compact form and reading the
hyphenated one off their ticket. This makes the two the same string.

── Why existing rows have to be rewritten ──────────────────────────────────────
Check-in itself survives either way: `matches_booking_code` compacts both sides
before comparing, so `XCB0042` already finds a row stored as `XC-B-0042`.

The desk search does not. `GET /bookings?search=` is a substring `ilike` against
`booking.reference`, so with the two formats mixed a receptionist typing the code off
a ticket finds nothing for any booking taken before today. The bookings list would
also show both shapes in one column, which is its own way of making staff doubt which
code is the real one.

Rebuilt from its parts rather than by stripping hyphens out of the stored string.
`invoice_prefix` is free text an academy sets for itself, so a prefix may legitimately
contain a hyphen, and `replace(reference, '-', '')` would eat that one too — leaving a
reference that no longer matches what the normaliser will build for that tenant.

── Why FORCE is lifted ─────────────────────────────────────────────────────────
Same reason as f093cdbd55e9, which created these references: `booking` and
`tenant_settings` carry FORCE ROW LEVEL SECURITY, which binds the table owner too.
This migration runs as that owner with no `app.current_tenant` set, so the policy
predicate is false and a straight UPDATE would touch zero rows and report success.

Revision ID: d7f3a2b91c60
Revises: c8a5e10b7d34
Create Date: 2026-09-03 11:20:41.336218
"""

from collections.abc import Sequence

from alembic import op

revision: str = 'd7f3a2b91c60'
down_revision: str | None = 'c8a5e10b7d34'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: Read and written across every tenant below.
BACKFILL_TABLES = ('booking', 'tenant_settings')

#: The tenant's prefix, or the column default if the academy somehow has no settings
#: row — matching what `normalise_reference` would build for it. A scalar subquery
#: rather than a join so a booking without settings is still converted rather than
#: silently skipped.
PREFIX = """
    COALESCE(
        (SELECT s.invoice_prefix FROM tenant_settings AS s WHERE s.tenant_id = b.tenant_id),
        'XC'
    )
"""

#: The counter, exactly as stored. Deliberately not re-padded: `lpad(x, 4, '0')`
#: *truncates* when x is longer than 4, so an academy past its ten-thousandth booking
#: would have `XC-B-12345` rewritten to `XCB1234` — a real reference belonging to a
#: different customer. The digits already carry whatever padding they were given.
COUNTER = "substring(b.reference from '[0-9]+$')"

#: The WHERE clause matches only the old shape, so a row already converted is left
#: alone and re-running this against a converted database changes nothing.
#:
#: Safe under the unique index on (tenant_id, reference): within a tenant the rewrite
#: is one-to-one on the counter value, and no new value can collide with an old one
#: because every old value contains '-B-' and no new one does.
#:
#: Module-level, and tenant-agnostic on purpose, so `test_booking_reference.py` can
#: run this exact statement over rows put back into the old shape. A migration whose
#: backfill is never executed against real rows is a migration nobody has tested.
UPGRADE_SQL = f"""
    UPDATE booking AS b
    SET reference = {PREFIX} || 'B' || {COUNTER}
    WHERE b.reference ~ '-B-[0-9]+$'
"""

DOWNGRADE_SQL = f"""
    UPDATE booking AS b
    SET reference = {PREFIX} || '-B-' || {COUNTER}
    WHERE b.reference !~ '-B-[0-9]+$'
      AND b.reference ~ '[0-9]+$'
"""


def _force_rls(on: bool) -> None:
    keyword = 'FORCE' if on else 'NO FORCE'
    for table in BACKFILL_TABLES:
        op.execute(f'ALTER TABLE {table} {keyword} ROW LEVEL SECURITY')


def upgrade() -> None:
    _force_rls(False)
    try:
        op.execute(UPGRADE_SQL)
    finally:
        # In a finally so a failed backfill cannot leave the tables unprotected.
        _force_rls(True)


def downgrade() -> None:
    _force_rls(False)
    try:
        op.execute(DOWNGRADE_SQL)
    finally:
        _force_rls(True)
