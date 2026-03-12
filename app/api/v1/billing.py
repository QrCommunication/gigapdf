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
Get the current subscription status for the authenticated user or their organization.

For tenant members, returns the organization's shared subscription. Individual users get their personal subscription details. Includes trial status and remaining trial days when applicable.
""",
    response_description="The current subscription details including plan, status, and trial information",
    responses={
        200: {"description": "Subscription details retrieved successfully"},
        401: {"description": "Authentication required"},
        403: {"description": "Insufficient permissions to view billing information"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": 'curl -X GET "https://api.giga-pdf.com/api/v1/billing/subscription" \\\n  -H "Authorization: Bearer $TOKEN"',
            },
            {
                "lang": "python",
                "label": "Python",
                "source": 'import requests\n\nresponse = requests.get(\n    "https://api.giga-pdf.com/api/v1/billing/subscription",\n    headers={"Authorization": "Bearer YOUR_API_TOKEN"}\n)\nsubscription = response.json()["data"]\nprint(f"Plan: {subscription[\'current_plan\']}")\nprint(f"Status: {subscription[\'status\']}")\nif subscription.get("is_in_trial"):\n    print(f"Trial ends in {subscription[\'trial_days_remaining\']} days")',
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": 'const response = await fetch("https://api.giga-pdf.com/api/v1/billing/subscription", {\n  headers: { "Authorization": "Bearer YOUR_API_TOKEN" }\n});\nconst { data: subscription } = await response.json();\nconsole.log(`Plan: ${subscription.current_plan}`);\nconsole.log(`Status: ${subscription.status}`);\nif (subscription.is_in_trial) {\n  console.log(`Trial ends in ${subscription.trial_days_remaining} days`);\n}',
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '<?php\n$client = new GuzzleHttp\\Client();\n$response = $client->get("https://api.giga-pdf.com/api/v1/billing/subscription", [\n    "headers" => ["Authorization" => "Bearer " . $token]\n]);\n$subscription = json_decode($response->getBody(), true)["data"];\necho "Plan: " . $subscription["current_plan"] . "\\n";\necho "Status: " . $subscription["status"] . "\\n";',
            },
        ]
    },
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
    summary="Update subscription plan",
    description="""
Change the current subscription plan for the authenticated user or organization.

During an active trial period, plan changes are free and immediate with no proration. After the trial, upgrades take effect immediately with prorations applied, while downgrades take effect at the end of the current billing period. Only organization owners can change the plan for tenant accounts.
""",
    response_description="The updated subscription details with new plan information",
    responses={
        200: {"description": "Subscription updated successfully"},
        400: {"description": "Invalid plan ID or no active subscription to update"},
        401: {"description": "Authentication required"},
        403: {"description": "Only organization owners can manage billing"},
        404: {"description": "Specified plan not found or not available"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": 'curl -X PATCH "https://api.giga-pdf.com/api/v1/billing/subscription" \\\n  -H "Authorization: Bearer $TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d \'{"plan_id": "pro"}\'',
            },
            {
                "lang": "python",
                "label": "Python",
                "source": 'import requests\n\nresponse = requests.patch(\n    "https://api.giga-pdf.com/api/v1/billing/subscription",\n    headers={"Authorization": "Bearer YOUR_API_TOKEN"},\n    json={"plan_id": "pro"}\n)\nresult = response.json()["data"]\nprint(f"Updated to: {result[\'current_plan\']}")',
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": 'const response = await fetch("https://api.giga-pdf.com/api/v1/billing/subscription", {\n  method: "PATCH",\n  headers: {\n    "Authorization": "Bearer YOUR_API_TOKEN",\n    "Content-Type": "application/json"\n  },\n  body: JSON.stringify({ plan_id: "pro" })\n});\nconst { data } = await response.json();\nconsole.log(`Updated to: ${data.current_plan}`);',
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '<?php\n$client = new GuzzleHttp\\Client();\n$response = $client->patch("https://api.giga-pdf.com/api/v1/billing/subscription", [\n    "headers" => [\n        "Authorization" => "Bearer " . $token,\n        "Content-Type" => "application/json"\n    ],\n    "json" => ["plan_id" => "pro"]\n]);\n$result = json_decode($response->getBody(), true)["data"];\necho "Updated to: " . $result["current_plan"] . "\\n";',
            },
        ]
    },
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
Cancel the current subscription, either immediately or at the end of the billing period.

Canceling during a trial immediately reverts the account to the free plan with no charges. After the trial, the default behavior is to cancel at the end of the current billing period. Setting `immediately` to true cancels immediately without a refund. Only organization owners can cancel for tenant accounts.
""",
    response_description="The updated subscription status after cancellation",
    responses={
        200: {"description": "Subscription cancelled successfully"},
        400: {"description": "No active subscription to cancel"},
        401: {"description": "Authentication required"},
        403: {"description": "Only organization owners can manage billing"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": 'curl -X POST "https://api.giga-pdf.com/api/v1/billing/subscription/cancel" \\\n  -H "Authorization: Bearer $TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d \'{"immediately": false}\'',
            },
            {
                "lang": "python",
                "label": "Python",
                "source": 'import requests\n\n# Cancel at period end (default)\nresponse = requests.post(\n    "https://api.giga-pdf.com/api/v1/billing/subscription/cancel",\n    headers={"Authorization": "Bearer YOUR_API_TOKEN"},\n    json={"immediately": False}\n)\nresult = response.json()["data"]\nprint(f"Status: {result[\'status\']}")\nprint(f"Cancel at period end: {result[\'cancel_at_period_end\']}")',
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": 'const response = await fetch("https://api.giga-pdf.com/api/v1/billing/subscription/cancel", {\n  method: "POST",\n  headers: {\n    "Authorization": "Bearer YOUR_API_TOKEN",\n    "Content-Type": "application/json"\n  },\n  body: JSON.stringify({ immediately: false })\n});\nconst { data } = await response.json();\nconsole.log(`Status: ${data.status}`);',
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '<?php\n$client = new GuzzleHttp\\Client();\n$response = $client->post("https://api.giga-pdf.com/api/v1/billing/subscription/cancel", [\n    "headers" => [\n        "Authorization" => "Bearer " . $token,\n        "Content-Type" => "application/json"\n    ],\n    "json" => ["immediately" => false]\n]);\n$result = json_decode($response->getBody(), true)["data"];\necho "Status: " . $result["status"] . "\\n";',
            },
        ]
    },
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
    summary="Reactivate scheduled cancellation",
    description="""
Reactivate a subscription that was previously scheduled for cancellation at the end of the billing period.

This endpoint only works if the subscription is still active but has `cancel_at_period_end` set to true. It does not restore an already-cancelled subscription. Only organization owners can reactivate for tenant accounts.
""",
    response_description="The reactivated subscription details",
    responses={
        200: {"description": "Subscription reactivated successfully"},
        400: {"description": "No subscription to reactivate or not scheduled for cancellation"},
        401: {"description": "Authentication required"},
        403: {"description": "Only organization owners can manage billing"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": 'curl -X POST "https://api.giga-pdf.com/api/v1/billing/subscription/reactivate" \\\n  -H "Authorization: Bearer $TOKEN"',
            },
            {
                "lang": "python",
                "label": "Python",
                "source": 'import requests\n\nresponse = requests.post(\n    "https://api.giga-pdf.com/api/v1/billing/subscription/reactivate",\n    headers={"Authorization": "Bearer YOUR_API_TOKEN"}\n)\nresult = response.json()["data"]\nprint(f"Status: {result[\'status\']}")\nprint(f"Cancel at period end: {result[\'cancel_at_period_end\']}")',
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": 'const response = await fetch("https://api.giga-pdf.com/api/v1/billing/subscription/reactivate", {\n  method: "POST",\n  headers: { "Authorization": "Bearer YOUR_API_TOKEN" }\n});\nconst { data } = await response.json();\nconsole.log(`Status: ${data.status}, Cancel at period end: ${data.cancel_at_period_end}`);',
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '<?php\n$client = new GuzzleHttp\\Client();\n$response = $client->post("https://api.giga-pdf.com/api/v1/billing/subscription/reactivate", [\n    "headers" => ["Authorization" => "Bearer " . $token]\n]);\n$result = json_decode($response->getBody(), true)["data"];\necho "Status: " . $result["status"] . "\\n";',
            },
        ]
    },
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
    summary="Start 14-day free trial",
    description="""
Start a 14-day free trial for a paid plan (starter or pro).

Each user or organization can only use the trial once. During the trial, you get full access to all plan features, can switch between Starter and Pro freely, and no payment is required. Billing starts automatically at the end of the 14-day period if not cancelled.
""",
    response_description="Trial start confirmation with plan details and end date",
    responses={
        200: {"description": "Trial started successfully"},
        400: {"description": "Trial already used, already in trial, or invalid plan specified (only starter/pro allowed)"},
        401: {"description": "Authentication required"},
        403: {"description": "Only organization owners can start trials for tenants"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": 'curl -X POST "https://api.giga-pdf.com/api/v1/billing/trial/start" \\\n  -H "Authorization: Bearer $TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d \'{"plan_id": "starter"}\'',
            },
            {
                "lang": "python",
                "label": "Python",
                "source": 'import requests\n\nresponse = requests.post(\n    "https://api.giga-pdf.com/api/v1/billing/trial/start",\n    headers={"Authorization": "Bearer YOUR_API_TOKEN"},\n    json={"plan_id": "starter"}\n)\nresult = response.json()["data"]\nprint(f"Trial started for: {result[\'plan\']}")\nprint(f"Trial ends: {result[\'trial_ends\']}")',
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": 'const response = await fetch("https://api.giga-pdf.com/api/v1/billing/trial/start", {\n  method: "POST",\n  headers: {\n    "Authorization": "Bearer YOUR_API_TOKEN",\n    "Content-Type": "application/json"\n  },\n  body: JSON.stringify({ plan_id: "starter" })\n});\nconst { data } = await response.json();\nconsole.log(`Trial started for ${data.plan}, ends ${data.trial_ends}`);',
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '<?php\n$client = new GuzzleHttp\\Client();\n$response = $client->post("https://api.giga-pdf.com/api/v1/billing/trial/start", [\n    "headers" => [\n        "Authorization" => "Bearer " . $token,\n        "Content-Type" => "application/json"\n    ],\n    "json" => ["plan_id" => "starter"]\n]);\n$result = json_decode($response->getBody(), true)["data"];\necho "Trial started for: " . $result["plan"] . "\\n";\necho "Trial ends: " . $result["trial_ends"] . "\\n";',
            },
        ]
    },
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
    summary="Create Stripe checkout session",
    description="""
Create a Stripe Checkout session to start or upgrade a subscription.

Returns a URL to redirect the user to the Stripe-hosted checkout page to complete payment. If the user is currently in a trial, completing checkout converts the trial to a paid subscription. Only organization owners can create checkout sessions for tenant accounts.
""",
    response_description="Checkout session with the redirect URL to Stripe payment page",
    responses={
        200: {"description": "Checkout session created successfully. Redirect the user to the returned URL."},
        400: {"description": "Stripe error or invalid request"},
        401: {"description": "Authentication required"},
        403: {"description": "Only organization owners can manage billing"},
        404: {"description": "Specified plan not found or not available for purchase"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": 'curl -X POST "https://api.giga-pdf.com/api/v1/billing/checkout" \\\n  -H "Authorization: Bearer $TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d \'{"plan_id": "starter", "success_url": "https://example.com/success", "cancel_url": "https://example.com/cancel"}\'',
            },
            {
                "lang": "python",
                "label": "Python",
                "source": 'import requests\n\nresponse = requests.post(\n    "https://api.giga-pdf.com/api/v1/billing/checkout",\n    headers={"Authorization": "Bearer YOUR_API_TOKEN"},\n    json={\n        "plan_id": "starter",\n        "success_url": "https://example.com/success",\n        "cancel_url": "https://example.com/cancel"\n    }\n)\ncheckout = response.json()["data"]\nprint(f"Redirect to: {checkout[\'url\']}")',
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": 'const response = await fetch("https://api.giga-pdf.com/api/v1/billing/checkout", {\n  method: "POST",\n  headers: {\n    "Authorization": "Bearer YOUR_API_TOKEN",\n    "Content-Type": "application/json"\n  },\n  body: JSON.stringify({\n    plan_id: "starter",\n    success_url: "https://example.com/success",\n    cancel_url: "https://example.com/cancel"\n  })\n});\nconst { data } = await response.json();\nwindow.location.href = data.url;  // Redirect to Stripe',
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '<?php\n$client = new GuzzleHttp\\Client();\n$response = $client->post("https://api.giga-pdf.com/api/v1/billing/checkout", [\n    "headers" => [\n        "Authorization" => "Bearer " . $token,\n        "Content-Type" => "application/json"\n    ],\n    "json" => [\n        "plan_id" => "starter",\n        "success_url" => "https://example.com/success",\n        "cancel_url" => "https://example.com/cancel"\n    ]\n]);\n$checkout = json_decode($response->getBody(), true)["data"];\nheader("Location: " . $checkout["url"]);  // Redirect to Stripe',
            },
        ]
    },
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
    summary="Create Stripe billing portal session",
    description="""
Create a Stripe Customer Portal session for self-service billing management.

Returns a URL to the Stripe-hosted portal where users can manage their subscription, update payment methods, download invoices, and change billing details. The portal automatically creates a Stripe customer if one does not yet exist. Only organization owners can access the portal for tenant accounts.
""",
    response_description="Portal session with the redirect URL to the Stripe billing portal",
    responses={
        200: {"description": "Portal session created successfully. Redirect the user to the returned URL."},
        400: {"description": "Stripe error or missing user email"},
        401: {"description": "Authentication required"},
        403: {"description": "Only organization owners can manage billing"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": 'curl -X POST "https://api.giga-pdf.com/api/v1/billing/portal" \\\n  -H "Authorization: Bearer $TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d \'{"return_url": "https://example.com/settings/billing"}\'',
            },
            {
                "lang": "python",
                "label": "Python",
                "source": 'import requests\n\nresponse = requests.post(\n    "https://api.giga-pdf.com/api/v1/billing/portal",\n    headers={"Authorization": "Bearer YOUR_API_TOKEN"},\n    json={"return_url": "https://example.com/settings/billing"}\n)\nportal = response.json()["data"]\nprint(f"Redirect to: {portal[\'url\']}")',
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": 'const response = await fetch("https://api.giga-pdf.com/api/v1/billing/portal", {\n  method: "POST",\n  headers: {\n    "Authorization": "Bearer YOUR_API_TOKEN",\n    "Content-Type": "application/json"\n  },\n  body: JSON.stringify({ return_url: "https://example.com/settings/billing" })\n});\nconst { data } = await response.json();\nwindow.location.href = data.url;  // Redirect to Stripe portal',
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '<?php\n$client = new GuzzleHttp\\Client();\n$response = $client->post("https://api.giga-pdf.com/api/v1/billing/portal", [\n    "headers" => [\n        "Authorization" => "Bearer " . $token,\n        "Content-Type" => "application/json"\n    ],\n    "json" => ["return_url" => "https://example.com/settings/billing"]\n]);\n$portal = json_decode($response->getBody(), true)["data"];\nheader("Location: " . $portal["url"]);',
            },
        ]
    },
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
    summary="List available subscription plans",
    description="""
Get the list of all available subscription plans with pricing, features, and resource limits.

All paid plans (starter and pro) include a 14-day free trial that can only be used once per user or organization. This endpoint is public and does not require authentication.
""",
    response_description="List of available plans with pricing, limits, and feature details",
    responses={
        200: {"description": "Plans retrieved successfully"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": 'curl -X GET "https://api.giga-pdf.com/api/v1/billing/plans"',
            },
            {
                "lang": "python",
                "label": "Python",
                "source": 'import requests\n\nresponse = requests.get("https://api.giga-pdf.com/api/v1/billing/plans")\nplans = response.json()["data"]\n\nfor plan in plans:\n    print(f"{plan[\'name\']}: ${plan[\'price\']}/{plan[\'interval\']}")\n    print(f"  Storage: {plan[\'storage_gb\']} GB")\n    print(f"  API calls: {plan[\'api_calls_limit\']}/month")',
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": 'const response = await fetch("https://api.giga-pdf.com/api/v1/billing/plans");\nconst { data: plans } = await response.json();\n\nplans.forEach(plan => {\n  console.log(`${plan.name}: $${plan.price}/${plan.interval}`);\n  console.log(`  Storage: ${plan.storage_gb} GB`);\n  console.log(`  API calls: ${plan.api_calls_limit}/month`);\n});',
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '<?php\n$client = new GuzzleHttp\\Client();\n$response = $client->get("https://api.giga-pdf.com/api/v1/billing/plans");\n$plans = json_decode($response->getBody(), true)["data"];\n\nforeach ($plans as $plan) {\n    echo "{$plan[\'name\']}: \\${$plan[\'price\']}/{$plan[\'interval\']}\\n";\n    echo "  Storage: {$plan[\'storage_gb\']} GB\\n";\n}',
            },
        ]
    },
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
    summary="List billing invoices",
    description="""
Get a paginated list of invoices for the authenticated user or their organization.

Returns invoices sorted by creation date (newest first) from Stripe. Returns an empty list if no Stripe customer exists yet (no payment has been made). Organization members require VIEW_BILLING permission.
""",
    response_description="List of invoices with amount, status, and download links",
    responses={
        200: {"description": "Invoices retrieved successfully (empty list if no billing history)"},
        400: {"description": "Stripe API error"},
        401: {"description": "Authentication required"},
        403: {"description": "Insufficient billing permissions"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": 'curl -X GET "https://api.giga-pdf.com/api/v1/billing/invoices?limit=10" \\\n  -H "Authorization: Bearer $TOKEN"',
            },
            {
                "lang": "python",
                "label": "Python",
                "source": 'import requests\n\nresponse = requests.get(\n    "https://api.giga-pdf.com/api/v1/billing/invoices",\n    headers={"Authorization": "Bearer YOUR_API_TOKEN"},\n    params={"limit": 10}\n)\ninvoices = response.json()["data"]\n\nfor inv in invoices:\n    print(f"Invoice {inv[\'number\']}: {inv[\'status\']} - ${inv[\'amount_paid\']/100:.2f}")\n    if inv.get("pdf_url"):\n        print(f"  PDF: {inv[\'pdf_url\']}")',
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": 'const response = await fetch("https://api.giga-pdf.com/api/v1/billing/invoices?limit=10", {\n  headers: { "Authorization": "Bearer YOUR_API_TOKEN" }\n});\nconst { data: invoices } = await response.json();\n\ninvoices.forEach(inv => {\n  console.log(`Invoice ${inv.number}: ${inv.status} - $${(inv.amount_paid/100).toFixed(2)}`);\n  if (inv.pdf_url) console.log(`  PDF: ${inv.pdf_url}`);\n});',
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '<?php\n$client = new GuzzleHttp\\Client();\n$response = $client->get("https://api.giga-pdf.com/api/v1/billing/invoices", [\n    "headers" => ["Authorization" => "Bearer " . $token],\n    "query" => ["limit" => 10]\n]);\n$invoices = json_decode($response->getBody(), true)["data"];\n\nforeach ($invoices as $inv) {\n    $amount = number_format($inv["amount_paid"] / 100, 2);\n    echo "Invoice {$inv[\'number\']}: {$inv[\'status\']} - \\${$amount}\\n";\n}',
            },
        ]
    },
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
    summary="Get invoice by ID",
    description="""
Retrieve a specific invoice by its Stripe invoice ID.

The invoice must belong to the authenticated user's billing account. Returns full invoice details including amounts, dates, and download URLs. Organization members require VIEW_BILLING permission.
""",
    response_description="Invoice details including amount, status, period, and PDF download URL",
    responses={
        200: {"description": "Invoice retrieved successfully"},
        401: {"description": "Authentication required"},
        403: {"description": "Insufficient billing permissions"},
        404: {"description": "Invoice not found or does not belong to this account"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": 'curl -X GET "https://api.giga-pdf.com/api/v1/billing/invoices/in_abc123" \\\n  -H "Authorization: Bearer $TOKEN"',
            },
            {
                "lang": "python",
                "label": "Python",
                "source": 'import requests\n\ninvoice_id = "in_abc123"\nresponse = requests.get(\n    f"https://api.giga-pdf.com/api/v1/billing/invoices/{invoice_id}",\n    headers={"Authorization": "Bearer YOUR_API_TOKEN"}\n)\ninv = response.json()["data"]\nprint(f"Invoice {inv[\'number\']}: {inv[\'status\']} - {inv[\'currency\'].upper()} {inv[\'amount_paid\']/100:.2f}")',
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": 'const invoiceId = "in_abc123";\nconst response = await fetch(`https://api.giga-pdf.com/api/v1/billing/invoices/${invoiceId}`, {\n  headers: { "Authorization": "Bearer YOUR_API_TOKEN" }\n});\nconst { data: inv } = await response.json();\nconsole.log(`Invoice ${inv.number}: ${inv.status} - ${inv.currency.toUpperCase()} ${(inv.amount_paid/100).toFixed(2)}`);',
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '<?php\n$invoiceId = "in_abc123";\n$client = new GuzzleHttp\\Client();\n$response = $client->get(\n    "https://api.giga-pdf.com/api/v1/billing/invoices/" . $invoiceId,\n    ["headers" => ["Authorization" => "Bearer " . $token]]\n);\n$inv = json_decode($response->getBody(), true)["data"];\necho "Invoice " . $inv["number"] . ": " . $inv["status"] . " - " . strtoupper($inv["currency"]) . " " . number_format($inv["amount_paid"] / 100, 2) . "\\n";',
            },
        ]
    },
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
    summary="Get invoice PDF download URL",
    description="""
Get the Stripe-hosted PDF download URL for a specific invoice.

Returns a direct link to the invoice PDF hosted by Stripe. This link is time-limited. Returns 404 if the invoice has no PDF available (e.g., pending invoices). The invoice must belong to the authenticated user's billing account.
""",
    response_description="Object containing the PDF URL for direct download",
    responses={
        200: {"description": "PDF URL retrieved successfully"},
        401: {"description": "Authentication required"},
        403: {"description": "Insufficient billing permissions"},
        404: {"description": "Invoice not found, does not belong to this account, or has no PDF available"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": 'curl -X GET "https://api.giga-pdf.com/api/v1/billing/invoices/in_abc123/download" \\\n  -H "Authorization: Bearer $TOKEN"',
            },
            {
                "lang": "python",
                "label": "Python",
                "source": 'import requests\n\ninvoice_id = "in_abc123"\nresponse = requests.get(\n    f"https://api.giga-pdf.com/api/v1/billing/invoices/{invoice_id}/download",\n    headers={"Authorization": "Bearer YOUR_API_TOKEN"}\n)\npdf_url = response.json()["data"]["pdf_url"]\nprint(f"PDF download URL: {pdf_url}")',
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": 'const invoiceId = "in_abc123";\nconst response = await fetch(`https://api.giga-pdf.com/api/v1/billing/invoices/${invoiceId}/download`, {\n  headers: { "Authorization": "Bearer YOUR_API_TOKEN" }\n});\nconst { data } = await response.json();\nconsole.log("PDF download URL:", data.pdf_url);\n// Open in new tab:\nwindow.open(data.pdf_url, "_blank");',
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '<?php\n$invoiceId = "in_abc123";\n$client = new GuzzleHttp\\Client();\n$response = $client->get(\n    "https://api.giga-pdf.com/api/v1/billing/invoices/" . $invoiceId . "/download",\n    ["headers" => ["Authorization" => "Bearer " . $token]]\n);\n$data = json_decode($response->getBody(), true)["data"];\necho "PDF URL: " . $data["pdf_url"] . "\\n";',
            },
        ]
    },
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
    summary="List saved payment methods",
    description="""
List all saved payment methods for the authenticated user or organization.

Returns card details (brand, last 4 digits, expiry) for each saved payment method, with an indicator for the default payment method used for recurring charges. Returns an empty list if no Stripe customer exists. Only organization owners can view payment methods for tenant accounts.
""",
    response_description="List of saved payment methods with card details and default flag",
    responses={
        200: {"description": "Payment methods retrieved successfully (empty list if none saved)"},
        400: {"description": "Stripe API error"},
        401: {"description": "Authentication required"},
        403: {"description": "Only organization owners can manage payment methods"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": 'curl -X GET "https://api.giga-pdf.com/api/v1/billing/payment-methods" \\\n  -H "Authorization: Bearer $TOKEN"',
            },
            {
                "lang": "python",
                "label": "Python",
                "source": 'import requests\n\nresponse = requests.get(\n    "https://api.giga-pdf.com/api/v1/billing/payment-methods",\n    headers={"Authorization": "Bearer YOUR_API_TOKEN"}\n)\npayment_methods = response.json()["data"]\n\nfor pm in payment_methods:\n    card = pm.get("card", {})\n    default = " (default)" if pm["is_default"] else ""\n    print(f"{card.get(\'brand\', \'card\').upper()} ending in {card.get(\'last4\')}{default}")',
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": 'const response = await fetch("https://api.giga-pdf.com/api/v1/billing/payment-methods", {\n  headers: { "Authorization": "Bearer YOUR_API_TOKEN" }\n});\nconst { data: methods } = await response.json();\n\nmethods.forEach(pm => {\n  const card = pm.card || {};\n  const flag = pm.is_default ? " (default)" : "";\n  console.log(`${card.brand?.toUpperCase()} ending in ${card.last4}${flag}`);\n});',
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '<?php\n$client = new GuzzleHttp\\Client();\n$response = $client->get("https://api.giga-pdf.com/api/v1/billing/payment-methods", [\n    "headers" => ["Authorization" => "Bearer " . $token]\n]);\n$methods = json_decode($response->getBody(), true)["data"];\n\nforeach ($methods as $pm) {\n    $card = $pm["card"] ?? [];\n    $flag = $pm["is_default"] ? " (default)" : "";\n    echo strtoupper($card["brand"] ?? "card") . " ending in " . ($card["last4"] ?? "") . $flag . "\\n";\n}',
            },
        ]
    },
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
    summary="Add a new payment method",
    description="""
Attach a Stripe payment method to the authenticated user's or organization's billing account.

The `payment_method_id` must be obtained from Stripe.js on the frontend after the customer enters their card details. If no Stripe customer account exists yet, one is created automatically. Only organization owners can add payment methods for tenant accounts. Returns 400 if the Stripe payment method ID is invalid or already attached.
""",
    response_description="The newly attached payment method with card details",
    responses={
        200: {"description": "Payment method attached successfully"},
        400: {"description": "Invalid payment method ID or Stripe API error"},
        401: {"description": "Authentication required"},
        403: {"description": "Only organization owners can add payment methods"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": 'curl -X POST "https://api.giga-pdf.com/api/v1/billing/payment-methods" \\\n  -H "Authorization: Bearer $TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d \'{"payment_method_id": "pm_1234567890abcdef"}\'',
            },
            {
                "lang": "python",
                "label": "Python",
                "source": 'import requests\n\nresponse = requests.post(\n    "https://api.giga-pdf.com/api/v1/billing/payment-methods",\n    headers={"Authorization": "Bearer YOUR_API_TOKEN"},\n    json={"payment_method_id": "pm_1234567890abcdef"}\n)\npm = response.json()["data"]\ncard = pm.get("card", {})\nprint(f"Added {card.get(\'brand\', \'card\').upper()} ending in {card.get(\'last4\')}")',
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": 'const response = await fetch("https://api.giga-pdf.com/api/v1/billing/payment-methods", {\n  method: "POST",\n  headers: {\n    "Authorization": "Bearer YOUR_API_TOKEN",\n    "Content-Type": "application/json"\n  },\n  body: JSON.stringify({ payment_method_id: "pm_1234567890abcdef" })\n});\nconst { data: pm } = await response.json();\nconst card = pm.card || {};\nconsole.log(`Added ${card.brand?.toUpperCase()} ending in ${card.last4}`);',
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '<?php\n$client = new GuzzleHttp\\Client();\n$response = $client->post("https://api.giga-pdf.com/api/v1/billing/payment-methods", [\n    "headers" => [\n        "Authorization" => "Bearer " . $token,\n        "Content-Type" => "application/json"\n    ],\n    "json" => ["payment_method_id" => "pm_1234567890abcdef"]\n]);\n$pm = json_decode($response->getBody(), true)["data"];\n$card = $pm["card"] ?? [];\necho "Added " . strtoupper($card["brand"] ?? "card") . " ending in " . ($card["last4"] ?? "") . "\\n";',
            },
        ]
    },
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
    summary="Remove a saved payment method",
    description="""
Detach a saved payment method from the billing account, making it unavailable for future charges.

Removing the default payment method does not block the account but may cause future subscription renewals to fail if no other payment method is set as default. Only organization owners can remove payment methods for tenant accounts. Returns 400 if the Stripe detach operation fails (e.g., the payment method is not attached to this customer).
""",
    response_description="Confirmation message that the payment method was removed",
    responses={
        200: {"description": "Payment method removed successfully"},
        400: {"description": "Stripe API error or payment method not attached to this account"},
        401: {"description": "Authentication required"},
        403: {"description": "Only organization owners can remove payment methods"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": 'curl -X DELETE "https://api.giga-pdf.com/api/v1/billing/payment-methods/pm_1234567890abcdef" \\\n  -H "Authorization: Bearer $TOKEN"',
            },
            {
                "lang": "python",
                "label": "Python",
                "source": 'import requests\n\npayment_method_id = "pm_1234567890abcdef"\nresponse = requests.delete(\n    f"https://api.giga-pdf.com/api/v1/billing/payment-methods/{payment_method_id}",\n    headers={"Authorization": "Bearer YOUR_API_TOKEN"}\n)\nresult = response.json()["data"]\nprint(result["message"])',
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": 'const paymentMethodId = "pm_1234567890abcdef";\nconst response = await fetch(\n  `https://api.giga-pdf.com/api/v1/billing/payment-methods/${paymentMethodId}`,\n  {\n    method: "DELETE",\n    headers: { "Authorization": "Bearer YOUR_API_TOKEN" }\n  }\n);\nconst { data } = await response.json();\nconsole.log(data.message);',
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '<?php\n$paymentMethodId = "pm_1234567890abcdef";\n$client = new GuzzleHttp\\Client();\n$response = $client->delete(\n    "https://api.giga-pdf.com/api/v1/billing/payment-methods/" . $paymentMethodId,\n    ["headers" => ["Authorization" => "Bearer " . $token]]\n);\n$result = json_decode($response->getBody(), true)["data"];\necho $result["message"] . "\\n";',
            },
        ]
    },
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
    summary="Set the default payment method",
    description="""
Designate an existing saved payment method as the default for future subscription charges and invoice payments.

The payment method must already be attached to the account — use `POST /payment-methods` first to attach it. Returns 404 if the specified payment method is not found among the account's saved methods. Returns 400 if no Stripe billing account exists. Only organization owners can change the default payment method for tenant accounts.
""",
    response_description="The payment method that was set as default, with its card details and `is_default: true`",
    responses={
        200: {"description": "Default payment method updated successfully"},
        400: {"description": "No billing account found or Stripe API error"},
        401: {"description": "Authentication required"},
        403: {"description": "Only organization owners can set the default payment method"},
        404: {"description": "Payment method not found on this account"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": 'curl -X POST "https://api.giga-pdf.com/api/v1/billing/payment-methods/pm_1234567890abcdef/default" \\\n  -H "Authorization: Bearer $TOKEN"',
            },
            {
                "lang": "python",
                "label": "Python",
                "source": 'import requests\n\npayment_method_id = "pm_1234567890abcdef"\nresponse = requests.post(\n    f"https://api.giga-pdf.com/api/v1/billing/payment-methods/{payment_method_id}/default",\n    headers={"Authorization": "Bearer YOUR_API_TOKEN"}\n)\npm = response.json()["data"]\ncard = pm.get("card", {})\nprint(f"Default set to {card.get(\'brand\', \'card\').upper()} ending in {card.get(\'last4\')}")',
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": 'const paymentMethodId = "pm_1234567890abcdef";\nconst response = await fetch(\n  `https://api.giga-pdf.com/api/v1/billing/payment-methods/${paymentMethodId}/default`,\n  {\n    method: "POST",\n    headers: { "Authorization": "Bearer YOUR_API_TOKEN" }\n  }\n);\nconst { data: pm } = await response.json();\nconst card = pm.card || {};\nconsole.log(`Default set to ${card.brand?.toUpperCase()} ending in ${card.last4}`);',
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '<?php\n$paymentMethodId = "pm_1234567890abcdef";\n$client = new GuzzleHttp\\Client();\n$response = $client->post(\n    "https://api.giga-pdf.com/api/v1/billing/payment-methods/" . $paymentMethodId . "/default",\n    ["headers" => ["Authorization" => "Bearer " . $token]]\n);\n$pm = json_decode($response->getBody(), true)["data"];\n$card = $pm["card"] ?? [];\necho "Default set to " . strtoupper($card["brand"] ?? "card") . " ending in " . ($card["last4"] ?? "") . "\\n";',
            },
        ]
    },
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
    summary="Get current billing period usage",
    description="""
Retrieve usage statistics and plan limits for the current billing period.

For organization members, returns the shared tenant usage (documents, storage, API calls) and the tenant's plan limits. For individual accounts, returns personal usage and limits derived from the active subscription plan or trial. The response also includes the billing period start and end dates, the billing entity type (`individual` or `tenant`), and trial status. All limits set to `null` indicate unlimited usage on the current plan.
""",
    response_description="Usage metrics and plan limits for the current billing period",
    responses={
        200: {"description": "Usage summary retrieved successfully"},
        401: {"description": "Authentication required"},
    },
    openapi_extra={
        "x-codeSamples": [
            {
                "lang": "curl",
                "label": "cURL",
                "source": 'curl -X GET "https://api.giga-pdf.com/api/v1/billing/usage" \\\n  -H "Authorization: Bearer $TOKEN"',
            },
            {
                "lang": "python",
                "label": "Python",
                "source": 'import requests\n\nresponse = requests.get(\n    "https://api.giga-pdf.com/api/v1/billing/usage",\n    headers={"Authorization": "Bearer YOUR_API_TOKEN"}\n)\ndata = response.json()["data"]\nusage = data["usage"]\nlimits = data["limits"]\n\nprint(f"Documents: {usage[\'documents\']} / {limits[\'documents\'] or \'unlimited\'}")\nprint(f"Storage: {usage[\'storage_gb\']:.2f} GB / {limits[\'storage_gb\'] or \'unlimited\'} GB")\nprint(f"API calls: {usage[\'api_calls\']} / {limits[\'api_calls\'] or \'unlimited\'}")',
            },
            {
                "lang": "javascript",
                "label": "JavaScript",
                "source": 'const response = await fetch("https://api.giga-pdf.com/api/v1/billing/usage", {\n  headers: { "Authorization": "Bearer YOUR_API_TOKEN" }\n});\nconst { data } = await response.json();\nconst { usage, limits } = data;\n\nconsole.log(`Documents: ${usage.documents} / ${limits.documents ?? "unlimited"}`);\nconsole.log(`Storage: ${usage.storage_gb.toFixed(2)} GB / ${limits.storage_gb ?? "unlimited"} GB`);\nconsole.log(`API calls: ${usage.api_calls} / ${limits.api_calls ?? "unlimited"}`);',
            },
            {
                "lang": "php",
                "label": "PHP",
                "source": '<?php\n$client = new GuzzleHttp\\Client();\n$response = $client->get("https://api.giga-pdf.com/api/v1/billing/usage", [\n    "headers" => ["Authorization" => "Bearer " . $token]\n]);\n$data = json_decode($response->getBody(), true)["data"];\n$usage = $data["usage"];\n$limits = $data["limits"];\n\necho "Documents: " . $usage["documents"] . " / " . ($limits["documents"] ?? "unlimited") . "\\n";\necho "Storage: " . number_format($usage["storage_gb"], 2) . " GB / " . ($limits["storage_gb"] ?? "unlimited") . " GB\\n";\necho "API calls: " . $usage["api_calls"] . " / " . ($limits["api_calls"] ?? "unlimited") . "\\n";',
            },
        ]
    },
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
