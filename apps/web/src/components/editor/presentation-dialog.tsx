"use client";

import React, { useEffect, useRef, useState } from "react";
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
  /**
   * 1-based page the editor is currently focused on. Drives the "current page"
   * scope option and seeds the transitions pre-fill. Defaults to page 1.
   */
  currentPageNumber?: number;
  /**
   * Editor mode (apply-to-document). When provided, a successful submit hands
   * the produced PDF bytes to the editor (which adopts them onto the live
   * document) instead of downloading a copy. When omitted, the dialog keeps its
   * stand-alone behaviour and downloads the result (back-compat).
   */
  onApply?: (bytes: Uint8Array) => void | Promise<void>;
}

/** Which presentation/page-setup task the dialog is performing. */
type Tab = "transitions" | "scale" | "portfolio" | "figures";

/**
 * The shape of a page transition as returned by `op=get` (mirrors the engine's
 * `PageTransition`). Declared locally so this client bundle never imports the
 * WASM lib — the route owns the canonical type.
 */
interface LoadedTransition {
  style?: string;
  duration?: number;
  dimension?: string;
  motion?: string;
  direction?: number | string;
  scale?: number;
  flyAreaOpaque?: boolean;
  displayDuration?: number;
}

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

/** Orientation options for `split`/`blinds` (empty = leave unset). */
const DIMENSIONS = ["", "horizontal", "vertical"] as const;

/** Motion options for `split`/`box` (empty = leave unset). */
const MOTIONS = ["", "inward", "outward"] as const;

/** Which pages a transition set/clear targets. */
type TransitionScope = "all" | "current" | "custom";
const SCOPES: TransitionScope[] = ["all", "current", "custom"];

/** Sub-key applicability per transition style (ISO 32000-1 §12.4.4). */
const DIMENSION_STYLES = new Set(["split", "blinds"]);
const MOTION_STYLES = new Set(["split", "box"]);
const DIRECTION_STYLES = new Set(["wipe", "glitter", "fly", "cover", "uncover", "push"]);

/**
 * Parse a human page list ("1, 3, 5-7") into a sorted, de-duplicated array of
 * 1-based page numbers. Tolerant: ignores blanks and malformed tokens, and
 * normalises reversed ranges. The server re-validates against the real page
 * count, so an out-of-range entry surfaces as a 400 there.
 */
function parsePageList(text: string): number[] {
  const out = new Set<number>();
  for (const token of text.split(",")) {
    const part = token.trim();
    if (part === "") continue;
    const dash = part.indexOf("-");
    if (dash === -1) {
      const n = Number(part);
      if (Number.isInteger(n) && n >= 1) out.add(n);
      continue;
    }
    const a = Number(part.slice(0, dash).trim());
    const b = Number(part.slice(dash + 1).trim());
    if (!Number.isInteger(a) || !Number.isInteger(b)) continue;
    const lo = Math.max(1, Math.min(a, b));
    const hi = Math.max(a, b);
    for (let n = lo; n <= hi; n++) out.add(n);
  }
  return Array.from(out).sort((x, y) => x - y);
}

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
  currentPageNumber = 1,
  onApply,
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
  // Style-specific sub-keys (only sent when they apply to the chosen style).
  const [dimension, setDimension] = useState<(typeof DIMENSIONS)[number]>("");
  const [motion, setMotion] = useState<(typeof MOTIONS)[number]>("");
  const [flyScale, setFlyScale] = useState("");
  const [flyAreaOpaque, setFlyAreaOpaque] = useState(false);
  // Which pages the set/clear targets (all / current / a custom list).
  const [scope, setScope] = useState<TransitionScope>("all");
  const [pagesInput, setPagesInput] = useState("");
  // Guards the one-shot op=get pre-fill so it runs once per dialog opening.
  const prefillDoneRef = useRef(false);

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
      // Re-arm the pre-fill so the next opening reflects the latest document.
      prefillDoneRef.current = false;
    }
  }, [open]);

  /** Seed the transitions form from a loaded {@link LoadedTransition}. */
  const prefillFromTransition = (tr: LoadedTransition) => {
    if (
      typeof tr.style === "string" &&
      (TRANSITION_STYLES as readonly string[]).includes(tr.style)
    ) {
      setStyle(tr.style as (typeof TRANSITION_STYLES)[number]);
    }
    setDuration(tr.duration != null ? String(tr.duration) : "1");
    setDisplayDuration(tr.displayDuration != null ? String(tr.displayDuration) : "");
    const dir = tr.direction == null ? "" : String(tr.direction);
    setDirection(
      (DIRECTIONS as readonly string[]).includes(dir)
        ? (dir as (typeof DIRECTIONS)[number])
        : "",
    );
    const dim = tr.dimension == null ? "" : String(tr.dimension);
    setDimension(
      (DIMENSIONS as readonly string[]).includes(dim)
        ? (dim as (typeof DIMENSIONS)[number])
        : "",
    );
    const mot = tr.motion == null ? "" : String(tr.motion);
    setMotion(
      (MOTIONS as readonly string[]).includes(mot)
        ? (mot as (typeof MOTIONS)[number])
        : "",
    );
    setFlyScale(tr.scale != null ? String(tr.scale) : "");
    setFlyAreaOpaque(Boolean(tr.flyAreaOpaque));
  };

  // Read the document's existing transitions (op=get) once per opening and
  // seed the transitions form with the focused page's (or page 1's) effect, so
  // the dialog reflects what's already in the PDF and lets the user adjust it.
  // Best-effort: any failure leaves the defaults in place.
  useEffect(() => {
    if (!open || tab !== "transitions" || !currentFile) return;
    if (prefillDoneRef.current) return;
    prefillDoneRef.current = true;
    let cancelled = false;
    void (async () => {
      try {
        const form = new FormData();
        form.append("file", currentFile);
        form.append("action", "transition");
        form.append("op", "get");
        const res = await fetch("/api/pdf/presentation", {
          method: "POST",
          headers: authHeaders(),
          body: form,
        });
        if (!res.ok || cancelled) return;
        const json = (await res.json()) as {
          data?: { transitions?: (LoadedTransition | null)[] };
        };
        const list = json?.data?.transitions;
        if (cancelled || !Array.isArray(list) || list.length === 0) return;
        // Prefer the focused page; fall back to the first page that carries one.
        const idx = Math.min(Math.max(0, currentPageNumber - 1), list.length - 1);
        const found = list[idx] ?? list.find((tr) => tr != null) ?? null;
        if (found) prefillFromTransition(found);
      } catch {
        // Pre-fill is best-effort; keep the form defaults on any error.
      }
    })();
    return () => {
      cancelled = true;
    };
    // prefillFromTransition is a stable closure over setters (no extra deps).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab, currentFile, currentPageNumber]);

  const tabs: { value: Tab; label: string; Icon: typeof Play }[] = [
    { value: "transitions", label: t("tabs.transitions"), Icon: Play },
    { value: "scale", label: t("tabs.scale"), Icon: Scaling },
    { value: "portfolio", label: t("tabs.portfolio"), Icon: Library },
    { value: "figures", label: t("tabs.figures"), Icon: Accessibility },
  ];

  // Which transition sub-keys apply to the chosen style (the engine writes only
  // the relevant ones, but we hide the irrelevant inputs to avoid confusion).
  const showDimension = DIMENSION_STYLES.has(style);
  const showMotion = MOTION_STYLES.has(style);
  const showDirection = DIRECTION_STYLES.has(style);
  const showFlyExtras = style === "fly";

  /**
   * Resolve the scope selector into the route's optional `pages` field:
   *  - "all"     → null (omit; the route treats an absent list as every page)
   *  - "current" → just the focused page
   *  - "custom"  → the parsed page list (empty/invalid falls back to all)
   */
  const pagesField = (): string | null => {
    if (scope === "current") {
      return JSON.stringify([Math.max(1, currentPageNumber)]);
    }
    if (scope === "custom") {
      const list = parsePageList(pagesInput);
      return list.length > 0 ? JSON.stringify(list) : null;
    }
    return null;
  };

  /**
   * POST one action to the route, then either hand the produced PDF to the
   * editor (apply mode) or download it (stand-alone mode) — see {@link onApply}.
   */
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

      if (onApply) {
        // Editor mode: hand the produced PDF bytes to the editor, which adopts
        // them onto the live document — no download.
        const bytes = new Uint8Array(await response.arrayBuffer());
        await onApply(bytes);
      } else {
        const blob = await response.blob();
        downloadBlob(
          blob,
          baseFilename.replace(/\.pdf$/i, "") + ".presentation.pdf",
        );
      }
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
      if (showDirection && direction !== "") fields.direction = direction;
      if (showDimension && dimension !== "") fields.dimension = dimension;
      if (showMotion && motion !== "") fields.motion = motion;
      if (showFlyExtras && flyScale.trim() !== "") fields.scale = flyScale.trim();
      if (showFlyExtras && flyAreaOpaque) fields.flyAreaOpaque = "true";
      const pages = pagesField();
      if (pages !== null) fields.pages = pages;
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

  /** Transitions-only: remove the page transition + auto-advance on the scoped pages. */
  const clearTransitions = () => {
    const fields: Record<string, string> = { action: "transition", op: "clear" };
    const pages = pagesField();
    if (pages !== null) fields.pages = pages;
    void run(fields);
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
              {showDirection && (
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
              )}

              {showDimension && (
                <div>
                  <label htmlFor="pres-dimension" className={labelClass}>
                    {t("transitions.dimensionLabel")}
                  </label>
                  <select
                    id="pres-dimension"
                    value={dimension}
                    onChange={(e) =>
                      setDimension(e.target.value as (typeof DIMENSIONS)[number])
                    }
                    className={inputClass}
                  >
                    {DIMENSIONS.map((d) => (
                      <option key={d || "auto"} value={d}>
                        {d === "" ? t("transitions.dimensionAuto") : t(`transitions.dimension.${d}`)}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {showMotion && (
                <div>
                  <label htmlFor="pres-motion" className={labelClass}>
                    {t("transitions.motionLabel")}
                  </label>
                  <select
                    id="pres-motion"
                    value={motion}
                    onChange={(e) =>
                      setMotion(e.target.value as (typeof MOTIONS)[number])
                    }
                    className={inputClass}
                  >
                    {MOTIONS.map((m) => (
                      <option key={m || "auto"} value={m}>
                        {m === "" ? t("transitions.motionAuto") : t(`transitions.motion.${m}`)}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {showFlyExtras && (
                <div className="grid grid-cols-2 gap-3 items-end">
                  <div>
                    <label htmlFor="pres-fly-scale" className={labelClass}>
                      {t("transitions.scaleLabel")}
                    </label>
                    <input
                      id="pres-fly-scale"
                      type="number"
                      min="0"
                      step="0.1"
                      value={flyScale}
                      onChange={(e) => setFlyScale(e.target.value)}
                      className={inputClass}
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm text-foreground pb-2">
                    <input
                      type="checkbox"
                      checked={flyAreaOpaque}
                      onChange={(e) => setFlyAreaOpaque(e.target.checked)}
                      className="h-4 w-4 rounded border-input"
                    />
                    {t("transitions.flyAreaOpaqueLabel")}
                  </label>
                </div>
              )}

              <div>
                <label htmlFor="pres-scope" className={labelClass}>
                  {t("transitions.scopeLabel")}
                </label>
                <select
                  id="pres-scope"
                  value={scope}
                  onChange={(e) => setScope(e.target.value as TransitionScope)}
                  className={inputClass}
                >
                  {SCOPES.map((s) => (
                    <option key={s} value={s}>
                      {t(`transitions.scope.${s}`)}
                    </option>
                  ))}
                </select>
              </div>

              {scope === "custom" && (
                <div>
                  <label htmlFor="pres-pages" className={labelClass}>
                    {t("transitions.pagesLabel")}
                  </label>
                  <input
                    id="pres-pages"
                    type="text"
                    inputMode="numeric"
                    value={pagesInput}
                    onChange={(e) => setPagesInput(e.target.value)}
                    placeholder={t("transitions.pagesPlaceholder")}
                    className={inputClass}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("transitions.pagesHint")}
                  </p>
                </div>
              )}
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
