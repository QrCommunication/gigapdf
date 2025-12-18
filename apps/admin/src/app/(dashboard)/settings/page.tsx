"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, AlertCircle, CheckCircle, HardDrive, Save } from "lucide-react";
import { settingsApi, type SystemSettings } from "@/lib/api";

export default function SettingsPage() {
  const t = useTranslations("settings");
  const tCommon = useTranslations("common");
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [storageInfo, setStorageInfo] = useState<{
    configured: boolean;
    bucket?: string;
    object_count?: number;
    total_size_formatted?: string;
    error?: string;
  } | null>(null);

  useEffect(() => {
    async function fetchSettings() {
      try {
        setLoading(true);
        const [settingsData, storageData] = await Promise.all([
          settingsApi.get(),
          settingsApi.getStorageInfo(),
        ]);
        setSettings(settingsData);
        setStorageInfo(storageData);
      } catch (err) {
        console.error("Failed to fetch settings:", err);
        setError(err instanceof Error ? err.message : tCommon("error"));
      } finally {
        setLoading(false);
      }
    }

    fetchSettings();
  }, [tCommon]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!settings) return;

    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      const formData = new FormData(e.currentTarget);
      const updateData = {
        system_name: formData.get("system_name") as string,
        support_email: formData.get("support_email") as string,
        max_file_size_mb: parseInt(formData.get("max_file_size_mb") as string),
        smtp_host: formData.get("smtp_host") as string || undefined,
        smtp_port: parseInt(formData.get("smtp_port") as string) || 587,
        smtp_user: formData.get("smtp_user") as string || undefined,
        enable_registration: formData.get("enable_registration") === "on",
        enable_public_sharing: formData.get("enable_public_sharing") === "on",
        enable_ocr: formData.get("enable_ocr") === "on",
        maintenance_mode: formData.get("maintenance_mode") === "on",
      };

      const updated = await settingsApi.update(updateData);
      setSettings(updated);
      setSuccess(t("saved"));

      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      console.error("Failed to save settings:", err);
      setError(err instanceof Error ? err.message : tCommon("error"));
    } finally {
      setSaving(false);
    }
  };

  const handleTestStorage = async () => {
    try {
      const result = await settingsApi.testStorage();
      if (result.success) {
        setSuccess(result.message);
      } else {
        setError(result.message);
      }
      setTimeout(() => {
        setSuccess(null);
        setError(null);
      }, 3000);
    } catch (err) {
      setError(tCommon("error"));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <AlertCircle className="h-12 w-12 text-destructive" />
        <p className="text-destructive">{error || tCommon("error")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 p-4 text-sm text-destructive flex items-center gap-2">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      {success && (
        <div className="rounded-md bg-green-500/10 p-4 text-sm text-green-600 flex items-center gap-2">
          <CheckCircle className="h-4 w-4" />
          {success}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="rounded-lg border bg-card p-6">
          <h3 className="mb-4 text-lg font-semibold">{t("sections.general.title")}</h3>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">{t("sections.general.siteName")}</label>
              <input
                type="text"
                name="system_name"
                defaultValue={settings.system_name}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-sm font-medium">{t("sections.general.supportEmail")}</label>
              <input
                type="email"
                name="support_email"
                defaultValue={settings.support_email}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-sm font-medium">{t("sections.storage.maxFileSize")}</label>
              <input
                type="number"
                name="max_file_size_mb"
                defaultValue={settings.max_file_size_mb}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
          </div>
        </div>

        <div className="rounded-lg border bg-card p-6">
          <h3 className="mb-4 text-lg font-semibold">{t("sections.email.title")}</h3>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">{t("sections.email.smtpHost")}</label>
              <input
                type="text"
                name="smtp_host"
                defaultValue={settings.smtp_host || ""}
                placeholder="smtp.example.com"
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-sm font-medium">{t("sections.email.smtpPort")}</label>
              <input
                type="number"
                name="smtp_port"
                defaultValue={settings.smtp_port}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-sm font-medium">{t("sections.email.smtpUser")}</label>
              <input
                type="text"
                name="smtp_user"
                defaultValue={settings.smtp_user || ""}
                className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
          </div>
        </div>

        <div className="rounded-lg border bg-card p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">{t("sections.storage.title")}</h3>
            <button
              type="button"
              onClick={handleTestStorage}
              className="rounded-md border px-3 py-1 text-sm hover:bg-accent"
            >
              <HardDrive className="h-4 w-4 inline mr-1" />
              {t("sections.email.testEmail")}
            </button>
          </div>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Provider:</span>
                <span className="ml-2 font-medium">{settings.storage_provider}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Bucket:</span>
                <span className="ml-2 font-medium">{settings.storage_bucket || "Not configured"}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Region:</span>
                <span className="ml-2 font-medium">{settings.storage_region || "Not configured"}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Endpoint:</span>
                <span className="ml-2 font-medium font-mono text-xs">
                  {settings.storage_endpoint || "Default"}
                </span>
              </div>
            </div>
            {storageInfo && storageInfo.configured && (
              <div className="rounded-md bg-secondary/50 p-4 mt-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">Objects:</span>
                    <span className="ml-2 font-medium">{storageInfo.object_count ?? "N/A"}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Total Size:</span>
                    <span className="ml-2 font-medium">{storageInfo.total_size_formatted ?? "N/A"}</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-lg border bg-card p-6">
          <h3 className="mb-4 text-lg font-semibold">{t("sections.security.title")}</h3>
          <div className="space-y-4">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                name="enable_registration"
                defaultChecked={settings.enable_registration}
                className="rounded border-gray-300"
              />
              <span className="text-sm">{t("sections.security.requireEmailVerification")}</span>
            </label>
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                name="enable_public_sharing"
                defaultChecked={settings.enable_public_sharing}
                className="rounded border-gray-300"
              />
              <span className="text-sm">{t("sections.security.require2FA")}</span>
            </label>
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                name="enable_ocr"
                defaultChecked={settings.enable_ocr}
                className="rounded border-gray-300"
              />
              <span className="text-sm">OCR</span>
            </label>
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                name="maintenance_mode"
                defaultChecked={settings.maintenance_mode}
                className="rounded border-gray-300"
              />
              <span className="text-sm text-yellow-600">{t("sections.general.maintenanceMode")}</span>
            </label>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-accent"
          >
            {tCommon("cancel")}
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {tCommon("saveChanges")}
          </button>
        </div>
      </form>
    </div>
  );
}
