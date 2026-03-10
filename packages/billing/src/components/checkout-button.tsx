import { Loader2 } from "lucide-react";
import { useCheckout } from "../hooks";
import type { PlanId } from "../types";

interface CheckoutButtonProps {
  planId: PlanId;
  children: React.ReactNode;
  successUrl?: string;
  cancelUrl?: string;
  trialDays?: number;
  className?: string;
  disabled?: boolean;
}

export function CheckoutButton({
  planId,
  children,
  successUrl = window.location.origin + "/billing/success",
  cancelUrl = window.location.origin + "/billing",
  trialDays,
  className = "",
  disabled = false,
}: CheckoutButtonProps) {
  const { createCheckoutSession, isLoading, error } = useCheckout();

  const handleClick = async () => {
    try {
      await createCheckoutSession({
        planId,
        successUrl,
        cancelUrl,
        trialDays,
      });
    } catch (err) {
      console.error("Checkout error:", err);
    }
  };

  return (
    <>
      <button
        onClick={handleClick}
        disabled={disabled || isLoading}
        className={`inline-flex items-center justify-center gap-2 ${className}`}
      >
        {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
        {children}
      </button>
      {error && (
        <p className="mt-2 text-sm text-red-600">
          {error.message}
        </p>
      )}
    </>
  );
}
