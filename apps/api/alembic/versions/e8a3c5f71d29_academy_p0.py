"""academy P0: guardians, notes, coach availability, schedules, courts, reminders

Revision ID: e8a3c5f71d29
Revises: c8e1a47d52b9
Create Date: 2026-10-03 18:00:00.000000

Everything here is additive: new nullable columns, columns with defaults, and new
tables. No existing row changes meaning, so there is no backfill and no FORCE-lifting.

* Students — home branch, emergency contact, medical notes; guardians as their own
  table (payer vs. progress-only); quick notes with a visibility rule.
* Plans — venue (branch), group or private delivery, classes per month, and a
  struck-through "was" price per term with an offer label.
* Batches — the schedule as data (weekdays + start/end time) so sessions can be
  generated from it, a target size, and the court it plays on.
* Sessions — court, coach check-in, close-out with an incident note, and who a
  substitute stood in for.
* Attendance — an absence reason. The new marks (excused, trial, make-up) are new
  values in an existing VARCHAR column and need no DDL.
* Coaches — weekly availability windows and time off.
* Reminders — a log so a renewal or payment reminder is sent once per stage.
* Settings — what the academy calls each level.

The new statuses (`trial`, `alumni`, `restricted`), the `competitive` level and the
`coach`/`accountant` roles are likewise new values in existing VARCHAR columns.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from alembic_rls import protect, unprotect

revision: str = 'e8a3c5f71d29'
down_revision: Union[str, None] = 'c8e1a47d52b9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_TABLES = (
    "student_guardian",
    "student_note",
    "coach_availability",
    "coach_time_off",
    "academy_reminder",
)


def _base_columns() -> list[sa.Column]:
    return [
        sa.Column('tenant_id', sa.UUID(), nullable=False),
        sa.Column('id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    ]


def _tenant_fk(table: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(['tenant_id'], ['tenant.id'], name=op.f(f'fk_{table}_tenant_id'), ondelete='RESTRICT')


def upgrade() -> None:
    # ── Settings
    op.add_column(
        'tenant_settings',
        sa.Column('academy_level_names', postgresql.JSONB(astext_type=sa.Text()), server_default='{}', nullable=False),
    )

    # ── Programme
    for term in ('1m', '3m', '6m', '12m'):
        op.add_column('program', sa.Column(f'list_{term}', sa.Numeric(12, 2), server_default='0', nullable=False))
    op.add_column('program', sa.Column('offer_label', sa.String(length=60), nullable=True))
    op.add_column('program', sa.Column('branch_id', sa.UUID(), nullable=True))
    op.add_column('program', sa.Column('delivery_type', sa.String(length=32), server_default='group', nullable=False))
    op.add_column('program', sa.Column('classes_per_month', sa.Integer(), nullable=True))
    op.create_foreign_key(op.f('fk_program_branch_id'), 'program', 'branch', ['branch_id'], ['id'], ondelete='SET NULL')

    # ── Batch
    op.add_column('batch', sa.Column('target_size', sa.Integer(), nullable=True))
    op.add_column('batch', sa.Column('days', postgresql.JSONB(astext_type=sa.Text()), server_default='[]', nullable=False))
    op.add_column('batch', sa.Column('start_time', sa.Time(), nullable=True))
    op.add_column('batch', sa.Column('end_time', sa.Time(), nullable=True))
    op.add_column('batch', sa.Column('court_id', sa.UUID(), nullable=True))
    op.create_foreign_key(op.f('fk_batch_court_id'), 'batch', 'court', ['court_id'], ['id'], ondelete='SET NULL')

    # ── Student
    op.add_column('student', sa.Column('branch_id', sa.UUID(), nullable=True))
    op.add_column('student', sa.Column('emergency_contact_name', sa.String(length=200), nullable=True))
    op.add_column('student', sa.Column('emergency_contact_phone', sa.String(length=32), nullable=True))
    op.add_column('student', sa.Column('medical_notes', sa.Text(), nullable=True))
    op.create_foreign_key(op.f('fk_student_branch_id'), 'student', 'branch', ['branch_id'], ['id'], ondelete='SET NULL')

    # ── Session
    op.add_column('coaching_session', sa.Column('court_id', sa.UUID(), nullable=True))
    op.add_column('coaching_session', sa.Column('coach_checked_in_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('coaching_session', sa.Column('closed_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('coaching_session', sa.Column('incident_note', sa.Text(), nullable=True))
    op.add_column('coaching_session', sa.Column('substitute_for_coach_id', sa.UUID(), nullable=True))
    op.create_foreign_key(
        op.f('fk_coaching_session_court_id'), 'coaching_session', 'court', ['court_id'], ['id'], ondelete='SET NULL'
    )
    op.create_foreign_key(
        op.f('fk_coaching_session_substitute_for_coach_id'), 'coaching_session', 'coach',
        ['substitute_for_coach_id'], ['id'], ondelete='SET NULL',
    )
    # Generation skips a batch/start pair that already exists (see
    # `schedule.generate_sessions`) rather than relying on a unique index here: an
    # existing database may already hold hand-made duplicates, and a migration that
    # fails on someone's data is worse than a check in code.
    op.create_index('ix_coaching_session_tenant_court', 'coaching_session', ['tenant_id', 'court_id', 'starts_at'])

    # ── Attendance
    op.add_column('attendance', sa.Column('reason', sa.String(length=32), nullable=True))

    # ── New tables
    op.create_table(
        'student_guardian',
        sa.Column('student_id', sa.UUID(), nullable=False),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('relation', sa.String(length=40), nullable=True),
        sa.Column('phone', sa.String(length=32), nullable=True),
        sa.Column('email', sa.String(length=320), nullable=True),
        sa.Column('is_primary', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('is_payer', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('receives_progress', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('receives_attendance', sa.Boolean(), nullable=False, server_default=sa.false()),
        *_base_columns(),
        sa.ForeignKeyConstraint(['student_id'], ['student.id'], name=op.f('fk_student_guardian_student_id'), ondelete='CASCADE'),
        _tenant_fk('student_guardian'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_student_guardian')),
    )
    op.create_index(op.f('ix_student_guardian_tenant_id'), 'student_guardian', ['tenant_id'])
    op.create_index('ix_student_guardian_tenant_student', 'student_guardian', ['tenant_id', 'student_id'])
    op.create_index(
        'uq_student_guardian_primary', 'student_guardian', ['tenant_id', 'student_id'],
        unique=True, postgresql_where=sa.text('is_primary'),
    )

    op.create_table(
        'student_note',
        sa.Column('student_id', sa.UUID(), nullable=False),
        sa.Column('session_id', sa.UUID(), nullable=True),
        sa.Column('author_user_id', sa.UUID(), nullable=True),
        sa.Column('author_name', sa.String(length=200), nullable=False),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('visibility', sa.String(length=32), nullable=False, server_default='staff'),
        *_base_columns(),
        sa.ForeignKeyConstraint(['student_id'], ['student.id'], name=op.f('fk_student_note_student_id'), ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['session_id'], ['coaching_session.id'], name=op.f('fk_student_note_session_id'), ondelete='SET NULL'),
        _tenant_fk('student_note'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_student_note')),
    )
    op.create_index(op.f('ix_student_note_tenant_id'), 'student_note', ['tenant_id'])
    op.create_index('ix_student_note_tenant_student', 'student_note', ['tenant_id', 'student_id', 'created_at'])

    op.create_table(
        'coach_availability',
        sa.Column('coach_id', sa.UUID(), nullable=False),
        sa.Column('weekday', sa.Integer(), nullable=False),
        sa.Column('start_time', sa.Time(), nullable=False),
        sa.Column('end_time', sa.Time(), nullable=False),
        *_base_columns(),
        sa.CheckConstraint('weekday >= 0 AND weekday <= 6', name=op.f('ck_coach_availability_weekday_in_range')),
        sa.CheckConstraint('end_time > start_time', name=op.f('ck_coach_availability_ends_after_starts')),
        sa.ForeignKeyConstraint(['coach_id'], ['coach.id'], name=op.f('fk_coach_availability_coach_id'), ondelete='CASCADE'),
        _tenant_fk('coach_availability'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_coach_availability')),
    )
    op.create_index(op.f('ix_coach_availability_tenant_id'), 'coach_availability', ['tenant_id'])
    op.create_index('ix_coach_availability_tenant_coach', 'coach_availability', ['tenant_id', 'coach_id'])

    op.create_table(
        'coach_time_off',
        sa.Column('coach_id', sa.UUID(), nullable=False),
        sa.Column('start_date', sa.Date(), nullable=False),
        sa.Column('end_date', sa.Date(), nullable=False),
        sa.Column('reason', sa.String(length=200), nullable=True),
        *_base_columns(),
        sa.CheckConstraint('end_date >= start_date', name=op.f('ck_coach_time_off_ends_after_starts')),
        sa.ForeignKeyConstraint(['coach_id'], ['coach.id'], name=op.f('fk_coach_time_off_coach_id'), ondelete='CASCADE'),
        _tenant_fk('coach_time_off'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_coach_time_off')),
    )
    op.create_index(op.f('ix_coach_time_off_tenant_id'), 'coach_time_off', ['tenant_id'])
    op.create_index('ix_coach_time_off_tenant_coach', 'coach_time_off', ['tenant_id', 'coach_id', 'start_date'])

    op.create_table(
        'academy_reminder',
        sa.Column('kind', sa.String(length=32), nullable=False),
        sa.Column('ref_id', sa.UUID(), nullable=False),
        sa.Column('stage', sa.String(length=16), nullable=False),
        sa.Column('recipients', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default='[]'),
        *_base_columns(),
        _tenant_fk('academy_reminder'),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_academy_reminder')),
    )
    op.create_index(op.f('ix_academy_reminder_tenant_id'), 'academy_reminder', ['tenant_id'])
    op.create_index('uq_academy_reminder', 'academy_reminder', ['tenant_id', 'kind', 'ref_id', 'stage'], unique=True)

    protect(NEW_TABLES)


def downgrade() -> None:
    unprotect(NEW_TABLES)
    for table in reversed(NEW_TABLES):
        op.drop_table(table)

    op.drop_column('attendance', 'reason')

    op.drop_index('ix_coaching_session_tenant_court', table_name='coaching_session')
    op.drop_constraint(op.f('fk_coaching_session_substitute_for_coach_id'), 'coaching_session', type_='foreignkey')
    op.drop_constraint(op.f('fk_coaching_session_court_id'), 'coaching_session', type_='foreignkey')
    for col in ('substitute_for_coach_id', 'incident_note', 'closed_at', 'coach_checked_in_at', 'court_id'):
        op.drop_column('coaching_session', col)

    op.drop_constraint(op.f('fk_student_branch_id'), 'student', type_='foreignkey')
    for col in ('medical_notes', 'emergency_contact_phone', 'emergency_contact_name', 'branch_id'):
        op.drop_column('student', col)

    op.drop_constraint(op.f('fk_batch_court_id'), 'batch', type_='foreignkey')
    for col in ('court_id', 'end_time', 'start_time', 'days', 'target_size'):
        op.drop_column('batch', col)

    op.drop_constraint(op.f('fk_program_branch_id'), 'program', type_='foreignkey')
    for col in ('classes_per_month', 'delivery_type', 'branch_id', 'offer_label', 'list_12m', 'list_6m', 'list_3m', 'list_1m'):
        op.drop_column('program', col)

    op.drop_column('tenant_settings', 'academy_level_names')
