"""
Webhook handlers for external services.

Handles Stripe webhooks for payment events, including trial management
and tenant billing.
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.config import get_settings
from app.core.database import get_db_session
from app.models.database import Plan, UserQuota
from app.models.tenant import Tenant, TenantMember, TenantStatus
from app.services.quota_service import quota_service
from app.services.stripe_service import StripeServiceError, stripe_service

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter()


@router.post(
    "/stripe",
    summary="Stripe webhook",
    description="""
Handle Stripe webhook events.

This endpoint receives events from Stripe and processes them accordingly.
Events handled:
- `checkout.session.completed`: Process successful payment
- `customer.subscription.created`: New subscription activated
- `customer.subscription.updated`: Subscription modified
- `customer.subscription.deleted`: Subscription canceled
- `customer.subscription.trial_will_end`: Trial ending soon (3 days)
- `invoice.paid`: Successful payment
- `invoice.payment_failed`: Failed payment

**Note**: This endpoint verifies the Stripe signature for security.
""",
    include_in_schema=False,  # Hide from public API docs
)
async def stripe_webhook(request: Request):
    """
    Handle Stripe webhook events.

    Verifies the webhook signature and processes the event.
    """
    # Get raw body and signature
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")

    if not sig_header:
        logger.warning("Stripe webhook received without signature")
        raise HTTPException(status_code=400, detail="Missing Stripe signature")

    # Verify and construct event
    try:
        event = stripe_service.construct_webhook_event(payload, sig_header)
    except StripeServiceError as e:
        logger.error(f"Webhook signature verification failed: {e}")
        raise HTTPException(status_code=400, detail=str(e))

    logger.info(f"Processing Stripe webhook: {event.type}")

    # Handle event types
    try:
        match event.type:
            case "checkout.session.completed":
                await handle_checkout_completed(event.data.object)

            case "customer.subscription.created":
                await handle_subscription_created(event.data.object)

            case "customer.subscription.updated":
                await handle_subscription_updated(event.data.object)

            case "customer.subscription.deleted":
                await handle_subscription_deleted(event.data.object)

            case "customer.subscription.trial_will_end":
                await handle_trial_will_end(event.data.object)

            case "invoice.paid":
                await handle_invoice_paid(event.data.object)

            case "invoice.payment_failed":
                await handle_payment_failed(event.data.object)

            case "customer.updated":
                await handle_customer_updated(event.data.object)

            case _:
                logger.debug(f"Unhandled webhook event type: {event.type}")

        return {"status": "success", "event_type": event.type}

    except Exception as e:
        logger.exception(f"Error processing webhook {event.type}: {e}")
        # Return 200 to prevent Stripe from retrying for non-critical errors
        return {"status": "error", "message": str(e)}


# =============================================================================
# Helper Functions
# =============================================================================


async def get_billing_entity_from_customer(customer_id: str, session):
    """
    Get the billing entity (user or tenant) from a Stripe customer ID.

    Returns:
        Tuple of (entity_type, entity) where entity is UserQuota or Tenant
    """
    # First check if it's a tenant
    tenant_result = await session.execute(
        select(Tenant)
        .options(selectinload(Tenant.plan))
        .where(Tenant.stripe_customer_id == customer_id)
    )
    tenant = tenant_result.scalar_one_or_none()

    if tenant:
        return "tenant", tenant

    # Then check if it's a user
    user_result = await session.execute(
        select(UserQuota).where(UserQuota.stripe_customer_id == customer_id)
    )
    user_quota = user_result.scalar_one_or_none()

    if user_quota:
        return "user", user_quota

    return None, None


# =============================================================================
# Event Handlers
# =============================================================================


async def handle_checkout_completed(session_data: dict):
    """
    Handle successful checkout session completion.

    Updates subscription status and applies plan limits.
    Handles both user and tenant billing.
    """
    customer_id = session_data.get("customer")
    subscription_id = session_data.get("subscription")
    metadata = session_data.get("metadata", {})

    user_id = metadata.get("user_id")
    plan_slug = metadata.get("plan_slug")
    billing_entity_type = metadata.get("billing_entity_type", "user")
    tenant_id = metadata.get("tenant_id")

    if not customer_id:
        logger.error("Checkout completed without customer ID")
        return

    logger.info(
        f"Checkout completed for customer {customer_id}, "
        f"subscription {subscription_id}, entity_type={billing_entity_type}"
    )

    async with get_db_session() as db_session:
        entity_type, entity = await get_billing_entity_from_customer(customer_id, db_session)

        if not entity:
            # Try to find by user_id or tenant_id from metadata
            if billing_entity_type == "tenant" and tenant_id:
                tenant_result = await db_session.execute(
                    select(Tenant).where(Tenant.id == tenant_id)
                )
                entity = tenant_result.scalar_one_or_none()
                entity_type = "tenant"
            elif user_id:
                user_result = await db_session.execute(
                    select(UserQuota).where(UserQuota.user_id == user_id)
                )
                entity = user_result.scalar_one_or_none()
                entity_type = "user"

        if not entity:
            logger.error(f"Entity not found for customer {customer_id}")
            return

        # Get subscription details from Stripe
        subscription = None
        if subscription_id:
            try:
                subscription = stripe_service.get_subscription(subscription_id)
            except StripeServiceError as e:
                logger.error(f"Failed to get subscription details: {e}")

        # Update entity based on type
        if entity_type == "tenant":
            entity.stripe_customer_id = customer_id
            entity.stripe_subscription_id = subscription_id

            if subscription:
                # Check if it's a trial
                if subscription.status == "trialing":
                    entity.status = TenantStatus.TRIAL
                    entity.trial_start_at = datetime.fromtimestamp(
                        subscription.trial_start, tz=timezone.utc
                    ) if subscription.trial_start else datetime.now(timezone.utc)
                    entity.trial_ends_at = datetime.fromtimestamp(
                        subscription.trial_end, tz=timezone.utc
                    ) if subscription.trial_end else None
                else:
                    entity.status = TenantStatus.ACTIVE
                    entity.has_used_trial = True

            # Apply plan if specified
            if plan_slug:
                plan_result = await db_session.execute(
                    select(Plan).where(Plan.slug == plan_slug)
                )
                plan = plan_result.scalar_one_or_none()
                if plan:
                    entity.plan_id = plan.id
                    entity.storage_limit_bytes = plan.storage_limit_bytes
                    entity.api_calls_limit = plan.api_calls_limit
                    entity.document_limit = plan.document_limit

        else:  # user
            entity.stripe_customer_id = customer_id
            entity.stripe_subscription_id = subscription_id

            if subscription:
                if subscription.status == "trialing":
                    entity.subscription_status = "trialing"
                    entity.trial_start_at = datetime.fromtimestamp(
                        subscription.trial_start, tz=timezone.utc
                    ) if subscription.trial_start else datetime.now(timezone.utc)
                    entity.trial_ends_at = datetime.fromtimestamp(
                        subscription.trial_end, tz=timezone.utc
                    ) if subscription.trial_end else None
                else:
                    entity.subscription_status = "active"
                    entity.has_used_trial = True

                entity.current_period_end = datetime.fromtimestamp(
                    subscription.current_period_end, tz=timezone.utc
                )
                entity.cancel_at_period_end = subscription.cancel_at_period_end

            # Apply plan
            if plan_slug:
                entity.plan_type = plan_slug
                await quota_service.upgrade_plan(entity.user_id, plan_slug)

        await db_session.commit()
        logger.info(f"Updated {entity_type} billing after checkout")


async def handle_subscription_created(subscription: dict):
    """
    Handle new subscription creation.

    Usually triggered after checkout, but handle separately for direct API subscriptions.
    """
    customer_id = subscription.get("customer")
    subscription_id = subscription.get("id")
    status = subscription.get("status")

    logger.info(f"Subscription created: {subscription_id} for customer {customer_id}")

    async with get_db_session() as db_session:
        entity_type, entity = await get_billing_entity_from_customer(customer_id, db_session)

        if not entity:
            logger.warning(f"Entity not found for customer {customer_id} on subscription create")
            return

        if entity_type == "tenant":
            entity.stripe_subscription_id = subscription_id
            if status == "trialing":
                entity.status = TenantStatus.TRIAL
                if subscription.get("trial_start"):
                    entity.trial_start_at = datetime.fromtimestamp(
                        subscription["trial_start"], tz=timezone.utc
                    )
                if subscription.get("trial_end"):
                    entity.trial_ends_at = datetime.fromtimestamp(
                        subscription["trial_end"], tz=timezone.utc
                    )
            else:
                entity.status = TenantStatus.ACTIVE
        else:
            entity.stripe_subscription_id = subscription_id
            entity.subscription_status = status
            entity.current_period_end = datetime.fromtimestamp(
                subscription.get("current_period_end", 0), tz=timezone.utc
            )
            entity.cancel_at_period_end = subscription.get("cancel_at_period_end", False)

            if status == "trialing":
                if subscription.get("trial_start"):
                    entity.trial_start_at = datetime.fromtimestamp(
                        subscription["trial_start"], tz=timezone.utc
                    )
                if subscription.get("trial_end"):
                    entity.trial_ends_at = datetime.fromtimestamp(
                        subscription["trial_end"], tz=timezone.utc
                    )

        # Determine and apply plan
        items = subscription.get("items", {}).get("data", [])
        if items:
            price_id = items[0].get("price", {}).get("id")
            if price_id:
                plan_slug = stripe_service.get_plan_slug_from_price(price_id)
                if plan_slug != "unknown":
                    if entity_type == "tenant":
                        plan_result = await db_session.execute(
                            select(Plan).where(Plan.slug == plan_slug)
                        )
                        plan = plan_result.scalar_one_or_none()
                        if plan:
                            entity.plan_id = plan.id
                            entity.storage_limit_bytes = plan.storage_limit_bytes
                            entity.api_calls_limit = plan.api_calls_limit
                            entity.document_limit = plan.document_limit
                    else:
                        entity.plan_type = plan_slug
                        await quota_service.upgrade_plan(entity.user_id, plan_slug)

        await db_session.commit()


async def handle_subscription_updated(subscription: dict):
    """
    Handle subscription updates.

    Handles plan changes, status changes, trial conversion, and cancellation scheduling.
    """
    customer_id = subscription.get("customer")
    subscription_id = subscription.get("id")
    status = subscription.get("status")
    cancel_at_period_end = subscription.get("cancel_at_period_end", False)

    logger.info(f"Subscription updated: {subscription_id}, status: {status}")

    async with get_db_session() as db_session:
        entity_type, entity = await get_billing_entity_from_customer(customer_id, db_session)

        if not entity:
            logger.warning(f"Entity not found for customer {customer_id} on subscription update")
            return

        # Update based on entity type
        if entity_type == "tenant":
            # Update status
            if status == "active":
                entity.status = TenantStatus.ACTIVE
                entity.has_used_trial = True  # Trial converted to paid
            elif status == "trialing":
                entity.status = TenantStatus.TRIAL
            elif status == "past_due":
                entity.status = TenantStatus.SUSPENDED
            elif status == "canceled":
                entity.status = TenantStatus.CANCELLED

        else:
            entity.subscription_status = status
            entity.current_period_end = datetime.fromtimestamp(
                subscription.get("current_period_end", 0), tz=timezone.utc
            )
            entity.cancel_at_period_end = cancel_at_period_end

            # Mark trial as used when converting to paid
            if status == "active" and entity.subscription_status == "trialing":
                entity.has_used_trial = True

        # Check for plan change
        items = subscription.get("items", {}).get("data", [])
        if items:
            price_id = items[0].get("price", {}).get("id")
            if price_id:
                new_plan_slug = stripe_service.get_plan_slug_from_price(price_id)

                if new_plan_slug != "unknown":
                    if entity_type == "tenant":
                        plan_result = await db_session.execute(
                            select(Plan).where(Plan.slug == new_plan_slug)
                        )
                        plan = plan_result.scalar_one_or_none()
                        if plan and entity.plan_id != plan.id:
                            old_plan_id = entity.plan_id
                            entity.plan_id = plan.id
                            entity.storage_limit_bytes = plan.storage_limit_bytes
                            entity.api_calls_limit = plan.api_calls_limit
                            entity.document_limit = plan.document_limit
                            logger.info(f"Tenant plan changed from {old_plan_id} to {plan.id}")
                    else:
                        if new_plan_slug != entity.plan_type:
                            old_plan = entity.plan_type
                            entity.plan_type = new_plan_slug
                            await quota_service.upgrade_plan(entity.user_id, new_plan_slug)
                            logger.info(f"User plan changed: {old_plan} -> {new_plan_slug}")

        await db_session.commit()


async def handle_subscription_deleted(subscription: dict):
    """
    Handle subscription deletion/cancellation.

    Downgrades entity to free plan.
    """
    customer_id = subscription.get("customer")
    subscription_id = subscription.get("id")

    logger.info(f"Subscription deleted: {subscription_id} for customer {customer_id}")

    async with get_db_session() as db_session:
        entity_type, entity = await get_billing_entity_from_customer(customer_id, db_session)

        if not entity:
            logger.warning(f"Entity not found for customer {customer_id} on subscription delete")
            return

        if entity_type == "tenant":
            old_plan = entity.plan_id
            entity.status = TenantStatus.CANCELLED
            entity.stripe_subscription_id = None
            entity.plan_id = None
            # Reset to free tier limits
            entity.storage_limit_bytes = 5 * 1024 * 1024 * 1024  # 5GB
            entity.api_calls_limit = 1000
            entity.document_limit = 100
            logger.info(f"Tenant {entity.id} downgraded from plan {old_plan} to free")
        else:
            old_plan = entity.plan_type
            entity.subscription_status = "canceled"
            entity.plan_type = "free"
            entity.stripe_subscription_id = None
            entity.current_period_end = None
            entity.cancel_at_period_end = False
            await quota_service.upgrade_plan(entity.user_id, "free")
            logger.info(f"User {entity.user_id} downgraded from {old_plan} to free")

        await db_session.commit()


async def handle_trial_will_end(subscription: dict):
    """
    Handle trial ending notification (sent 3 days before trial ends).

    Can be used to send reminder emails to users.
    """
    customer_id = subscription.get("customer")
    subscription_id = subscription.get("id")
    trial_end = subscription.get("trial_end")

    logger.info(
        f"Trial will end for subscription {subscription_id}, "
        f"customer {customer_id}, trial_end={trial_end}"
    )

    # TODO: Send reminder email to user/tenant owner
    # This would use the mail service to notify the user


async def handle_invoice_paid(invoice: dict):
    """
    Handle successful invoice payment.

    Logs the payment and ensures subscription is active.
    """
    customer_id = invoice.get("customer")
    subscription_id = invoice.get("subscription")
    amount_paid = invoice.get("amount_paid", 0)
    currency = invoice.get("currency", "eur")

    logger.info(
        f"Invoice paid: {amount_paid/100} {currency.upper()} "
        f"for customer {customer_id}, subscription {subscription_id}"
    )

    async with get_db_session() as db_session:
        entity_type, entity = await get_billing_entity_from_customer(customer_id, db_session)

        if not entity:
            return

        # Ensure entity is marked as active after successful payment
        if entity_type == "tenant":
            if entity.status in (TenantStatus.TRIAL, TenantStatus.SUSPENDED):
                entity.status = TenantStatus.ACTIVE
                entity.has_used_trial = True
        else:
            if entity.subscription_status in ("trialing", "past_due"):
                entity.subscription_status = "active"
                entity.has_used_trial = True

        await db_session.commit()


async def handle_payment_failed(invoice: dict):
    """
    Handle failed invoice payment.

    Updates subscription status and could trigger notification.
    """
    customer_id = invoice.get("customer")
    subscription_id = invoice.get("subscription")
    attempt_count = invoice.get("attempt_count", 0)

    logger.warning(
        f"Payment failed for customer {customer_id}, "
        f"subscription {subscription_id}, attempt {attempt_count}"
    )

    async with get_db_session() as db_session:
        entity_type, entity = await get_billing_entity_from_customer(customer_id, db_session)

        if not entity:
            return

        # Update status to past_due if multiple failures
        if attempt_count >= 2:
            if entity_type == "tenant":
                entity.status = TenantStatus.SUSPENDED
                logger.warning(f"Tenant {entity.id} suspended due to payment failure")
            else:
                entity.subscription_status = "past_due"
                logger.warning(f"User {entity.user_id} subscription marked as past_due")

            await db_session.commit()

        # TODO: Send notification email to user about failed payment


async def handle_customer_updated(customer: dict):
    """
    Handle customer information updates.

    Syncs email and other customer info.
    """
    customer_id = customer.get("id")
    email = customer.get("email")

    logger.debug(f"Customer updated: {customer_id}")

    if not email:
        return

    async with get_db_session() as db_session:
        entity_type, entity = await get_billing_entity_from_customer(customer_id, db_session)

        if not entity:
            return

        if entity_type == "tenant":
            if entity.email != email:
                entity.email = email
                await db_session.commit()
                logger.info(f"Updated email for tenant {entity.id}")
        else:
            if entity.email != email:
                entity.email = email
                await db_session.commit()
                logger.info(f"Updated email for user {entity.user_id}")
