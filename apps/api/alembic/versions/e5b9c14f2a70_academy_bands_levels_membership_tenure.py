"""academy age bands and levels, membership tenure and pause banking

Three groups of changes, all additive.

── Academy: age bands and a progression ladder ─────────────────────────────────
`program.age_group` and `program.level` were free text ("6–14 yrs", "Beginner").
Readable, and useless as rules — nothing can decide anything from them. They stay,
untouched, because they are the only record of what a pre-existing programme meant;
the structured columns beside them are what enrolment now reads.

`age_band` is **nullable and left NULL** for every existing programme. That is the
whole migration strategy: a NULL band admits any age, so no enrolment that worked
yesterday starts failing today. Enforcement switches on per programme, the moment
someone sets a band deliberately.

`student_sport_level` and `student_promotion` are new. Per *sport*, not per student:
a child can be advanced at tennis and a beginner at football, and one column would
force one of those to be a lie.

── Membership: tenure ──────────────────────────────────────────────────────────
`renew_subscription` overwrote `start_date` on every renewal, so a five-year member
looked like they joined last month the moment they renewed. `joined_on` is set once
and never touched. Backfilled from `start_date`, which is the best available answer
for rows that already lost their real join date — earliest known, not invented.

── Membership: pause banking ───────────────────────────────────────────────────
`paused_days_total` accumulates days given back when a paused membership resumes.
Zero for everyone existing, which is correct: nothing was ever banked before,
because until now there was no way to resume at all.

Revision ID: e5b9c14f2a70
Revises: d7f3a2b91c60
Create Date: 2026-09-24 10:12:44.881203
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from alembic_rls import protect

revision: str = 'e5b9c14f2a70'
down_revision: str | None = 'd7f3a2b91c60'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

#: Written across every tenant by the joined_on backfill below.
BACKFILL_TABLES = ('member_subscription',)

age_band = postgresql.ENUM('kids', 'adults', name='age_band', create_type=False)
skill_level = postgresql.ENUM(
    'beginner', 'intermediate', 'advanced', name='skill_level', create_type=False
)


def _force_rls(on: bool) -> None:
    keyword = 'FORCE' if on else 'NO FORCE'
    for table in BACKFILL_TABLES:
        op.execute(f'ALTER TABLE {table} {keyword} ROW LEVEL SECURITY')


def upgrade() -> None:
    bind = op.get_bind()
    age_band.create(bind, checkfirst=True)
    skill_level.create(bind, checkfirst=True)

    # ── Programmes ──────────────────────────────────────────────────────────
    op.add_column('program', sa.Column('skill_level', skill_level, nullable=True))
    op.add_column('program', sa.Column('age_band', age_band, nullable=True))
    op.add_column('program', sa.Column('age_min', sa.Integer(), nullable=True))
    op.add_column('program', sa.Column('age_max', sa.Integer(), nullable=True))

    # ── The ladder ──────────────────────────────────────────────────────────
    op.create_table(
        'student_sport_level',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text('gen_random_uuid()')),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('tenant.id', ondelete='CASCADE'), nullable=False),
        sa.Column('student_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('student.id', ondelete='CASCADE'), nullable=False),
        sa.Column('sport_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('sport.id', ondelete='CASCADE'), nullable=False),
        sa.Column('level', skill_level, nullable=False),
        sa.Column('assessed_on', sa.Date(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
    )
    op.create_index(
        'uq_student_sport_level',
        'student_sport_level',
        ['tenant_id', 'student_id', 'sport_id'],
        unique=True,
    )

    op.create_table(
        'student_promotion',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True,
                  server_default=sa.text('gen_random_uuid()')),
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('tenant.id', ondelete='CASCADE'), nullable=False),
        sa.Column('student_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('student.id', ondelete='CASCADE'), nullable=False),
        sa.Column('sport_id', postgresql.UUID(as_uuid=True),
                  sa.ForeignKey('sport.id', ondelete='CASCADE'), nullable=False),
        sa.Column('from_level', skill_level, nullable=True),
        sa.Column('to_level', skill_level, nullable=False),
        sa.Column('assessed_on', sa.Date(), nullable=False),
        sa.Column('assessed_by', sa.String(length=200), nullable=True),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True),
                  server_default=sa.text('now()'), nullable=False),
    )
    op.create_index(
        'ix_student_promotion_tenant_student',
        'student_promotion',
        ['tenant_id', 'student_id', 'assessed_on'],
    )

    # Both hold one academy's students, so both take the standard grants and tenant
    # policy. Deliberately NOT append-only: a promotion recorded against the wrong
    # child is a mistake staff must be able to erase, and the append-only tables are
    # reachable for tenant deletion only through `purge_tenant_ledgers`, which names
    # its two tables explicitly.
    protect(('student_sport_level', 'student_promotion'))

    # ── Membership ──────────────────────────────────────────────────────────
    op.add_column('member_subscription', sa.Column('joined_on', sa.Date(), nullable=True))
    op.add_column(
        'member_subscription',
        sa.Column('paused_days_total', sa.Integer(), server_default='0', nullable=False),
    )

    _force_rls(False)
    try:
        # start_date is the best available answer: for a member who never renewed
        # it is exactly right, and for one who has it is the earliest date we still
        # hold. Inventing anything else would be worse than being honestly approximate.
        op.execute('UPDATE member_subscription SET joined_on = start_date WHERE joined_on IS NULL')
    finally:
        _force_rls(True)

    op.alter_column('member_subscription', 'joined_on', existing_type=sa.Date(), nullable=False)


def downgrade() -> None:
    op.drop_column('member_subscription', 'paused_days_total')
    op.drop_column('member_subscription', 'joined_on')

    op.drop_index('ix_student_promotion_tenant_student', table_name='student_promotion')
    op.drop_table('student_promotion')
    op.drop_index('uq_student_sport_level', table_name='student_sport_level')
    op.drop_table('student_sport_level')

    op.drop_column('program', 'age_max')
    op.drop_column('program', 'age_min')
    op.drop_column('program', 'age_band')
    op.drop_column('program', 'skill_level')

    bind = op.get_bind()
    skill_level.drop(bind, checkfirst=True)
    age_band.drop(bind, checkfirst=True)
