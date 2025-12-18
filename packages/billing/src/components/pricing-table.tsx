import { Check } from "lucide-react";
import { PLANS, formatPrice, formatStorage, formatApiCalls } from "../plans";
import type { PlanId } from "../types";

interface PricingTableProps {
  currentPlan?: PlanId;
  onSelectPlan: (planId: PlanId) => void;
  className?: string;
}

export function PricingTable({ currentPlan, onSelectPlan, className }: PricingTableProps) {
  const plans = Object.values(PLANS);

  return (
    <div className={className}>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        {plans.map((plan) => {
          const isCurrent = currentPlan === plan.id;
          const isEnterprise = plan.id === "enterprise";

          return (
            <div
              key={plan.id}
              className={`relative flex flex-col rounded-lg border p-6 shadow-sm transition-all hover:shadow-md ${
                plan.popular
                  ? "border-blue-500 ring-2 ring-blue-500 ring-offset-2"
                  : "border-gray-200"
              } ${isCurrent ? "bg-blue-50" : "bg-white"}`}
            >
              {plan.popular && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2 rounded-full bg-blue-500 px-4 py-1 text-xs font-semibold text-white">
                  Most Popular
                </div>
              )}

              {isCurrent && (
                <div className="absolute -top-4 right-4 rounded-full bg-green-500 px-3 py-1 text-xs font-semibold text-white">
                  Current Plan
                </div>
              )}

              <div className="mb-4">
                <h3 className="text-xl font-bold text-gray-900">{plan.name}</h3>
                <p className="mt-2 text-sm text-gray-600">{plan.description}</p>
              </div>

              <div className="mb-6">
                <div className="flex items-baseline">
                  <span className="text-4xl font-bold text-gray-900">
                    {formatPrice(plan.price, plan.currency)}
                  </span>
                  {plan.price > 0 && (
                    <span className="ml-2 text-gray-600">/{plan.interval}</span>
                  )}
                </div>
              </div>

              <ul className="mb-8 flex-1 space-y-3">
                <li className="flex items-start">
                  <Check className="mr-2 h-5 w-5 flex-shrink-0 text-green-500" />
                  <span className="text-sm text-gray-700">
                    {formatStorage(plan.features.storageGb)} storage
                  </span>
                </li>
                <li className="flex items-start">
                  <Check className="mr-2 h-5 w-5 flex-shrink-0 text-green-500" />
                  <span className="text-sm text-gray-700">
                    {formatApiCalls(plan.features.apiCallsPerMonth)} API calls/month
                  </span>
                </li>
                {plan.features.customBranding && (
                  <li className="flex items-start">
                    <Check className="mr-2 h-5 w-5 flex-shrink-0 text-green-500" />
                    <span className="text-sm text-gray-700">Custom branding</span>
                  </li>
                )}
                {plan.features.prioritySupport && (
                  <li className="flex items-start">
                    <Check className="mr-2 h-5 w-5 flex-shrink-0 text-green-500" />
                    <span className="text-sm text-gray-700">Priority support</span>
                  </li>
                )}
                {plan.features.sla && (
                  <li className="flex items-start">
                    <Check className="mr-2 h-5 w-5 flex-shrink-0 text-green-500" />
                    <span className="text-sm text-gray-700">99.9% SLA</span>
                  </li>
                )}
                {plan.features.dedicatedAccount && (
                  <li className="flex items-start">
                    <Check className="mr-2 h-5 w-5 flex-shrink-0 text-green-500" />
                    <span className="text-sm text-gray-700">Dedicated account manager</span>
                  </li>
                )}
              </ul>

              <button
                onClick={() => onSelectPlan(plan.id)}
                disabled={isCurrent && !isEnterprise}
                className={`w-full rounded-lg px-4 py-2 font-semibold transition-colors ${
                  plan.popular || isCurrent
                    ? "bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-400"
                    : "bg-gray-900 text-white hover:bg-gray-800 disabled:bg-gray-400"
                } disabled:cursor-not-allowed`}
              >
                {isCurrent && !isEnterprise ? "Current Plan" : plan.cta}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
