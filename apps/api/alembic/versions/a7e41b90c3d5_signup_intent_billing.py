"""self-serve billing: signup intents

Revision ID: a7e41b90c3d5
Revises: 91ca6eeccf04
Create Date: 2026-08-23 21:10:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from alembic_rls import app_role

revision: str = 'a7e41b90c3d5'
down_revision: Union[str, None] = '91ca6eeccf04'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── Signup intents ───────────────────────────────────────────────────────
    #
    # NO RLS, and it is not an oversight. This table is written by an anonymous
    # browser before any tenant exists to bind a session to; there is no tenant_id
    # to filter on and no policy that could be expressed. It therefore is NOT passed
    # to alembic_rls.protect() — the grant is issued by hand below, without the
    # policy that would make every row invisible to an unbound session.
    #
    # It joins `tenant`, `platform_admin` and `account_directory` in the
    # UNSCOPED_TABLES allowlist in tests/test_tenant_isolation.py, which asserts that
    # each of them is a decision somebody made rather than a model that forgot its
    # base class. See app/modules/billing/models.py for the full reasoning.
    #
    # What stands in for RLS is `token`: 32 bytes of `secrets` output, the only way
    # to address a row, and the thing the browser holds.
    op.create_table(
        'signup_intent',
        sa.Column('token', sa.String(length=64), nullable=False),
        sa.Column(
            'status',
            sa.Enum(
                'draft', 'awaiting_payment', 'provisioning', 'completed', 'failed',
                name='signup_status', native_enum=False, length=32,
            ),
            nullable=False,
        ),
        # Becomes the admin's login. Checked against account_directory at both ends
        # of the flow — once here so a taken address fails before anyone pays, and
        # again inside the provisioning transaction, which is the authoritative one.
        sa.Column('email', sa.String(length=320), nullable=False),
        sa.Column('full_name', sa.String(length=200), nullable=False),
        sa.Column('phone', sa.String(length=32), nullable=True),

        # What the wizard collected, before there was a tenant_settings row to put it on.
        sa.Column('business_name', sa.String(length=200), nullable=True),
        sa.Column('logo_url', sa.Text(), nullable=True),
        sa.Column('city', sa.String(length=120), nullable=True),
        sa.Column('address', sa.Text(), nullable=True),
        sa.Column('sports', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('services', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        # A timestamp rather than a boolean: the question a dispute asks is "when
        # did they agree", not "did they".
        sa.Column('accepted_terms_at', sa.DateTime(timezone=True), nullable=True),

        # The money. `amount_paise` is snapshotted at order time and never
        # recomputed — the price list in plans.py is editable, and what was charged
        # must stay what was charged even if the catalogue moves underneath.
        sa.Column('plan_code', sa.String(length=50), nullable=True),
        sa.Column('billing_period', sa.String(length=16), nullable=True),
        sa.Column('amount_paise', sa.Integer(), nullable=True),
        sa.Column('currency', sa.String(length=3), nullable=False),
        sa.Column('provider', sa.String(length=32), nullable=True),
        sa.Column('order_id', sa.String(length=128), nullable=True),
        sa.Column('payment_id', sa.String(length=128), nullable=True),
        sa.Column('paid_at', sa.DateTime(timezone=True), nullable=True),
        # `webhook` or `callback`. Purely diagnostic: if this is always `callback`,
        # the webhook is not reaching us and signups will start failing the moment
        # somebody closes a tab too early.
        sa.Column('confirmed_via', sa.String(length=16), nullable=True),

        # The result.
        sa.Column('tenant_id', sa.UUID(), nullable=True),
        sa.Column('credentials_emailed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_error', sa.Text(), nullable=True),

        # The handoff into the dashboard. Only the SHA-256 is stored, so a stolen
        # dump yields nothing redeemable.
        sa.Column('handoff_token_hash', sa.String(length=64), nullable=True),
        sa.Column('handoff_expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('handoff_used_at', sa.DateTime(timezone=True), nullable=True),

        sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column(
            'created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False
        ),
        sa.Column(
            'updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False
        ),
        # SET NULL, unlike the RESTRICT used everywhere else in this schema: an
        # intent is a receipt *for* a tenant, and an offboarded academy should not
        # be un-deletable because one exists. Keeps the payment record, drops the
        # dangling pointer.
        sa.ForeignKeyConstraint(
            ['tenant_id'], ['tenant.id'], name=op.f('fk_signup_intent_tenant_id'), ondelete='SET NULL'
        ),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_signup_intent')),
    )

    # The browser's handle. Unique because it is the address.
    op.create_index('uq_signup_intent_token', 'signup_intent', ['token'], unique=True)
    # The webhook's only handle — it knows the Razorpay order and nothing else.
    op.create_index('ix_signup_intent_order_id', 'signup_intent', ['order_id'], unique=False)
    op.create_index('ix_signup_intent_email', 'signup_intent', ['email'], unique=False)
    # Redeeming a handoff looks the row up by this hash on every sign-in from the
    # website, and it is the only query with no other predicate to lean on.
    op.create_index(
        'ix_signup_intent_handoff_token_hash', 'signup_intent', ['handoff_token_hash'], unique=False
    )

    op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE signup_intent TO {app_role()}")


def downgrade() -> None:
    op.drop_index('ix_signup_intent_handoff_token_hash', table_name='signup_intent')
    op.drop_index('ix_signup_intent_email', table_name='signup_intent')
    op.drop_index('ix_signup_intent_order_id', table_name='signup_intent')
    op.drop_index('uq_signup_intent_token', table_name='signup_intent')
    op.drop_table('signup_intent')
