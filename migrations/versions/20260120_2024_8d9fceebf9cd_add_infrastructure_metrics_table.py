"""add_infrastructure_metrics_table

Revision ID: 8d9fceebf9cd
Revises: 013_add_sharing_tables
Create Date: 2026-01-20 20:24:41.284434+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8d9fceebf9cd'
down_revision: Union[str, None] = '013_add_sharing_tables'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create infrastructure_metrics table for monitoring dashboard."""
    op.create_table(
        'infrastructure_metrics',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('recorded_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('cpu_percent', sa.Float(), nullable=True),
        sa.Column('memory_used_bytes', sa.BigInteger(), nullable=True),
        sa.Column('memory_total_bytes', sa.BigInteger(), nullable=True),
        sa.Column('disk_used_bytes', sa.BigInteger(), nullable=True),
        sa.Column('disk_total_bytes', sa.BigInteger(), nullable=True),
        sa.Column('s3_objects_count', sa.Integer(), nullable=True),
        sa.Column('s3_total_bytes', sa.BigInteger(), nullable=True),
        sa.Column('network_rx_bytes', sa.BigInteger(), nullable=True),
        sa.Column('network_tx_bytes', sa.BigInteger(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('recorded_at')
    )
    op.create_index('idx_infra_metrics_time', 'infrastructure_metrics', ['recorded_at'], unique=False)


def downgrade() -> None:
    """Drop infrastructure_metrics table."""
    op.drop_index('idx_infra_metrics_time', table_name='infrastructure_metrics')
    op.drop_table('infrastructure_metrics')
