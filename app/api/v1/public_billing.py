"""
Public billing endpoints for landing page.

These endpoints are accessible without authentication for:
- Viewing available plans
- Creating checkout sessions for new users

Note: For authenticated users who are members of a tenant,
billing is managed by the tenant owner only.
"""

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, EmailStr
from sqlalchemy import select

from app.config import get_settings
from app.core.database import get_db_session
from app.middleware.auth import AuthenticatedUser, OptionalUser
from app.middleware.request_id import get_request_id
from app.models.database import Plan, UserQuota
from app.schemas.billing import BillingPlanResponse, CheckoutSessionResponse
from app.schemas.responses.common import APIResponse, MetaInfo
from app.services.billing_permission_service import (
    TRIAL_DURATION_DAYS,
    billing_permission_service,
)
from app.services.stripe_service import StripeServiceError, stripe_service
from app.utils.helpers import now_utc

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter()


# =============================================================================
# Schemas
# =============================================================================


class PublicCheckoutRequest(BaseModel):
    """Request to create a checkout session from landing page."""

    plan_id: str
    email: Optional[EmailStr] = None  # Required if not authenticated
    success_url: str
    cancel_url: str


class PlanComparisonResponse(BaseModel):
    """Plan comparison for landing page."""

    slug: str
    name: str
    description: Optional[str]
    price: float
    currency: str
    interval: str
    storage_gb: float
    api_calls_limit: int
    document_limit: int
    features: Optional[list] = None
    is_popular: bool = False
    trial_days: Optional[int] = None
    cta_text: str = "Get Started"


# =============================================================================
# Public Endpoints
# =============================================================================


@router.get(
    "/plans",
    response_model=APIResponse[list[PlanComparisonResponse]],
    summary="List available plans (public)",
    description="""
Get list of available subscription plans.

**Public endpoint** - No authentication required.

Returns all active plans with pricing, features, and limits.
Plans are sorted by display order for proper comparison display.

## Trial Information
- Starter and Pro plans include a 14-day free trial
- Trial can be used once per user
- No credit card required to start trial

## Response
Returns an array of plans with:
- Pricing information (price, currency, interval)
- Usage limits (storage, API calls, documents)
- Features list
- Trial availability

## Example (curl)
```bash
curl -X GET "https://giga-pdf.com/api/v1/public/billing/plans"
```

## Example (JavaScript)
```javascript
const response = await fetch('https://giga-pdf.com/api/v1/public/billing/plans');
const { data: plans } = await response.json();

// Display plans on landing page
plans.forEach(plan => {
  console.log(`${plan.name}: €${plan.price}/${plan.interval}`);
});
```
""",
)
async def list_plans_public() -> APIResponse[list[PlanComparisonResponse]]:
    """List all available subscription plans (public access)."""
    async with get_db_session() as session:
        result = await session.execute(
            select(Plan)
            .where(Plan.is_active == True, Plan.is_tenant_plan == False)
            .order_by(Plan.display_order)
        )
        plans = result.scalars().all()

        plan_responses = [
            PlanComparisonResponse(
                slug=plan.slug,
                name=plan.name,
                description=plan.description,
                price=float(plan.price),
                currency=plan.currency,
                interval=plan.interval,
                storage_gb=plan.storage_limit_bytes / (1024**3),
                api_calls_limit=plan.api_calls_limit,
                document_limit=plan.document_limit,
                features=plan.features or [],
                is_popular=plan.is_popular,
                trial_days=TRIAL_DURATION_DAYS if plan.slug in ("starter", "pro") else None,
                cta_text=plan.cta_text,
            )
            for plan in plans
        ]

        return APIResponse(
            success=True,
            data=plan_responses,
            meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
        )


@router.get(
    "/plans/{plan_slug}",
    response_model=APIResponse[PlanComparisonResponse],
    summary="Get plan details (public)",
    description="""
Get details for a specific plan.

**Public endpoint** - No authentication required.

## Example (curl)
```bash
curl -X GET "https://giga-pdf.com/api/v1/public/billing/plans/starter"
```
""",
)
async def get_plan_public(plan_slug: str) -> APIResponse[PlanComparisonResponse]:
    """Get details for a specific plan (public access)."""
    async with get_db_session() as session:
        result = await session.execute(
            select(Plan).where(Plan.slug == plan_slug, Plan.is_active == True)
        )
        plan = result.scalar_one_or_none()

        if not plan:
            raise HTTPException(status_code=404, detail=f"Plan '{plan_slug}' not found")

        return APIResponse(
            success=True,
            data=PlanComparisonResponse(
                slug=plan.slug,
                name=plan.name,
                description=plan.description,
                price=float(plan.price),
                currency=plan.currency,
                interval=plan.interval,
                storage_gb=plan.storage_limit_bytes / (1024**3),
                api_calls_limit=plan.api_calls_limit,
                document_limit=plan.document_limit,
                features=plan.features or [],
                is_popular=plan.is_popular,
                trial_days=TRIAL_DURATION_DAYS if plan.slug in ("starter", "pro") else None,
                cta_text=plan.cta_text,
            ),
            meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
        )


@router.post(
    "/checkout",
    response_model=APIResponse[CheckoutSessionResponse],
    summary="Create checkout session (public)",
    description="""
Create a Stripe Checkout session for subscription.

**Semi-public endpoint**:
- Authenticated users: Uses their account
- Unauthenticated users: Requires email, creates guest checkout

After checkout, users will be redirected to create an account or login.

## For Authenticated Users
The subscription is linked to their existing account.
If they are a member of a tenant, they cannot subscribe individually.

## For New Users (Guest Checkout)
- Email is required
- After payment, they'll need to create an account
- The subscription is linked via Stripe customer email

## Trial Period
- If user hasn't used their trial, a 14-day trial is included
- No charge until trial ends

## Example (curl) - Guest checkout
```bash
curl -X POST "https://giga-pdf.com/api/v1/public/billing/checkout" \\
  -H "Content-Type: application/json" \\
  -d '{
    "plan_id": "starter",
    "email": "newuser@example.com",
    "success_url": "https://giga-pdf.com/welcome?session_id={CHECKOUT_SESSION_ID}",
    "cancel_url": "https://giga-pdf.com/pricing"
  }'
```

## Example (JavaScript) - Landing page
```javascript
async function subscribeToPlan(planSlug, email) {
  const response = await fetch('https://giga-pdf.com/api/v1/public/billing/checkout', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Include auth header if user is logged in
      ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {})
    },
    body: JSON.stringify({
      plan_id: planSlug,
      email: email, // Required if not authenticated
      success_url: `${window.location.origin}/welcome?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${window.location.origin}/pricing`
    })
  });

  const { data } = await response.json();

  // Redirect to Stripe Checkout
  window.location.href = data.url;
}
```

## Example (PHP)
```php
<?php
// Create checkout for guest user
$data = [
    'plan_id' => 'starter',
    'email' => 'newuser@example.com',
    'success_url' => 'https://giga-pdf.com/welcome?session_id={CHECKOUT_SESSION_ID}',
    'cancel_url' => 'https://giga-pdf.com/pricing'
];

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, 'https://giga-pdf.com/api/v1/public/billing/checkout');
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($data));

$response = curl_exec($ch);
curl_close($ch);

$result = json_decode($response, true);
header('Location: ' . $result['data']['url']);
exit;
?>
```
""",
)
async def create_public_checkout(
    request: PublicCheckoutRequest,
    user: OptionalUser = None,
) -> APIResponse[CheckoutSessionResponse]:
    """Create a Stripe Checkout session (public or authenticated)."""
    async with get_db_session() as session:
        # Get plan details
        plan_result = await session.execute(
            select(Plan).where(Plan.slug == request.plan_id, Plan.is_active == True)
        )
        plan = plan_result.scalar_one_or_none()

        if not plan or not plan.stripe_price_id:
            raise HTTPException(
                status_code=404,
                detail=f"Plan '{request.plan_id}' not found or not available",
            )

        # Determine if authenticated
        is_authenticated = user is not None and user.user_id is not None
        customer_email = None
        stripe_customer_id = None
        user_id = None
        has_used_trial = False

        if is_authenticated:
            # Check if user is in a tenant
            context = await billing_permission_service.get_billing_context(
                user.user_id, session
            )

            if context.is_tenant_member:
                raise HTTPException(
                    status_code=403,
                    detail=(
                        "You are a member of an organization. "
                        "Only the organization owner can manage subscriptions. "
                        f"Please contact the owner of '{context.tenant.name}'."
                    ),
                )

            # Use existing customer if available
            stripe_customer_id = context.stripe_customer_id
            customer_email = user.email or context.user_quota.email
            user_id = user.user_id
            has_used_trial = context.has_used_trial

            # Check if already has active subscription
            if context.stripe_subscription_id and context.user_quota.subscription_status in ("active", "trialing"):
                raise HTTPException(
                    status_code=400,
                    detail="You already have an active subscription. Use the billing portal to change plans.",
                )

        else:
            # Guest checkout - email required
            if not request.email:
                raise HTTPException(
                    status_code=400,
                    detail="Email is required for guest checkout",
                )
            customer_email = request.email

            # Check if email already has an account
            existing_user = await session.execute(
                select(UserQuota).where(UserQuota.email == request.email)
            )
            existing = existing_user.scalar_one_or_none()

            if existing:
                # Use existing customer
                stripe_customer_id = existing.stripe_customer_id
                has_used_trial = existing.has_used_trial
                user_id = existing.user_id

        try:
            # Create or get Stripe customer
            if not stripe_customer_id:
                customer = stripe_service.create_customer(
                    user_id=user_id or f"guest_{customer_email}",
                    email=customer_email,
                    metadata={
                        "source": "landing_page",
                        "user_id": user_id,
                    },
                )
                stripe_customer_id = customer.id

                # If authenticated, save customer ID
                if is_authenticated:
                    user_result = await session.execute(
                        select(UserQuota).where(UserQuota.user_id == user.user_id)
                    )
                    user_quota = user_result.scalar_one_or_none()
                    if user_quota:
                        user_quota.stripe_customer_id = stripe_customer_id
                        user_quota.email = customer_email

            # Determine trial days
            trial_days = None
            if not has_used_trial and plan.trial_days:
                trial_days = plan.trial_days

            # Create checkout session
            checkout_session = stripe_service.create_checkout_session(
                customer_id=stripe_customer_id,
                price_id=plan.stripe_price_id,
                success_url=request.success_url,
                cancel_url=request.cancel_url,
                trial_days=trial_days,
                metadata={
                    "user_id": user_id,
                    "plan_slug": plan.slug,
                    "source": "landing_page",
                    "billing_entity_type": "user",
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
            logger.error(f"Stripe error creating checkout: {e}")
            raise HTTPException(status_code=400, detail=str(e))


@router.post(
    "/trial/start",
    response_model=APIResponse[dict],
    summary="Start free trial",
    description="""
Start a 14-day free trial for a plan.

**Requires authentication** - User must be logged in.

**Restrictions**:
- Users in a tenant cannot start individual trials
- Each user can only use the trial once
- Only Starter and Pro plans have trials

## Example (curl)
```bash
curl -X POST "https://giga-pdf.com/api/v1/public/billing/trial/start" \\
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"plan_id": "starter"}'
```

## Example (JavaScript)
```javascript
const response = await fetch('https://giga-pdf.com/api/v1/public/billing/trial/start', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${authToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ plan_id: 'starter' })
});

const { data } = await response.json();
console.log(`Trial ends: ${data.trial_ends}`);
```
""",
)
async def start_trial_public(
    user: AuthenticatedUser,
    plan_id: str = Query(..., description="Plan to trial: 'starter' or 'pro'"),
) -> APIResponse[dict]:
    """Start a free trial period."""
    async with get_db_session() as session:
        context = await billing_permission_service.get_billing_context(
            user.user_id, session
        )

        # Check if user is in a tenant
        if context.is_tenant_member:
            raise HTTPException(
                status_code=403,
                detail=(
                    "You are a member of an organization. "
                    "Only the organization owner can manage subscriptions. "
                    f"Please contact the owner of '{context.tenant.name}'."
                ),
            )

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
        if plan_id not in ("starter", "pro"):
            raise HTTPException(
                status_code=400,
                detail="Trial is only available for Starter and Pro plans.",
            )

        try:
            trial_start, trial_end = await billing_permission_service.start_trial(
                context, session, plan_slug=plan_id
            )
            await session.commit()

            return APIResponse(
                success=True,
                data={
                    "message": f"Trial started successfully for {plan_id.capitalize()} plan",
                    "plan": plan_id,
                    "trial_start": trial_start.isoformat(),
                    "trial_ends": trial_end.isoformat(),
                    "trial_days": TRIAL_DURATION_DAYS,
                },
                meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
            )

        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))


@router.get(
    "/check-trial-eligibility",
    response_model=APIResponse[dict],
    summary="Check trial eligibility",
    description="""
Check if the current user is eligible for a free trial.

**Requires authentication** - User must be logged in.

Returns:
- `eligible`: Whether user can start a trial
- `reason`: If not eligible, why
- `current_plan`: User's current plan

## Example (curl)
```bash
curl -X GET "https://giga-pdf.com/api/v1/public/billing/check-trial-eligibility" \\
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```
""",
)
async def check_trial_eligibility(
    user: AuthenticatedUser,
) -> APIResponse[dict]:
    """Check if user is eligible for a free trial."""
    async with get_db_session() as session:
        context = await billing_permission_service.get_billing_context(
            user.user_id, session
        )

        # Check various conditions
        if context.is_tenant_member:
            return APIResponse(
                success=True,
                data={
                    "eligible": False,
                    "reason": "tenant_member",
                    "message": "Organization members cannot start individual trials. Contact your organization owner.",
                    "current_plan": context.tenant.plan.slug if context.tenant.plan else "free",
                },
                meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
            )

        if context.has_used_trial:
            return APIResponse(
                success=True,
                data={
                    "eligible": False,
                    "reason": "trial_used",
                    "message": "You have already used your free trial.",
                    "current_plan": context.user_quota.plan_type,
                },
                meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
            )

        if context.is_in_trial:
            return APIResponse(
                success=True,
                data={
                    "eligible": False,
                    "reason": "in_trial",
                    "message": "You are currently in a trial period.",
                    "current_plan": context.user_quota.plan_type,
                    "trial_ends_at": context.trial_ends_at.isoformat() if context.trial_ends_at else None,
                    "trial_days_remaining": context.trial_days_remaining,
                },
                meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
            )

        if context.user_quota.subscription_status == "active":
            return APIResponse(
                success=True,
                data={
                    "eligible": False,
                    "reason": "has_subscription",
                    "message": "You already have an active subscription.",
                    "current_plan": context.user_quota.plan_type,
                },
                meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
            )

        # User is eligible
        return APIResponse(
            success=True,
            data={
                "eligible": True,
                "reason": None,
                "message": f"You can start a {TRIAL_DURATION_DAYS}-day free trial!",
                "current_plan": context.user_quota.plan_type,
                "trial_days_available": TRIAL_DURATION_DAYS,
            },
            meta=MetaInfo(request_id=get_request_id(), timestamp=now_utc()),
        )
