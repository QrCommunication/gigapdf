"""
Quota Service - Storage and API quota management.

Handles:
- Storage quota tracking (5GB free tier)
- API call counting (1000/month free tier)
- Monthly reset of API quotas
- Plan upgrades/downgrades
- Tenant-based quota inheritance for enterprise plans
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional
from dataclasses import dataclass

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db_session
from app.models.database import UserQuota, Plan
from app.models.tenant import Tenant, TenantMember, TenantStatus

logger = logging.getLogger(__name__)


@dataclass
class EffectiveLimits:
    """Effective limits for a user (personal or tenant-based)."""
    storage_limit_bytes: int
    storage_used_bytes: int
    api_calls_limit: int
    api_calls_used: int
    document_limit: int
    document_count: int
    plan_type: str
    is_tenant_based: bool = False
    tenant_id: Optional[str] = None
    tenant_name: Optional[str] = None
    tenant_role: Optional[str] = None

    @property
    def storage_available_bytes(self) -> int:
        return max(0, self.storage_limit_bytes - self.storage_used_bytes)

    @property
    def api_calls_remaining(self) -> int:
        return max(0, self.api_calls_limit - self.api_calls_used)

    @property
    def storage_percentage(self) -> float:
        if self.storage_limit_bytes == 0:
            return 0
        return (self.storage_used_bytes / self.storage_limit_bytes) * 100

    @property
    def api_percentage(self) -> float:
        if self.api_calls_limit == 0:
            return 0
        return (self.api_calls_used / self.api_calls_limit) * 100

    def to_dict(self) -> dict:
        return {
            "storage": {
                "used_bytes": self.storage_used_bytes,
                "limit_bytes": self.storage_limit_bytes,
                "available_bytes": self.storage_available_bytes,
                "usage_percentage": round(self.storage_percentage, 2),
            },
            "api_calls": {
                "used": self.api_calls_used,
                "limit": self.api_calls_limit,
                "remaining": self.api_calls_remaining,
                "usage_percentage": round(self.api_percentage, 2),
            },
            "documents": {
                "count": self.document_count,
                "limit": self.document_limit,
            },
            "plan_type": self.plan_type,
            "is_tenant_based": self.is_tenant_based,
            "tenant": {
                "id": self.tenant_id,
                "name": self.tenant_name,
                "role": self.tenant_role,
            } if self.is_tenant_based else None,
        }


# Plan configurations (synchronized with frontend packages/billing/src/plans.ts)
PLANS = {
    "free": {
        "storage_limit_bytes": 5 * 1024 * 1024 * 1024,  # 5GB
        "api_calls_limit": 1000,  # per month
        "document_limit": 100,
    },
    "starter": {
        "storage_limit_bytes": 25 * 1024 * 1024 * 1024,  # 25GB
        "api_calls_limit": 10000,  # per month
        "document_limit": 500,
    },
    "pro": {
        "storage_limit_bytes": 100 * 1024 * 1024 * 1024,  # 100GB
        "api_calls_limit": 100000,  # per month
        "document_limit": 2000,
    },
    "enterprise": {
        "storage_limit_bytes": 500 * 1024 * 1024 * 1024,  # 500GB
        "api_calls_limit": 1000000,  # per month
        "document_limit": -1,  # unlimited
    },
}


class QuotaService:
    """
    Manages user quotas for storage and API calls.
    """

    async def get_or_create_quota(self, user_id: str) -> UserQuota:
        """
        Get user quota or create with free tier defaults.

        Args:
            user_id: User identifier.

        Returns:
            UserQuota: User's quota record.
        """
        async with get_db_session() as session:
            stmt = select(UserQuota).where(UserQuota.user_id == user_id)
            result = await session.execute(stmt)
            quota = result.scalar_one_or_none()

            if not quota:
                # Create new quota with free tier
                quota = UserQuota(
                    user_id=user_id,
                    storage_used_bytes=0,
                    storage_limit_bytes=PLANS["free"]["storage_limit_bytes"],
                    document_count=0,
                    document_limit=PLANS["free"]["document_limit"],
                    api_calls_used=0,
                    api_calls_limit=PLANS["free"]["api_calls_limit"],
                    api_calls_reset_at=self._get_next_reset_date(),
                    plan_type="free",
                )
                session.add(quota)
                await session.commit()
                await session.refresh(quota)
                logger.info(f"Created free tier quota for user {user_id}")

            return quota

    async def check_storage_quota(
        self, user_id: str, additional_bytes: int = 0
    ) -> tuple[bool, dict]:
        """
        Check if user has storage quota available.

        Args:
            user_id: User identifier.
            additional_bytes: Additional storage needed.

        Returns:
            tuple: (is_allowed, quota_info)
        """
        quota = await self.get_or_create_quota(user_id)

        new_total = quota.storage_used_bytes + additional_bytes
        is_allowed = new_total <= quota.storage_limit_bytes

        return is_allowed, {
            "storage_used_bytes": quota.storage_used_bytes,
            "storage_limit_bytes": quota.storage_limit_bytes,
            "storage_available_bytes": max(0, quota.storage_limit_bytes - quota.storage_used_bytes),
            "would_use_bytes": new_total,
            "is_allowed": is_allowed,
            "plan_type": quota.plan_type,
        }

    async def check_api_quota(self, user_id: str) -> tuple[bool, dict]:
        """
        Check if user has API calls remaining.

        Also handles monthly reset if needed.

        Args:
            user_id: User identifier.

        Returns:
            tuple: (is_allowed, quota_info)
        """
        quota = await self.get_or_create_quota(user_id)

        # Check if we need to reset monthly quota
        now = datetime.now(timezone.utc)
        if now >= quota.api_calls_reset_at:
            await self._reset_api_quota(user_id)
            quota = await self.get_or_create_quota(user_id)

        is_allowed = quota.api_calls_used < quota.api_calls_limit
        remaining = max(0, quota.api_calls_limit - quota.api_calls_used)

        return is_allowed, {
            "api_calls_used": quota.api_calls_used,
            "api_calls_limit": quota.api_calls_limit,
            "api_calls_remaining": remaining,
            "reset_at": quota.api_calls_reset_at.isoformat(),
            "is_allowed": is_allowed,
            "plan_type": quota.plan_type,
        }

    async def increment_api_calls(self, user_id: str, count: int = 1) -> dict:
        """
        Increment API call count for user.

        Args:
            user_id: User identifier.
            count: Number of calls to add.

        Returns:
            dict: Updated quota info.
        """
        async with get_db_session() as session:
            # Get current quota
            stmt = select(UserQuota).where(UserQuota.user_id == user_id)
            result = await session.execute(stmt)
            quota = result.scalar_one_or_none()

            if not quota:
                # Create quota first
                await self.get_or_create_quota(user_id)
                result = await session.execute(stmt)
                quota = result.scalar_one()

            # Check for monthly reset
            now = datetime.now(timezone.utc)
            if now >= quota.api_calls_reset_at:
                quota.api_calls_used = count
                quota.api_calls_reset_at = self._get_next_reset_date()
            else:
                quota.api_calls_used += count

            await session.commit()

            remaining = max(0, quota.api_calls_limit - quota.api_calls_used)

            return {
                "api_calls_used": quota.api_calls_used,
                "api_calls_limit": quota.api_calls_limit,
                "api_calls_remaining": remaining,
                "reset_at": quota.api_calls_reset_at.isoformat(),
            }

    async def update_storage_usage(
        self, user_id: str, delta_bytes: int, delta_documents: int = 0
    ) -> dict:
        """
        Update storage usage for user.

        Args:
            user_id: User identifier.
            delta_bytes: Bytes to add (negative to subtract).
            delta_documents: Documents to add (negative to subtract).

        Returns:
            dict: Updated quota info.
        """
        async with get_db_session() as session:
            stmt = select(UserQuota).where(UserQuota.user_id == user_id)
            result = await session.execute(stmt)
            quota = result.scalar_one_or_none()

            if not quota:
                await self.get_or_create_quota(user_id)
                result = await session.execute(stmt)
                quota = result.scalar_one()

            quota.storage_used_bytes = max(0, quota.storage_used_bytes + delta_bytes)
            quota.document_count = max(0, quota.document_count + delta_documents)

            await session.commit()

            return {
                "storage_used_bytes": quota.storage_used_bytes,
                "storage_limit_bytes": quota.storage_limit_bytes,
                "storage_available_bytes": max(0, quota.storage_limit_bytes - quota.storage_used_bytes),
                "document_count": quota.document_count,
                "document_limit": quota.document_limit,
            }

    async def upgrade_plan(
        self, user_id: str, plan_type: str, expires_at: Optional[datetime] = None
    ) -> dict:
        """
        Upgrade user to a new plan.

        Args:
            user_id: User identifier.
            plan_type: New plan type (pro, enterprise).
            expires_at: Plan expiration date.

        Returns:
            dict: Updated quota info.
        """
        if plan_type not in PLANS:
            raise ValueError(f"Invalid plan type: {plan_type}")

        plan = PLANS[plan_type]

        async with get_db_session() as session:
            stmt = select(UserQuota).where(UserQuota.user_id == user_id)
            result = await session.execute(stmt)
            quota = result.scalar_one_or_none()

            if not quota:
                await self.get_or_create_quota(user_id)
                result = await session.execute(stmt)
                quota = result.scalar_one()

            quota.plan_type = plan_type
            quota.storage_limit_bytes = plan["storage_limit_bytes"]
            quota.api_calls_limit = plan["api_calls_limit"]
            quota.document_limit = plan["document_limit"]
            quota.plan_expires_at = expires_at

            await session.commit()

            logger.info(f"Upgraded user {user_id} to {plan_type} plan")

            return {
                "plan_type": quota.plan_type,
                "storage_limit_bytes": quota.storage_limit_bytes,
                "api_calls_limit": quota.api_calls_limit,
                "document_limit": quota.document_limit,
                "expires_at": quota.plan_expires_at.isoformat() if quota.plan_expires_at else None,
            }

    async def get_quota_summary(self, user_id: str) -> dict:
        """
        Get complete quota summary for user.

        Args:
            user_id: User identifier.

        Returns:
            dict: Complete quota information.
        """
        quota = await self.get_or_create_quota(user_id)

        # Check for monthly reset
        now = datetime.now(timezone.utc)
        if now >= quota.api_calls_reset_at:
            await self._reset_api_quota(user_id)
            quota = await self.get_or_create_quota(user_id)

        storage_percentage = (
            (quota.storage_used_bytes / quota.storage_limit_bytes * 100)
            if quota.storage_limit_bytes > 0
            else 0
        )
        api_percentage = (
            (quota.api_calls_used / quota.api_calls_limit * 100)
            if quota.api_calls_limit > 0
            else 0
        )

        return {
            "user_id": user_id,
            "plan": {
                "type": quota.plan_type,
                "expires_at": quota.plan_expires_at.isoformat() if quota.plan_expires_at else None,
            },
            "storage": {
                "used_bytes": quota.storage_used_bytes,
                "limit_bytes": quota.storage_limit_bytes,
                "available_bytes": max(0, quota.storage_limit_bytes - quota.storage_used_bytes),
                "usage_percentage": round(storage_percentage, 2),
            },
            "documents": {
                "count": quota.document_count,
                "limit": quota.document_limit,
            },
            "api_calls": {
                "used": quota.api_calls_used,
                "limit": quota.api_calls_limit,
                "remaining": max(0, quota.api_calls_limit - quota.api_calls_used),
                "usage_percentage": round(api_percentage, 2),
                "reset_at": quota.api_calls_reset_at.isoformat(),
            },
        }

    async def _reset_api_quota(self, user_id: str) -> None:
        """Reset monthly API quota for user."""
        async with get_db_session() as session:
            stmt = (
                update(UserQuota)
                .where(UserQuota.user_id == user_id)
                .values(
                    api_calls_used=0,
                    api_calls_reset_at=self._get_next_reset_date(),
                )
            )
            await session.execute(stmt)
            await session.commit()
            logger.info(f"Reset API quota for user {user_id}")

    def _get_next_reset_date(self) -> datetime:
        """Get next monthly reset date (1st of next month)."""
        now = datetime.now(timezone.utc)
        if now.month == 12:
            return datetime(now.year + 1, 1, 1)
        return datetime(now.year, now.month + 1, 1)


    async def get_effective_limits(self, user_id: str) -> EffectiveLimits:
        """
        Get effective limits for a user, considering tenant membership.

        If user belongs to a tenant with an active enterprise plan,
        they inherit the tenant's limits instead of their personal limits.

        Args:
            user_id: User identifier.

        Returns:
            EffectiveLimits: The effective limits for the user.
        """
        # First ensure quota exists (this uses its own session)
        user_quota = await self.get_or_create_quota(user_id)

        async with get_db_session() as session:
            # Re-fetch the quota in this session for consistent reads
            stmt = select(UserQuota).where(UserQuota.user_id == user_id)
            result = await session.execute(stmt)
            user_quota = result.scalar_one()

            # Check if user belongs to a tenant with an enterprise plan
            tenant_membership = await self._get_active_tenant_membership(session, user_quota.id)

            if tenant_membership and str(tenant_membership.tenant.status) == "active":
                tenant = tenant_membership.tenant
                # User inherits tenant limits
                return EffectiveLimits(
                    storage_limit_bytes=tenant.storage_limit_bytes,
                    storage_used_bytes=tenant.storage_used_bytes,
                    api_calls_limit=tenant.api_calls_limit,
                    api_calls_used=tenant.api_calls_used,
                    document_limit=tenant.document_limit,
                    document_count=tenant.document_count,
                    plan_type=tenant.plan.slug if tenant.plan else "enterprise",
                    is_tenant_based=True,
                    tenant_id=str(tenant.id),
                    tenant_name=tenant.name,
                    tenant_role=tenant_membership.role.value,
                )

            # Use personal limits
            return EffectiveLimits(
                storage_limit_bytes=user_quota.storage_limit_bytes,
                storage_used_bytes=user_quota.storage_used_bytes,
                api_calls_limit=user_quota.api_calls_limit,
                api_calls_used=user_quota.api_calls_used,
                document_limit=user_quota.document_limit,
                document_count=user_quota.document_count,
                plan_type=user_quota.plan_type,
                is_tenant_based=False,
            )

    async def _get_active_tenant_membership(
        self, session: AsyncSession, user_quota_id: str
    ) -> Optional[TenantMember]:
        """
        Get user's active tenant membership with an enterprise plan.

        A user can belong to multiple tenants, but we prioritize:
        1. Tenants with active enterprise plans
        2. The tenant where user has the highest role

        Args:
            session: Database session.
            user_quota_id: User quota UUID.

        Returns:
            TenantMember or None if no active tenant membership found.
        """
        from sqlalchemy import and_

        # Query for tenant memberships with active tenants that have enterprise plans
        stmt = (
            select(TenantMember)
            .options(
                selectinload(TenantMember.tenant).selectinload(Tenant.plan)
            )
            .join(TenantMember.tenant)
            .outerjoin(Tenant.plan)
            .where(
                and_(
                    TenantMember.user_id == user_quota_id,
                    TenantMember.is_active == True,
                    Tenant.status == TenantStatus.ACTIVE,
                )
            )
            .order_by(TenantMember.role)  # owner < admin < manager < member < viewer
        )

        result = await session.execute(stmt)
        memberships = result.scalars().all()

        if not memberships:
            return None

        # Prefer tenant with enterprise plan, otherwise first active membership
        for membership in memberships:
            if membership.tenant.plan and membership.tenant.plan.is_tenant_plan:
                return membership

        # Return first active membership even without enterprise plan
        return memberships[0]

    async def check_tenant_storage_quota(
        self, tenant_id: str, additional_bytes: int = 0
    ) -> tuple[bool, dict]:
        """
        Check if tenant has storage quota available.

        Args:
            tenant_id: Tenant UUID.
            additional_bytes: Additional storage needed.

        Returns:
            tuple: (is_allowed, quota_info)
        """
        async with get_db_session() as session:
            stmt = select(Tenant).where(Tenant.id == tenant_id)
            result = await session.execute(stmt)
            tenant = result.scalar_one_or_none()

            if not tenant:
                return False, {"error": "Tenant not found"}

            new_total = tenant.storage_used_bytes + additional_bytes
            is_allowed = new_total <= tenant.storage_limit_bytes

            return is_allowed, {
                "storage_used_bytes": tenant.storage_used_bytes,
                "storage_limit_bytes": tenant.storage_limit_bytes,
                "storage_available_bytes": max(0, tenant.storage_limit_bytes - tenant.storage_used_bytes),
                "would_use_bytes": new_total,
                "is_allowed": is_allowed,
                "tenant_id": str(tenant.id),
                "tenant_name": tenant.name,
            }

    async def update_tenant_storage(
        self, tenant_id: str, delta_bytes: int, delta_documents: int = 0
    ) -> dict:
        """
        Update storage usage for a tenant.

        Args:
            tenant_id: Tenant UUID.
            delta_bytes: Bytes to add (negative to subtract).
            delta_documents: Documents to add (negative to subtract).

        Returns:
            dict: Updated quota info.
        """
        async with get_db_session() as session:
            stmt = select(Tenant).where(Tenant.id == tenant_id)
            result = await session.execute(stmt)
            tenant = result.scalar_one_or_none()

            if not tenant:
                raise ValueError(f"Tenant not found: {tenant_id}")

            tenant.storage_used_bytes = max(0, tenant.storage_used_bytes + delta_bytes)
            tenant.document_count = max(0, tenant.document_count + delta_documents)

            await session.commit()

            return {
                "storage_used_bytes": tenant.storage_used_bytes,
                "storage_limit_bytes": tenant.storage_limit_bytes,
                "storage_available_bytes": max(0, tenant.storage_limit_bytes - tenant.storage_used_bytes),
                "document_count": tenant.document_count,
                "document_limit": tenant.document_limit,
                "tenant_id": str(tenant.id),
            }

    async def increment_tenant_api_calls(self, tenant_id: str, count: int = 1) -> dict:
        """
        Increment API call count for a tenant.

        Args:
            tenant_id: Tenant UUID.
            count: Number of calls to add.

        Returns:
            dict: Updated quota info.
        """
        async with get_db_session() as session:
            stmt = select(Tenant).where(Tenant.id == tenant_id)
            result = await session.execute(stmt)
            tenant = result.scalar_one_or_none()

            if not tenant:
                raise ValueError(f"Tenant not found: {tenant_id}")

            # Check for monthly reset
            now = datetime.now(timezone.utc)
            if tenant.api_calls_reset_at and now >= tenant.api_calls_reset_at:
                tenant.api_calls_used = count
                tenant.api_calls_reset_at = self._get_next_reset_date()
            else:
                tenant.api_calls_used += count
                if not tenant.api_calls_reset_at:
                    tenant.api_calls_reset_at = self._get_next_reset_date()

            await session.commit()

            return {
                "api_calls_used": tenant.api_calls_used,
                "api_calls_limit": tenant.api_calls_limit,
                "api_calls_remaining": max(0, tenant.api_calls_limit - tenant.api_calls_used),
                "reset_at": tenant.api_calls_reset_at.isoformat() if tenant.api_calls_reset_at else None,
                "tenant_id": str(tenant.id),
            }

    async def apply_plan_to_tenant(self, tenant_id: str, plan_id: str) -> dict:
        """
        Apply a plan's limits to a tenant.

        When a tenant subscribes to an enterprise plan, this method
        updates the tenant's limits based on the plan configuration.

        Args:
            tenant_id: Tenant UUID.
            plan_id: Plan UUID.

        Returns:
            dict: Updated tenant info.
        """
        async with get_db_session() as session:
            # Get the plan
            plan_stmt = select(Plan).where(Plan.id == plan_id)
            plan_result = await session.execute(plan_stmt)
            plan = plan_result.scalar_one_or_none()

            if not plan:
                raise ValueError(f"Plan not found: {plan_id}")

            if not plan.is_tenant_plan:
                raise ValueError(f"Plan '{plan.name}' is not a tenant/enterprise plan")

            # Get the tenant
            tenant_stmt = select(Tenant).where(Tenant.id == tenant_id)
            tenant_result = await session.execute(tenant_stmt)
            tenant = tenant_result.scalar_one_or_none()

            if not tenant:
                raise ValueError(f"Tenant not found: {tenant_id}")

            # Apply plan limits to tenant
            tenant.plan_id = plan.id
            tenant.storage_limit_bytes = plan.storage_limit_bytes
            tenant.api_calls_limit = plan.api_calls_limit
            tenant.document_limit = plan.document_limit
            tenant.max_members = plan.max_members
            tenant.status = TenantStatus.ACTIVE

            await session.commit()

            logger.info(f"Applied plan '{plan.name}' to tenant '{tenant.name}'")

            return {
                "tenant_id": str(tenant.id),
                "tenant_name": tenant.name,
                "plan_id": str(plan.id),
                "plan_name": plan.name,
                "storage_limit_bytes": tenant.storage_limit_bytes,
                "api_calls_limit": tenant.api_calls_limit,
                "document_limit": tenant.document_limit,
                "max_members": tenant.max_members,
            }


# Global service instance
quota_service = QuotaService()
