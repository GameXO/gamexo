"""repair account_directory usernames left stamped with the email

Revision ID: f1c72d9a4e88
Revises: c3b81d47f602
Create Date: 2026-08-25 10:00:00.000000

`c3b81d47f602` gave every principal a username. Its third backfill — the one that
copies `app_user.username` across to `account_directory` — read `app_user` while
FORCE ROW LEVEL SECURITY was in effect and `app.current_tenant` was unset, so the
join matched zero rows. The UPDATE succeeded, changed nothing, and the fallback
immediately below it stamped every row with `lower(email)` instead.

Nothing looked wrong: the column was NOT NULL, unique, and populated. But
`account_directory` is what maps a typed-in identifier to an academy
(auth/service.py::tenant_id_for_login), so on any database that ran the broken
revision, every pre-existing account's *new* username resolves to no tenant and is
rejected with "Incorrect username or password" — a correct credential refused as
wrong. Only the old email address still works, which is why it reads as a handful
of accounts being mysteriously bad rather than as a migration failure.

This redoes that one statement with FORCE lifted, as it should have been. It is
idempotent and safe on a healthy database: the WHERE clause only touches rows whose
directory username actually disagrees with the user's, so a deployment that never
ran the broken version, and every row created since by application code, is left
untouched.

The original revision is fixed too, so a database migrating from scratch never
enters the bad state and arrives here with nothing to do.
"""

from typing import Sequence, Union

from alembic import op

revision: str = 'f1c72d9a4e88'
down_revision: Union[str, None] = 'c3b81d47f602'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # See the module docstring: this is the lift that was missing the first time.
    op.execute("ALTER TABLE app_user NO FORCE ROW LEVEL SECURITY")
    try:
        # Matched on email because that is the only column the two tables shared
        # before usernames existed — and it is still the join the directory row was
        # created under.
        #
        # `IS DISTINCT FROM` rather than `<>` so a NULL on either side counts as a
        # disagreement; and the guard means re-running this changes nothing.
        op.execute(
            """
            UPDATE account_directory ad
            SET username = u.username
            FROM app_user u
            WHERE lower(u.email) = lower(ad.email)
              AND lower(ad.username) IS DISTINCT FROM lower(u.username)
            """
        )
    finally:
        op.execute("ALTER TABLE app_user FORCE ROW LEVEL SECURITY")


def downgrade() -> None:
    # Deliberately empty. The "before" state is a set of usernames that cannot log
    # in; restoring it would be restoring the outage, and the column is still
    # NOT NULL and unique either way.
    pass
