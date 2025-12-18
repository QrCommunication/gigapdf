"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, Skeleton } from "@giga-pdf/ui";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@giga-pdf/ui";
import { Badge } from "@giga-pdf/ui";
import { Check, CreditCard, Download, ExternalLink, Loader2, Trash2 } from "lucide-react";
import { api, Plan, QuotaSummary, Subscription, PaymentMethod, Invoice } from "@/lib/api";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 0,
  }).format(amount / 100); // Stripe amounts are in cents
}

export default function BillingPage() {
  const t = useTranslations("billing");
  const tCommon = useTranslations("common");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [quota, setQuota] = useState<QuotaSummary | null>(null);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const formatPrice = (price: number, currency: string, interval: string): string => {
    const formatted = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
      minimumFractionDigits: 0,
    }).format(price);

    if (price === 0) return t("free");
    return `${formatted}/${interval === "month" ? "mo" : interval}`;
  };

  useEffect(() => {
    loadBillingData();
  }, []);

  const loadBillingData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [plansResponse, quotaResponse, subscriptionResponse, paymentMethodsResponse, invoicesResponse] = await Promise.all([
        api.getPlans().catch(() => []),
        api.getQuota().catch(() => null),
        api.getSubscription().catch(() => null),
        api.getPaymentMethods().catch(() => []),
        api.getInvoices(5).catch(() => []),
      ]);

      setPlans(plansResponse || []);
      setQuota(quotaResponse);
      setSubscription(subscriptionResponse);
      setPaymentMethods(paymentMethodsResponse || []);
      setInvoices(invoicesResponse || []);
    } catch (err) {
      console.error("Failed to load billing data:", err);
      setError(tCommon("error"));
    } finally {
      setLoading(false);
    }
  };

  const handleUpgrade = async (planSlug: string) => {
    try {
      setActionLoading(`upgrade-${planSlug}`);

      // If in trial or no subscription, we can update directly
      if (subscription?.is_in_trial || !subscription?.status || subscription?.status === "none") {
        // Start trial or update subscription
        if (!subscription?.has_used_trial && planSlug !== "free") {
          await api.startTrial(planSlug);
        } else {
          // Create checkout session for new subscription
          const session = await api.createCheckoutSession(
            planSlug,
            `${window.location.origin}/billing?success=true`,
            `${window.location.origin}/billing?canceled=true`
          );
          window.location.href = session.url;
          return;
        }
      } else {
        // Update existing subscription
        await api.updateSubscription(planSlug);
      }

      await loadBillingData();
    } catch (err) {
      console.error("Failed to upgrade:", err);
      setError(err instanceof Error ? err.message : "Failed to upgrade");
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancelSubscription = async () => {
    if (!confirm(t("confirmCancel"))) return;

    try {
      setActionLoading("cancel");
      await api.cancelSubscription(false);
      await loadBillingData();
    } catch (err) {
      console.error("Failed to cancel:", err);
      setError(err instanceof Error ? err.message : "Failed to cancel");
    } finally {
      setActionLoading(null);
    }
  };

  const handleReactivate = async () => {
    try {
      setActionLoading("reactivate");
      await api.reactivateSubscription();
      await loadBillingData();
    } catch (err) {
      console.error("Failed to reactivate:", err);
      setError(err instanceof Error ? err.message : "Failed to reactivate");
    } finally {
      setActionLoading(null);
    }
  };

  const handleManagePaymentMethods = async () => {
    try {
      setActionLoading("portal");
      const session = await api.createBillingPortalSession(
        `${window.location.origin}/billing`
      );
      window.location.href = session.url;
    } catch (err) {
      console.error("Failed to open portal:", err);
      setError(err instanceof Error ? err.message : "Failed to open billing portal");
      setActionLoading(null);
    }
  };

  const handleRemovePaymentMethod = async (paymentMethodId: string) => {
    if (!confirm(t("confirmRemovePaymentMethod"))) return;

    try {
      setActionLoading(`remove-${paymentMethodId}`);
      await api.removePaymentMethod(paymentMethodId);
      await loadBillingData();
    } catch (err) {
      console.error("Failed to remove payment method:", err);
      setError(err instanceof Error ? err.message : "Failed to remove payment method");
    } finally {
      setActionLoading(null);
    }
  };

  const handleSetDefaultPaymentMethod = async (paymentMethodId: string) => {
    try {
      setActionLoading(`default-${paymentMethodId}`);
      await api.setDefaultPaymentMethod(paymentMethodId);
      await loadBillingData();
    } catch (err) {
      console.error("Failed to set default:", err);
      setError(err instanceof Error ? err.message : "Failed to set default payment method");
    } finally {
      setActionLoading(null);
    }
  };

  const currentPlanSlug = subscription?.current_plan || quota?.plan?.type || "free";

  const getPlanFeatures = (plan: Plan): string[] => {
    const features: string[] = [];

    // Storage
    const storageGB = plan.storage_limit_bytes / (1024 * 1024 * 1024);
    features.push(`${storageGB >= 1 ? storageGB + "GB" : plan.storage_limit_bytes / (1024 * 1024) + "MB"} ${t("storage").toLowerCase()}`);

    // Documents
    if (plan.document_limit === -1) {
      features.push("Unlimited documents");
    } else {
      features.push(`Up to ${plan.document_limit} documents`);
    }

    // API calls
    if (plan.api_calls_limit === -1) {
      features.push("Unlimited API calls");
    } else {
      features.push(`${plan.api_calls_limit.toLocaleString()} API calls/month`);
    }

    // Additional features from plan.features
    if (plan.features) {
      Object.entries(plan.features).forEach(([key, value]) => {
        if (value === true) {
          const readable = key
            .replace(/_/g, " ")
            .replace(/\b\w/g, (l) => l.toUpperCase());
          features.push(readable);
        }
      });
    }

    return features;
  };

  if (loading) {
    return (
      <div className="space-y-8">
        <div>
          <Skeleton className="h-9 w-64" />
          <Skeleton className="mt-2 h-5 w-96" />
        </div>
        <Skeleton className="h-32" />
        <div>
          <Skeleton className="mb-6 h-8 w-48" />
          <div className="grid gap-6 md:grid-cols-3">
            <Skeleton className="h-80" />
            <Skeleton className="h-80" />
            <Skeleton className="h-80" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">{t("title")}</h1>
        <p className="text-muted-foreground">
          {t("subtitle")}
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Subscription Status Card */}
      <Card>
        <CardHeader>
          <CardTitle>{t("currentPlan")}</CardTitle>
          <CardDescription>
            {subscription?.billing_entity_type === "tenant"
              ? t("managedByOrganization")
              : t("currentPlanDescription", { plan: subscription?.plan_name || quota?.plan?.name || t("free") })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <p className="text-2xl font-bold">{subscription?.plan_name || quota?.plan?.name || t("free")}</p>
                {subscription?.is_in_trial && (
                  <Badge variant="secondary">
                    {t("trialDaysRemaining", { days: subscription.trial_days_remaining })}
                  </Badge>
                )}
                {subscription?.cancel_at_period_end && (
                  <Badge variant="destructive">{t("cancelingAtPeriodEnd")}</Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">
                {quota?.documents.count ?? 0} / {quota?.documents.limit === -1 ? "∞" : quota?.documents.limit ?? 5} documents
                {" • "}
                {formatBytes(quota?.storage.used_bytes ?? 0)} / {formatBytes(quota?.storage.limit_bytes ?? 1073741824)} {t("storage").toLowerCase()}
              </p>
              {subscription?.current_period_end && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {subscription.cancel_at_period_end
                    ? t("accessUntil", { date: new Date(subscription.current_period_end).toLocaleDateString() })
                    : t("renewsOn", { date: new Date(subscription.current_period_end).toLocaleDateString() })}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              {subscription?.cancel_at_period_end && (
                <Button
                  variant="outline"
                  onClick={handleReactivate}
                  disabled={actionLoading === "reactivate"}
                >
                  {actionLoading === "reactivate" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  {t("reactivateSubscription")}
                </Button>
              )}
              {subscription?.status === "active" && !subscription.cancel_at_period_end && (
                <Button
                  variant="destructive"
                  onClick={handleCancelSubscription}
                  disabled={actionLoading === "cancel"}
                >
                  {actionLoading === "cancel" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  {t("cancelSubscription")}
                </Button>
              )}
            </div>
          </div>

          {/* Usage bars */}
          <div className="mt-6 space-y-4">
            <div>
              <div className="mb-1 flex justify-between text-sm">
                <span>{t("storage")}</span>
                <span>{quota?.storage.percentage ?? 0}%</span>
              </div>
              <div className="h-2 rounded-full bg-muted">
                <div
                  className="h-2 rounded-full bg-primary transition-all"
                  style={{ width: `${Math.min(quota?.storage.percentage ?? 0, 100)}%` }}
                />
              </div>
            </div>
            <div>
              <div className="mb-1 flex justify-between text-sm">
                <span>{t("apiCalls")} ({t("resetsOn", { date: quota?.api_calls.resets_at ? new Date(quota.api_calls.resets_at).toLocaleDateString() : t("resetsMonthly") })})</span>
                <span>{quota?.api_calls.percentage ?? 0}%</span>
              </div>
              <div className="h-2 rounded-full bg-muted">
                <div
                  className="h-2 rounded-full bg-primary transition-all"
                  style={{ width: `${Math.min(quota?.api_calls.percentage ?? 0, 100)}%` }}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Available Plans */}
      <div>
        <h2 className="mb-6 text-2xl font-bold">{t("availablePlans")}</h2>
        {plans.length === 0 ? (
          <p className="text-muted-foreground">{t("noPlans")}</p>
        ) : (
          <div className="grid gap-6 md:grid-cols-3">
            {plans
              .filter((plan) => plan.is_active)
              .sort((a, b) => a.display_order - b.display_order)
              .map((plan) => {
                const isCurrentPlan = plan.slug === currentPlanSlug;
                const features = getPlanFeatures(plan);
                const isUpgrade = plan.price > (plans.find((p) => p.slug === currentPlanSlug)?.price ?? 0);
                const isDowngrade = plan.price < (plans.find((p) => p.slug === currentPlanSlug)?.price ?? 0);

                return (
                  <Card
                    key={plan.id}
                    className={plan.is_popular ? "border-primary shadow-lg" : ""}
                  >
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle>{plan.name}</CardTitle>
                        {plan.is_popular && <Badge>{t("popular")}</Badge>}
                      </div>
                      <CardDescription>
                        <span className="text-3xl font-bold">
                          {formatPrice(plan.price, plan.currency, plan.interval)}
                        </span>
                        {plan.price > 0 && (
                          <span className="text-muted-foreground">
                            /{plan.interval === "month" ? "month" : plan.interval}
                          </span>
                        )}
                      </CardDescription>
                      {plan.description && (
                        <p className="mt-2 text-sm text-muted-foreground">
                          {plan.description}
                        </p>
                      )}
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <ul className="space-y-2">
                        {features.map((feature) => (
                          <li key={feature} className="flex items-start gap-2">
                            <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" />
                            <span className="text-sm">{feature}</span>
                          </li>
                        ))}
                      </ul>
                      <Button
                        className="w-full"
                        variant={plan.is_popular && !isCurrentPlan ? "default" : "outline"}
                        disabled={isCurrentPlan || actionLoading === `upgrade-${plan.slug}` || subscription?.billing_entity_type === "tenant"}
                        onClick={() => handleUpgrade(plan.slug)}
                      >
                        {actionLoading === `upgrade-${plan.slug}` ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : null}
                        {isCurrentPlan
                          ? t("currentPlan")
                          : subscription?.billing_entity_type === "tenant"
                          ? t("managedByOrganization")
                          : isUpgrade
                          ? t("upgrade")
                          : isDowngrade
                          ? t("downgrade")
                          : plan.cta_text || (plan.price === 0 ? t("getStarted") : t("upgrade"))}
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
          </div>
        )}
      </div>

      {/* Payment Methods */}
      <Card>
        <CardHeader>
          <CardTitle>{t("paymentMethod")}</CardTitle>
          <CardDescription>{t("paymentMethodDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          {subscription?.billing_entity_type === "tenant" ? (
            <p className="text-sm text-muted-foreground">
              {t("paymentManagedByOrganization")}
            </p>
          ) : paymentMethods.length === 0 ? (
            <div>
              <p className="text-sm text-muted-foreground">
                {t("noPaymentMethod")}
              </p>
              <Button
                className="mt-4"
                variant="outline"
                onClick={handleManagePaymentMethods}
                disabled={actionLoading === "portal"}
              >
                {actionLoading === "portal" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CreditCard className="mr-2 h-4 w-4" />
                )}
                {t("addPaymentMethod")}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {paymentMethods.map((method) => (
                <div
                  key={method.id}
                  className="flex items-center justify-between rounded-lg border p-4"
                >
                  <div className="flex items-center gap-3">
                    <CreditCard className="h-8 w-8 text-muted-foreground" />
                    <div>
                      <p className="font-medium">
                        {method.card?.brand.toUpperCase()} •••• {method.card?.last4}
                        {method.is_default && (
                          <Badge variant="secondary" className="ml-2">
                            {t("default")}
                          </Badge>
                        )}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {t("expires")} {method.card?.exp_month}/{method.card?.exp_year}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {!method.is_default && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleSetDefaultPaymentMethod(method.id)}
                        disabled={actionLoading === `default-${method.id}`}
                      >
                        {actionLoading === `default-${method.id}` ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          t("setDefault")
                        )}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemovePaymentMethod(method.id)}
                      disabled={actionLoading === `remove-${method.id}` || method.is_default}
                    >
                      {actionLoading === `remove-${method.id}` ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
              ))}
              <Button
                variant="outline"
                onClick={handleManagePaymentMethods}
                disabled={actionLoading === "portal"}
              >
                {actionLoading === "portal" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <ExternalLink className="mr-2 h-4 w-4" />
                )}
                {t("manageBillingPortal")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Billing History / Invoices */}
      <Card>
        <CardHeader>
          <CardTitle>{t("billingHistory")}</CardTitle>
          <CardDescription>{t("billingHistoryDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          {invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("noBillingHistory")}
            </p>
          ) : (
            <div className="space-y-2">
              {invoices.map((invoice) => (
                <div
                  key={invoice.id}
                  className="flex items-center justify-between rounded-lg border p-4"
                >
                  <div>
                    <p className="font-medium">{invoice.number}</p>
                    <p className="text-sm text-muted-foreground">
                      {new Date(invoice.created).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <p className="font-medium">
                        {formatCurrency(invoice.amount_paid, invoice.currency)}
                      </p>
                      <Badge
                        variant={invoice.status === "paid" ? "default" : "secondary"}
                      >
                        {invoice.status}
                      </Badge>
                    </div>
                    {invoice.pdf_url && (
                      <Button variant="ghost" size="sm" asChild>
                        <a href={invoice.pdf_url} target="_blank" rel="noopener noreferrer">
                          <Download className="h-4 w-4" />
                        </a>
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
