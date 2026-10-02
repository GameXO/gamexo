"""student reviews and photos

Revision ID: c9a4f7e21b38
Revises: b5d2e8a41c96
Create Date: 2026-10-03 10:00:00.000000

* `student_assessment` — dated reviews: an overall score, the skill scores behind it,
  and the coach's comment. Until now a student carried one mutable set of skills and
  one rating, so "is she improving?" had no answer. Reviews are kept as history and
  the newest is mirrored back onto `student` (see `router.add_assessment`), so every
  screen that reads the student keeps working untouched.
* `student.photo_url` — a URL from `POST /uploads`.

Nothing is backfilled. A student's existing rating and skills stay where they are;
the first review written for them starts their history.

`student_assessment` is new, so it needs no FORCE-lifting here: the table is created
and then put under tenant isolation in the same migration, with no rows to move.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from alembic_rls import protect, unprotect

revision: str = 'c9a4f7e21b38'
down_revision: Union[str, None] = 'b5d2e8a41c96'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('student', sa.Column('photo_url', sa.Text(), nullable=True))

    op.create_table(
        'student_assessment',
        sa.Column('student_id', sa.UUID(), nullable=False),
        sa.Column('sport_id', sa.UUID(), nullable=True),
        sa.Column('assessed_on', sa.Date(), nullable=False),
        sa.Column('rating', sa.Numeric(precision=4, scale=2), nullable=False),
        sa.Column('skills', postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column('comment', sa.Text(), nullable=True),
        sa.Column('assessed_by', sa.String(length=200), nullable=True),
        sa.Column('tenant_id', sa.UUID(), nullable=False),
        sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint('rating >= 0 AND rating <= 10', name=op.f('ck_student_assessment_rating_in_range')),
        sa.ForeignKeyConstraint(['student_id'], ['student.id'], name=op.f('fk_student_assessment_student_id'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['sport_id'], ['sport.id'], name=op.f('fk_student_assessment_sport_id'), ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenant.id'], name=op.f('fk_student_assessment_tenant_id'), ondelete='RESTRICT'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_student_assessment')),
    )
    op.create_index(op.f('ix_student_assessment_tenant_id'), 'student_assessment', ['tenant_id'], unique=False)
    op.create_index(
        'ix_student_assessment_tenant_student', 'student_assessment',
        ['tenant_id', 'student_id', 'assessed_on'], unique=False,
    )

    protect(("student_assessment",))


def downgrade() -> None:
    unprotect(("student_assessment",))
    op.drop_index('ix_student_assessment_tenant_student', table_name='student_assessment')
    op.drop_index(op.f('ix_student_assessment_tenant_id'), table_name='student_assessment')
    op.drop_table('student_assessment')
    op.drop_column('student', 'photo_url')
