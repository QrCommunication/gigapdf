"""
Billing endpoints for Stripe integration.

Provides endpoints for subscription management, checkout, portal, invoices, and payment methods.

**Important**: For users in a tenant (organization), only the tenant owner can manage billing.
Members share the tenant's quotas and subscription.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import select

from app.config import get_settings
from app.core.database import get_db_session
from app.middleware.auth import AuthenticatedUser
from app.middleware.request_id import get_request_id
from app.models.database import Plan, UserQuota
from app.models.tenant import Tenant, TenantStatus
from app.schemas.billing import (
    AddPaymentMethodRequest,
    BillingPlanResponse,
    CancelSubscriptionRequest,
    CardDetails,
    CheckoutSessionResponse,
    CreateCheckoutRequest,
    CreatePortalRequest,
    InvoiceResponse,
    PaymentMethodResponse,
    PortalSessionResponse,
    SubscriptionResponse,
    UpdateSubscriptionRequest,
    UsageLimits,
    UsageMetrics,
    UsageSummaryResponse,
)
from app.schemas.responses.common import APIResponse, MetaInfo
from app.services.billing_permission_service import (
    TRIAL_DURATION_DAYS,
    BillingContext,
    billing_permission_service,
)
from app.services.quota_service import quota_service
from app.services.stripe_service import (
    StripeServiceError,
    stripe_service,
)
from app.utils.helpers import now_utc

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter()


# =============================================================================
# Helper Functions
# =============================================================================


async def get_billing_context_or_error(
    user: AuthenticatedUser,
    require_manage: bool = True,
) -> BillingContext:
    """
    Get billing context and check permissions.

    Args:
        user: Authenticated user
        require_manage: If True, require MANAGE_BILLING permission

    Returns:
        BillingContext: Billing context if allowed

    Raises:
        HTTPException: If permission denied
    """
    async with get_db_session() as session:
        context = await billing_permission_service.get_billing_context(
            user.user_id, session
        )

        allowed, error_msg = billing_permission_service.check_billing_permission(
            context, require_manage=require_manage
        )

        if not allowed:
            raise HTTPException(status_code=403, detail=error_msg)

        return context


def get_plan_name(plan_type: str) -> str:
    """Get display name for plan type."""
    names = {
        "free": "Free",
        "starter": "Starter",
        "pro": "Pro",
        "enterprise": "Enterprise",
    }
    return names.get(plan_type, plan_type.capitalize())


async def ensure_stripe_customer(
    user: "AuthenticatedUser",
    context: BillingContext,
    session,
) -> str:
    """
    Ensure a Stripe customer exists, creating one if necessary.

    Args:
        user: Authenticated user
        context: Billing context
        session: Database session

    Returns:
        str: Stripe customer ID

    Raises:
        HTTPException: If customer creation fails
    """
    if context.stripe_customer_id:
        return context.stripe_customer_id

    # Get user email
    customer_email = user.email
    if not customer_email:
        raise HTTPException(
            status_code=400,
            detail="User email is required to create a billing account.",
        )

    try:
        # Create Stripe customer
        customer = stripe_service.create_customer(
            user_id=user.user_id,
            email=customer_email,
            name=user.name,
            metadata={
                "user_id": user.user_id,
                "billing_entity_type": context.billing_entity_type,
            },
        )
        stripe_customer_id = customer.id

        # Save customer ID to database
        if context.billing_entity_type == "tenant" and context.tenant:
            context.tenant.stripe_customer_id = stripe_customer_id
        else:
            context.user_quota.stripe_customer_id = stripe_customer_id

        await session.commit()
        logger.info(f"Created Stripe customer {stripe_customer_id} for user {user.user_id}")

        return stripe_customer_id

    except StripeServiceError as e:
        raise HTTPException(status_code=400, detail=f"Failed to create billing account: {e}")


# =============================================================================
# Subscription Endpoints
# =============================================================================


@router.get(
    "/subscription",
    response_model=APIResponse[SubscriptionResponse],
    summary="Get current subscription",
    description="""
Get the current subscription status.

**For tenant members**: Returns the organization's subscription.
Only members with VIEW_BILLING permission can access this.

**For individual users**: Returns their personal subscription.

## Trial Period
- 14-day free trial for Starter and Pro plans
- During trial, you can switch plans without payment
- Billing starts at the end of the trial

## Example (curl)
```bash
curl -X GET "https://giga-pdf.com/api/v1/billing/subscription" \\
  -H "Authorization: Bearer <token>"
```

## Example (Python)
```python
import requests

response = requests.get(
    "https://giga-pdf.com/api/v1/billing/subscription",
    headers={"Authorization": "Bearer <token>"}
)
subscription = response.json()["data"]
print(f"Plan: {subscription['current_plan']}")
print(f"Status: {subscription['status']}")
if subscription.get('is_in_trial'):
    print(f"Trial ends in {subscription['trial_days_remaining']} days")
```
""",
)
async def get_subscription(user: AuthenticatedUser) -> APIResponse[SubscriptionResponse]:
    """Get current subscription status."""
    async with get_db_session() as session:
        context = await billing_permission_service.get_billing_context(
            user.user_id, session
        )

        # Check view permission
        allowed, error_msg = billing_permission_service.check_billing_permission(
            context, require_manage=False
        )
        if not allowed:
            raise HTTPException(status_code=403, detail=error_msg)

        # Determine current plan and status based on context
        if context.billing_entity_type == "tenant":
            tenant = context.tenant
            plan_type = tenant.plan.slug if tenant.plan else "free"
            plan_name = tenant.plan.name if tenant.plan else "Free"
            status = "trialing" if context.is_in_trial else str(tenant.status.value)
            current_period_end = context.trial_ends_at if context.is_in_trial else None
        else:
            user_quota = context.user_quota
            plan_type = user_quota.plan_type
            plan_name = get_plan_name(plan_type)
            status = user_quota.subscription_status
            current_period_end = (
                context.trial_ends_at if context.is_in_trial
                else user_quota.current_period_end
            )

        # Build response with trial info
        subscription_data = SubscriptionResponse(
            status=status,
            current_plan=plan_type,
            plan_name=plan_name,
            billing_cycle="month" if status not in ("none", "free") else None,
            current_period_end=current_period_end,
            cancel_at_period_end=(
                context.user_quota.cancel_at_period_end
                if context.billing_entity_type == "user"
                else False
            ),
            stripe_customer_id=context.stripe_customer_id,
            stripe_subscription_id=context.stripe_subscription_id,
        )

        # Add trial information to response
        response_data = subscription_data.model_dump()
        response_data["is_in_trial"] = context.is_in_trial
        response_data["trial_days_remaining"] = context.trial_days_remaining
        response_data["trial_ends_at"] = context.trial_ends_at
        response_data["has_used_trial"] = context.has_used_trial
        response_data["billing_entity_type"] = context.billing_entity_type
        if context.is_tenant_member:
            response_data["tenant_name"] = context.tenant.name
            response_data["tenant_id"] = str(context.tenant.id)

        return APIResponse(
            success=True,
            data=response_data,
            meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
        )


@router.patch(
    "/subscription",
    response_model=APIResponse[SubscriptionResponse],
    summary="Update subscription",
    description="""
Change the current subscription plan.

**Permissions**: Only organization owners can change the plan for tenants.

**During Trial Period (14 days)**:
- You can switch between Starter and Pro plans freely
- No payment or proration is applied
- The trial continues until it ends

**After Trial**:
- Prorations are automatically applied
- Upgrades are effective immediately
- Downgrades take effect at period end

## Example (curl)
```bash
curl -X PATCH "https://giga-pdf.com/api/v1/billing/subscription" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{"plan_id": "pro"}'
```
""",
)
async def update_subscription(
    user: AuthenticatedUser,
    request: UpdateSubscriptionRequest,
) -> APIResponse[SubscriptionResponse]:
    """Update subscription to a new plan."""
    async with get_db_session() as session:
        context = await billing_permission_service.get_billing_context(
            user.user_id, session
        )

        # Check manage permission
        allowed, error_msg = billing_permission_service.check_billing_permission(
            context, require_manage=True
        )
        if not allowed:
            raise HTTPException(status_code=403, detail=error_msg)

        # Get the new plan
        plan_result = await session.execute(
            select(Plan).where(Plan.slug == request.plan_id, Plan.is_active == True)
        )
        plan = plan_result.scalar_one_or_none()

        if not plan or not plan.stripe_price_id:
            raise HTTPException(status_code=404, detail=f"Plan '{request.plan_id}' not found")

        # Check if in trial period - handle differently
        if context.is_in_trial:
            # During trial, just change the plan without Stripe interaction
            if context.billing_entity_type == "tenant":
                context.tenant.plan_id = plan.id
                context.tenant.storage_limit_bytes = plan.storage_limit_bytes
                context.tenant.api_calls_limit = plan.api_calls_limit
                context.tenant.document_limit = plan.document_limit
            else:
                context.user_quota.plan_type = request.plan_id
                await quota_service.upgrade_plan(user.user_id, request.plan_id)

            await session.commit()

            return APIResponse(
                success=True,
                data={
                    "status": "trialing",
                    "current_plan": request.plan_id,
                    "plan_name": plan.name,
                    "is_in_trial": True,
                    "trial_days_remaining": context.trial_days_remaining,
                    "trial_ends_at": context.trial_ends_at,
                    "message": f"Plan changed to {plan.name}. No charge during trial period.",
                },
                meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
            )

        # Not in trial - need active subscription to update
        if not context.stripe_subscription_id:
            raise HTTPException(
                status_code=400,
                detail="No active subscription to update. Please create a subscription first.",
            )

        try:
            # Update subscription in Stripe
            updated_sub = stripe_service.update_subscription(
                context.stripe_subscription_id,
                plan.stripe_price_id,
            )

            # Update local records
            if context.billing_entity_type == "tenant":
                context.tenant.plan_id = plan.id
                context.tenant.storage_limit_bytes = plan.storage_limit_bytes
                context.tenant.api_calls_limit = plan.api_calls_limit
                context.tenant.document_limit = plan.document_limit
            else:
                context.user_quota.plan_type = request.plan_id
                context.user_quota.current_period_end = datetime.fromtimestamp(
                    updated_sub.current_period_end, tz=timezone.utc
                )
                await quota_service.upgrade_plan(user.user_id, request.plan_id)

            await session.commit()

            return APIResponse(
                success=True,
                data=SubscriptionResponse(
                    status=updated_sub.status,
                    current_plan=request.plan_id,
                    plan_name=plan.name,
                    billing_cycle=plan.interval,
                    current_period_end=datetime.fromtimestamp(
                        updated_sub.current_period_end, tz=timezone.utc
                    ),
                    cancel_at_period_end=updated_sub.cancel_at_period_end,
                    stripe_customer_id=context.stripe_customer_id,
                    stripe_subscription_id=context.stripe_subscription_id,
                ),
                meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
            )

        except StripeServiceError as e:
            logger.error(f"Failed to update subscription: {e}")
            raise HTTPException(status_code=400, detail=str(e))


@router.post(
    "/subscription/cancel",
    response_model=APIResponse[SubscriptionResponse],
    summary="Cancel subscription",
    description="""
Cancel the current subscription.

**Permissions**: Only organization owners can cancel for tenants.

**During Trial**:
- Canceling during trial immediately reverts to free plan
- No charges are applied

**After Trial**:
- By default, cancellation takes effect at the end of the current billing period
- Set `immediately: true` to cancel immediately (no refund)

## Example (curl)
```bash
curl -X POST "https://giga-pdf.com/api/v1/billing/subscription/cancel" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{"immediately": false}'
```
""",
)
async def cancel_subscription(
    user: AuthenticatedUser,
    request: CancelSubscriptionRequest,
) -> APIResponse[SubscriptionResponse]:
    """Cancel the current subscription."""
    async with get_db_session() as session:
        context = await billing_permission_service.get_billing_context(
            user.user_id, session
        )

        # Check manage permission
        allowed, error_msg = billing_permission_service.check_billing_permission(
            context, require_manage=True
        )
        if not allowed:
            raise HTTPException(status_code=403, detail=error_msg)

        # Handle trial cancellation
        if context.is_in_trial:
            # End trial and revert to free
            await billing_permission_service.end_trial(
                context, session, convert_to_paid=False
            )
            await session.commit()

            return APIResponse(
                success=True,
                data={
                    "status": "canceled",
                    "current_plan": "free",
                    "plan_name": "Free",
                    "message": "Trial canceled. Reverted to free plan.",
                },
                meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
            )

        # No active subscription
        if not context.stripe_subscription_id:
            raise HTTPException(status_code=400, detail="No active subscription to cancel")

        try:
            canceled_sub = stripe_service.cancel_subscription(
                context.stripe_subscription_id,
                immediately=request.immediately,
            )

            if request.immediately:
                if context.billing_entity_type == "tenant":
                    context.tenant.status = TenantStatus.CANCELLED
                    context.tenant.plan_id = None
                else:
                    context.user_quota.subscription_status = "canceled"
                    context.user_quota.plan_type = "free"
                    await quota_service.upgrade_plan(user.user_id, "free")
            else:
                if context.billing_entity_type == "user":
                    context.user_quota.cancel_at_period_end = True

            await session.commit()

            return APIResponse(
                success=True,
                data=SubscriptionResponse(
                    status=canceled_sub.status,
                    current_plan=(
                        "free" if request.immediately
                        else context.user_quota.plan_type if context.billing_entity_type == "user"
                        else context.tenant.plan.slug if context.tenant.plan else "free"
                    ),
                    plan_name="Free" if request.immediately else get_plan_name(
                        context.user_quota.plan_type if context.billing_entity_type == "user"
                        else context.tenant.plan.slug if context.tenant.plan else "free"
                    ),
                    cancel_at_period_end=canceled_sub.cancel_at_period_end,
                    stripe_customer_id=context.stripe_customer_id,
                    stripe_subscription_id=context.stripe_subscription_id,
                ),
                meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
            )

        except StripeServiceError as e:
            raise HTTPException(status_code=400, detail=str(e))


@router.post(
    "/subscription/reactivate",
    response_model=APIResponse[SubscriptionResponse],
    summary="Reactivate subscription",
    description="""
Reactivate a subscription that was scheduled for cancellation.

**Permissions**: Only organization owners can reactivate for tenants.

Only works if the subscription hasn't actually been canceled yet.

## Example (curl)
```bash
curl -X POST "https://giga-pdf.com/api/v1/billing/subscription/reactivate" \\
  -H "Authorization: Bearer <token>"
```
""",
)
async def reactivate_subscription(
    user: AuthenticatedUser,
) -> APIResponse[SubscriptionResponse]:
    """Reactivate a subscription scheduled for cancellation."""
    async with get_db_session() as session:
        context = await billing_permission_service.get_billing_context(
            user.user_id, session
        )

        # Check manage permission
        allowed, error_msg = billing_permission_service.check_billing_permission(
            context, require_manage=True
        )
        if not allowed:
            raise HTTPException(status_code=403, detail=error_msg)

        if not context.stripe_subscription_id:
            raise HTTPException(status_code=400, detail="No subscription to reactivate")

        if context.billing_entity_type == "user" and not context.user_quota.cancel_at_period_end:
            raise HTTPException(
                status_code=400,
                detail="Subscription is not scheduled for cancellation",
            )

        try:
            reactivated_sub = stripe_service.reactivate_subscription(
                context.stripe_subscription_id
            )

            if context.billing_entity_type == "user":
                context.user_quota.cancel_at_period_end = False

            await session.commit()

            plan_type = (
                context.user_quota.plan_type if context.billing_entity_type == "user"
                else context.tenant.plan.slug if context.tenant.plan else "free"
            )

            return APIResponse(
                success=True,
                data=SubscriptionResponse(
                    status=reactivated_sub.status,
                    current_plan=plan_type,
                    plan_name=get_plan_name(plan_type),
                    cancel_at_period_end=False,
                    stripe_customer_id=context.stripe_customer_id,
                    stripe_subscription_id=context.stripe_subscription_id,
                ),
                meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
            )

        except StripeServiceError as e:
            raise HTTPException(status_code=400, detail=str(e))


# =============================================================================
# Trial Management
# =============================================================================


@router.post(
    "/trial/start",
    response_model=APIResponse[dict],
    summary="Start free trial",
    description="""
Start a 14-day free trial for a plan.

**Each user/organization can only use the trial once.**

During the trial:
- Full access to all features of the selected plan
- Switch between Starter and Pro freely
- No payment required until trial ends
- Billing starts automatically after 14 days if not canceled

## Example (curl)
```bash
curl -X POST "https://giga-pdf.com/api/v1/billing/trial/start" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{"plan_id": "starter"}'
```
""",
)
async def start_trial(
    user: AuthenticatedUser,
    request: UpdateSubscriptionRequest,
) -> APIResponse[dict]:
    """Start a free trial period."""
    async with get_db_session() as session:
        context = await billing_permission_service.get_billing_context(
            user.user_id, session
        )

        # Check manage permission
        allowed, error_msg = billing_permission_service.check_billing_permission(
            context, require_manage=True
        )
        if not allowed:
            raise HTTPException(status_code=403, detail=error_msg)

        # Check if trial already used
        if context.has_used_trial:
            raise HTTPException(
                status_code=400,
                detail="Trial period already used. Please subscribe to continue.",
            )

        # Check if already in trial
        if context.is_in_trial:
            raise HTTPException(
                status_code=400,
                detail="Already in trial period.",
            )

        # Validate plan
        if request.plan_id not in ("starter", "pro"):
            raise HTTPException(
                status_code=400,
                detail="Trial is only available for Starter and Pro plans.",
            )

        try:
            trial_start, trial_end = await billing_permission_service.start_trial(
                context, session, plan_slug=request.plan_id
            )
            await session.commit()

            return APIResponse(
                success=True,
                data={
                    "message": f"Trial started successfully for {request.plan_id.capitalize()} plan",
                    "plan": request.plan_id,
                    "trial_start": trial_start.isoformat(),
                    "trial_ends": trial_end.isoformat(),
                    "trial_days": TRIAL_DURATION_DAYS,
                },
                meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
            )

        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))


# =============================================================================
# Checkout & Portal
# =============================================================================


@router.post(
    "/checkout",
    response_model=APIResponse[CheckoutSessionResponse],
    summary="Create checkout session",
    description="""
Create a Stripe Checkout session for subscription.

**Permissions**: Only organization owners can create checkout for tenants.

**Trial Handling**:
- If currently in trial, checkout will convert the trial to a paid subscription
- Billing starts immediately after checkout completion
- The trial is marked as used

Returns a URL to redirect the user to complete payment.

## Example (curl)
```bash
curl -X POST "https://giga-pdf.com/api/v1/billing/checkout" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "plan_id": "starter",
    "success_url": "https://giga-pdf.com/billing/success",
    "cancel_url": "https://giga-pdf.com/billing/cancel"
  }'
```

## Example (JavaScript)
```javascript
const response = await fetch('https://giga-pdf.com/api/v1/billing/checkout', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer <token>',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    plan_id: 'starter',
    success_url: 'https://giga-pdf.com/billing/success',
    cancel_url: 'https://giga-pdf.com/billing/cancel'
  })
});
const { data } = await response.json();
window.location.href = data.url;
```
""",
)
async def create_checkout(
    user: AuthenticatedUser,
    request: CreateCheckoutRequest,
) -> APIResponse[CheckoutSessionResponse]:
    """Create a Stripe Checkout session."""
    async with get_db_session() as session:
        context = await billing_permission_service.get_billing_context(
            user.user_id, session
        )

        # Check manage permission
        allowed, error_msg = billing_permission_service.check_billing_permission(
            context, require_manage=True
        )
        if not allowed:
            raise HTTPException(status_code=403, detail=error_msg)

        # Get plan details
        plan_result = await session.execute(
            select(Plan).where(Plan.slug == request.plan_id, Plan.is_active == True)
        )
        plan = plan_result.scalar_one_or_none()

        if not plan or not plan.stripe_price_id:
            raise HTTPException(
                status_code=404,
                detail=f"Plan '{request.plan_id}' not found or not available for purchase",
            )

        # Create Stripe customer if not exists
        if not context.stripe_customer_id:
            try:
                if context.billing_entity_type == "tenant":
                    customer = stripe_service.create_customer(
                        user_id=str(context.tenant.id),
                        email=context.tenant.email,
                        name=context.tenant.name,
                        metadata={"tenant_id": str(context.tenant.id)},
                    )
                    context.tenant.stripe_customer_id = customer.id
                else:
                    customer = stripe_service.create_customer(
                        user_id=user.user_id,
                        email=user.email or f"{user.user_id}@giga-pdf.com",
                        name=user.name,
                    )
                    context.user_quota.stripe_customer_id = customer.id

                await session.flush()
                context.stripe_customer_id = customer.id

            except StripeServiceError as e:
                raise HTTPException(status_code=400, detail=str(e))

        try:
            # Determine trial days (only if trial not used)
            trial_days = None
            if not context.has_used_trial and plan.trial_days:
                trial_days = plan.trial_days

            # Create checkout session
            checkout_session = stripe_service.create_checkout_session(
                customer_id=context.stripe_customer_id,
                price_id=plan.stripe_price_id,
                success_url=request.success_url,
                cancel_url=request.cancel_url,
                trial_days=trial_days,
                metadata={
                    "user_id": user.user_id,
                    "plan_slug": plan.slug,
                    "billing_entity_type": context.billing_entity_type,
                    "tenant_id": str(context.tenant.id) if context.tenant else None,
                },
            )

            await session.commit()

            return APIResponse(
                success=True,
                data=CheckoutSessionResponse(
                    session_id=checkout_session.id,
                    url=checkout_session.url,
                ),
                meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
            )

        except StripeServiceError as e:
            raise HTTPException(status_code=400, detail=str(e))


@router.post(
    "/portal",
    response_model=APIResponse[PortalSessionResponse],
    summary="Create billing portal session",
    description="""
Create a Stripe Customer Portal session.

**Permissions**: Only organization owners can access the portal for tenants.

Allows users to manage their subscription, payment methods, and view invoices.

## Example (curl)
```bash
curl -X POST "https://giga-pdf.com/api/v1/billing/portal" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{"return_url": "https://giga-pdf.com/settings/billing"}'
```
""",
)
async def create_portal(
    user: AuthenticatedUser,
    request: CreatePortalRequest,
) -> APIResponse[PortalSessionResponse]:
    """Create a Stripe Customer Portal session."""
    async with get_db_session() as session:
        context = await billing_permission_service.get_billing_context(
            user.user_id, session
        )

        # Check manage permission
        allowed, error_msg = billing_permission_service.check_billing_permission(
            context, require_manage=True
        )
        if not allowed:
            raise HTTPException(status_code=403, detail=error_msg)

        # Create Stripe customer if it doesn't exist
        stripe_customer_id = await ensure_stripe_customer(user, context, session)

        try:
            portal_session = stripe_service.create_portal_session(
                customer_id=stripe_customer_id,
                return_url=request.return_url,
            )

            return APIResponse(
                success=True,
                data=PortalSessionResponse(url=portal_session.url),
                meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
            )

        except StripeServiceError as e:
            raise HTTPException(status_code=400, detail=str(e))


# =============================================================================
# Plans
# =============================================================================


@router.get(
    "/plans",
    response_model=APIResponse[list[BillingPlanResponse]],
    summary="List available plans",
    description="""
Get list of available subscription plans.

## Trial Information
- All paid plans include a 14-day free trial
- Trial can only be used once per user/organization
- During trial, switch between plans freely

## Example (curl)
```bash
curl -X GET "https://giga-pdf.com/api/v1/billing/plans"
```
""",
)
async def list_plans() -> APIResponse[list[BillingPlanResponse]]:
    """List all available subscription plans."""
    async with get_db_session() as session:
        result = await session.execute(
            select(Plan)
            .where(Plan.is_active == True, Plan.is_tenant_plan == False)
            .order_by(Plan.display_order)
        )
        plans = result.scalars().all()

        plan_responses = [
            BillingPlanResponse(
                id=str(plan.id),
                slug=plan.slug,
                name=plan.name,
                description=plan.description,
                price=float(plan.price),
                currency=plan.currency,
                interval=plan.interval,
                storage_gb=plan.storage_limit_bytes / (1024**3),
                api_calls_limit=plan.api_calls_limit,
                document_limit=plan.document_limit,
                features=plan.features,
                is_popular=plan.is_popular,
                stripe_price_id=plan.stripe_price_id,
                trial_days=TRIAL_DURATION_DAYS if plan.slug in ("starter", "pro") else None,
            )
            for plan in plans
        ]

        return APIResponse(
            success=True,
            data=plan_responses,
            meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
        )


# =============================================================================
# Invoices
# =============================================================================


@router.get(
    "/invoices",
    response_model=APIResponse[list[InvoiceResponse]],
    summary="List invoices",
    description="""
Get list of invoices.

**Permissions**: Requires VIEW_BILLING permission for organization members.

## Example (curl)
```bash
curl -X GET "https://giga-pdf.com/api/v1/billing/invoices?limit=10" \\
  -H "Authorization: Bearer <token>"
```
""",
)
async def list_invoices(
    user: AuthenticatedUser,
    limit: int = Query(default=10, ge=1, le=100, description="Number of invoices to return"),
) -> APIResponse[list[InvoiceResponse]]:
    """List invoices."""
    async with get_db_session() as session:
        context = await billing_permission_service.get_billing_context(
            user.user_id, session
        )

        # Check view permission
        allowed, error_msg = billing_permission_service.check_billing_permission(
            context, require_manage=False
        )
        if not allowed:
            raise HTTPException(status_code=403, detail=error_msg)

        if not context.stripe_customer_id:
            return APIResponse(
                success=True,
                data=[],
                meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
            )

        try:
            invoices = stripe_service.list_invoices(
                customer_id=context.stripe_customer_id,
                limit=limit,
            )

            invoice_responses = [
                InvoiceResponse(
                    id=inv.id,
                    number=inv.number,
                    status=inv.status,
                    amount_due=inv.amount_due,
                    amount_paid=inv.amount_paid,
                    currency=inv.currency,
                    created=datetime.fromtimestamp(inv.created, tz=timezone.utc),
                    due_date=datetime.fromtimestamp(inv.due_date, tz=timezone.utc)
                    if inv.due_date
                    else None,
                    pdf_url=inv.invoice_pdf,
                    hosted_invoice_url=inv.hosted_invoice_url,
                    period_start=datetime.fromtimestamp(inv.period_start, tz=timezone.utc)
                    if inv.period_start
                    else None,
                    period_end=datetime.fromtimestamp(inv.period_end, tz=timezone.utc)
                    if inv.period_end
                    else None,
                )
                for inv in invoices
            ]

            return APIResponse(
                success=True,
                data=invoice_responses,
                meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
            )

        except StripeServiceError as e:
            raise HTTPException(status_code=400, detail=str(e))


@router.get(
    "/invoices/{invoice_id}",
    response_model=APIResponse[InvoiceResponse],
    summary="Get invoice",
    description="Get a single invoice by ID.",
)
async def get_invoice(
    user: AuthenticatedUser,
    invoice_id: str,
) -> APIResponse[InvoiceResponse]:
    """Get a single invoice by ID."""
    async with get_db_session() as session:
        context = await billing_permission_service.get_billing_context(
            user.user_id, session
        )

        allowed, error_msg = billing_permission_service.check_billing_permission(
            context, require_manage=False
        )
        if not allowed:
            raise HTTPException(status_code=403, detail=error_msg)

        try:
            inv = stripe_service.get_invoice(invoice_id)

            # Verify the invoice belongs to this billing entity
            if inv.customer != context.stripe_customer_id:
                raise HTTPException(status_code=404, detail="Invoice not found")

            return APIResponse(
                success=True,
                data=InvoiceResponse(
                    id=inv.id,
                    number=inv.number,
                    status=inv.status,
                    amount_due=inv.amount_due,
                    amount_paid=inv.amount_paid,
                    currency=inv.currency,
                    created=datetime.fromtimestamp(inv.created, tz=timezone.utc),
                    due_date=datetime.fromtimestamp(inv.due_date, tz=timezone.utc)
                    if inv.due_date
                    else None,
                    pdf_url=inv.invoice_pdf,
                    hosted_invoice_url=inv.hosted_invoice_url,
                ),
                meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
            )

        except StripeServiceError as e:
            raise HTTPException(status_code=404, detail=str(e))


@router.get(
    "/invoices/{invoice_id}/download",
    summary="Download invoice PDF",
    description="Get the PDF download URL for an invoice.",
)
async def download_invoice(
    user: AuthenticatedUser,
    invoice_id: str,
) -> APIResponse[dict]:
    """Get invoice PDF download URL."""
    async with get_db_session() as session:
        context = await billing_permission_service.get_billing_context(
            user.user_id, session
        )

        allowed, error_msg = billing_permission_service.check_billing_permission(
            context, require_manage=False
        )
        if not allowed:
            raise HTTPException(status_code=403, detail=error_msg)

        try:
            inv = stripe_service.get_invoice(invoice_id)

            if inv.customer != context.stripe_customer_id:
                raise HTTPException(status_code=404, detail="Invoice not found")

            if not inv.invoice_pdf:
                raise HTTPException(status_code=404, detail="PDF not available for this invoice")

            return APIResponse(
                success=True,
                data={"pdf_url": inv.invoice_pdf},
                meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
            )

        except StripeServiceError as e:
            raise HTTPException(status_code=404, detail=str(e))


# =============================================================================
# Payment Methods
# =============================================================================


@router.get(
    "/payment-methods",
    response_model=APIResponse[list[PaymentMethodResponse]],
    summary="List payment methods",
    description="""
List all payment methods.

**Permissions**: Only organization owners can view payment methods for tenants.

## Example (curl)
```bash
curl -X GET "https://giga-pdf.com/api/v1/billing/payment-methods" \\
  -H "Authorization: Bearer <token>"
```
""",
)
async def list_payment_methods(
    user: AuthenticatedUser,
) -> APIResponse[list[PaymentMethodResponse]]:
    """List payment methods."""
    async with get_db_session() as session:
        context = await billing_permission_service.get_billing_context(
            user.user_id, session
        )

        # Check manage permission for payment methods
        allowed, error_msg = billing_permission_service.check_billing_permission(
            context, require_manage=True
        )
        if not allowed:
            raise HTTPException(status_code=403, detail=error_msg)

        if not context.stripe_customer_id:
            return APIResponse(
                success=True,
                data=[],
                meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
            )

        try:
            customer = stripe_service.get_customer(context.stripe_customer_id)
            default_pm_id = (
                customer.invoice_settings.default_payment_method
                if customer.invoice_settings
                else None
            )

            payment_methods = stripe_service.list_payment_methods(
                customer_id=context.stripe_customer_id
            )

            pm_responses = []
            for pm in payment_methods:
                card_details = None
                if pm.card:
                    card_details = CardDetails(
                        brand=pm.card.brand,
                        last4=pm.card.last4,
                        exp_month=pm.card.exp_month,
                        exp_year=pm.card.exp_year,
                    )

                pm_responses.append(
                    PaymentMethodResponse(
                        id=pm.id,
                        type=pm.type,
                        card=card_details,
                        is_default=pm.id == default_pm_id,
                        created_at=datetime.fromtimestamp(pm.created, tz=timezone.utc),
                    )
                )

            return APIResponse(
                success=True,
                data=pm_responses,
                meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
            )

        except StripeServiceError as e:
            raise HTTPException(status_code=400, detail=str(e))


@router.post(
    "/payment-methods",
    response_model=APIResponse[PaymentMethodResponse],
    summary="Add payment method",
    description="""
Add a new payment method.

**Permissions**: Only organization owners can add payment methods for tenants.

The payment_method_id should be obtained from Stripe.js on the frontend.

## Example (curl)
```bash
curl -X POST "https://giga-pdf.com/api/v1/billing/payment-methods" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{"payment_method_id": "pm_1234567890"}'
```
""",
)
async def add_payment_method(
    user: AuthenticatedUser,
    request: AddPaymentMethodRequest,
) -> APIResponse[PaymentMethodResponse]:
    """Add a new payment method."""
    async with get_db_session() as session:
        context = await billing_permission_service.get_billing_context(
            user.user_id, session
        )

        # Check manage permission
        allowed, error_msg = billing_permission_service.check_billing_permission(
            context, require_manage=True
        )
        if not allowed:
            raise HTTPException(status_code=403, detail=error_msg)

        # Create Stripe customer if it doesn't exist
        stripe_customer_id = await ensure_stripe_customer(user, context, session)

        try:
            pm = stripe_service.attach_payment_method(
                customer_id=stripe_customer_id,
                payment_method_id=request.payment_method_id,
            )

            card_details = None
            if pm.card:
                card_details = CardDetails(
                    brand=pm.card.brand,
                    last4=pm.card.last4,
                    exp_month=pm.card.exp_month,
                    exp_year=pm.card.exp_year,
                )

            return APIResponse(
                success=True,
                data=PaymentMethodResponse(
                    id=pm.id,
                    type=pm.type,
                    card=card_details,
                    is_default=False,
                    created_at=datetime.fromtimestamp(pm.created, tz=timezone.utc),
                ),
                meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
            )

        except StripeServiceError as e:
            raise HTTPException(status_code=400, detail=str(e))


@router.delete(
    "/payment-methods/{payment_method_id}",
    response_model=APIResponse[dict],
    summary="Remove payment method",
    description="""
Remove a payment method.

**Permissions**: Only organization owners can remove payment methods for tenants.
""",
)
async def remove_payment_method(
    user: AuthenticatedUser,
    payment_method_id: str,
) -> APIResponse[dict]:
    """Remove a payment method."""
    async with get_db_session() as session:
        context = await billing_permission_service.get_billing_context(
            user.user_id, session
        )

        allowed, error_msg = billing_permission_service.check_billing_permission(
            context, require_manage=True
        )
        if not allowed:
            raise HTTPException(status_code=403, detail=error_msg)

        try:
            stripe_service.detach_payment_method(payment_method_id)

            return APIResponse(
                success=True,
                data={"message": "Payment method removed successfully"},
                meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
            )

        except StripeServiceError as e:
            raise HTTPException(status_code=400, detail=str(e))


@router.post(
    "/payment-methods/{payment_method_id}/default",
    response_model=APIResponse[PaymentMethodResponse],
    summary="Set default payment method",
    description="""
Set a payment method as the default.

**Permissions**: Only organization owners can set default payment method for tenants.
""",
)
async def set_default_payment_method(
    user: AuthenticatedUser,
    payment_method_id: str,
) -> APIResponse[PaymentMethodResponse]:
    """Set a payment method as default."""
    async with get_db_session() as session:
        context = await billing_permission_service.get_billing_context(
            user.user_id, session
        )

        allowed, error_msg = billing_permission_service.check_billing_permission(
            context, require_manage=True
        )
        if not allowed:
            raise HTTPException(status_code=403, detail=error_msg)

        if not context.stripe_customer_id:
            raise HTTPException(status_code=400, detail="No billing account found")

        try:
            stripe_service.set_default_payment_method(
                customer_id=context.stripe_customer_id,
                payment_method_id=payment_method_id,
            )

            pms = stripe_service.list_payment_methods(context.stripe_customer_id)
            pm = next((p for p in pms if p.id == payment_method_id), None)

            if not pm:
                raise HTTPException(status_code=404, detail="Payment method not found")

            card_details = None
            if pm.card:
                card_details = CardDetails(
                    brand=pm.card.brand,
                    last4=pm.card.last4,
                    exp_month=pm.card.exp_month,
                    exp_year=pm.card.exp_year,
                )

            return APIResponse(
                success=True,
                data=PaymentMethodResponse(
                    id=pm.id,
                    type=pm.type,
                    card=card_details,
                    is_default=True,
                    created_at=datetime.fromtimestamp(pm.created, tz=timezone.utc),
                ),
                meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
            )

        except StripeServiceError as e:
            raise HTTPException(status_code=400, detail=str(e))


# =============================================================================
# Usage
# =============================================================================


@router.get(
    "/usage",
    response_model=APIResponse[UsageSummaryResponse],
    summary="Get usage summary",
    description="""
Get current usage and limits for the billing period.

**For tenant members**: Returns the organization's shared usage.
**For individuals**: Returns personal usage.

## Example (curl)
```bash
curl -X GET "https://giga-pdf.com/api/v1/billing/usage" \\
  -H "Authorization: Bearer <token>"
```
""",
)
async def get_usage(user: AuthenticatedUser) -> APIResponse[UsageSummaryResponse]:
    """Get usage summary for the current billing period."""
    async with get_db_session() as session:
        context = await billing_permission_service.get_billing_context(
            user.user_id, session
        )

        # Calculate period dates
        now = datetime.now(timezone.utc)

        if context.is_in_trial:
            period_start = context.trial_start_at or now
            period_end = context.trial_ends_at or (now + timedelta(days=TRIAL_DURATION_DAYS))
        elif context.billing_entity_type == "tenant":
            period_start = context.tenant.api_calls_reset_at or now.replace(day=1)
            period_end = now.replace(month=now.month + 1, day=1) if now.month < 12 else now.replace(
                year=now.year + 1, month=1, day=1
            )
        else:
            period_start = context.user_quota.api_calls_reset_at or now.replace(day=1)
            period_end = context.user_quota.current_period_end or (
                now.replace(month=now.month + 1, day=1) if now.month < 12
                else now.replace(year=now.year + 1, month=1, day=1)
            )

        # Get usage and limits based on billing entity
        if context.billing_entity_type == "tenant":
            tenant = context.tenant
            usage = UsageMetrics(
                documents=tenant.document_count,
                storage_gb=tenant.storage_used_bytes / (1024**3),
                api_calls=tenant.api_calls_used,
            )
            limits = UsageLimits(
                documents=None if tenant.document_limit == -1 else tenant.document_limit,
                storage_gb=None if tenant.storage_limit_bytes == -1 else tenant.storage_limit_bytes / (1024**3),
                api_calls=None if tenant.api_calls_limit == -1 else tenant.api_calls_limit,
            )
        else:
            user_quota = context.user_quota
            usage = UsageMetrics(
                documents=user_quota.document_count,
                storage_gb=user_quota.storage_used_bytes / (1024**3),
                api_calls=user_quota.api_calls_used,
            )
            limits = UsageLimits(
                documents=None if user_quota.document_limit == -1 else user_quota.document_limit,
                storage_gb=None if user_quota.storage_limit_bytes == -1 else user_quota.storage_limit_bytes / (1024**3),
                api_calls=None if user_quota.api_calls_limit == -1 else user_quota.api_calls_limit,
            )

        response_data = UsageSummaryResponse(
            current_period_start=period_start,
            current_period_end=period_end,
            usage=usage,
            limits=limits,
        ).model_dump()

        # Add additional context
        response_data["billing_entity_type"] = context.billing_entity_type
        response_data["is_in_trial"] = context.is_in_trial
        if context.is_tenant_member:
            response_data["tenant_name"] = context.tenant.name

        return APIResponse(
            success=True,
            data=response_data,
            meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
        )
