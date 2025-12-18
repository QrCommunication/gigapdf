import { loadStripe, Stripe } from "@stripe/stripe-js";

/**
 * Singleton Stripe.js instance.
 */
let stripePromise: Promise<Stripe | null> | null = null;

/**
 * Get or initialize Stripe.js instance.
 */
export function getStripe(): Promise<Stripe | null> {
  if (!stripePromise) {
    const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;

    if (!publishableKey) {
      console.error("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not defined");
      return Promise.resolve(null);
    }

    stripePromise = loadStripe(publishableKey, {
      locale: "fr",
    });
  }

  return stripePromise;
}

/**
 * Reset Stripe instance (useful for testing).
 */
export function resetStripe(): void {
  stripePromise = null;
}
