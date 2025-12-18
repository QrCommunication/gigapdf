# @giga-pdf/billing

Stripe billing integration package for GigaPDF with comprehensive subscription management, checkout flows, and usage tracking.

## Features

- **Pricing Table**: Display all available plans with features and pricing
- **Stripe Checkout**: Seamless redirect to Stripe Checkout for subscriptions
- **Customer Portal**: Manage subscriptions, payment methods, and invoices
- **Usage Tracking**: Real-time API calls and storage usage meters
- **Invoice Management**: View and download invoice history
- **Subscription Status**: Display current subscription state with badges
- **Payment Forms**: Embedded Stripe Elements for custom payment flows

## Installation

```bash
pnpm add @giga-pdf/billing
```

## Environment Variables

```env
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID=price_...
NEXT_PUBLIC_STRIPE_PRO_PRICE_ID=price_...
```

## Plans

- **Free**: 0€, 5GB storage, 1000 API calls/month
- **Starter**: 9€/month, 25GB storage, 10000 API calls/month
- **Pro**: 29€/month, 100GB storage, 100000 API calls/month
- **Enterprise**: Custom pricing

## Usage

### Pricing Table

```tsx
import { PricingTable } from "@giga-pdf/billing";

function PricingPage() {
  const handleSelectPlan = (planId) => {
    // Handle plan selection
  };

  return (
    <PricingTable
      currentPlan="free"
      onSelectPlan={handleSelectPlan}
    />
  );
}
```

### Checkout Flow

```tsx
import { CheckoutButton } from "@giga-pdf/billing";

function SubscribeButton() {
  return (
    <CheckoutButton
      planId="starter"
      successUrl="/billing/success"
      cancelUrl="/billing"
      trialDays={14}
      className="btn-primary"
    >
      Start Free Trial
    </CheckoutButton>
  );
}
```

### Billing Portal

```tsx
import { BillingPortalButton } from "@giga-pdf/billing";

function ManageBilling({ customerId }) {
  return (
    <BillingPortalButton
      customerId={customerId}
      returnUrl="/billing"
      className="btn-secondary"
    >
      Manage Billing
    </BillingPortalButton>
  );
}
```

### Subscription Status

```tsx
import { SubscriptionStatus } from "@giga-pdf/billing";

function BillingDashboard() {
  return (
    <div>
      <SubscriptionStatus />
    </div>
  );
}
```

### Usage Meter

```tsx
import { UsageMeter } from "@giga-pdf/billing";

function UsageTracking({ usage }) {
  return (
    <UsageMeter
      usage={{
        apiCalls: { used: 500, limit: 1000, percentage: 50 },
        storage: { usedGb: 2.5, limitGb: 5, percentage: 50 },
        periodStart: "2025-01-01",
        periodEnd: "2025-02-01",
      }}
    />
  );
}
```

### Invoice List

```tsx
import { InvoiceList } from "@giga-pdf/billing";

function InvoicesPage() {
  return <InvoiceList />;
}
```

### Payment Form (Embedded)

```tsx
import { PaymentForm } from "@giga-pdf/billing";

function CheckoutPage({ clientSecret }) {
  return (
    <PaymentForm
      clientSecret={clientSecret}
      onSuccess={() => console.log("Payment successful")}
      onError={(error) => console.error("Payment failed", error)}
    />
  );
}
```

### Using Hooks

```tsx
import { useSubscription, useCheckout, useInvoices } from "@giga-pdf/billing";

function MyComponent() {
  const { data: subscription, isLoading } = useSubscription();
  const { createCheckoutSession } = useCheckout();
  const { data: invoices } = useInvoices();

  // Use the data
}
```

## API Endpoints Required

Your backend should implement these endpoints:

- `GET /api/billing/subscription` - Get current subscription
- `POST /api/billing/subscription/cancel` - Cancel subscription
- `POST /api/billing/subscription/resume` - Resume subscription
- `POST /api/billing/checkout` - Create checkout session
- `POST /api/billing/portal` - Create portal session
- `GET /api/billing/invoices` - List invoices
- `GET /api/billing/invoices/:id` - Get invoice details

## Type Definitions

```typescript
interface SubscriptionStatus {
  status: "active" | "canceled" | "past_due" | "unpaid" | "incomplete" | "trialing" | "none";
  currentPlan: PlanId;
  billingCycle?: "monthly" | "yearly";
  currentPeriodEnd?: string;
  cancelAtPeriodEnd?: boolean;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
}

interface UsageMetrics {
  apiCalls: {
    used: number;
    limit: number;
    percentage: number;
  };
  storage: {
    usedGb: number;
    limitGb: number;
    percentage: number;
  };
  periodStart: string;
  periodEnd: string;
}
```

## License

Private
