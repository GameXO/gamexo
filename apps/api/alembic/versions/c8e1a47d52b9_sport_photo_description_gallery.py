"""sport photo, description and gallery

Revision ID: c8e1a47d52b9
Revises: d6b3f8a15e72
Create Date: 2026-10-02 12:00:00.000000

Sports gained a face. Until now a sport carried only an emoji and two colours, and
its picture came from the asset CDN by slug, so a sport the venue made up itself had
no image at all and the owner had nowhere to describe the facility.

* `sport.image_url`   — the cover photo; wins over the CDN image when set.
* `sport.description` — the facility in the venue's own words.
* `sport.images`      — gallery for the sport's page.

Purely additive and every column is nullable or defaulted, so code from before this
revision keeps working against the migrated database (it neither reads nor writes
them) — which matters on a database more than one branch of the app points at.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = 'c8e1a47d52b9'
down_revision: Union[str, None] = 'd6b3f8a15e72'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('sport', sa.Column('image_url', sa.Text(), nullable=True))
    op.add_column('sport', sa.Column('description', sa.Text(), nullable=True))
    op.add_column(
        'sport',
        sa.Column(
            'images',
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column('sport', 'images')
    op.drop_column('sport', 'description')
    op.drop_column('sport', 'image_url')
