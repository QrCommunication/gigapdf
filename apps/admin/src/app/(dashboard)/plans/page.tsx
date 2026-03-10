"use client";

import { useEffect, useState, useMemo } from "react";
import { useTranslations } from "next-intl";
import { formatBytes, formatCurrency, formatNumber } from "@/lib/utils";
import { plansApi, tenantsApi, type Plan, type CreatePlanData, type UpdatePlanData, type Tenant } from "@/lib/api";
import {
  Check,
  Edit,
  Plus,
  Trash2,
  X,
  Loader2,
  AlertCircle,
  RefreshCw,
  Building2,
  Lock,
  Search,
  Users,
} from "lucide-react";

type FormMode = "closed" | "create" | "edit";

interface PlanFormData {
  slug: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  interval: string;
  storage_limit_gb: number;
  api_calls_limit: number;
  document_limit: number;
  is_active: boolean;
  is_popular: boolean;
  is_tenant_plan: boolean;
  max_members: number;
  linked_tenant_id: string | null;
  display_order: number;
  cta_text: string;
  trial_days: number | null;
  custom_branding: boolean;
  priority_support: boolean;
  sla: boolean;
  dedicated_account: boolean;
}

const defaultFormData: PlanFormData = {
  slug: "",
  name: "",
  description: "",
  price: 0,
  currency: "EUR",
  interval: "month",
  storage_limit_gb: 5,
  api_calls_limit: 1000,
  document_limit: 100,
  is_active: true,
  is_popular: false,
  is_tenant_plan: false,
  max_members: 1,
  linked_tenant_id: null,
  display_order: 0,
  cta_text: "Get Started",
  trial_days: null,
  custom_branding: false,
  priority_support: false,
  sla: false,
  dedicated_account: false,
};

export default function PlansPage() {
  const t = useTranslations("plans");
  const tCommon = useTranslations("common");

  const [plans, setPlans] = useState<Plan[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formMode, setFormMode] = useState<FormMode>("closed");
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [formData, setFormData] = useState<PlanFormData>(defaultFormData);
  const [submitting, setSubmitting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [tenantSearch, setTenantSearch] = useState("");
  const [showTenantDropdown, setShowTenantDropdown] = useState(false);

  // Filter tenants based on search
  const filteredTenants = useMemo(() => {
    if (!tenantSearch) return tenants;
    const search = tenantSearch.toLowerCase();
    return tenants.filter(
      (t) =>
        t.name.toLowerCase().includes(search) ||
        t.slug.toLowerCase().includes(search) ||
        t.email.toLowerCase().includes(search)
    );
  }, [tenants, tenantSearch]);

  // Get selected tenant name
  const selectedTenantName = useMemo(() => {
    if (!formData.linked_tenant_id) return null;
    return tenants.find((t) => t.id === formData.linked_tenant_id)?.name || null;
  }, [tenants, formData.linked_tenant_id]);

  const fetchPlans = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await plansApi.list(true);
      setPlans(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  const fetchTenants = async () => {
    try {
      const response = await tenantsApi.list({ page_size: 100 });
      setTenants(response.tenants);
    } catch (err) {
      console.error("Failed to load tenants:", err);
    }
  };

  useEffect(() => {
    fetchPlans();
    fetchTenants();
  }, []);

  const openCreateForm = () => {
    setFormData(defaultFormData);
    setEditingPlan(null);
    setTenantSearch("");
    setFormMode("create");
  };

  const openEditForm = (plan: Plan) => {
    setFormData({
      slug: plan.slug,
      name: plan.name,
      description: plan.description || "",
      price: plan.price,
      currency: plan.currency,
      interval: plan.interval,
      storage_limit_gb: plan.storage_limit_bytes / (1024 * 1024 * 1024),
      api_calls_limit: plan.api_calls_limit,
      document_limit: plan.document_limit,
      is_active: plan.is_active,
      is_popular: plan.is_popular,
      is_tenant_plan: plan.is_tenant_plan,
      max_members: plan.max_members,
      linked_tenant_id: plan.linked_tenant_id,
      display_order: plan.display_order,
      cta_text: plan.cta_text,
      trial_days: plan.trial_days,
      custom_branding: plan.features?.customBranding || false,
      priority_support: plan.features?.prioritySupport || false,
      sla: plan.features?.sla || false,
      dedicated_account: plan.features?.dedicatedAccount || false,
    });
    setEditingPlan(plan);
    setTenantSearch("");
    setFormMode("edit");
  };

  const closeForm = () => {
    setFormMode("closed");
    setEditingPlan(null);
    setFormData(defaultFormData);
    setTenantSearch("");
    setShowTenantDropdown(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);

    try {
      const apiData: CreatePlanData | UpdatePlanData = {
        name: formData.name,
        description: formData.description || undefined,
        price: formData.price,
        currency: formData.currency,
        interval: formData.interval,
        storage_limit_bytes: formData.storage_limit_gb * 1024 * 1024 * 1024,
        api_calls_limit: formData.api_calls_limit,
        document_limit: formData.document_limit,
        is_active: formData.is_active,
        is_popular: formData.is_popular,
        is_tenant_plan: formData.is_tenant_plan,
        max_members: formData.max_members,
        linked_tenant_id: formData.linked_tenant_id,
        display_order: formData.display_order,
        cta_text: formData.cta_text,
        trial_days: formData.trial_days || undefined,
        features: {
          storageGb: formData.storage_limit_gb,
          apiCallsPerMonth: formData.api_calls_limit,
          customBranding: formData.custom_branding,
          prioritySupport: formData.priority_support,
          sla: formData.sla,
          dedicatedAccount: formData.dedicated_account,
        },
      };

      if (formMode === "create") {
        await plansApi.create({ ...apiData, slug: formData.slug } as CreatePlanData);
      } else if (editingPlan) {
        await plansApi.update(editingPlan.id, apiData);
      }

      await fetchPlans();
      closeForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.saveFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (planId: string) => {
    try {
      await plansApi.delete(planId);
      await fetchPlans();
      setDeleteConfirm(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.deleteFailed"));
    }
  };

  const toggleActive = async (plan: Plan) => {
    try {
      await plansApi.update(plan.id, { is_active: !plan.is_active });
      await fetchPlans();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.updateFailed"));
    }
  };

  // Get tenant name by ID for display
  const getTenantName = (tenantId: string | null) => {
    if (!tenantId) return null;
    return tenants.find((t) => t.id === tenantId)?.name || tenantId;
  };

  if (loading) {
    return (
      <div className="flex h-96 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t("title")}</h1>
          <p className="text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={fetchPlans}
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent flex items-center gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            {t("refresh")}
          </button>
          <button
            onClick={openCreateForm}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            {t("create")}
          </button>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 text-destructive" />
          <p className="text-sm text-destructive">{error}</p>
          <button
            onClick={() => setError(null)}
            className="ml-auto text-destructive hover:text-destructive/80"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Plans Grid */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {plans.map((plan) => (
          <div
            key={plan.id}
            className={`rounded-lg border bg-card p-6 shadow-sm relative ${
              plan.is_popular ? "ring-2 ring-primary" : ""
            } ${!plan.is_active ? "opacity-60" : ""}`}
          >
            {/* Status Badges */}
            <div className="absolute top-3 right-3 flex gap-2 flex-wrap justify-end">
              {!plan.is_active && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  {t("status.inactive")}
                </span>
              )}
              {plan.is_popular && (
                <span className="rounded-full bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground">
                  Popular
                </span>
              )}
              {plan.linked_tenant_id && (
                <span className="rounded-full bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400 px-2 py-0.5 text-xs font-medium flex items-center gap-1">
                  <Lock className="h-3 w-3" />
                  {t("card.privatePlan")}
                </span>
              )}
              {plan.is_tenant_plan && !plan.linked_tenant_id && (
                <span className="rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 px-2 py-0.5 text-xs font-medium flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  {t("card.tenantPlan")}
                </span>
              )}
            </div>

            {/* Plan Info */}
            <div className="mb-4 mt-6">
              <p className="text-xs text-muted-foreground font-mono">
                {plan.slug}
              </p>
              <h3 className="text-xl font-bold">{plan.name}</h3>
              {plan.description && (
                <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                  {plan.description}
                </p>
              )}
              {plan.linked_tenant_id && (
                <p className="text-xs text-orange-600 dark:text-orange-400 mt-2 flex items-center gap-1">
                  <Building2 className="h-3 w-3" />
                  {getTenantName(plan.linked_tenant_id)}
                </p>
              )}
            </div>

            {/* Pricing */}
            <div className="mb-4">
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-bold">
                  {plan.price === 0 ? "Free" : formatCurrency(plan.price, plan.currency)}
                </span>
                {plan.price > 0 && (
                  <span className="text-muted-foreground">/{plan.interval === "month" ? t("interval.perMonth") : t("interval.perYear")}</span>
                )}
              </div>
              {plan.trial_days && (
                <p className="text-xs text-muted-foreground mt-1">
                  {t("card.trial", { days: plan.trial_days })}
                </p>
              )}
            </div>

            {/* Limits */}
            <div className="mb-4 space-y-2 rounded-lg bg-muted p-3">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">{t("card.storage")}</span>
                <span className="font-medium">
                  {plan.storage_limit_bytes < 0
                    ? t("card.unlimited")
                    : formatBytes(plan.storage_limit_bytes)}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">{t("card.apiCalls")}</span>
                <span className="font-medium">
                  {plan.api_calls_limit < 0
                    ? t("card.unlimited")
                    : formatNumber(plan.api_calls_limit)}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">{t("card.documents")}</span>
                <span className="font-medium">
                  {plan.document_limit < 0
                    ? t("card.unlimited")
                    : formatNumber(plan.document_limit)}
                </span>
              </div>
              {plan.is_tenant_plan && plan.max_members > 1 && (
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{t("form.maxMembers")}</span>
                  <span className="font-medium">{plan.max_members}</span>
                </div>
              )}
            </div>

            {/* Features */}
            {plan.features && (
              <ul className="mb-4 space-y-1.5">
                {plan.features.customBranding && (
                  <li className="flex items-center gap-2 text-xs">
                    <Check className="h-3.5 w-3.5 text-primary" />
                    {t("form.customBranding")}
                  </li>
                )}
                {plan.features.prioritySupport && (
                  <li className="flex items-center gap-2 text-xs">
                    <Check className="h-3.5 w-3.5 text-primary" />
                    {t("form.prioritySupport")}
                  </li>
                )}
                {plan.features.sla && (
                  <li className="flex items-center gap-2 text-xs">
                    <Check className="h-3.5 w-3.5 text-primary" />
                    {t("form.slaGuarantee")}
                  </li>
                )}
                {plan.features.dedicatedAccount && (
                  <li className="flex items-center gap-2 text-xs">
                    <Check className="h-3.5 w-3.5 text-primary" />
                    {t("form.dedicatedAccount")}
                  </li>
                )}
              </ul>
            )}

            {/* Actions */}
            <div className="flex gap-2">
              <button
                onClick={() => openEditForm(plan)}
                className="flex-1 rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent flex items-center justify-center gap-2"
              >
                <Edit className="h-4 w-4" />
                {t("card.edit")}
              </button>
              <button
                onClick={() => toggleActive(plan)}
                className={`rounded-md border px-3 py-2 text-sm font-medium hover:bg-accent ${
                  plan.is_active ? "text-orange-600" : "text-green-600"
                }`}
                title={plan.is_active ? t("card.disable") : t("card.enable")}
              >
                {plan.is_active ? t("card.disable") : t("card.enable")}
              </button>
              {!["free", "starter", "pro", "enterprise"].includes(plan.slug) && (
                <button
                  onClick={() => setDeleteConfirm(plan.id)}
                  className="rounded-md border border-destructive/50 px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10"
                  title={t("card.delete")}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Delete Confirmation */}
            {deleteConfirm === plan.id && (
              <div className="absolute inset-0 rounded-lg bg-background/95 backdrop-blur-sm flex flex-col items-center justify-center p-6">
                <p className="text-sm font-medium mb-4">{t("card.deleteConfirm", { name: plan.name })}</p>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleDelete(plan.id)}
                    className="rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
                  >
                    {tCommon("delete")}
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(null)}
                    className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
                  >
                    {tCommon("cancel")}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Create/Edit Form Modal */}
      {formMode !== "closed" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg border bg-card p-6 shadow-lg">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold">
                {formMode === "create" ? t("modal.createTitle") : t("modal.editTitle")}
              </h2>
              <button
                onClick={closeForm}
                className="rounded-md p-2 hover:bg-accent"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Basic Info */}
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    {t("form.slug")}
                  </label>
                  <input
                    type="text"
                    value={formData.slug}
                    onChange={(e) =>
                      setFormData({ ...formData, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })
                    }
                    disabled={formMode === "edit"}
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50"
                    placeholder={t("form.slugPlaceholder")}
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    {t("form.name")}
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) =>
                      setFormData({ ...formData, name: e.target.value })
                    }
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    placeholder={t("form.namePlaceholder")}
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1.5">
                  {t("form.description")}
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  rows={2}
                  placeholder={t("form.descriptionPlaceholder")}
                />
              </div>

              {/* Pricing */}
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    {t("form.price")}
                  </label>
                  <input
                    type="number"
                    value={formData.price}
                    onChange={(e) =>
                      setFormData({ ...formData, price: parseFloat(e.target.value) || 0 })
                    }
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    min="0"
                    step="0.01"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    {t("form.currency")}
                  </label>
                  <select
                    value={formData.currency}
                    onChange={(e) =>
                      setFormData({ ...formData, currency: e.target.value })
                    }
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  >
                    <option value="EUR">EUR</option>
                    <option value="USD">USD</option>
                    <option value="GBP">GBP</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    {t("form.interval")}
                  </label>
                  <select
                    value={formData.interval}
                    onChange={(e) =>
                      setFormData({ ...formData, interval: e.target.value })
                    }
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  >
                    <option value="month">{t("form.monthly")}</option>
                    <option value="year">{t("form.yearly")}</option>
                  </select>
                </div>
              </div>

              {/* Limits */}
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    {t("form.storageGb")}
                  </label>
                  <input
                    type="number"
                    value={formData.storage_limit_gb}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        storage_limit_gb: parseFloat(e.target.value) || 0,
                      })
                    }
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    min="-1"
                    step="1"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("form.storageHint")}
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    {t("form.apiCallsLimit")}
                  </label>
                  <input
                    type="number"
                    value={formData.api_calls_limit}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        api_calls_limit: parseInt(e.target.value) || 0,
                      })
                    }
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    min="-1"
                    step="1000"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    {t("form.documentLimit")}
                  </label>
                  <input
                    type="number"
                    value={formData.document_limit}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        document_limit: parseInt(e.target.value) || 0,
                      })
                    }
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    min="-1"
                    step="100"
                  />
                </div>
              </div>

              {/* Tenant Plan Options */}
              <div className="rounded-lg border p-4 space-y-4">
                <div className="flex items-center gap-2">
                  <Building2 className="h-5 w-5 text-muted-foreground" />
                  <h3 className="font-medium">{t("form.linkedTenant")}</h3>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.is_tenant_plan}
                      onChange={(e) =>
                        setFormData({ ...formData, is_tenant_plan: e.target.checked })
                      }
                      className="rounded border"
                    />
                    <span className="text-sm">{t("form.isTenantPlan")}</span>
                  </label>

                  {formData.is_tenant_plan && (
                    <div>
                      <label className="block text-sm font-medium mb-1.5">
                        {t("form.maxMembers")}
                      </label>
                      <input
                        type="number"
                        value={formData.max_members}
                        onChange={(e) =>
                          setFormData({
                            ...formData,
                            max_members: parseInt(e.target.value) || 1,
                          })
                        }
                        className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                        min="1"
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        {t("form.maxMembersHint")}
                      </p>
                    </div>
                  )}
                </div>

                {/* Linked Tenant Selector */}
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    {t("form.linkedTenant")}
                  </label>
                  <div className="relative">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <input
                        type="text"
                        value={selectedTenantName || tenantSearch}
                        onChange={(e) => {
                          setTenantSearch(e.target.value);
                          if (formData.linked_tenant_id) {
                            setFormData({ ...formData, linked_tenant_id: null });
                          }
                        }}
                        onFocus={() => setShowTenantDropdown(true)}
                        className="w-full rounded-md border bg-background pl-10 pr-10 py-2 text-sm"
                        placeholder={t("form.linkedTenantPlaceholder")}
                      />
                      {formData.linked_tenant_id && (
                        <button
                          type="button"
                          onClick={() => {
                            setFormData({ ...formData, linked_tenant_id: null });
                            setTenantSearch("");
                          }}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>

                    {/* Dropdown */}
                    {showTenantDropdown && !formData.linked_tenant_id && (
                      <div className="absolute z-10 w-full mt-1 max-h-60 overflow-auto rounded-md border bg-popover shadow-lg">
                        <button
                          type="button"
                          onClick={() => {
                            setFormData({ ...formData, linked_tenant_id: null });
                            setShowTenantDropdown(false);
                            setTenantSearch("");
                          }}
                          className="w-full px-3 py-2 text-left text-sm hover:bg-accent flex items-center gap-2 text-muted-foreground"
                        >
                          <X className="h-4 w-4" />
                          {t("form.noTenantSelected")}
                        </button>
                        {filteredTenants.map((tenant) => (
                          <button
                            key={tenant.id}
                            type="button"
                            onClick={() => {
                              setFormData({ ...formData, linked_tenant_id: tenant.id });
                              setShowTenantDropdown(false);
                              setTenantSearch("");
                            }}
                            className="w-full px-3 py-2 text-left text-sm hover:bg-accent flex items-center gap-2"
                          >
                            <Building2 className="h-4 w-4 text-muted-foreground" />
                            <div>
                              <div className="font-medium">{tenant.name}</div>
                              <div className="text-xs text-muted-foreground">{tenant.email}</div>
                            </div>
                          </button>
                        ))}
                        {filteredTenants.length === 0 && tenantSearch && (
                          <div className="px-3 py-2 text-sm text-muted-foreground">
                            {tCommon("noResults")}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("form.linkedTenantHint")}
                  </p>
                </div>
              </div>

              {/* Features */}
              <div>
                <label className="block text-sm font-medium mb-3">
                  {t("form.features")}
                </label>
                <div className="grid gap-3 md:grid-cols-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.custom_branding}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          custom_branding: e.target.checked,
                        })
                      }
                      className="rounded border"
                    />
                    <span className="text-sm">{t("form.customBranding")}</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.priority_support}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          priority_support: e.target.checked,
                        })
                      }
                      className="rounded border"
                    />
                    <span className="text-sm">{t("form.prioritySupport")}</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.sla}
                      onChange={(e) =>
                        setFormData({ ...formData, sla: e.target.checked })
                      }
                      className="rounded border"
                    />
                    <span className="text-sm">{t("form.slaGuarantee")}</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={formData.dedicated_account}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          dedicated_account: e.target.checked,
                        })
                      }
                      className="rounded border"
                    />
                    <span className="text-sm">{t("form.dedicatedAccount")}</span>
                  </label>
                </div>
              </div>

              {/* Display Options */}
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    {t("form.displayOrder")}
                  </label>
                  <input
                    type="number"
                    value={formData.display_order}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        display_order: parseInt(e.target.value) || 0,
                      })
                    }
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    min="0"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    {t("form.ctaText")}
                  </label>
                  <input
                    type="text"
                    value={formData.cta_text}
                    onChange={(e) =>
                      setFormData({ ...formData, cta_text: e.target.value })
                    }
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    placeholder={t("form.ctaPlaceholder")}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1.5">
                    {t("form.trialDays")}
                  </label>
                  <input
                    type="number"
                    value={formData.trial_days || ""}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        trial_days: e.target.value ? parseInt(e.target.value) : null,
                      })
                    }
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                    min="0"
                    placeholder={t("form.trialPlaceholder")}
                  />
                </div>
              </div>

              {/* Status Toggles */}
              <div className="flex gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.is_active}
                    onChange={(e) =>
                      setFormData({ ...formData, is_active: e.target.checked })
                    }
                    className="rounded border"
                  />
                  <span className="text-sm">{t("form.isActive")}</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.is_popular}
                    onChange={(e) =>
                      setFormData({ ...formData, is_popular: e.target.checked })
                    }
                    className="rounded border"
                  />
                  <span className="text-sm">{t("form.isPopular")}</span>
                </label>
              </div>

              {/* Submit */}
              <div className="flex gap-3 pt-4 border-t">
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {formMode === "create" ? tCommon("create") : tCommon("saveChanges")}
                </button>
                <button
                  type="button"
                  onClick={closeForm}
                  className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
                >
                  {tCommon("cancel")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Click outside to close dropdown */}
      {showTenantDropdown && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setShowTenantDropdown(false)}
        />
      )}
    </div>
  );
}
