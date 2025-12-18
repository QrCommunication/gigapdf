import { CheckCircle, XCircle, AlertCircle, Clock } from "lucide-react";
import { useSubscription } from "../hooks";
import { getPlanById } from "../plans";

interface SubscriptionStatusProps {
  className?: string;
}

export function SubscriptionStatus({ className }: SubscriptionStatusProps) {
  const { data: subscription, isLoading, error } = useSubscription();

  if (isLoading) {
    return (
      <div className={`rounded-lg border border-gray-200 bg-white p-4 ${className}`}>
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 animate-pulse rounded-full bg-gray-200" />
          <div className="flex-1">
            <div className="h-4 w-32 animate-pulse rounded bg-gray-200" />
            <div className="mt-2 h-3 w-48 animate-pulse rounded bg-gray-200" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`rounded-lg border border-red-200 bg-red-50 p-4 ${className}`}>
        <div className="flex items-center gap-3">
          <XCircle className="h-10 w-10 text-red-600" />
          <div>
            <p className="font-semibold text-red-900">Error loading subscription</p>
            <p className="text-sm text-red-700">{error.message}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!subscription) {
    return null;
  }

  const plan = getPlanById(subscription.currentPlan);
  const statusConfig = getStatusConfig(subscription.status);

  return (
    <div className={`rounded-lg border p-4 ${statusConfig.bgClass} ${statusConfig.borderClass} ${className}`}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          {statusConfig.icon}
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-gray-900">
                {plan?.name || subscription.currentPlan} Plan
              </h3>
              <span className={`rounded-full px-2 py-1 text-xs font-semibold ${statusConfig.badgeClass}`}>
                {statusConfig.label}
              </span>
            </div>
            <p className="mt-1 text-sm text-gray-600">
              {subscription.status === "active" && subscription.currentPeriodEnd && (
                <>Next billing date: {new Date(subscription.currentPeriodEnd).toLocaleDateString()}</>
              )}
              {subscription.status === "canceled" && subscription.currentPeriodEnd && (
                <>Access until: {new Date(subscription.currentPeriodEnd).toLocaleDateString()}</>
              )}
              {subscription.status === "past_due" && (
                <>Please update your payment method</>
              )}
              {subscription.status === "trialing" && subscription.currentPeriodEnd && (
                <>Trial ends: {new Date(subscription.currentPeriodEnd).toLocaleDateString()}</>
              )}
            </p>
            {subscription.cancelAtPeriodEnd && (
              <p className="mt-1 text-sm font-medium text-orange-600">
                Subscription will cancel at period end
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function getStatusConfig(status: string) {
  switch (status) {
    case "active":
      return {
        label: "Active",
        icon: <CheckCircle className="h-10 w-10 text-green-600" />,
        bgClass: "bg-green-50",
        borderClass: "border-green-200",
        badgeClass: "bg-green-100 text-green-800",
      };
    case "trialing":
      return {
        label: "Trial",
        icon: <Clock className="h-10 w-10 text-blue-600" />,
        bgClass: "bg-blue-50",
        borderClass: "border-blue-200",
        badgeClass: "bg-blue-100 text-blue-800",
      };
    case "canceled":
      return {
        label: "Canceled",
        icon: <XCircle className="h-10 w-10 text-gray-600" />,
        bgClass: "bg-gray-50",
        borderClass: "border-gray-200",
        badgeClass: "bg-gray-100 text-gray-800",
      };
    case "past_due":
    case "unpaid":
      return {
        label: "Past Due",
        icon: <AlertCircle className="h-10 w-10 text-red-600" />,
        bgClass: "bg-red-50",
        borderClass: "border-red-200",
        badgeClass: "bg-red-100 text-red-800",
      };
    case "incomplete":
      return {
        label: "Incomplete",
        icon: <AlertCircle className="h-10 w-10 text-orange-600" />,
        bgClass: "bg-orange-50",
        borderClass: "border-orange-200",
        badgeClass: "bg-orange-100 text-orange-800",
      };
    default:
      return {
        label: "None",
        icon: <XCircle className="h-10 w-10 text-gray-600" />,
        bgClass: "bg-white",
        borderClass: "border-gray-200",
        badgeClass: "bg-gray-100 text-gray-800",
      };
  }
}
