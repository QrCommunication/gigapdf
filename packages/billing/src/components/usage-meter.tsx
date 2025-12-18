import { HardDrive, Activity, TrendingUp } from "lucide-react";
import { formatStorage, formatApiCalls } from "../plans";
import type { UsageMetrics } from "../types";

interface UsageMeterProps {
  usage: UsageMetrics;
  className?: string;
}

export function UsageMeter({ usage, className }: UsageMeterProps) {
  return (
    <div className={`space-y-6 ${className}`}>
      {/* API Calls Usage */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-blue-100 p-3">
              <Activity className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">API Calls</h3>
              <p className="text-sm text-gray-600">
                {formatApiCalls(usage.apiCalls.used)} of {formatApiCalls(usage.apiCalls.limit)} used
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-gray-900">
              {usage.apiCalls.percentage.toFixed(0)}%
            </p>
            <p className="text-sm text-gray-600">used</p>
          </div>
        </div>

        <div className="overflow-hidden rounded-full bg-gray-200">
          <div
            className={`h-3 rounded-full transition-all ${
              usage.apiCalls.percentage >= 90
                ? "bg-red-500"
                : usage.apiCalls.percentage >= 75
                ? "bg-orange-500"
                : "bg-blue-500"
            }`}
            style={{ width: `${Math.min(usage.apiCalls.percentage, 100)}%` }}
          />
        </div>

        {usage.apiCalls.percentage >= 80 && (
          <div className="mt-3 rounded-md bg-orange-50 p-3">
            <p className="text-sm text-orange-800">
              {usage.apiCalls.percentage >= 90
                ? "You're approaching your API call limit. Consider upgrading your plan."
                : "You've used more than 80% of your API calls."}
            </p>
          </div>
        )}
      </div>

      {/* Storage Usage */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-purple-100 p-3">
              <HardDrive className="h-6 w-6 text-purple-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">Storage</h3>
              <p className="text-sm text-gray-600">
                {usage.storage.usedGb.toFixed(2)} GB of {formatStorage(usage.storage.limitGb)} used
              </p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-gray-900">
              {usage.storage.percentage.toFixed(0)}%
            </p>
            <p className="text-sm text-gray-600">used</p>
          </div>
        </div>

        <div className="overflow-hidden rounded-full bg-gray-200">
          <div
            className={`h-3 rounded-full transition-all ${
              usage.storage.percentage >= 90
                ? "bg-red-500"
                : usage.storage.percentage >= 75
                ? "bg-orange-500"
                : "bg-purple-500"
            }`}
            style={{ width: `${Math.min(usage.storage.percentage, 100)}%` }}
          />
        </div>

        {usage.storage.percentage >= 80 && (
          <div className="mt-3 rounded-md bg-orange-50 p-3">
            <p className="text-sm text-orange-800">
              {usage.storage.percentage >= 90
                ? "You're running out of storage space. Consider upgrading your plan."
                : "You've used more than 80% of your storage."}
            </p>
          </div>
        )}
      </div>

      {/* Billing Period */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-green-100 p-3">
            <TrendingUp className="h-6 w-6 text-green-600" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">Current Billing Period</h3>
            <p className="text-sm text-gray-600">
              {new Date(usage.periodStart).toLocaleDateString()} -{" "}
              {new Date(usage.periodEnd).toLocaleDateString()}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
