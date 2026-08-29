"""app_user.token_version: make a password change end other sessions

Revision ID: c8a5e10b7d34
Revises: b4e0d3a71f95
Create Date: 2026-08-27 10:00:00.000000

Access and refresh tokens are stateless and signed, so nothing about changing a
password invalidated them: a session opened with the old one carried on working
until its refresh token expired. That was tolerable while passwords were only ever
set at provisioning. It is not tolerable now that an admin can change their own
password from Settings, because the password they are changing is the temporary one
that was emailed to them in plaintext — the whole point of the action is to cut off
anyone who read that email.

`token_version` is the counter that fixes it. It travels in the token claims as
`ver`, is compared on every authenticated request and every refresh, and is bumped
whenever the password changes. One UPDATE invalidates every outstanding token for
that account, with no denylist to store and no expiry to sweep.

Existing rows start at 1, matching the model default, so tokens issued before this
migration are refused on their next request — they carry no `ver` claim at all. That
is a one-off sign-out at deploy, which is the correct behaviour for a change to how
sessions are validated, and cheaper than the alternative of trusting unversioned
tokens indefinitely.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = 'c8a5e10b7d34'
down_revision: Union[str, None] = 'b4e0d3a71f95'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # server_default so the column can be NOT NULL without a separate backfill pass,
    # and so rows inserted by anything that predates the model change still get a
    # usable value rather than failing.
    op.add_column(
        'app_user',
        sa.Column('token_version', sa.Integer(), server_default='1', nullable=False),
    )


def downgrade() -> None:
    op.drop_column('app_user', 'token_version')
