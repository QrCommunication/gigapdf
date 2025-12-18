import { useState } from "react";
import { Elements, PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";
import { Loader2 } from "lucide-react";
import { getStripe } from "../stripe-client";

interface PaymentFormContentProps {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

function PaymentFormContent({ onSuccess, onError }: PaymentFormContentProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setIsProcessing(true);
    setErrorMessage(null);

    try {
      const { error } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/billing/success`,
        },
      });

      if (error) {
        setErrorMessage(error.message || "An error occurred");
        onError?.(new Error(error.message));
      } else {
        onSuccess?.();
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error("An unknown error occurred");
      setErrorMessage(error.message);
      onError?.(error);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <PaymentElement />

      {errorMessage && (
        <div className="rounded-md bg-red-50 p-4">
          <p className="text-sm text-red-800">{errorMessage}</p>
        </div>
      )}

      <button
        type="submit"
        disabled={!stripe || isProcessing}
        className="w-full rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400"
      >
        {isProcessing ? (
          <span className="flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            Processing...
          </span>
        ) : (
          "Pay now"
        )}
      </button>
    </form>
  );
}

interface PaymentFormProps {
  clientSecret: string;
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

export function PaymentForm({ clientSecret, onSuccess, onError }: PaymentFormProps) {
  const stripePromise = getStripe();

  return (
    <Elements
      stripe={stripePromise}
      options={{
        clientSecret,
        appearance: {
          theme: "stripe",
          variables: {
            colorPrimary: "#2563eb",
          },
        },
      }}
    >
      <PaymentFormContent onSuccess={onSuccess} onError={onError} />
    </Elements>
  );
}
