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
Get all active subscription plans for display on the landing page.

**Public endpoint** — No authentication required.

Returns plans sorted by `display_order`, each with:
- Pricing (`price`, `currency`, `interval`)
- Storage and API usage limits
- Feature list
- Trial availability (Starter and Pro plans include a 14-day trial)

Tenant-specific plans are excluded from this endpoint.
""",
    response_description="Array of plan objects sorted by display order",
    responses={
        200: {"description": "Plans listed successfully"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": 'curl -X GET "https://api.giga-pdf.com/api/v1/public/billing/plans"',
            },
            {
                "lang": "python",
                "label": "Python",
                "source": 'import requests\n\nresponse = requests.get("https://api.giga-pdf.com/api/v1/public/billing/plans")\nplans = response.json()["data"]\nfor plan in plans:\n    print(f"{plan[\'name\']}: \u20ac{plan[\'price\']}/{plan[\'interval\']}")',
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": "const response = await fetch('https://api.giga-pdf.com/api/v1/public/billing/plans');\nconst { data: plans } = await response.json();\nplans.forEach(plan => console.log(`${plan.name}: \u20ac${plan.price}/${plan.interval}`));",
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": "<?php\n$response = file_get_contents('https://api.giga-pdf.com/api/v1/public/billing/plans');\n$plans = json_decode($response, true)['data'];\nforeach ($plans as $plan) {\n    echo \"{$plan['name']}: \u20ac{$plan['price']}/{$plan['interval']}\\n\";\n}",
            },
        ]
    },
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
    summary="Get plan details by slug (public)",
    description="""
Retrieve full details for a single subscription plan by its slug.

**Public endpoint** — No authentication required.

Useful for displaying pricing details on individual plan pages or confirming plan
features before checkout. Returns `404` if the plan is inactive or does not exist.
""",
    response_description="Single plan object with pricing, limits, and feature list",
    responses={
        200: {"description": "Plan found and returned"},
        404: {"description": "Plan not found or inactive"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": 'curl -X GET "https://api.giga-pdf.com/api/v1/public/billing/plans/starter"',
            },
            {
                "lang": "python",
                "label": "Python",
                "source": 'import requests\n\nresponse = requests.get("https://api.giga-pdf.com/api/v1/public/billing/plans/starter")\nplan = response.json()["data"]\nprint(f"{plan[\'name\']}: \u20ac{plan[\'price\']}/{plan[\'interval\']}, {plan[\'storage_gb\']} GB")',
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": "const response = await fetch('https://api.giga-pdf.com/api/v1/public/billing/plans/starter');\nconst { data: plan } = await response.json();\nconsole.log(`${plan.name}: \u20ac${plan.price}/${plan.interval}`);",
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": "<?php\n$response = file_get_contents('https://api.giga-pdf.com/api/v1/public/billing/plans/starter');\n$plan = json_decode($response, true)['data'];\necho \"{$plan['name']}: \u20ac{$plan['price']}/{$plan['interval']}\\n\";",
            },
        ]
    },
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
    summary="Create a Stripe checkout session",
    description="""
Initiate a Stripe Checkout session to subscribe to a plan.

**Semi-public endpoint**:
- **Authenticated users**: The subscription is linked to their existing account.
  If they are a member of an organization, they cannot subscribe individually — only the
  organization owner can manage subscriptions.
- **Unauthenticated users (guest checkout)**: `email` is required. After payment, the user
  must create an account or log in to activate the subscription.

**Trial period**: If the user has never started a trial and the plan supports it, a
14-day free trial is automatically included in the checkout session.

On success, redirect the user to `data.url` (the Stripe-hosted checkout page).
""",
    response_description="Stripe checkout session ID and redirect URL",
    responses={
        200: {"description": "Checkout session created — redirect user to `data.url`"},
        400: {"description": "Invalid request: missing email for guest, or already has active subscription"},
        403: {"description": "Organization members cannot create individual subscriptions"},
        404: {"description": "Plan not found or not available for checkout"},
        422: {"description": "Validation error in request body"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": (
                    'curl -X POST "https://api.giga-pdf.com/api/v1/public/billing/checkout" \\\n'
                    '  -H "Content-Type: application/json" \\\n'
                    "  -d '{\n"
                    '    "plan_id": "starter",\n'
                    '    "email": "newuser@example.com",\n'
                    '    "success_url": "https://app.giga-pdf.com/welcome?session_id={CHECKOUT_SESSION_ID}",\n'
                    '    "cancel_url": "https://giga-pdf.com/pricing"\n'
                    "  }'"
                ),
            },
            {
                "lang": "python",
                "label": "Python",
                "source": (
                    'import requests\n\n'
                    'response = requests.post(\n'
                    '    "https://api.giga-pdf.com/api/v1/public/billing/checkout",\n'
                    '    json={\n'
                    '        "plan_id": "starter",\n'
                    '        "email": "newuser@example.com",\n'
                    '        "success_url": "https://app.giga-pdf.com/welcome?session_id={CHECKOUT_SESSION_ID}",\n'
                    '        "cancel_url": "https://giga-pdf.com/pricing"\n'
                    '    }\n'
                    ')\n'
                    'checkout_url = response.json()["data"]["url"]\n'
                    '# Redirect user to checkout_url'
                ),
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": (
                    "async function subscribeToPlan(planSlug, email, authToken = null) {\n"
                    "  const response = await fetch('https://api.giga-pdf.com/api/v1/public/billing/checkout', {\n"
                    "    method: 'POST',\n"
                    "    headers: {\n"
                    "      'Content-Type': 'application/json',\n"
                    "      ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {})\n"
                    "    },\n"
                    "    body: JSON.stringify({\n"
                    "      plan_id: planSlug,\n"
                    "      email,\n"
                    "      success_url: `${window.location.origin}/welcome?session_id={CHECKOUT_SESSION_ID}`,\n"
                    "      cancel_url: `${window.location.origin}/pricing`\n"
                    "    })\n"
                    "  });\n"
                    "  const { data } = await response.json();\n"
                    "  window.location.href = data.url;\n"
                    "}"
                ),
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": (
                    "<?php\n"
                    "$ch = curl_init('https://api.giga-pdf.com/api/v1/public/billing/checkout');\n"
                    "curl_setopt_array($ch, [\n"
                    "    CURLOPT_POST => true,\n"
                    "    CURLOPT_RETURNTRANSFER => true,\n"
                    "    CURLOPT_HTTPHEADER => ['Content-Type: application/json'],\n"
                    "    CURLOPT_POSTFIELDS => json_encode([\n"
                    "        'plan_id' => 'starter',\n"
                    "        'email' => 'newuser@example.com',\n"
                    "        'success_url' => 'https://app.giga-pdf.com/welcome?session_id={CHECKOUT_SESSION_ID}',\n"
                    "        'cancel_url' => 'https://giga-pdf.com/pricing'\n"
                    "    ])\n"
                    "]);\n"
                    "$result = json_decode(curl_exec($ch), true);\n"
                    "header('Location: ' . $result['data']['url']);\n"
                    "exit;"
                ),
            },
        ]
    },
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
    summary="Start a free trial",
    description="""
Activate a 14-day free trial for the Starter or Pro plan.

**Requires authentication** — include a valid Bearer token.

**Eligibility rules**:
- The user must not be a member of an organization (tenant members cannot start individual trials).
- Each user can only use their free trial once.
- Only `starter` and `pro` plans support trials.
- The user must not already have an active subscription.

On success, returns the trial start and end dates.
""",
    response_description="Trial activation details including start date, end date, and duration",
    responses={
        200: {"description": "Trial started successfully"},
        400: {"description": "Trial already used, already in trial, or invalid plan"},
        401: {"description": "Authentication required"},
        403: {"description": "Organization members cannot start individual trials"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": (
                    'curl -X POST "https://api.giga-pdf.com/api/v1/public/billing/trial/start?plan_id=starter" \\\n'
                    '  -H "Authorization: Bearer $TOKEN"'
                ),
            },
            {
                "lang": "python",
                "label": "Python",
                "source": (
                    'import requests\n\n'
                    'response = requests.post(\n'
                    '    "https://api.giga-pdf.com/api/v1/public/billing/trial/start",\n'
                    '    headers={"Authorization": "Bearer $TOKEN"},\n'
                    '    params={"plan_id": "starter"}\n'
                    ')\n'
                    'data = response.json()["data"]\n'
                    'print(f"Trial ends: {data[\'trial_ends\']}")'
                ),
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": (
                    "const response = await fetch(\n"
                    "  'https://api.giga-pdf.com/api/v1/public/billing/trial/start?plan_id=starter',\n"
                    "  {\n"
                    "    method: 'POST',\n"
                    "    headers: { 'Authorization': `Bearer ${authToken}` }\n"
                    "  }\n"
                    ");\n"
                    "const { data } = await response.json();\n"
                    "console.log(`Trial ends: ${data.trial_ends}`);"
                ),
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": (
                    "<?php\n"
                    "$ch = curl_init('https://api.giga-pdf.com/api/v1/public/billing/trial/start?plan_id=starter');\n"
                    "curl_setopt_array($ch, [\n"
                    "    CURLOPT_POST => true,\n"
                    "    CURLOPT_RETURNTRANSFER => true,\n"
                    "    CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $token]\n"
                    "]);\n"
                    "$data = json_decode(curl_exec($ch), true)['data'];\n"
                    "echo 'Trial ends: ' . $data['trial_ends'];"
                ),
            },
        ]
    },
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
    summary="Check trial eligibility for the current user",
    description="""
Determine whether the authenticated user is eligible to start a free trial.

**Requires authentication** — include a valid Bearer token.

**Response fields**:
- `eligible` (bool): Whether the user can start a trial right now.
- `reason` (str | null): If not eligible, one of: `tenant_member`, `trial_used`, `in_trial`, `has_subscription`.
- `message` (str): Human-readable explanation.
- `current_plan` (str): The user's current plan slug.
- `trial_ends_at` (str, optional): ISO timestamp if currently in trial.
- `trial_days_remaining` (int, optional): Days left if currently in trial.
- `trial_days_available` (int, optional): Number of trial days if eligible.
""",
    response_description="Trial eligibility status with reason and current plan information",
    responses={
        200: {"description": "Eligibility check completed (always 200, check `eligible` field)"},
        401: {"description": "Authentication required"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": (
                    'curl -X GET "https://api.giga-pdf.com/api/v1/public/billing/check-trial-eligibility" \\\n'
                    '  -H "Authorization: Bearer $TOKEN"'
                ),
            },
            {
                "lang": "python",
                "label": "Python",
                "source": (
                    'import requests\n\n'
                    'response = requests.get(\n'
                    '    "https://api.giga-pdf.com/api/v1/public/billing/check-trial-eligibility",\n'
                    '    headers={"Authorization": "Bearer $TOKEN"}\n'
                    ')\n'
                    'data = response.json()["data"]\n'
                    'if data["eligible"]:\n'
                    '    print(f"Eligible for {data[\'trial_days_available\']}-day trial")\n'
                    'else:\n'
                    '    print(f"Not eligible: {data[\'reason\']}")'
                ),
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": (
                    "const response = await fetch(\n"
                    "  'https://api.giga-pdf.com/api/v1/public/billing/check-trial-eligibility',\n"
                    "  { headers: { 'Authorization': `Bearer ${authToken}` } }\n"
                    ");\n"
                    "const { data } = await response.json();\n"
                    "if (data.eligible) {\n"
                    "  console.log(`Eligible for ${data.trial_days_available}-day trial`);\n"
                    "} else {\n"
                    "  console.log(`Not eligible: ${data.reason}`);\n"
                    "}"
                ),
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": (
                    "<?php\n"
                    "$ch = curl_init('https://api.giga-pdf.com/api/v1/public/billing/check-trial-eligibility');\n"
                    "curl_setopt_array($ch, [\n"
                    "    CURLOPT_RETURNTRANSFER => true,\n"
                    "    CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . $token]\n"
                    "]);\n"
                    "$data = json_decode(curl_exec($ch), true)['data'];\n"
                    "if ($data['eligible']) {\n"
                    "    echo 'Eligible for ' . $data['trial_days_available'] . '-day trial';\n"
                    "} else {\n"
                    "    echo 'Not eligible: ' . $data['reason'];\n"
                    "}"
                ),
            },
        ]
    },
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
