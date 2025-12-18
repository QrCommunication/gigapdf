"""Add plans table

Revision ID: 003_plans
Revises: 002_storage_jobs
Create Date: 2025-12-18

This migration adds the plans table for dynamic plan management:
- plans: Subscription plan definitions with pricing and features
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSON, UUID

# revision identifiers, used by Alembic
revision: str = "003_plans"
down_revision: Union[str, None] = "002_storage_jobs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Create plans table.
    """
    # Create plans table if not exists
    if not op.get_bind().dialect.has_table(op.get_bind(), "plans"):
        op.create_table(
            "plans",
            sa.Column(
                "id",
                UUID(as_uuid=False),
                nullable=False,
                primary_key=True,
            ),
            sa.Column("slug", sa.String(50), nullable=False, unique=True),
            sa.Column("name", sa.String(100), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            # Pricing
            sa.Column("price", sa.Numeric(10, 2), nullable=False, default=0),
            sa.Column("currency", sa.String(3), nullable=False, default="EUR"),
            sa.Column(
                "interval", sa.String(10), nullable=False, default="month"
            ),  # month, year
            sa.Column("stripe_price_id", sa.String(255), nullable=True),
            # Features and limits
            sa.Column(
                "storage_limit_bytes",
                sa.BigInteger(),
                nullable=False,
                default=5 * 1024 * 1024 * 1024,
            ),  # 5GB default
            sa.Column(
                "api_calls_limit", sa.Integer(), nullable=False, default=1000
            ),  # per month
            sa.Column("document_limit", sa.Integer(), nullable=False, default=100),
            # Additional features as JSON
            sa.Column("features", JSON, nullable=True),
            # Status and display
            sa.Column("is_active", sa.Boolean(), nullable=False, default=True),
            sa.Column("is_popular", sa.Boolean(), nullable=False, default=False),
            sa.Column("display_order", sa.Integer(), nullable=False, default=0),
            sa.Column("cta_text", sa.String(50), nullable=False, default="Get Started"),
            # Trial settings
            sa.Column("trial_days", sa.Integer(), nullable=True),
            # Timestamps
            sa.Column(
                "created_at",
                sa.DateTime(),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(),
                nullable=False,
                server_default=sa.func.now(),
            ),
        )

        op.create_index("idx_plans_slug", "plans", ["slug"], unique=True)
        op.create_index("idx_plans_active", "plans", ["is_active"])
        op.create_index("idx_plans_order", "plans", ["display_order"])

    # Insert default plans
    op.execute(
        """
        INSERT INTO plans (id, slug, name, description, price, currency, interval, storage_limit_bytes, api_calls_limit, document_limit, features, is_active, is_popular, display_order, cta_text, trial_days)
        VALUES
        (
            gen_random_uuid(),
            'free',
            'Free',
            'Perfect for individuals getting started with PDF editing',
            0,
            'EUR',
            'month',
            5368709120,
            1000,
            100,
            '{"storageGb": 5, "apiCallsPerMonth": 1000, "customBranding": false, "prioritySupport": false, "sla": false, "dedicatedAccount": false}',
            true,
            false,
            0,
            'Get Started',
            NULL
        ),
        (
            gen_random_uuid(),
            'starter',
            'Starter',
            'For professionals who need more power and flexibility',
            9,
            'EUR',
            'month',
            26843545600,
            10000,
            500,
            '{"storageGb": 25, "apiCallsPerMonth": 10000, "customBranding": false, "prioritySupport": false, "sla": false, "dedicatedAccount": false}',
            true,
            true,
            1,
            'Start 14-day Trial',
            14
        ),
        (
            gen_random_uuid(),
            'pro',
            'Pro',
            'For teams that need advanced features and priority support',
            29,
            'EUR',
            'month',
            107374182400,
            100000,
            2000,
            '{"storageGb": 100, "apiCallsPerMonth": 100000, "customBranding": true, "prioritySupport": true, "sla": false, "dedicatedAccount": false}',
            true,
            false,
            2,
            'Start 14-day Trial',
            14
        ),
        (
            gen_random_uuid(),
            'enterprise',
            'Enterprise',
            'Custom solutions for large organizations with dedicated support',
            0,
            'EUR',
            'month',
            536870912000,
            1000000,
            -1,
            '{"storageGb": -1, "apiCallsPerMonth": -1, "customBranding": true, "prioritySupport": true, "sla": true, "dedicatedAccount": true}',
            true,
            false,
            3,
            'Contact Sales',
            NULL
        )
        ON CONFLICT (slug) DO NOTHING;
        """
    )


def downgrade() -> None:
    """
    Drop plans table.
    """
    if op.get_bind().dialect.has_table(op.get_bind(), "plans"):
        op.drop_table("plans")
