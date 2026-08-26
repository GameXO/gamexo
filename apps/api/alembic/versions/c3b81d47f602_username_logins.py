"""username logins: admin@/kiosk@/{name}.staff@{tenant}, ops@gamexo

Revision ID: c3b81d47f602
Revises: a7e41b90c3d5
Create Date: 2026-08-24 10:20:00.000000

Every principal gains a `username` — what is actually typed into the sign-in form.
The email column stays: it is where mail is delivered, and `admin@navigo-sports` has
no mailbox behind it. See app/auth/usernames.py for the scheme.

The backfill is the interesting half. Existing accounts have been signing in with an
email address, so every one of them needs a username derived from what is already
there, deterministically and without collisions:

    role=admin   -> admin@{slug}
    role=kiosk   -> kiosk@{slug}
    everyone else-> {email-local-part}.staff@{slug}

Login keeps accepting the old email as well (see
auth/service.py::tenant_id_for_login), so nobody is locked out the moment this
lands — which matters, because the credential people have written down is the one
that has to keep working while the new one is communicated.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from alembic_rls import app_role

revision: str = 'c3b81d47f602'
down_revision: Union[str, None] = 'a7e41b90c3d5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

#: Local parts that belong to the platform. Frozen at this revision — the live copy
#: is auth/usernames.py::RESERVED_LOCAL_PARTS and the two are allowed to diverge.
RESERVED = ("admin", "kiosk", "ops", "root", "support", "system")


def upgrade() -> None:
    # ── Columns, nullable first ──────────────────────────────────────────────
    # Added NULL-able, backfilled, then made NOT NULL. Adding them NOT NULL with a
    # server_default would stamp every existing row with the same placeholder and
    # then immediately violate the unique index below.
    op.add_column('app_user', sa.Column('username', sa.String(length=200), nullable=True))
    op.add_column('platform_admin', sa.Column('username', sa.String(length=200), nullable=True))
    op.add_column('account_directory', sa.Column('username', sa.String(length=200), nullable=True))

    # ── Backfill: app_user ───────────────────────────────────────────────────
    #
    # FORCE is lifted around this, and it is load-bearing. `app_user` is FORCE ROW
    # LEVEL SECURITY, which — unlike plain ENABLE — applies to the table's owner too,
    # and this migration *is* the owner. With `app.current_tenant` unset the policy
    # evaluates `tenant_id = NULL` for every row, so the UPDATE would match nothing,
    # succeed silently, and leave every username NULL — surfacing much later as a
    # NOT NULL violation, or as an entire platform unable to sign in.
    op.execute("ALTER TABLE app_user NO FORCE ROW LEVEL SECURITY")
    try:
        reserved_sql = ", ".join(f"'{r}'" for r in RESERVED)
        op.execute(
            f"""
            WITH derived AS (
                SELECT
                    u.id,
                    CASE
                        WHEN u.role = 'admin' THEN 'admin@' || t.slug
                        WHEN u.role = 'kiosk' THEN 'kiosk@' || t.slug
                        ELSE (
                            CASE
                                WHEN local IN ({reserved_sql}) THEN local || '-staff'
                                ELSE local
                            END
                        ) || '.staff@' || t.slug
                    END AS base
                FROM app_user u
                JOIN tenant t ON t.id = u.tenant_id
                CROSS JOIN LATERAL (
                    -- The email's local part, slugified the same way
                    -- usernames.slugify_name does: non-alphanumerics collapse to a
                    -- hyphen, trimmed, capped at 40 characters.
                    SELECT COALESCE(
                        NULLIF(
                            LEFT(
                                TRIM(BOTH '-' FROM regexp_replace(
                                    lower(split_part(u.email, '@', 1)), '[^a-z0-9]+', '-', 'g'
                                )),
                                40
                            ),
                            ''
                        ),
                        'staff'
                    ) AS local
                ) AS parts
            ),
            numbered AS (
                -- Two people whose emails reduce to the same local part at one
                -- academy: the oldest keeps the bare name, the rest are suffixed,
                -- exactly as claim_staff_username does for new staff.
                SELECT
                    d.id,
                    d.base,
                    ROW_NUMBER() OVER (PARTITION BY d.base ORDER BY u.created_at, u.id) AS n
                FROM derived d
                JOIN app_user u ON u.id = d.id
            )
            UPDATE app_user u
            SET username = CASE
                WHEN nm.n = 1 THEN nm.base
                ELSE regexp_replace(nm.base, '^([^@]*?)(\\.staff)?@', '\\1-' || nm.n || '\\2@')
            END
            FROM numbered nm
            WHERE u.id = nm.id
            """
        )
    finally:
        op.execute("ALTER TABLE app_user FORCE ROW LEVEL SECURITY")

    # ── Backfill: platform_admin ─────────────────────────────────────────────
    # One operator account by design. Any extras keep a distinguishable name rather
    # than colliding on the unique index.
    op.execute(
        """
        UPDATE platform_admin pa
        SET username = CASE WHEN nm.n = 1 THEN 'ops@gamexo' ELSE 'ops-' || nm.n || '@gamexo' END
        FROM (
            SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS n FROM platform_admin
        ) nm
        WHERE pa.id = nm.id
        """
    )

    # ── Backfill: account_directory ──────────────────────────────────────────
    # `account_directory` itself carries no RLS (see the self-serve-onboarding
    # revision) — but this statement *reads* `app_user`, which does, and FORCE was
    # put back above. Without lifting it again the join matches nothing, every row
    # falls through to the email fallback below, and the usernames people were told
    # to sign in with resolve to no academy at all.
    op.execute("ALTER TABLE app_user NO FORCE ROW LEVEL SECURITY")
    try:
        op.execute(
            """
            UPDATE account_directory ad
            SET username = u.username
            FROM app_user u
            WHERE lower(u.email) = lower(ad.email)
            """
        )
    finally:
        op.execute("ALTER TABLE app_user FORCE ROW LEVEL SECURITY")
    # Any directory row still NULL is a genuine orphan — a user deleted without
    # cleaning up after itself. Left pointing at its own email so the NOT NULL below
    # holds; it resolves to nothing either way.
    #
    # This fallback is deliberately last and deliberately narrow. It is total-loss
    # cover for a broken join: if the UPDATE above ever silently matches nothing,
    # every row lands here looking perfectly well-formed, and the failure surfaces
    # only as correct usernames being rejected as bad credentials. The repair for
    # exactly that is revision f1c72d9a4e88.
    op.execute("UPDATE account_directory SET username = lower(email) WHERE username IS NULL")

    # ── Lock it down ─────────────────────────────────────────────────────────
    op.alter_column('app_user', 'username', nullable=False)
    op.alter_column('platform_admin', 'username', nullable=False)
    op.alter_column('account_directory', 'username', nullable=False)

    op.create_index(
        'uq_app_user_tenant_username',
        'app_user',
        ['tenant_id', sa.text('lower(username)')],
        unique=True,
    )
    op.create_index(
        'ix_platform_admin_username', 'platform_admin', ['username'], unique=True
    )
    op.create_index(
        'uq_account_directory_username',
        'account_directory',
        [sa.text('lower(username)')],
        unique=True,
    )

    # account_directory carries no RLS policy, so its grant is issued by hand — the
    # column is new but the grant is table-level and already covers it. Re-issued
    # for a deployment provisioned without the ALTER DEFAULT PRIVILEGES bootstrap.
    op.execute(
        f"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE account_directory TO {app_role()}"
    )


def downgrade() -> None:
    op.drop_index('uq_account_directory_username', table_name='account_directory')
    op.drop_index('ix_platform_admin_username', table_name='platform_admin')
    op.drop_index('uq_app_user_tenant_username', table_name='app_user')
    op.drop_column('account_directory', 'username')
    op.drop_column('platform_admin', 'username')
    op.drop_column('app_user', 'username')
