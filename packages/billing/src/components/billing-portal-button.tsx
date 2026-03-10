import { Loader2, Settings } from "lucide-react";
import { useBillingPortal } from "../hooks";

interface BillingPortalButtonProps {
  customerId: string;
  returnUrl?: string;
  children?: React.ReactNode;
  className?: string;
  disabled?: boolean;
}

export function BillingPortalButton({
  customerId,
  returnUrl = window.location.origin + "/billing",
  children,
  className = "",
  disabled = false,
}: BillingPortalButtonProps) {
  const { openBillingPortal, isLoading, error } = useBillingPortal();

  const handleClick = async () => {
    try {
      await openBillingPortal({
        customerId,
        returnUrl,
      });
    } catch (err) {
      console.error("Billing portal error:", err);
    }
  };

  return (
    <>
      <button
        onClick={handleClick}
        disabled={disabled || isLoading || !customerId}
        className={`inline-flex items-center justify-center gap-2 ${className}`}
      >
        {isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Settings className="h-4 w-4" />
        )}
        {children || "Manage Billing"}
      </button>
      {error && (
        <p className="mt-2 text-sm text-red-600">
          {error.message}
        </p>
      )}
    </>
  );
}
