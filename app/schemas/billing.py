"""
Billing schemas for Stripe integration.

Defines request and response models for all billing operations.
"""

from datetime import datetime

from pydantic import BaseModel, Field

# =============================================================================
# Request Schemas
# =============================================================================


class CreateCheckoutRequest(BaseModel):
    """Request to create a Stripe Checkout session."""

    plan_id: str = Field(description="Plan slug (starter, pro)")
    success_url: str = Field(description="URL to redirect after successful payment")
    cancel_url: str = Field(description="URL to redirect if payment is cancelled")

    class Config:
        json_schema_extra = {
            "example": {
                "plan_id": "starter",
                "success_url": "https://giga-pdf.com/billing/success",
                "cancel_url": "https://giga-pdf.com/billing/cancel",
            }
        }


class CreatePortalRequest(BaseModel):
    """Request to create a Stripe Customer Portal session."""

    return_url: str = Field(description="URL to return after portal session")

    class Config:
        json_schema_extra = {
            "example": {
                "return_url": "https://giga-pdf.com/settings/billing",
            }
        }


class UpdateSubscriptionRequest(BaseModel):
    """Request to update subscription plan."""

    plan_id: str = Field(description="New plan slug")

    class Config:
        json_schema_extra = {
            "example": {
                "plan_id": "pro",
            }
        }


class CancelSubscriptionRequest(BaseModel):
    """Request to cancel subscription."""

    immediately: bool = Field(
        default=False,
        description="If true, cancel immediately. Otherwise, cancel at period end.",
    )

    class Config:
        json_schema_extra = {
            "example": {
                "immediately": False,
            }
        }


class AddPaymentMethodRequest(BaseModel):
    """Request to add a payment method."""

    payment_method_id: str = Field(description="Stripe PaymentMethod ID")

    class Config:
        json_schema_extra = {
            "example": {
                "payment_method_id": "pm_1234567890",
            }
        }


# =============================================================================
# Response Schemas
# =============================================================================


class SubscriptionResponse(BaseModel):
    """Current subscription status."""

    status: str = Field(description="Subscription status (none, active, canceled, past_due, trialing)")
    current_plan: str = Field(description="Current plan slug")
    plan_name: str = Field(description="Current plan display name")
    billing_cycle: str | None = Field(default=None, description="month or year")
    current_period_start: datetime | None = Field(default=None, description="Current billing period start")
    current_period_end: datetime | None = Field(default=None, description="Current billing period end")
    cancel_at_period_end: bool = Field(default=False, description="If subscription will cancel at period end")
    stripe_customer_id: str | None = Field(default=None, description="Stripe Customer ID")
    stripe_subscription_id: str | None = Field(default=None, description="Stripe Subscription ID")

    class Config:
        json_schema_extra = {
            "example": {
                "status": "active",
                "current_plan": "starter",
                "plan_name": "Starter",
                "billing_cycle": "month",
                "current_period_start": "2025-01-01T00:00:00Z",
                "current_period_end": "2025-02-01T00:00:00Z",
                "cancel_at_period_end": False,
                "stripe_customer_id": "cus_abc123",
                "stripe_subscription_id": "sub_xyz789",
            }
        }


class CheckoutSessionResponse(BaseModel):
    """Stripe Checkout session response."""

    session_id: str = Field(description="Stripe Checkout Session ID")
    url: str = Field(description="URL to redirect user for checkout")

    class Config:
        json_schema_extra = {
            "example": {
                "session_id": "cs_test_abc123",
                "url": "https://checkout.stripe.com/c/pay/cs_test_abc123",
            }
        }


class PortalSessionResponse(BaseModel):
    """Stripe Customer Portal session response."""

    url: str = Field(description="URL to redirect user to billing portal")

    class Config:
        json_schema_extra = {
            "example": {
                "url": "https://billing.stripe.com/p/session/test_abc123",
            }
        }


class CardDetails(BaseModel):
    """Card details for payment method."""

    brand: str = Field(description="Card brand (visa, mastercard, etc.)")
    last4: str = Field(description="Last 4 digits of card number")
    exp_month: int = Field(description="Card expiration month")
    exp_year: int = Field(description="Card expiration year")

    class Config:
        json_schema_extra = {
            "example": {
                "brand": "visa",
                "last4": "4242",
                "exp_month": 12,
                "exp_year": 2025,
            }
        }


class PaymentMethodResponse(BaseModel):
    """Payment method information."""

    id: str = Field(description="Payment method ID")
    type: str = Field(description="Payment method type (card, sepa_debit, etc.)")
    card: CardDetails | None = Field(default=None, description="Card details if type is card")
    is_default: bool = Field(default=False, description="If this is the default payment method")
    created_at: datetime | None = Field(default=None, description="When payment method was created")

    class Config:
        json_schema_extra = {
            "example": {
                "id": "pm_1234567890",
                "type": "card",
                "card": {
                    "brand": "visa",
                    "last4": "4242",
                    "exp_month": 12,
                    "exp_year": 2025,
                },
                "is_default": True,
                "created_at": "2025-01-01T00:00:00Z",
            }
        }


class InvoiceResponse(BaseModel):
    """Invoice information."""

    id: str = Field(description="Invoice ID")
    number: str | None = Field(default=None, description="Invoice number")
    status: str = Field(description="Invoice status (draft, open, paid, void, uncollectible)")
    amount_due: int = Field(description="Amount due in cents")
    amount_paid: int = Field(description="Amount paid in cents")
    currency: str = Field(description="Currency code (EUR, USD, etc.)")
    created: datetime = Field(description="Invoice creation date")
    due_date: datetime | None = Field(default=None, description="Due date")
    pdf_url: str | None = Field(default=None, description="URL to download PDF invoice")
    hosted_invoice_url: str | None = Field(default=None, description="URL to view invoice online")
    period_start: datetime | None = Field(default=None, description="Billing period start")
    period_end: datetime | None = Field(default=None, description="Billing period end")

    class Config:
        json_schema_extra = {
            "example": {
                "id": "in_abc123",
                "number": "INV-0001",
                "status": "paid",
                "amount_due": 900,
                "amount_paid": 900,
                "currency": "eur",
                "created": "2025-01-01T00:00:00Z",
                "due_date": "2025-01-15T00:00:00Z",
                "pdf_url": "https://pay.stripe.com/invoice/abc123/pdf",
                "hosted_invoice_url": "https://invoice.stripe.com/i/abc123",
                "period_start": "2025-01-01T00:00:00Z",
                "period_end": "2025-02-01T00:00:00Z",
            }
        }


class UsageMetrics(BaseModel):
    """Usage metrics for current period."""

    documents: int = Field(description="Number of documents created")
    storage_gb: float = Field(description="Storage used in GB")
    api_calls: int = Field(description="Number of API calls made")

    class Config:
        json_schema_extra = {
            "example": {
                "documents": 42,
                "storage_gb": 1.5,
                "api_calls": 500,
            }
        }


class UsageLimits(BaseModel):
    """Usage limits based on plan."""

    documents: int | None = Field(default=None, description="Document limit (null = unlimited)")
    storage_gb: float | None = Field(default=None, description="Storage limit in GB (null = unlimited)")
    api_calls: int | None = Field(default=None, description="API call limit (null = unlimited)")

    class Config:
        json_schema_extra = {
            "example": {
                "documents": 500,
                "storage_gb": 25.0,
                "api_calls": 10000,
            }
        }


class UsageSummaryResponse(BaseModel):
    """Usage summary with limits."""

    current_period_start: datetime = Field(description="Current billing period start")
    current_period_end: datetime = Field(description="Current billing period end")
    usage: UsageMetrics = Field(description="Current usage metrics")
    limits: UsageLimits = Field(description="Plan limits")

    class Config:
        json_schema_extra = {
            "example": {
                "current_period_start": "2025-01-01T00:00:00Z",
                "current_period_end": "2025-02-01T00:00:00Z",
                "usage": {
                    "documents": 42,
                    "storage_gb": 1.5,
                    "api_calls": 500,
                },
                "limits": {
                    "documents": 500,
                    "storage_gb": 25.0,
                    "api_calls": 10000,
                },
            }
        }


class BillingPlanResponse(BaseModel):
    """Plan information for billing display."""

    id: str = Field(description="Plan ID")
    slug: str = Field(description="Plan slug (free, starter, pro, enterprise)")
    name: str = Field(description="Plan display name")
    description: str | None = Field(default=None, description="Plan description")
    price: float = Field(description="Price in currency units")
    currency: str = Field(description="Currency code")
    interval: str = Field(description="Billing interval (month, year)")
    storage_gb: float = Field(description="Storage limit in GB")
    api_calls_limit: int = Field(description="API calls per month")
    document_limit: int = Field(description="Document limit")
    features: dict | None = Field(default=None, description="Additional features")
    is_popular: bool = Field(default=False, description="If plan is marked as popular")
    stripe_price_id: str | None = Field(default=None, description="Stripe Price ID")
    trial_days: int | None = Field(default=None, description="Free trial days")

    class Config:
        json_schema_extra = {
            "example": {
                "id": "uuid-here",
                "slug": "starter",
                "name": "Starter",
                "description": "Perfect for individuals and small teams",
                "price": 9.0,
                "currency": "EUR",
                "interval": "month",
                "storage_gb": 25.0,
                "api_calls_limit": 10000,
                "document_limit": 500,
                "features": {
                    "customBranding": False,
                    "prioritySupport": False,
                },
                "is_popular": True,
                "stripe_price_id": "price_abc123",
                "trial_days": 14,
            }
        }
