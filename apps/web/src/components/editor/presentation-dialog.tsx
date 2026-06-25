"use client";

import React, { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  X,
  Loader2,
  Presentation,
  Play,
  Scaling,
  Library,
  Accessibility,
  AlertCircle,
} from "lucide-react";
import { downloadBlob } from "@giga-pdf/api";

export interface PresentationDialogProps {
  open: boolean;
  onClose: () => void;
  currentFile: File | null;
  baseFilename?: string;
}

/** Which presentation/page-setup task the dialog is performing. */
type Tab = "transitions" | "scale" | "portfolio" | "figures";

/**
 * The 12 ISO 32000-1 §12.4.4 page-transition styles, in the engine's enum order.
 * Declared locally (not imported from the lib) so this client bundle never pulls
 * the WASM engine — the route validates against the same list server-side.
 */
const TRANSITION_STYLES = [
  "split",
  "blinds",
  "box",
  "wipe",
  "dissolve",
  "glitter",
  "fly",
  "push",
  "cover",
  "uncover",
  "fade",
  "replace",
] as const;

/** Sweep-direction options for directional transitions (empty = leave unset). */
const DIRECTIONS = ["", "0", "90", "180", "270", "315", "none"] as const;

type ScaleMode = "uniform" | "xy" | "fit" | "userUnit";
const SCALE_MODES: ScaleMode[] = ["uniform", "xy", "fit", "userUnit"];

type PortfolioView = "details" | "tile" | "hidden";
const PORTFOLIO_VIEWS: PortfolioView[] = ["details", "tile", "hidden"];

/** Bearer token for the expo/widget auth path; cookie session is sent anyway. */
function authHeaders(): HeadersInit {
  if (typeof window === "undefined") return {};
  const token = localStorage.getItem("access_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Build the portfolio schema from a "key|Header" textarea (one column per line). */
function parseColumns(text: string): { key: string; name?: string }[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => {
      const sep = line.indexOf("|");
      if (sep === -1) return { key: line };
      const key = line.slice(0, sep).trim() || line.trim();
      const name = line.slice(sep + 1).trim();
      return name ? { key, name } : { key };
    });
}

/**
 * PresentationDialog — configure a PDF's presentation/page setup via the engine,
 * across four tabs:
 *
 *  - **Transitions** set or remove a page-transition effect + auto-advance time
 *                    (ISO 32000-1 §12.4.4), applied to every page.
 *  - **Scale**       zoom page content uniformly / anisotropically / to-fit, or
 *                    set the `/UserUnit` for large-format authoring.
 *  - **Portfolio**   mark the document as a PDF portfolio (`/Collection`) and
 *                    pick its initial navigator + column schema.
 *  - **Figures**     bake author alt-text onto the document's figures (a11y).
 *
 * Every tab posts to /api/pdf/presentation and downloads the resulting PDF.
 */
export function PresentationDialog({
  open,
  onClose,
  currentFile,
  baseFilename = "document",
}: PresentationDialogProps) {
  const t = useTranslations("editor.presentation");
  const [tab, setTab] = useState<Tab>("transitions");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Transitions tab.
  const [style, setStyle] = useState<(typeof TRANSITION_STYLES)[number]>("fade");
  const [duration, setDuration] = useState("1");
  const [displayDuration, setDisplayDuration] = useState("");
  const [direction, setDirection] = useState<(typeof DIRECTIONS)[number]>("");

  // Scale tab.
  const [scaleMode, setScaleMode] = useState<ScaleMode>("uniform");
  const [factor, setFactor] = useState("1");
  const [sx, setSx] = useState("1");
  const [sy, setSy] = useState("1");
  const [fitWidth, setFitWidth] = useState("595");
  const [fitHeight, setFitHeight] = useState("842");
  const [userUnit, setUserUnit] = useState("1");

  // Portfolio tab.
  const [view, setView] = useState<PortfolioView>("details");
  const [columns, setColumns] = useState("");

  // Figures tab.
  const [figureAltsText, setFigureAltsText] = useState("");

  // Clear transient state whenever the dialog is reopened.
  useEffect(() => {
    if (!open) {
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const tabs: { value: Tab; label: string; Icon: typeof Play }[] = [
    { value: "transitions", label: t("tabs.transitions"), Icon: Play },
    { value: "scale", label: t("tabs.scale"), Icon: Scaling },
    { value: "portfolio", label: t("tabs.portfolio"), Icon: Library },
    { value: "figures", label: t("tabs.figures"), Icon: Accessibility },
  ];

  /** POST one action to the route and download the produced PDF on success. */
  const run = async (fields: Record<string, string>) => {
    if (!currentFile || busy) return;
    setError(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", currentFile);
      for (const [key, value] of Object.entries(fields)) form.append(key, value);

      const response = await fetch("/api/pdf/presentation", {
        method: "POST",
        headers: authHeaders(),
        body: form,
      });
      if (!response.ok) {
        let message = `HTTP ${response.status}`;
        try {
          const json = (await response.json()) as { error?: string };
          if (json?.error) message = json.error;
        } catch {
          // non-JSON error body — keep the status message
        }
        throw new Error(message);
      }

      const blob = await response.blob();
      downloadBlob(blob, baseFilename.replace(/\.pdf$/i, "") + ".presentation.pdf");
      onClose();
    } catch (err) {
      // Keep the dialog open so the user can adjust and retry.
      setError(err instanceof Error ? err.message : t("failed"));
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (tab === "transitions") {
      const fields: Record<string, string> = { action: "transition", op: "set", style };
      if (duration.trim() !== "") fields.duration = duration.trim();
      if (displayDuration.trim() !== "") fields.displayDuration = displayDuration.trim();
      if (direction !== "") fields.direction = direction;
      void run(fields);
    } else if (tab === "scale") {
      const fields: Record<string, string> = { action: "scale", mode: scaleMode };
      if (scaleMode === "uniform") fields.factor = factor.trim();
      else if (scaleMode === "xy") {
        fields.sx = sx.trim();
        fields.sy = sy.trim();
      } else if (scaleMode === "fit") {
        fields.width = fitWidth.trim();
        fields.height = fitHeight.trim();
      } else fields.unit = userUnit.trim();
      void run(fields);
    } else if (tab === "portfolio") {
      const config = { view, schema: parseColumns(columns) };
      void run({ action: "collection", config: JSON.stringify(config) });
    } else {
      // figures
      const alts = figureAltsText.split("\n").map((s) => s.trim());
      while (alts.length > 0 && alts[alts.length - 1] === "") alts.pop();
      void run({ action: "figureAlt", figureAlts: JSON.stringify(alts) });
    }
  };

  /** Transitions-only: remove every page transition + auto-advance. */
  const clearTransitions = () => {
    void run({ action: "transition", op: "clear" });
  };

  if (!open) return null;

  const inputClass =
    "w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";
  const labelClass = "block text-sm font-medium text-foreground mb-1";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="presentation-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-md max-h-[90vh] rounded-xl border border-border bg-background shadow-2xl flex flex-col">
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-2 shrink-0">
          <div className="flex items-center gap-2">
            <Presentation size={18} className="text-muted-foreground" />
            <h2
              id="presentation-dialog-title"
              className="text-lg font-semibold text-foreground"
            >
              {t("title")}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("close")}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X size={16} />
          </button>
        </div>

        {/* Tab selector */}
        <div
          role="tablist"
          aria-label={t("title")}
          className="mx-6 mt-1 mb-2 grid grid-cols-4 gap-1 rounded-lg border border-border bg-muted/40 p-1 shrink-0"
        >
          {tabs.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={tab === item.value}
              onClick={() => setTab(item.value)}
              className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                tab === item.value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <item.Icon size={14} className="shrink-0" />
              {item.label}
            </button>
          ))}
        </div>

        <form
          onSubmit={submit}
          className="px-6 pb-6 pt-2 space-y-4 overflow-y-auto min-h-0"
        >
          {tab === "transitions" && (
            <>
              <div>
                <label htmlFor="pres-style" className={labelClass}>
                  {t("transitions.styleLabel")}
                </label>
                <select
                  id="pres-style"
                  value={style}
                  onChange={(e) =>
                    setStyle(e.target.value as (typeof TRANSITION_STYLES)[number])
                  }
                  className={inputClass}
                >
                  {TRANSITION_STYLES.map((s) => (
                    <option key={s} value={s}>
                      {t(`transitions.style.${s}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="pres-duration" className={labelClass}>
                    {t("transitions.durationLabel")}
                  </label>
                  <input
                    id="pres-duration"
                    type="number"
                    min="0"
                    step="0.1"
                    value={duration}
                    onChange={(e) => setDuration(e.target.value)}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="pres-display-duration" className={labelClass}>
                    {t("transitions.displayDurationLabel")}
                  </label>
                  <input
                    id="pres-display-duration"
                    type="number"
                    min="0"
                    step="0.5"
                    value={displayDuration}
                    onChange={(e) => setDisplayDuration(e.target.value)}
                    placeholder={t("transitions.displayDurationPlaceholder")}
                    className={inputClass}
                  />
                </div>
              </div>
              <div>
                <label htmlFor="pres-direction" className={labelClass}>
                  {t("transitions.directionLabel")}
                </label>
                <select
                  id="pres-direction"
                  value={direction}
                  onChange={(e) =>
                    setDirection(e.target.value as (typeof DIRECTIONS)[number])
                  }
                  className={inputClass}
                >
                  {DIRECTIONS.map((d) => (
                    <option key={d || "auto"} value={d}>
                      {d === "" ? t("transitions.directionAuto") : d === "none" ? t("transitions.directionNone") : `${d}°`}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-xs text-muted-foreground">{t("transitions.allPagesNote")}</p>
            </>
          )}

          {tab === "scale" && (
            <>
              <div>
                <label htmlFor="pres-scale-mode" className={labelClass}>
                  {t("scale.modeLabel")}
                </label>
                <select
                  id="pres-scale-mode"
                  value={scaleMode}
                  onChange={(e) => setScaleMode(e.target.value as ScaleMode)}
                  className={inputClass}
                >
                  {SCALE_MODES.map((m) => (
                    <option key={m} value={m}>
                      {t(`scale.mode.${m}`)}
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  {t(`scale.modeHint.${scaleMode}`)}
                </p>
              </div>

              {scaleMode === "uniform" && (
                <div>
                  <label htmlFor="pres-factor" className={labelClass}>
                    {t("scale.factorLabel")}
                  </label>
                  <input
                    id="pres-factor"
                    type="number"
                    min="0"
                    step="0.1"
                    value={factor}
                    onChange={(e) => setFactor(e.target.value)}
                    className={inputClass}
                  />
                </div>
              )}

              {scaleMode === "xy" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="pres-sx" className={labelClass}>
                      {t("scale.sxLabel")}
                    </label>
                    <input
                      id="pres-sx"
                      type="number"
                      min="0"
                      step="0.1"
                      value={sx}
                      onChange={(e) => setSx(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="pres-sy" className={labelClass}>
                      {t("scale.syLabel")}
                    </label>
                    <input
                      id="pres-sy"
                      type="number"
                      min="0"
                      step="0.1"
                      value={sy}
                      onChange={(e) => setSy(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                </div>
              )}

              {scaleMode === "fit" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="pres-fit-width" className={labelClass}>
                      {t("scale.widthLabel")}
                    </label>
                    <input
                      id="pres-fit-width"
                      type="number"
                      min="0"
                      step="1"
                      value={fitWidth}
                      onChange={(e) => setFitWidth(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label htmlFor="pres-fit-height" className={labelClass}>
                      {t("scale.heightLabel")}
                    </label>
                    <input
                      id="pres-fit-height"
                      type="number"
                      min="0"
                      step="1"
                      value={fitHeight}
                      onChange={(e) => setFitHeight(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                </div>
              )}

              {scaleMode === "userUnit" && (
                <div>
                  <label htmlFor="pres-unit" className={labelClass}>
                    {t("scale.unitLabel")}
                  </label>
                  <input
                    id="pres-unit"
                    type="number"
                    min="0"
                    step="0.1"
                    value={userUnit}
                    onChange={(e) => setUserUnit(e.target.value)}
                    className={inputClass}
                  />
                </div>
              )}
              <p className="text-xs text-muted-foreground">{t("scale.allPagesNote")}</p>
            </>
          )}

          {tab === "portfolio" && (
            <>
              <div>
                <label htmlFor="pres-view" className={labelClass}>
                  {t("portfolio.viewLabel")}
                </label>
                <select
                  id="pres-view"
                  value={view}
                  onChange={(e) => setView(e.target.value as PortfolioView)}
                  className={inputClass}
                >
                  {PORTFOLIO_VIEWS.map((v) => (
                    <option key={v} value={v}>
                      {t(`portfolio.view.${v}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="pres-columns" className={labelClass}>
                  {t("portfolio.columnsLabel")}
                </label>
                <textarea
                  id="pres-columns"
                  value={columns}
                  onChange={(e) => setColumns(e.target.value)}
                  rows={3}
                  placeholder={t("portfolio.columnsPlaceholder")}
                  className={inputClass}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("portfolio.columnsHint")}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">{t("portfolio.note")}</p>
            </>
          )}

          {tab === "figures" && (
            <div className="space-y-3 rounded-md border border-border/60 bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">{t("figures.note")}</p>
              <div>
                <label htmlFor="pres-figure-alts" className="block text-xs font-medium text-foreground mb-1">
                  {t("figures.label")}
                </label>
                <textarea
                  id="pres-figure-alts"
                  value={figureAltsText}
                  onChange={(e) => setFigureAltsText(e.target.value)}
                  rows={4}
                  placeholder={t("figures.placeholder")}
                  className="w-full px-3 py-2 rounded-md border border-input bg-background text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <p className="mt-1 text-xs text-muted-foreground">{t("figures.hint")}</p>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/20">
              <AlertCircle size={16} className="text-destructive shrink-0 mt-0.5" />
              <p className="text-xs text-destructive">{error}</p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            {tab === "transitions" && (
              <button
                type="button"
                onClick={clearTransitions}
                disabled={!currentFile || busy}
                className="mr-auto px-4 py-2 text-sm rounded-md border border-input hover:bg-muted disabled:opacity-50"
              >
                {t("transitions.remove")}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-md border border-input hover:bg-muted"
            >
              {t("cancel")}
            </button>
            <button
              type="submit"
              disabled={!currentFile || busy}
              className="px-4 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
            >
              {busy && <Loader2 size={14} className="animate-spin" />}
              {t("apply")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
