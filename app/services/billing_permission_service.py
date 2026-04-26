"""
Billing permission service.

Handles permission checks for billing operations based on tenant membership.
"""

import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.database import Plan, UserQuota
from app.models.tenant import (
    Tenant,
    TenantMember,
    TenantPermission,
    TenantStatus,
)

logger = logging.getLogger(__name__)

# Trial period duration in days
TRIAL_DURATION_DAYS = 14


@dataclass
class BillingContext:
    """Context for billing operations."""

    # User information
    user_id: str
    user_quota: UserQuota

    # Tenant information (if applicable)
    is_tenant_member: bool = False
    tenant: Tenant | None = None
    tenant_membership: TenantMember | None = None

    # Permissions
    can_manage_billing: bool = False
    can_view_billing: bool = False

    # Billing target (user or tenant)
    billing_entity_type: str = "user"  # "user" or "tenant"
    stripe_customer_id: str | None = None
    stripe_subscription_id: str | None = None

    # Trial information
    is_in_trial: bool = False
    trial_start_at: datetime | None = None
    trial_ends_at: datetime | None = None
    has_used_trial: bool = False
    trial_days_remaining: int = 0


class BillingPermissionService:
    """
    Service for managing billing permissions.

    Handles:
    - Determining if user can manage billing (own or tenant)
    - Getting the correct billing entity (user vs tenant)
    - Trial period management
    """

    async def get_billing_context(
        self,
        user_id: str,
        session: AsyncSession,
    ) -> BillingContext:
        """
        Get the billing context for a user.

        Determines:
        - If user is part of a tenant
        - Who can manage billing (user or tenant owner)
        - Current trial status

        Args:
            user_id: The user's ID
            session: Database session

        Returns:
            BillingContext: Complete billing context
        """
        # Get user quota
        result = await session.execute(
            select(UserQuota).where(UserQuota.user_id == user_id)
        )
        user_quota = result.scalar_one_or_none()

        if not user_quota:
            # Create default quota for new user
            user_quota = UserQuota(
                user_id=user_id,
                plan_type="free",
                subscription_status="none",
            )
            session.add(user_quota)
            await session.flush()

        # Check for tenant membership
        membership_result = await session.execute(
            select(TenantMember)
            .options(selectinload(TenantMember.tenant).selectinload(Tenant.plan))
            .where(
                TenantMember.user_id == user_quota.id,
                TenantMember.is_active,
            )
        )
        membership = membership_result.scalar_one_or_none()

        context = BillingContext(
            user_id=user_id,
            user_quota=user_quota,
        )

        if membership and membership.tenant:
            tenant = membership.tenant

            context.is_tenant_member = True
            context.tenant = tenant
            context.tenant_membership = membership

            # Check permissions
            context.can_view_billing = membership.has_permission(TenantPermission.VIEW_BILLING)
            context.can_manage_billing = membership.has_permission(TenantPermission.MANAGE_BILLING)

            # For tenant members, billing is managed at tenant level
            context.billing_entity_type = "tenant"
            context.stripe_customer_id = tenant.stripe_customer_id
            context.stripe_subscription_id = tenant.stripe_subscription_id

            # Trial info from tenant
            context.trial_start_at = tenant.trial_start_at
            context.trial_ends_at = tenant.trial_ends_at
            context.has_used_trial = tenant.has_used_trial
            context.is_in_trial = self._is_in_trial(tenant.trial_ends_at, tenant.status)
            context.trial_days_remaining = self._calculate_trial_days_remaining(tenant.trial_ends_at)

        else:
            # Individual user billing
            context.billing_entity_type = "user"
            context.can_view_billing = True
            context.can_manage_billing = True
            context.stripe_customer_id = user_quota.stripe_customer_id
            context.stripe_subscription_id = user_quota.stripe_subscription_id

            # Trial info from user quota
            context.trial_start_at = user_quota.trial_start_at
            context.trial_ends_at = user_quota.trial_ends_at
            context.has_used_trial = user_quota.has_used_trial
            context.is_in_trial = self._is_in_trial(
                user_quota.trial_ends_at,
                user_quota.subscription_status,
            )
            context.trial_days_remaining = self._calculate_trial_days_remaining(user_quota.trial_ends_at)

        return context

    def _is_in_trial(
        self,
        trial_ends_at: datetime | None,
        status: str,
    ) -> bool:
        """Check if currently in trial period."""
        if not trial_ends_at:
            return False

        # Ensure timezone aware comparison
        now = datetime.now(UTC)
        if trial_ends_at.tzinfo is None:
            trial_ends_at = trial_ends_at.replace(tzinfo=UTC)

        # Check if trial is still active
        if now < trial_ends_at:
            # Also check status
            if isinstance(status, TenantStatus):
                return status == TenantStatus.TRIAL
            return status in ("trialing", "trial", "none")

        return False

    def _calculate_trial_days_remaining(
        self,
        trial_ends_at: datetime | None,
    ) -> int:
        """Calculate days remaining in trial."""
        if not trial_ends_at:
            return 0

        now = datetime.now(UTC)
        if trial_ends_at.tzinfo is None:
            trial_ends_at = trial_ends_at.replace(tzinfo=UTC)

        if now >= trial_ends_at:
            return 0

        delta = trial_ends_at - now
        return max(0, delta.days)

    async def start_trial(
        self,
        context: BillingContext,
        session: AsyncSession,
        plan_slug: str = "starter",
    ) -> tuple[datetime, datetime]:
        """
        Start a trial period for user or tenant.

        Args:
            context: Billing context
            session: Database session
            plan_slug: Plan to trial

        Returns:
            Tuple of (trial_start, trial_end) dates

        Raises:
            ValueError: If trial already used
        """
        now = datetime.now(UTC)
        trial_end = now + timedelta(days=TRIAL_DURATION_DAYS)

        if context.billing_entity_type == "tenant":
            if context.tenant.has_used_trial:
                raise ValueError("Trial period already used for this organization")

            context.tenant.trial_start_at = now
            context.tenant.trial_ends_at = trial_end
            context.tenant.status = TenantStatus.TRIAL

            # Get plan and apply limits to tenant
            plan_result = await session.execute(
                select(Plan).where(Plan.slug == plan_slug, Plan.is_active)
            )
            plan = plan_result.scalar_one_or_none()

            if plan:
                context.tenant.plan_id = plan.id
                context.tenant.storage_limit_bytes = plan.storage_limit_bytes
                context.tenant.api_calls_limit = plan.api_calls_limit
                context.tenant.document_limit = plan.document_limit

            logger.info(f"Started trial for tenant {context.tenant.id} until {trial_end}")

        else:
            if context.user_quota.has_used_trial:
                raise ValueError("Trial period already used")

            context.user_quota.trial_start_at = now
            context.user_quota.trial_ends_at = trial_end
            context.user_quota.subscription_status = "trialing"
            context.user_quota.plan_type = plan_slug

            # Apply plan limits
            from app.services.quota_service import quota_service
            await quota_service.upgrade_plan(context.user_id, plan_slug)

            logger.info(f"Started trial for user {context.user_id} until {trial_end}")

        return now, trial_end

    async def end_trial(
        self,
        context: BillingContext,
        session: AsyncSession,
        convert_to_paid: bool = False,
    ):
        """
        End a trial period.

        Args:
            context: Billing context
            session: Database session
            convert_to_paid: If True, mark as converted (keep plan)
        """
        if context.billing_entity_type == "tenant":
            context.tenant.has_used_trial = True

            if convert_to_paid:
                context.tenant.status = TenantStatus.ACTIVE
            else:
                # Downgrade to free
                context.tenant.status = TenantStatus.ACTIVE
                context.tenant.plan_id = None
                # Reset to free tier limits
                context.tenant.storage_limit_bytes = 5 * 1024 * 1024 * 1024  # 5GB
                context.tenant.api_calls_limit = 1000
                context.tenant.document_limit = 100

            logger.info(f"Ended trial for tenant {context.tenant.id}, converted={convert_to_paid}")

        else:
            context.user_quota.has_used_trial = True

            if convert_to_paid:
                context.user_quota.subscription_status = "active"
            else:
                # Downgrade to free
                context.user_quota.subscription_status = "none"
                context.user_quota.plan_type = "free"
                from app.services.quota_service import quota_service
                await quota_service.upgrade_plan(context.user_id, "free")

            logger.info(f"Ended trial for user {context.user_id}, converted={convert_to_paid}")

    async def can_change_plan_during_trial(
        self,
        context: BillingContext,
    ) -> bool:
        """
        Check if plan can be changed during trial without payment.

        During the 14-day trial, users can switch between plans freely.
        No proration or payment is required.

        Args:
            context: Billing context

        Returns:
            bool: True if in trial and can change plan freely
        """
        return context.is_in_trial

    def check_billing_permission(
        self,
        context: BillingContext,
        require_manage: bool = True,
    ) -> tuple[bool, str]:
        """
        Check if user has permission for billing operation.

        Args:
            context: Billing context
            require_manage: If True, require MANAGE_BILLING permission

        Returns:
            Tuple of (allowed, error_message)
        """
        if not context.is_tenant_member:
            # Individual users can always manage their own billing
            return True, ""

        if require_manage:
            if not context.can_manage_billing:
                return False, (
                    "Only the organization owner can manage billing. "
                    f"Please contact the owner of '{context.tenant.name}'."
                )
        else:
            if not context.can_view_billing:
                return False, "You don't have permission to view billing information."

        return True, ""


# Singleton instance
billing_permission_service = BillingPermissionService()
