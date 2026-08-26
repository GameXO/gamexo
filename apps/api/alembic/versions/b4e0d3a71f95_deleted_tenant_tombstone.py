"""deleted_tenant: a tombstone that survives hard deletion

Revision ID: b4e0d3a71f95
Revises: f1c72d9a4e88
Create Date: 2026-08-26 10:00:00.000000

Operators can now hard-delete an academy. Deleting one destroys its own evidence:
`audit_log` is tenant-scoped, so the row saying "this academy was deleted" is removed
by the operation it describes, leaving a platform with one fewer tenant and nothing
to say where it went.

This table is what remains. It holds identity and scale — slug, name, plan, who did
it, and how many rows went with it, per table — and none of the academy's own data,
which is the thing that was deleted.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

from alembic_rls import app_role

revision: str = 'b4e0d3a71f95'
down_revision: Union[str, None] = 'f1c72d9a4e88'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # NO RLS, and deliberately so — the same decision as `signup_intent`, for a
    # sharper reason: a policy filtering on tenant_id could only ever match a tenant
    # that no longer exists, so every row would be invisible to everyone forever.
    # It therefore is not passed to alembic_rls.protect(), and joins the
    # UNSCOPED_TABLES allowlist in tests/test_tenant_isolation.py.
    #
    # `tenant_id` is a plain column, not a foreign key. Pointing it at `tenant.id`
    # would make the tombstone undeletable-by-construction or cascade-deleted with
    # the very row it commemorates.
    op.create_table(
        'deleted_tenant',
        sa.Column('tenant_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('slug', sa.String(length=63), nullable=False),
        sa.Column('name', sa.String(length=200), nullable=False),
        sa.Column('plan_tier', sa.String(length=50), nullable=False),
        sa.Column('status', sa.String(length=50), nullable=False),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('deleted_by_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('deleted_by_label', sa.String(length=320), nullable=True),
        sa.Column(
            'row_counts',
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        # gen_random_uuid() to match UUIDPrimaryKeyMixin, which relies on the server
        # default rather than generating ids in Python.
        sa.Column(
            'id',
            postgresql.UUID(as_uuid=True),
            server_default=sa.text('gen_random_uuid()'),
            nullable=False,
        ),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id', name=op.f('pk_deleted_tenant')),
    )
    # Both are lookups an operator actually performs: "what happened to this slug"
    # and "what did we delete for this id in the logs".
    op.create_index(op.f('ix_deleted_tenant_slug'), 'deleted_tenant', ['slug'])
    op.create_index(op.f('ix_deleted_tenant_tenant_id'), 'deleted_tenant', ['tenant_id'])

    op.execute(
        f"GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE deleted_tenant TO {app_role()}"
    )

    # ── The two ledgers the app role may not delete from ─────────────────────
    #
    # `audit_log` and `equipment_movement` are append-only, and that is enforced the
    # strongest way available: the DELETE grant was never issued to the app role (see
    # alembic_rls.protect(append_only=...)). A tenant deletion has to remove their
    # rows anyway, since the foreign keys are RESTRICT and the tenant cannot go while
    # they remain.
    #
    # Handing the app role a blanket DELETE on both would answer this by giving every
    # other code path — and any bug or injection in one — the ability to rewrite the
    # audit trail. So the capability is a single SECURITY DEFINER function instead:
    # one name, one argument, no way to express "delete these particular audit rows".
    #
    # It runs as the owner (the migration role), which does hold DELETE. RLS is not
    # bypassed: both tables are FORCE, so the owner is subject to the same policy,
    # and `app.current_tenant` must already name this tenant for the statements to
    # match anything. That is a deliberate second lock — a caller that has not bound
    # its session deletes nothing rather than deleting the wrong academy.
    op.execute(
        """
        CREATE OR REPLACE FUNCTION purge_tenant_ledgers(p_tenant_id uuid)
        RETURNS void
        LANGUAGE sql
        SECURITY DEFINER
        SET search_path = public
        AS $$
            DELETE FROM audit_log WHERE tenant_id = p_tenant_id;
            DELETE FROM equipment_movement WHERE tenant_id = p_tenant_id;
        $$
        """
    )
    # EXECUTE defaults to PUBLIC on a new function, which would undo the point.
    op.execute("REVOKE ALL ON FUNCTION purge_tenant_ledgers(uuid) FROM PUBLIC")
    op.execute(f"GRANT EXECUTE ON FUNCTION purge_tenant_ledgers(uuid) TO {app_role()}")


def downgrade() -> None:
    op.execute("DROP FUNCTION IF EXISTS purge_tenant_ledgers(uuid)")
    op.drop_index(op.f('ix_deleted_tenant_tenant_id'), table_name='deleted_tenant')
    op.drop_index(op.f('ix_deleted_tenant_slug'), table_name='deleted_tenant')
    op.drop_table('deleted_tenant')
