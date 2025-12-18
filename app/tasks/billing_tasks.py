"""
Billing background tasks for Stripe integration.

Handles:
- Plan synchronization with Stripe
- Overdue payment processing
- Account suspension for payment failures
- Trial period expiration
- Invoice generation and reminders
"""

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Optional

import stripe
from celery import shared_task
from sqlalchemy import select, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.core.database import get_db_session
from app.models.database import Plan, UserQuota
from app.models.tenant import Tenant, TenantStatus
from app.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)
settings = get_settings()

# Configure Stripe
stripe.api_key = settings.stripe_secret_key


# =============================================================================
# Plan Synchronization Tasks
# =============================================================================


@celery_app.task(bind=True, name="billing.sync_plans_to_stripe")
def sync_plans_to_stripe(self):
    """
    Synchronize all active plans from database to Stripe.

    Creates or updates Stripe Products and Prices for each plan.
    Should be run periodically (e.g., every hour) or after plan changes.
    """
    logger.info("Starting plan synchronization with Stripe")

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    try:
        result = loop.run_until_complete(_sync_plans_to_stripe_async())
        return result
    finally:
        loop.close()


async def _sync_plans_to_stripe_async() -> dict:
    """Async implementation of plan sync."""
    synced = 0
    errors = []

    async with get_db_session() as session:
        # Get all active plans
        result = await session.execute(
            select(Plan).where(Plan.is_active == True)
        )
        plans = result.scalars().all()

        for plan in plans:
            try:
                await _sync_single_plan(plan, session)
                synced += 1
            except Exception as e:
                logger.error(f"Failed to sync plan {plan.slug}: {e}")
                errors.append({"plan": plan.slug, "error": str(e)})

        await session.commit()

    logger.info(f"Plan sync complete: {synced} synced, {len(errors)} errors")
    return {"synced": synced, "errors": errors}


async def _sync_single_plan(plan: Plan, session: AsyncSession):
    """Sync a single plan to Stripe."""
    # Skip free plans - no need to create in Stripe
    if plan.price == 0 or plan.slug == "free":
        logger.debug(f"Skipping free plan: {plan.slug}")
        return

    # Create or update Stripe Product
    if not plan.stripe_product_id:
        # Create new product
        product = stripe.Product.create(
            name=plan.name,
            description=plan.description or f"{plan.name} subscription plan",
            metadata={
                "plan_slug": plan.slug,
                "plan_id": str(plan.id),
            }
        )
        plan.stripe_product_id = product.id
        logger.info(f"Created Stripe product for plan {plan.slug}: {product.id}")
    else:
        # Update existing product
        try:
            stripe.Product.modify(
                plan.stripe_product_id,
                name=plan.name,
                description=plan.description or f"{plan.name} subscription plan",
            )
        except stripe.error.InvalidRequestError:
            # Product doesn't exist, create new one
            product = stripe.Product.create(
                name=plan.name,
                description=plan.description or f"{plan.name} subscription plan",
                metadata={
                    "plan_slug": plan.slug,
                    "plan_id": str(plan.id),
                }
            )
            plan.stripe_product_id = product.id
            logger.info(f"Re-created Stripe product for plan {plan.slug}: {product.id}")

    # Create or update Stripe Price
    price_amount = int(plan.price * 100)  # Convert to cents

    if not plan.stripe_price_id:
        # Create new price
        price = stripe.Price.create(
            product=plan.stripe_product_id,
            unit_amount=price_amount,
            currency=plan.currency.lower(),
            recurring={"interval": plan.interval},
            metadata={
                "plan_slug": plan.slug,
                "plan_id": str(plan.id),
            }
        )
        plan.stripe_price_id = price.id
        logger.info(f"Created Stripe price for plan {plan.slug}: {price.id}")
    else:
        # Check if price needs update (prices are immutable in Stripe)
        try:
            existing_price = stripe.Price.retrieve(plan.stripe_price_id)

            # If price changed, create new price and archive old one
            if existing_price.unit_amount != price_amount:
                # Archive old price
                stripe.Price.modify(plan.stripe_price_id, active=False)

                # Create new price
                price = stripe.Price.create(
                    product=plan.stripe_product_id,
                    unit_amount=price_amount,
                    currency=plan.currency.lower(),
                    recurring={"interval": plan.interval},
                    metadata={
                        "plan_slug": plan.slug,
                        "plan_id": str(plan.id),
                    }
                )
                plan.stripe_price_id = price.id
                logger.info(f"Updated Stripe price for plan {plan.slug}: {price.id}")
        except stripe.error.InvalidRequestError:
            # Price doesn't exist, create new one
            price = stripe.Price.create(
                product=plan.stripe_product_id,
                unit_amount=price_amount,
                currency=plan.currency.lower(),
                recurring={"interval": plan.interval},
                metadata={
                    "plan_slug": plan.slug,
                    "plan_id": str(plan.id),
                }
            )
            plan.stripe_price_id = price.id
            logger.info(f"Re-created Stripe price for plan {plan.slug}: {price.id}")

    plan.stripe_synced_at = datetime.now(timezone.utc)


# =============================================================================
# Payment Processing Tasks
# =============================================================================


@celery_app.task(bind=True, name="billing.process_overdue_payments")
def process_overdue_payments(self):
    """
    Process overdue payments and retry failed charges.

    Should be run daily to:
    - Retry failed payments
    - Send payment reminders
    - Suspend accounts after multiple failures
    """
    logger.info("Processing overdue payments")

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    try:
        result = loop.run_until_complete(_process_overdue_payments_async())
        return result
    finally:
        loop.close()


async def _process_overdue_payments_async() -> dict:
    """Async implementation of overdue payment processing."""
    processed = 0
    suspended = 0
    errors = []

    async with get_db_session() as session:
        # Find users with past_due subscriptions
        result = await session.execute(
            select(UserQuota).where(
                and_(
                    UserQuota.subscription_status == "past_due",
                    UserQuota.is_suspended == False,
                )
            )
        )
        users = result.scalars().all()

        for user in users:
            try:
                await _process_user_overdue(user, session)
                processed += 1

                # Check if should suspend
                if user.payment_failed_count >= 3:
                    await _suspend_user_account(user, session, "Multiple payment failures")
                    suspended += 1

            except Exception as e:
                logger.error(f"Failed to process user {user.user_id}: {e}")
                errors.append({"user_id": user.user_id, "error": str(e)})

        # Also process tenants
        tenant_result = await session.execute(
            select(Tenant).where(
                and_(
                    Tenant.status == TenantStatus.SUSPENDED,
                    Tenant.stripe_subscription_id.isnot(None),
                )
            )
        )
        tenants = tenant_result.scalars().all()

        for tenant in tenants:
            try:
                await _process_tenant_overdue(tenant, session)
                processed += 1
            except Exception as e:
                logger.error(f"Failed to process tenant {tenant.id}: {e}")
                errors.append({"tenant_id": str(tenant.id), "error": str(e)})

        await session.commit()

    logger.info(f"Overdue processing complete: {processed} processed, {suspended} suspended, {len(errors)} errors")
    return {"processed": processed, "suspended": suspended, "errors": errors}


async def _process_user_overdue(user: UserQuota, session: AsyncSession):
    """Process overdue payment for a user."""
    if not user.stripe_subscription_id:
        return

    try:
        # Get subscription status from Stripe
        subscription = stripe.Subscription.retrieve(user.stripe_subscription_id)

        if subscription.status == "past_due":
            # Get latest invoice
            invoices = stripe.Invoice.list(
                subscription=user.stripe_subscription_id,
                status="open",
                limit=1,
            )

            if invoices.data:
                invoice = invoices.data[0]

                # Check if we should retry
                if invoice.attempt_count < 4:  # Stripe default is 4 attempts
                    # Invoice will be retried automatically by Stripe
                    logger.info(f"Invoice {invoice.id} for user {user.user_id} will be retried automatically")
                else:
                    # Too many failures, increment counter
                    user.payment_failed_count += 1
                    user.last_payment_failed_at = datetime.now(timezone.utc)

        elif subscription.status == "active":
            # Payment succeeded, reset counters
            user.subscription_status = "active"
            user.payment_failed_count = 0
            user.last_payment_failed_at = None

    except stripe.error.StripeError as e:
        logger.error(f"Stripe error processing user {user.user_id}: {e}")
        raise


async def _process_tenant_overdue(tenant: Tenant, session: AsyncSession):
    """Process overdue payment for a tenant."""
    if not tenant.stripe_subscription_id:
        return

    try:
        subscription = stripe.Subscription.retrieve(tenant.stripe_subscription_id)

        if subscription.status == "active":
            # Payment succeeded, reactivate tenant
            tenant.status = TenantStatus.ACTIVE
            logger.info(f"Reactivated tenant {tenant.id} after successful payment")

    except stripe.error.StripeError as e:
        logger.error(f"Stripe error processing tenant {tenant.id}: {e}")
        raise


async def _suspend_user_account(
    user: UserQuota,
    session: AsyncSession,
    reason: str,
):
    """Suspend a user account due to payment issues."""
    user.is_suspended = True
    user.suspended_at = datetime.now(timezone.utc)
    user.suspension_reason = reason

    logger.warning(f"Suspended user {user.user_id}: {reason}")

    # TODO: Send suspension notification email


# =============================================================================
# Trial Expiration Tasks
# =============================================================================


@celery_app.task(bind=True, name="billing.process_expired_trials")
def process_expired_trials(self):
    """
    Process expired trial periods.

    Should be run daily to:
    - End expired trials
    - Downgrade to free plan if no payment method
    - Send trial expiration reminders
    """
    logger.info("Processing expired trials")

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    try:
        result = loop.run_until_complete(_process_expired_trials_async())
        return result
    finally:
        loop.close()


async def _process_expired_trials_async() -> dict:
    """Async implementation of expired trial processing."""
    processed = 0
    downgraded = 0
    errors = []
    now = datetime.now(timezone.utc)

    async with get_db_session() as session:
        # Find users with expired trials
        result = await session.execute(
            select(UserQuota).where(
                and_(
                    UserQuota.subscription_status == "trialing",
                    UserQuota.trial_ends_at.isnot(None),
                    UserQuota.trial_ends_at < now,
                )
            )
        )
        users = result.scalars().all()

        for user in users:
            try:
                converted = await _process_user_trial_end(user, session)
                processed += 1
                if not converted:
                    downgraded += 1
            except Exception as e:
                logger.error(f"Failed to process trial end for user {user.user_id}: {e}")
                errors.append({"user_id": user.user_id, "error": str(e)})

        # Also process tenants
        tenant_result = await session.execute(
            select(Tenant).where(
                and_(
                    Tenant.status == TenantStatus.TRIAL,
                    Tenant.trial_ends_at.isnot(None),
                    Tenant.trial_ends_at < now,
                )
            )
        )
        tenants = tenant_result.scalars().all()

        for tenant in tenants:
            try:
                converted = await _process_tenant_trial_end(tenant, session)
                processed += 1
                if not converted:
                    downgraded += 1
            except Exception as e:
                logger.error(f"Failed to process trial end for tenant {tenant.id}: {e}")
                errors.append({"tenant_id": str(tenant.id), "error": str(e)})

        await session.commit()

    logger.info(f"Trial processing complete: {processed} processed, {downgraded} downgraded, {len(errors)} errors")
    return {"processed": processed, "downgraded": downgraded, "errors": errors}


async def _process_user_trial_end(user: UserQuota, session: AsyncSession) -> bool:
    """
    Process trial end for a user.

    Returns True if converted to paid, False if downgraded.
    """
    user.has_used_trial = True

    # Check if user has a valid subscription in Stripe
    if user.stripe_subscription_id:
        try:
            subscription = stripe.Subscription.retrieve(user.stripe_subscription_id)

            if subscription.status == "active":
                # Successfully converted to paid
                user.subscription_status = "active"
                logger.info(f"User {user.user_id} converted from trial to paid")
                return True

        except stripe.error.StripeError as e:
            logger.error(f"Stripe error checking subscription for {user.user_id}: {e}")

    # No valid subscription, downgrade to free
    user.subscription_status = "none"
    user.plan_type = "free"
    user.storage_limit_bytes = 5 * 1024 * 1024 * 1024  # 5GB
    user.api_calls_limit = 1000
    user.document_limit = 100

    logger.info(f"User {user.user_id} downgraded to free after trial ended")

    # TODO: Send trial ended notification email

    return False


async def _process_tenant_trial_end(tenant: Tenant, session: AsyncSession) -> bool:
    """
    Process trial end for a tenant.

    Returns True if converted to paid, False if downgraded.
    """
    tenant.has_used_trial = True

    # Check if tenant has a valid subscription in Stripe
    if tenant.stripe_subscription_id:
        try:
            subscription = stripe.Subscription.retrieve(tenant.stripe_subscription_id)

            if subscription.status == "active":
                # Successfully converted to paid
                tenant.status = TenantStatus.ACTIVE
                logger.info(f"Tenant {tenant.id} converted from trial to paid")
                return True

        except stripe.error.StripeError as e:
            logger.error(f"Stripe error checking subscription for tenant {tenant.id}: {e}")

    # No valid subscription, downgrade to free
    tenant.status = TenantStatus.ACTIVE  # Keep active but on free tier
    tenant.plan_id = None
    tenant.storage_limit_bytes = 5 * 1024 * 1024 * 1024  # 5GB
    tenant.api_calls_limit = 1000
    tenant.document_limit = 100

    logger.info(f"Tenant {tenant.id} downgraded to free after trial ended")

    # TODO: Send trial ended notification email

    return False


# =============================================================================
# Trial Reminder Tasks
# =============================================================================


@celery_app.task(bind=True, name="billing.send_trial_reminders")
def send_trial_reminders(self):
    """
    Send reminders for trials about to expire.

    Sends reminders at:
    - 3 days before trial ends
    - 1 day before trial ends
    """
    logger.info("Sending trial expiration reminders")

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    try:
        result = loop.run_until_complete(_send_trial_reminders_async())
        return result
    finally:
        loop.close()


async def _send_trial_reminders_async() -> dict:
    """Async implementation of trial reminders."""
    sent = 0
    now = datetime.now(timezone.utc)
    three_days_from_now = now + timedelta(days=3)
    one_day_from_now = now + timedelta(days=1)

    async with get_db_session() as session:
        # Find users with trials ending in 3 days
        result = await session.execute(
            select(UserQuota).where(
                and_(
                    UserQuota.subscription_status == "trialing",
                    UserQuota.trial_ends_at.isnot(None),
                    UserQuota.trial_ends_at >= now,
                    UserQuota.trial_ends_at <= three_days_from_now,
                )
            )
        )
        users = result.scalars().all()

        for user in users:
            days_remaining = (user.trial_ends_at - now).days

            # TODO: Send email reminder based on days_remaining
            # if days_remaining == 3 or days_remaining == 1:
            #     await send_trial_reminder_email(user.email, days_remaining)

            logger.info(f"Trial reminder: User {user.user_id} has {days_remaining} days remaining")
            sent += 1

        # Also check tenants
        tenant_result = await session.execute(
            select(Tenant).where(
                and_(
                    Tenant.status == TenantStatus.TRIAL,
                    Tenant.trial_ends_at.isnot(None),
                    Tenant.trial_ends_at >= now,
                    Tenant.trial_ends_at <= three_days_from_now,
                )
            )
        )
        tenants = tenant_result.scalars().all()

        for tenant in tenants:
            days_remaining = (tenant.trial_ends_at - now).days

            # TODO: Send email to tenant owner
            logger.info(f"Trial reminder: Tenant {tenant.id} has {days_remaining} days remaining")
            sent += 1

    return {"reminders_sent": sent}


# =============================================================================
# Subscription Cleanup Tasks
# =============================================================================


@celery_app.task(bind=True, name="billing.cleanup_stale_subscriptions")
def cleanup_stale_subscriptions(self):
    """
    Clean up stale subscription data.

    Syncs local subscription status with Stripe to catch any missed webhooks.
    Should be run daily.
    """
    logger.info("Cleaning up stale subscriptions")

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    try:
        result = loop.run_until_complete(_cleanup_stale_subscriptions_async())
        return result
    finally:
        loop.close()


async def _cleanup_stale_subscriptions_async() -> dict:
    """Async implementation of subscription cleanup."""
    updated = 0
    errors = []

    async with get_db_session() as session:
        # Find users with subscriptions that might be stale
        result = await session.execute(
            select(UserQuota).where(
                and_(
                    UserQuota.stripe_subscription_id.isnot(None),
                    UserQuota.subscription_status.in_(["active", "past_due", "trialing"]),
                )
            )
        )
        users = result.scalars().all()

        for user in users:
            try:
                subscription = stripe.Subscription.retrieve(user.stripe_subscription_id)

                # Update if status differs
                if subscription.status != user.subscription_status:
                    old_status = user.subscription_status
                    user.subscription_status = subscription.status

                    if subscription.status == "canceled":
                        user.plan_type = "free"
                        user.stripe_subscription_id = None

                    logger.info(
                        f"Updated user {user.user_id} subscription status: "
                        f"{old_status} -> {subscription.status}"
                    )
                    updated += 1

            except stripe.error.InvalidRequestError:
                # Subscription no longer exists
                user.subscription_status = "none"
                user.stripe_subscription_id = None
                user.plan_type = "free"
                logger.warning(f"Subscription not found for user {user.user_id}, reset to free")
                updated += 1

            except stripe.error.StripeError as e:
                logger.error(f"Stripe error for user {user.user_id}: {e}")
                errors.append({"user_id": user.user_id, "error": str(e)})

        await session.commit()

    logger.info(f"Subscription cleanup complete: {updated} updated, {len(errors)} errors")
    return {"updated": updated, "errors": errors}


# =============================================================================
# Celery Beat Schedule (for periodic tasks)
# =============================================================================

# Add these to celery_app.conf.beat_schedule in celery_app.py:
BILLING_BEAT_SCHEDULE = {
    "sync-plans-to-stripe": {
        "task": "billing.sync_plans_to_stripe",
        "schedule": 3600.0,  # Every hour
    },
    "process-overdue-payments": {
        "task": "billing.process_overdue_payments",
        "schedule": 86400.0,  # Every 24 hours
    },
    "process-expired-trials": {
        "task": "billing.process_expired_trials",
        "schedule": 3600.0,  # Every hour
    },
    "send-trial-reminders": {
        "task": "billing.send_trial_reminders",
        "schedule": 86400.0,  # Every 24 hours
    },
    "cleanup-stale-subscriptions": {
        "task": "billing.cleanup_stale_subscriptions",
        "schedule": 86400.0,  # Every 24 hours
    },
}
