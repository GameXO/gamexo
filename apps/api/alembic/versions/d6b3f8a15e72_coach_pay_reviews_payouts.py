"""coach pay model, reviews and payouts

Revision ID: d6b3f8a15e72
Revises: c9a4f7e21b38
Create Date: 2026-10-03 14:00:00.000000

* `coach.pay_model` and `coach.commission_pct` — how a coach is paid. `salary` and
  `hourly_rate` already existed but nothing said which one applied; the model does,
  and a coach can carry all three numbers without blanking the unused ones.
* `coach_review` — feedback on a coach, kept as events. `coach.rating` becomes the
  average of them (a cache written by the endpoint).
* `coach_payout` — what was actually paid for a month, as a frozen snapshot.

Existing coaches get the model their numbers imply: a salary means `fixed`, an hourly
rate with no salary means `hourly`, and with neither it stays `fixed` at zero for a
manager to set. Nothing is guessed beyond that.

── Why FORCE is lifted ─────────────────────────────────────────────────────────
`coach` carries FORCE ROW LEVEL SECURITY, and the migration role has no tenant bound,
so the backfill UPDATE would silently match nothing. FORCE is lifted around it and
restored in a `finally`, the same as earlier backfills. The two new tables hold no
rows, so they need none of this.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from alembic_rls import protect, unprotect

revision: str = 'd6b3f8a15e72'
down_revision: Union[str, None] = 'c9a4f7e21b38'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _force_rls(on: bool) -> None:
    keyword = "FORCE" if on else "NO FORCE"
    op.execute(f"ALTER TABLE coach {keyword} ROW LEVEL SECURITY")


def upgrade() -> None:
    op.add_column(
        'coach',
        sa.Column('pay_model', sa.String(length=32), server_default='fixed', nullable=False),
    )
    op.add_column(
        'coach',
        sa.Column('commission_pct', sa.Numeric(precision=5, scale=2), server_default='0', nullable=False),
    )

    _force_rls(False)
    try:
        op.execute(
            "UPDATE coach SET pay_model = 'hourly' WHERE salary = 0 AND hourly_rate > 0"
        )
    finally:
        _force_rls(True)

    op.create_table(
        'coach_review',
        sa.Column('coach_id', sa.UUID(), nullable=False),
        sa.Column('student_id', sa.UUID(), nullable=True),
        sa.Column('reviewer_name', sa.String(length=200), nullable=True),
        sa.Column('rating', sa.Integer(), nullable=False),
        sa.Column('comment', sa.Text(), nullable=True),
        sa.Column('reviewed_on', sa.Date(), nullable=False),
        sa.Column('recorded_by', sa.String(length=200), nullable=True),
        sa.Column('tenant_id', sa.UUID(), nullable=False),
        sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint('rating >= 1 AND rating <= 5', name=op.f('ck_coach_review_rating_in_range')),
        sa.ForeignKeyConstraint(['coach_id'], ['coach.id'], name=op.f('fk_coach_review_coach_id'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['student_id'], ['student.id'], name=op.f('fk_coach_review_student_id'), ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenant.id'], name=op.f('fk_coach_review_tenant_id'), ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_coach_review')),
    )
    op.create_index(op.f('ix_coach_review_tenant_id'), 'coach_review', ['tenant_id'], unique=False)
    op.create_index(
        'ix_coach_review_tenant_coach', 'coach_review',
        ['tenant_id', 'coach_id', 'reviewed_on'], unique=False,
    )

    op.create_table(
        'coach_payout',
        sa.Column('coach_id', sa.UUID(), nullable=False),
        sa.Column('coach_name', sa.String(length=200), nullable=False),
        sa.Column('period', sa.Date(), nullable=False),
        sa.Column('pay_model', sa.String(length=32), nullable=False),
        sa.Column('sessions', sa.Integer(), server_default='0', nullable=False),
        sa.Column('hours', sa.Numeric(precision=8, scale=2), server_default='0', nullable=False),
        sa.Column('fees_collected', sa.Numeric(precision=12, scale=2), server_default='0', nullable=False),
        sa.Column('commission_pct', sa.Numeric(precision=5, scale=2), server_default='0', nullable=False),
        sa.Column('base_amount', sa.Numeric(precision=12, scale=2), server_default='0', nullable=False),
        sa.Column('commission_amount', sa.Numeric(precision=12, scale=2), server_default='0', nullable=False),
        sa.Column('adjustment', sa.Numeric(precision=12, scale=2), server_default='0', nullable=False),
        sa.Column('adjustment_note', sa.String(length=300), nullable=True),
        sa.Column('total', sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column('method', sa.String(length=20), server_default='bank', nullable=False),
        sa.Column('reference', sa.String(length=120), nullable=True),
        sa.Column('paid_on', sa.Date(), nullable=False),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('paid_by', sa.String(length=200), nullable=True),
        sa.Column('tenant_id', sa.UUID(), nullable=False),
        sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint('total >= 0', name=op.f('ck_coach_payout_total_not_negative')),
        sa.ForeignKeyConstraint(['coach_id'], ['coach.id'], name=op.f('fk_coach_payout_coach_id'), ondelete='RESTRICT'),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenant.id'], name=op.f('fk_coach_payout_tenant_id'), ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_coach_payout')),
    )
    op.create_index(op.f('ix_coach_payout_tenant_id'), 'coach_payout', ['tenant_id'], unique=False)
    op.create_index(
        'uq_coach_payout_month', 'coach_payout', ['tenant_id', 'coach_id', 'period'], unique=True
    )
    op.create_index(
        'ix_coach_payout_tenant_period', 'coach_payout', ['tenant_id', 'period'], unique=False
    )

    protect(("coach_review", "coach_payout"))


def downgrade() -> None:
    unprotect(("coach_review", "coach_payout"))
    op.drop_index('ix_coach_payout_tenant_period', table_name='coach_payout')
    op.drop_index('uq_coach_payout_month', table_name='coach_payout')
    op.drop_index(op.f('ix_coach_payout_tenant_id'), table_name='coach_payout')
    op.drop_table('coach_payout')
    op.drop_index('ix_coach_review_tenant_coach', table_name='coach_review')
    op.drop_index(op.f('ix_coach_review_tenant_id'), table_name='coach_review')
    op.drop_table('coach_review')
    op.drop_column('coach', 'commission_pct')
    op.drop_column('coach', 'pay_model')
