# Usage Examples

## Setup in Next.js App

### 1. Environment Variables

Add to your `.env.local`:

```env
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...
NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID=price_...
NEXT_PUBLIC_STRIPE_PRO_PRICE_ID=price_...
```

### 2. Install Dependencies

The billing package is already part of the monorepo. Just import it:

```tsx
import { PricingTable, useSubscription } from "@giga-pdf/billing";
```

### 3. Wrap Your App with Query Provider

```tsx
// app/layout.tsx or pages/_app.tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient();

export default function RootLayout({ children }) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
```

## Complete Pricing Page Example

```tsx
// app/pricing/page.tsx
"use client";

import { useRouter } from "next/navigation";
import { PricingTable, useCheckout } from "@giga-pdf/billing";

export default function PricingPage() {
  const router = useRouter();
  const { createCheckoutSession } = useCheckout();

  const handleSelectPlan = async (planId: string) => {
    if (planId === "free") {
      router.push("/signup");
      return;
    }

    if (planId === "enterprise") {
      router.push("/contact-sales");
      return;
    }

    // Redirect to Stripe Checkout
    await createCheckoutSession({
      planId,
      successUrl: `${window.location.origin}/billing/success`,
      cancelUrl: `${window.location.origin}/pricing`,
      trialDays: 14,
    });
  };

  return (
    <div className="container mx-auto py-12">
      <div className="mb-12 text-center">
        <h1 className="text-4xl font-bold">Choose Your Plan</h1>
        <p className="mt-4 text-xl text-gray-600">
          Select the perfect plan for your needs
        </p>
      </div>

      <PricingTable onSelectPlan={handleSelectPlan} />
    </div>
  );
}
```

## Billing Dashboard Example

```tsx
// app/billing/page.tsx
"use client";

import {
  SubscriptionStatusBadge,
  UsageMeter,
  InvoiceList,
  BillingPortalButton,
  useSubscription,
} from "@giga-pdf/billing";

export default function BillingPage() {
  const { data: subscription } = useSubscription();

  return (
    <div className="container mx-auto py-12">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-3xl font-bold">Billing & Usage</h1>
        {subscription?.stripeCustomerId && (
          <BillingPortalButton
            customerId={subscription.stripeCustomerId}
            className="rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
          />
        )}
      </div>

      <div className="space-y-8">
        {/* Subscription Status */}
        <SubscriptionStatusBadge />

        {/* Usage Metrics */}
        <UsageMeter
          usage={{
            apiCalls: {
              used: 5423,
              limit: 10000,
              percentage: 54.23,
            },
            storage: {
              usedGb: 12.5,
              limitGb: 25,
              percentage: 50,
            },
            periodStart: "2025-12-01",
            periodEnd: "2026-01-01",
          }}
        />

        {/* Invoices */}
        <InvoiceList />
      </div>
    </div>
  );
}
```

## Backend API Endpoints

You need to implement these endpoints in your backend:

### 1. Get Subscription Status

```tsx
// app/api/billing/subscription/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2023-10-16",
});

export async function GET() {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get user's Stripe customer ID from database
  const user = await getUserFromDb(session.user.id);

  if (!user.stripeCustomerId) {
    return NextResponse.json({
      status: "none",
      currentPlan: "free",
    });
  }

  // Get subscriptions from Stripe
  const subscriptions = await stripe.subscriptions.list({
    customer: user.stripeCustomerId,
    status: "all",
    limit: 1,
  });

  const subscription = subscriptions.data[0];

  if (!subscription) {
    return NextResponse.json({
      status: "none",
      currentPlan: "free",
    });
  }

  return NextResponse.json({
    status: subscription.status,
    currentPlan: getPlanIdFromPriceId(subscription.items.data[0].price.id),
    billingCycle: subscription.items.data[0].price.recurring?.interval,
    currentPeriodEnd: new Date(subscription.current_period_end * 1000).toISOString(),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    stripeCustomerId: user.stripeCustomerId,
    stripeSubscriptionId: subscription.id,
  });
}
```

### 2. Create Checkout Session

```tsx
// app/api/billing/checkout/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2023-10-16",
});

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { planId, successUrl, cancelUrl, trialDays } = await req.json();

  const priceId = getPriceIdFromPlanId(planId);
  const user = await getUserFromDb(session.user.id);

  const checkoutSession = await stripe.checkout.sessions.create({
    customer: user.stripeCustomerId,
    customer_email: user.stripeCustomerId ? undefined : user.email,
    mode: "subscription",
    payment_method_types: ["card"],
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    subscription_data: trialDays
      ? {
          trial_period_days: trialDays,
        }
      : undefined,
    metadata: {
      userId: session.user.id,
      planId,
    },
  });

  return NextResponse.json({ sessionId: checkoutSession.id });
}
```

### 3. Create Portal Session

```tsx
// app/api/billing/portal/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2023-10-16",
});

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { customerId, returnUrl } = await req.json();

  const portalSession = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });

  return NextResponse.json({ url: portalSession.url });
}
```

### 4. Get Invoices

```tsx
// app/api/billing/invoices/route.ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2023-10-16",
});

export async function GET() {
  const session = await getServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await getUserFromDb(session.user.id);

  if (!user.stripeCustomerId) {
    return NextResponse.json([]);
  }

  const invoices = await stripe.invoices.list({
    customer: user.stripeCustomerId,
    limit: 100,
  });

  return NextResponse.json(
    invoices.data.map((invoice) => ({
      id: invoice.id,
      number: invoice.number,
      status: invoice.status,
      amountDue: invoice.amount_due,
      amountPaid: invoice.amount_paid,
      currency: invoice.currency,
      created: new Date(invoice.created * 1000).toISOString(),
      dueDate: invoice.due_date
        ? new Date(invoice.due_date * 1000).toISOString()
        : undefined,
      pdfUrl: invoice.invoice_pdf,
      hostedInvoiceUrl: invoice.hosted_invoice_url,
    }))
  );
}
```

## Stripe Webhook Handler

```tsx
// app/api/webhooks/stripe/route.ts
import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2023-10-16",
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

export async function POST(req: NextRequest) {
  const body = await req.text();
  const signature = req.headers.get("stripe-signature")!;

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
      const subscription = event.data.object as Stripe.Subscription;
      await updateUserSubscription(subscription);
      break;

    case "customer.subscription.deleted":
      const deletedSub = event.data.object as Stripe.Subscription;
      await handleSubscriptionDeleted(deletedSub);
      break;

    case "invoice.paid":
      const invoice = event.data.object as Stripe.Invoice;
      await handleInvoicePaid(invoice);
      break;

    case "invoice.payment_failed":
      const failedInvoice = event.data.object as Stripe.Invoice;
      await handlePaymentFailed(failedInvoice);
      break;
  }

  return NextResponse.json({ received: true });
}
```

## Using with Custom Payment Flow

```tsx
// app/checkout/page.tsx
"use client";

import { useState } from "react";
import { PaymentForm } from "@giga-pdf/billing";

export default function CheckoutPage() {
  const [clientSecret, setClientSecret] = useState<string | null>(null);

  // Create payment intent on mount
  useEffect(() => {
    fetch("/api/billing/create-payment-intent", {
      method: "POST",
      body: JSON.stringify({ planId: "starter" }),
    })
      .then((res) => res.json())
      .then((data) => setClientSecret(data.clientSecret));
  }, []);

  if (!clientSecret) {
    return <div>Loading...</div>;
  }

  return (
    <div className="container mx-auto max-w-md py-12">
      <h1 className="mb-8 text-2xl font-bold">Complete Your Payment</h1>
      <PaymentForm
        clientSecret={clientSecret}
        onSuccess={() => {
          window.location.href = "/billing/success";
        }}
        onError={(error) => {
          console.error("Payment failed:", error);
        }}
      />
    </div>
  );
}
```
