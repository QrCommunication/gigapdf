"""
Stripe service for payment processing.

Handles all Stripe API interactions for subscriptions, customers, and payments.
"""

import logging
from datetime import datetime
from typing import Optional

import stripe
from stripe import (
    AuthenticationError,
    CardError,
    InvalidRequestError,
    RateLimitError,
    StripeError,
)

from app.config import get_settings

logger = logging.getLogger(__name__)

# Initialize settings
settings = get_settings()

# Configure Stripe API key
stripe.api_key = settings.stripe_secret_key


class StripeServiceError(Exception):
    """Base exception for Stripe service errors."""

    def __init__(self, message: str, code: str = "stripe_error"):
        self.message = message
        self.code = code
        super().__init__(self.message)


class PaymentDeclinedError(StripeServiceError):
    """Payment was declined."""

    def __init__(self, message: str):
        super().__init__(message, code="payment_declined")


class CustomerNotFoundError(StripeServiceError):
    """Customer not found in Stripe."""

    def __init__(self, customer_id: str):
        super().__init__(f"Customer {customer_id} not found", code="customer_not_found")


class SubscriptionNotFoundError(StripeServiceError):
    """Subscription not found in Stripe."""

    def __init__(self, subscription_id: str):
        super().__init__(f"Subscription {subscription_id} not found", code="subscription_not_found")


class StripeService:
    """
    Service for Stripe payment operations.

    Provides methods for:
    - Customer management
    - Checkout sessions
    - Subscription management
    - Invoice retrieval
    - Payment method management
    """

    # =========================================================================
    # Customer Management
    # =========================================================================

    @staticmethod
    def create_customer(
        user_id: str,
        email: str,
        name: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> stripe.Customer:
        """
        Create a new Stripe customer.

        Args:
            user_id: Internal user ID
            email: Customer email
            name: Customer name (optional)
            metadata: Additional metadata (optional)

        Returns:
            stripe.Customer: Created customer object

        Raises:
            StripeServiceError: If customer creation fails
        """
        try:
            customer_metadata = {"user_id": user_id}
            if metadata:
                customer_metadata.update(metadata)

            customer = stripe.Customer.create(
                email=email,
                name=name,
                metadata=customer_metadata,
            )
            logger.info(f"Created Stripe customer {customer.id} for user {user_id}")
            return customer

        except StripeError as e:
            logger.error(f"Failed to create customer for user {user_id}: {e}")
            raise StripeServiceError(f"Failed to create customer: {e.user_message or str(e)}")

    @staticmethod
    def get_customer(customer_id: str) -> stripe.Customer:
        """
        Retrieve a Stripe customer by ID.

        Args:
            customer_id: Stripe customer ID

        Returns:
            stripe.Customer: Customer object

        Raises:
            CustomerNotFoundError: If customer not found
            StripeServiceError: If retrieval fails
        """
        try:
            return stripe.Customer.retrieve(customer_id)
        except InvalidRequestError as e:
            if "No such customer" in str(e):
                raise CustomerNotFoundError(customer_id)
            raise StripeServiceError(f"Failed to retrieve customer: {str(e)}")
        except StripeError as e:
            raise StripeServiceError(f"Failed to retrieve customer: {str(e)}")

    @staticmethod
    def update_customer(
        customer_id: str,
        email: Optional[str] = None,
        name: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> stripe.Customer:
        """
        Update a Stripe customer.

        Args:
            customer_id: Stripe customer ID
            email: New email (optional)
            name: New name (optional)
            metadata: New metadata (optional)

        Returns:
            stripe.Customer: Updated customer object
        """
        try:
            update_params = {}
            if email:
                update_params["email"] = email
            if name:
                update_params["name"] = name
            if metadata:
                update_params["metadata"] = metadata

            return stripe.Customer.modify(customer_id, **update_params)
        except StripeError as e:
            raise StripeServiceError(f"Failed to update customer: {str(e)}")

    # =========================================================================
    # Checkout Sessions
    # =========================================================================

    @staticmethod
    def create_checkout_session(
        customer_id: str,
        price_id: str,
        success_url: str,
        cancel_url: str,
        trial_days: Optional[int] = None,
        metadata: Optional[dict] = None,
    ) -> stripe.checkout.Session:
        """
        Create a Stripe Checkout session for subscription.

        Args:
            customer_id: Stripe customer ID
            price_id: Stripe price ID
            success_url: URL to redirect on success
            cancel_url: URL to redirect on cancel
            trial_days: Number of trial days (optional)
            metadata: Additional metadata (optional)

        Returns:
            stripe.checkout.Session: Checkout session object
        """
        try:
            session_params = {
                "customer": customer_id,
                "mode": "subscription",
                "line_items": [
                    {
                        "price": price_id,
                        "quantity": 1,
                    }
                ],
                "success_url": success_url + "?session_id={CHECKOUT_SESSION_ID}",
                "cancel_url": cancel_url,
                "payment_method_types": ["card"],
                "billing_address_collection": "auto",
                "allow_promotion_codes": True,
            }

            if trial_days and trial_days > 0:
                session_params["subscription_data"] = {
                    "trial_period_days": trial_days,
                }

            if metadata:
                session_params["metadata"] = metadata

            session = stripe.checkout.Session.create(**session_params)
            logger.info(f"Created checkout session {session.id} for customer {customer_id}")
            return session

        except StripeError as e:
            logger.error(f"Failed to create checkout session: {e}")
            raise StripeServiceError(f"Failed to create checkout session: {str(e)}")

    # =========================================================================
    # Billing Portal
    # =========================================================================

    @staticmethod
    def create_portal_session(
        customer_id: str,
        return_url: str,
    ) -> stripe.billing_portal.Session:
        """
        Create a Stripe Customer Portal session.

        Args:
            customer_id: Stripe customer ID
            return_url: URL to return after portal session

        Returns:
            stripe.billing_portal.Session: Portal session object
        """
        try:
            session = stripe.billing_portal.Session.create(
                customer=customer_id,
                return_url=return_url,
            )
            logger.info(f"Created portal session for customer {customer_id}")
            return session

        except StripeError as e:
            logger.error(f"Failed to create portal session: {e}")
            raise StripeServiceError(f"Failed to create portal session: {str(e)}")

    # =========================================================================
    # Subscription Management
    # =========================================================================

    @staticmethod
    def get_subscription(subscription_id: str) -> stripe.Subscription:
        """
        Retrieve a subscription by ID.

        Args:
            subscription_id: Stripe subscription ID

        Returns:
            stripe.Subscription: Subscription object
        """
        try:
            return stripe.Subscription.retrieve(subscription_id)
        except InvalidRequestError as e:
            if "No such subscription" in str(e):
                raise SubscriptionNotFoundError(subscription_id)
            raise StripeServiceError(f"Failed to retrieve subscription: {str(e)}")
        except StripeError as e:
            raise StripeServiceError(f"Failed to retrieve subscription: {str(e)}")

    @staticmethod
    def list_subscriptions(
        customer_id: str,
        status: Optional[str] = None,
        limit: int = 10,
    ) -> list[stripe.Subscription]:
        """
        List subscriptions for a customer.

        Args:
            customer_id: Stripe customer ID
            status: Filter by status (optional)
            limit: Maximum number of results

        Returns:
            list[stripe.Subscription]: List of subscriptions
        """
        try:
            params = {
                "customer": customer_id,
                "limit": limit,
            }
            if status:
                params["status"] = status

            return list(stripe.Subscription.list(**params))
        except StripeError as e:
            raise StripeServiceError(f"Failed to list subscriptions: {str(e)}")

    @staticmethod
    def update_subscription(
        subscription_id: str,
        price_id: str,
        proration_behavior: str = "create_prorations",
    ) -> stripe.Subscription:
        """
        Update a subscription to a new price/plan.

        Args:
            subscription_id: Stripe subscription ID
            price_id: New Stripe price ID
            proration_behavior: How to handle prorations

        Returns:
            stripe.Subscription: Updated subscription
        """
        try:
            subscription = stripe.Subscription.retrieve(subscription_id)

            # Update the subscription item with new price
            updated = stripe.Subscription.modify(
                subscription_id,
                items=[
                    {
                        "id": subscription["items"]["data"][0].id,
                        "price": price_id,
                    }
                ],
                proration_behavior=proration_behavior,
            )
            logger.info(f"Updated subscription {subscription_id} to price {price_id}")
            return updated

        except StripeError as e:
            logger.error(f"Failed to update subscription: {e}")
            raise StripeServiceError(f"Failed to update subscription: {str(e)}")

    @staticmethod
    def cancel_subscription(
        subscription_id: str,
        immediately: bool = False,
    ) -> stripe.Subscription:
        """
        Cancel a subscription.

        Args:
            subscription_id: Stripe subscription ID
            immediately: If True, cancel immediately. Otherwise, cancel at period end.

        Returns:
            stripe.Subscription: Canceled subscription
        """
        try:
            if immediately:
                subscription = stripe.Subscription.cancel(subscription_id)
                logger.info(f"Canceled subscription {subscription_id} immediately")
            else:
                subscription = stripe.Subscription.modify(
                    subscription_id,
                    cancel_at_period_end=True,
                )
                logger.info(f"Scheduled subscription {subscription_id} for cancellation at period end")

            return subscription

        except StripeError as e:
            logger.error(f"Failed to cancel subscription: {e}")
            raise StripeServiceError(f"Failed to cancel subscription: {str(e)}")

    @staticmethod
    def reactivate_subscription(subscription_id: str) -> stripe.Subscription:
        """
        Reactivate a subscription scheduled for cancellation.

        Args:
            subscription_id: Stripe subscription ID

        Returns:
            stripe.Subscription: Reactivated subscription
        """
        try:
            subscription = stripe.Subscription.modify(
                subscription_id,
                cancel_at_period_end=False,
            )
            logger.info(f"Reactivated subscription {subscription_id}")
            return subscription

        except StripeError as e:
            logger.error(f"Failed to reactivate subscription: {e}")
            raise StripeServiceError(f"Failed to reactivate subscription: {str(e)}")

    # =========================================================================
    # Invoices
    # =========================================================================

    @staticmethod
    def list_invoices(
        customer_id: str,
        limit: int = 10,
        starting_after: Optional[str] = None,
    ) -> list[stripe.Invoice]:
        """
        List invoices for a customer.

        Args:
            customer_id: Stripe customer ID
            limit: Maximum number of results
            starting_after: Pagination cursor (optional)

        Returns:
            list[stripe.Invoice]: List of invoices
        """
        try:
            params = {
                "customer": customer_id,
                "limit": limit,
            }
            if starting_after:
                params["starting_after"] = starting_after

            return list(stripe.Invoice.list(**params))
        except StripeError as e:
            raise StripeServiceError(f"Failed to list invoices: {str(e)}")

    @staticmethod
    def get_invoice(invoice_id: str) -> stripe.Invoice:
        """
        Retrieve an invoice by ID.

        Args:
            invoice_id: Stripe invoice ID

        Returns:
            stripe.Invoice: Invoice object
        """
        try:
            return stripe.Invoice.retrieve(invoice_id)
        except InvalidRequestError:
            raise StripeServiceError(f"Invoice {invoice_id} not found", code="invoice_not_found")
        except StripeError as e:
            raise StripeServiceError(f"Failed to retrieve invoice: {str(e)}")

    # =========================================================================
    # Payment Methods
    # =========================================================================

    @staticmethod
    def list_payment_methods(
        customer_id: str,
        type: str = "card",
        limit: int = 10,
    ) -> list[stripe.PaymentMethod]:
        """
        List payment methods for a customer.

        Args:
            customer_id: Stripe customer ID
            type: Payment method type (card, sepa_debit, etc.)
            limit: Maximum number of results

        Returns:
            list[stripe.PaymentMethod]: List of payment methods
        """
        try:
            return list(
                stripe.PaymentMethod.list(
                    customer=customer_id,
                    type=type,
                    limit=limit,
                )
            )
        except StripeError as e:
            raise StripeServiceError(f"Failed to list payment methods: {str(e)}")

    @staticmethod
    def attach_payment_method(
        customer_id: str,
        payment_method_id: str,
    ) -> stripe.PaymentMethod:
        """
        Attach a payment method to a customer.

        Args:
            customer_id: Stripe customer ID
            payment_method_id: Stripe PaymentMethod ID

        Returns:
            stripe.PaymentMethod: Attached payment method
        """
        try:
            payment_method = stripe.PaymentMethod.attach(
                payment_method_id,
                customer=customer_id,
            )
            logger.info(f"Attached payment method {payment_method_id} to customer {customer_id}")
            return payment_method

        except CardError as e:
            raise PaymentDeclinedError(e.user_message or str(e))
        except StripeError as e:
            raise StripeServiceError(f"Failed to attach payment method: {str(e)}")

    @staticmethod
    def detach_payment_method(payment_method_id: str) -> stripe.PaymentMethod:
        """
        Detach a payment method from customer.

        Args:
            payment_method_id: Stripe PaymentMethod ID

        Returns:
            stripe.PaymentMethod: Detached payment method
        """
        try:
            payment_method = stripe.PaymentMethod.detach(payment_method_id)
            logger.info(f"Detached payment method {payment_method_id}")
            return payment_method

        except StripeError as e:
            raise StripeServiceError(f"Failed to detach payment method: {str(e)}")

    @staticmethod
    def set_default_payment_method(
        customer_id: str,
        payment_method_id: str,
    ) -> stripe.Customer:
        """
        Set default payment method for a customer.

        Args:
            customer_id: Stripe customer ID
            payment_method_id: Stripe PaymentMethod ID

        Returns:
            stripe.Customer: Updated customer
        """
        try:
            customer = stripe.Customer.modify(
                customer_id,
                invoice_settings={
                    "default_payment_method": payment_method_id,
                },
            )
            logger.info(f"Set default payment method {payment_method_id} for customer {customer_id}")
            return customer

        except StripeError as e:
            raise StripeServiceError(f"Failed to set default payment method: {str(e)}")

    # =========================================================================
    # Webhook Verification
    # =========================================================================

    @staticmethod
    def construct_webhook_event(
        payload: bytes,
        sig_header: str,
    ) -> stripe.Event:
        """
        Construct and verify a webhook event.

        Args:
            payload: Raw request body
            sig_header: Stripe-Signature header value

        Returns:
            stripe.Event: Verified event object

        Raises:
            StripeServiceError: If signature verification fails
        """
        try:
            event = stripe.Webhook.construct_event(
                payload,
                sig_header,
                settings.stripe_webhook_secret,
            )
            return event

        except stripe.error.SignatureVerificationError as e:
            logger.error(f"Webhook signature verification failed: {e}")
            raise StripeServiceError("Invalid webhook signature", code="invalid_signature")
        except ValueError as e:
            logger.error(f"Invalid webhook payload: {e}")
            raise StripeServiceError("Invalid webhook payload", code="invalid_payload")

    # =========================================================================
    # Price/Product Helpers
    # =========================================================================

    @staticmethod
    def get_price(price_id: str) -> stripe.Price:
        """
        Retrieve a Stripe price by ID.

        Args:
            price_id: Stripe price ID

        Returns:
            stripe.Price: Price object
        """
        try:
            return stripe.Price.retrieve(price_id, expand=["product"])
        except StripeError as e:
            raise StripeServiceError(f"Failed to retrieve price: {str(e)}")

    @staticmethod
    def get_plan_slug_from_price(price_id: str) -> str:
        """
        Get plan slug from Stripe price ID.

        Looks up the plan slug from price metadata first,
        then falls back to database lookup.

        Args:
            price_id: Stripe price ID

        Returns:
            str: Plan slug (starter, pro, etc.)
        """
        # Try to get from price metadata first
        try:
            price = stripe.Price.retrieve(price_id)
            slug = price.metadata.get("plan_slug")
            if slug:
                return slug
        except StripeError:
            pass

        # Fallback: will need async database lookup
        # This is a sync method, so we return unknown for now
        # The caller should handle this case
        return "unknown"

    @staticmethod
    async def get_plan_slug_from_price_async(price_id: str) -> str:
        """
        Get plan slug from Stripe price ID (async version with DB lookup).

        Args:
            price_id: Stripe price ID

        Returns:
            str: Plan slug (starter, pro, etc.)
        """
        # Try metadata first
        try:
            price = stripe.Price.retrieve(price_id)
            slug = price.metadata.get("plan_slug")
            if slug:
                return slug
        except StripeError:
            pass

        # Database lookup
        from app.core.database import get_db_session
        from app.models.database import Plan
        from sqlalchemy import select

        async with get_db_session() as session:
            result = await session.execute(
                select(Plan).where(Plan.stripe_price_id == price_id)
            )
            plan = result.scalar_one_or_none()
            if plan:
                return plan.slug

        return "unknown"

    @staticmethod
    async def get_price_id_for_plan(plan_slug: str) -> str | None:
        """
        Get Stripe price ID for a plan slug.

        Looks up the plan in the database and returns its stripe_price_id.

        Args:
            plan_slug: Plan slug (starter, pro, etc.)

        Returns:
            str | None: Stripe price ID or None if not found
        """
        from app.core.database import get_db_session
        from app.models.database import Plan
        from sqlalchemy import select

        async with get_db_session() as session:
            result = await session.execute(
                select(Plan).where(Plan.slug == plan_slug, Plan.is_active == True)
            )
            plan = result.scalar_one_or_none()
            if plan and plan.stripe_price_id:
                return plan.stripe_price_id

        return None


# Create singleton instance
stripe_service = StripeService()
