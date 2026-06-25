"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import {
  X,
  Loader2,
  Grid2x2,
  FileCode2,
  Layers,
  StampIcon,
  Plus,
  Trash2,
  CheckCircle2,
  Lock,
  Eye,
  EyeOff,
} from "lucide-react";
import { downloadBlob } from "@giga-pdf/api";

// ─── Types ────────────────────────────────────────────────────────────────────

type DialogMode = "nup" | "js" | "ocg";

/** Mirrors the SDK's `DocumentJavascript` (read side of addDocumentJavascript). */
interface DocumentJavascript {
  name: string;
  script: string;
}

/** Mirrors the SDK's `LayerInfo` (optional-content layer / calque). */
interface LayerInfo {
  id: number;
  name: string;
  visible: boolean;
  locked: boolean;
  order: number;
}

/** Sheet-size presets for N-up, mapped to point dimensions. */
const SHEET_PRESETS = {
  a4p: { width: 595.276, height: 841.89 },
  a4l: { width: 841.89, height: 595.276 },
  letter: { width: 612, height: 792 },
} as const;
type SheetPreset = keyof typeof SHEET_PRESETS;

const ENDPOINT = "/api/pdf/imposition";

export interface ImpositionDialogProps {
  open: boolean;
  onClose: () => void;
  currentFile: File | null;
  /** Suggested base filename for the resulting downloads. */
  baseFilename?: string;
  /**
   * Called with the produced PDF when the host wants to apply the result to the
   * live document instead of downloading a copy. When omitted, every operation
   * downloads a new PDF and the dialog stays open for further edits.
   */
  onApplied?: (blob: Blob) => void;
}

// ─── Network helpers ──────────────────────────────────────────────────────────

/** Best-effort bearer header (the cookie session still authenticates same-origin). */
function getAuthHeader(): HeadersInit {
  if (typeof window === "undefined") return {};
  const token = localStorage.getItem("access_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readError(response: Response): Promise<string> {
  let message = `HTTP ${response.status}`;
  try {
    const json = (await response.json()) as { error?: string };
    if (json.error) message = json.error;
  } catch {
    // Non-JSON body — keep the status-based message.
  }
  return message;
}

/** POST `fields` to the imposition endpoint, returning the raw Response. */
function postImposition(file: File, fields: Record<string, string>): Promise<Response> {
  const form = new FormData();
  form.append("file", file);
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return fetch(ENDPOINT, { method: "POST", headers: getAuthHeader(), body: form });
}

// ─── Small UI atoms ─────────────────────────────────────────────────────────────

function FieldLabel({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="block text-xs font-medium text-muted-foreground mb-1">
      {children}
    </label>
  );
}

const numberInputClass =
  "w-full h-9 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";

// ─── Main dialog ────────────────────────────────────────────────────────────────

/**
 * ImpositionDialog — three engine surfaces in a tabbed modal:
 *
 *  - **N-up**       grid imposition of every page (`nUp`) plus a place-one-page
 *                   primitive (`placePage`).
 *  - **JavaScript** list / add / remove document-level JavaScript
 *                   (`/Names /JavaScript`).
 *  - **Layers**     list optional-content layers (OCGs) and bracket a page's
 *                   content under one (`beginOptionalContent` / `endOptionalContent`).
 *
 * Each mutation produces a PDF: it is downloaded (default) or handed to
 * `onApplied` when the host wires apply-to-document. The dialog stays open so
 * several operations can be chained.
 */
export function ImpositionDialog({
  open,
  onClose,
  currentFile,
  baseFilename = "document.pdf",
  onApplied,
}: ImpositionDialogProps) {
  const t = useTranslations("editor.imposition");

  const [mode, setMode] = useState<DialogMode>("nup");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // N-up state.
  const [cols, setCols] = useState(2);
  const [rows, setRows] = useState(1);
  const [sheet, setSheet] = useState<SheetPreset>("a4p");
  const [margin, setMargin] = useState(14);
  const [gutter, setGutter] = useState(14);

  // placePage state.
  const [ppTarget, setPpTarget] = useState(1);
  const [ppSource, setPpSource] = useState(1);
  const [ppX, setPpX] = useState(0);
  const [ppY, setPpY] = useState(0);
  const [ppScaleX, setPpScaleX] = useState(1);
  const [ppScaleY, setPpScaleY] = useState(1);

  // Document-JavaScript state.
  const [scripts, setScripts] = useState<DocumentJavascript[]>([]);
  const [scriptsLoading, setScriptsLoading] = useState(false);
  const [scriptsError, setScriptsError] = useState<string | null>(null);
  const [jsName, setJsName] = useState("");
  const [jsScript, setJsScript] = useState("");

  // Optional-content (layers) state.
  const [layers, setLayers] = useState<LayerInfo[]>([]);
  const [layersLoading, setLayersLoading] = useState(false);
  const [layersError, setLayersError] = useState<string | null>(null);
  const [ocgPage, setOcgPage] = useState(1);
  const [ocgEndPage, setOcgEndPage] = useState(1);
  /** Either an existing layer id (as string) or "new" to create one. */
  const [ocgLayerChoice, setOcgLayerChoice] = useState<string>("new");
  const [ocgNewName, setOcgNewName] = useState("");

  // Load the document JavaScript list when the JS tab is shown.
  useEffect(() => {
    if (!open || mode !== "js" || !currentFile) return;
    let cancelled = false;
    setScriptsLoading(true);
    setScriptsError(null);
    postImposition(currentFile, { action: "jsList" })
      .then(async (res) => {
        if (!res.ok) throw new Error(await readError(res));
        const json = (await res.json()) as { scripts: DocumentJavascript[] };
        if (!cancelled) setScripts(json.scripts ?? []);
      })
      .catch((err) => {
        if (!cancelled) setScriptsError(err instanceof Error ? err.message : t("js.loadFailed"));
      })
      .finally(() => {
        if (!cancelled) setScriptsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, currentFile]);

  // Load the optional-content layers when the Layers tab is shown.
  useEffect(() => {
    if (!open || mode !== "ocg" || !currentFile) return;
    let cancelled = false;
    setLayersLoading(true);
    setLayersError(null);
    postImposition(currentFile, { action: "ocgLayers" })
      .then(async (res) => {
        if (!res.ok) throw new Error(await readError(res));
        const json = (await res.json()) as { layers: LayerInfo[] };
        if (!cancelled) setLayers(json.layers ?? []);
      })
      .catch((err) => {
        if (!cancelled) setLayersError(err instanceof Error ? err.message : t("ocg.loadFailed"));
      })
      .finally(() => {
        if (!cancelled) setLayersLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, currentFile]);

  const handleClose = useCallback(() => {
    setError(null);
    setSuccess(false);
    onClose();
  }, [onClose]);

  /** Deliver a produced PDF: apply to the document if wired, else download. */
  const deliver = useCallback(
    (blob: Blob, suffix: string) => {
      if (onApplied) {
        onApplied(blob);
      } else {
        downloadBlob(blob, baseFilename.replace(/\.pdf$/i, "") + suffix);
      }
      setSuccess(true);
    },
    [onApplied, baseFilename],
  );

  /** Run a PDF-producing action; resolves false on failure (error already set). */
  const runBinary = useCallback(
    async (fields: Record<string, string>, suffix: string): Promise<boolean> => {
      if (!currentFile) {
        setError(t("errors.noFile"));
        return false;
      }
      setBusy(true);
      setError(null);
      setSuccess(false);
      try {
        const res = await postImposition(currentFile, fields);
        if (!res.ok) {
          setError(await readError(res));
          return false;
        }
        deliver(await res.blob(), suffix);
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : t("errors.generic"));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [currentFile, deliver, t],
  );

  if (!open) return null;

  const submitNup = (e: React.FormEvent) => {
    e.preventDefault();
    const preset = SHEET_PRESETS[sheet];
    void runBinary(
      {
        action: "nup",
        cols: String(cols),
        rows: String(rows),
        sheetWidth: String(preset.width),
        sheetHeight: String(preset.height),
        margin: String(margin),
        gutter: String(gutter),
      },
      "_imposed.pdf",
    );
  };

  const submitPlacePage = (e: React.FormEvent) => {
    e.preventDefault();
    void runBinary(
      {
        action: "placePage",
        target: String(ppTarget),
        source: String(ppSource),
        x: String(ppX),
        y: String(ppY),
        scaleX: String(ppScaleX),
        scaleY: String(ppScaleY),
      },
      "_placed.pdf",
    );
  };

  const submitJsAdd = (e: React.FormEvent) => {
    e.preventDefault();
    void runBinary({ action: "jsAdd", name: jsName.trim(), script: jsScript }, "_js.pdf").then((ok) => {
      if (ok) {
        // Reflect the addition optimistically in the read-only list.
        setScripts((prev) => {
          const next = prev.filter((s) => s.name !== jsName.trim());
          next.push({ name: jsName.trim(), script: jsScript });
          return next.sort((a, b) => a.name.localeCompare(b.name));
        });
        setJsName("");
        setJsScript("");
      }
    });
  };

  const removeScript = (name: string) => {
    void runBinary({ action: "jsRemove", name }, "_js.pdf").then((ok) => {
      if (ok) setScripts((prev) => prev.filter((s) => s.name !== name));
    });
  };

  const submitOcgBegin = (e: React.FormEvent) => {
    e.preventDefault();
    const fields: Record<string, string> = { action: "ocgBegin", page: String(ocgPage) };
    if (ocgLayerChoice === "new") {
      fields.layerName = ocgNewName.trim();
    } else {
      fields.ocg = ocgLayerChoice;
    }
    void runBinary(fields, "_ocg.pdf");
  };

  const submitOcgEnd = () => {
    void runBinary({ action: "ocgEnd", page: String(ocgEndPage) }, "_ocg.pdf");
  };

  const tabs: ReadonlyArray<{ value: DialogMode; Icon: typeof Grid2x2; label: string }> = [
    { value: "nup", Icon: Grid2x2, label: t("tabs.nup") },
    { value: "js", Icon: FileCode2, label: t("tabs.js") },
    { value: "ocg", Icon: Layers, label: t("tabs.ocg") },
  ];

  const ocgBeginInvalid = ocgLayerChoice === "new" && ocgNewName.trim() === "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="imposition-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-background shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-2">
          <div>
            <h2 id="imposition-dialog-title" className="text-lg font-semibold text-foreground">
              {t("headerTitle")}
            </h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{t("subtitle")}</p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label={t("close")}
            className="mt-0.5 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground shrink-0"
          >
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div
          role="tablist"
          aria-label={t("headerTitle")}
          className="mx-6 mt-1 mb-2 grid grid-cols-3 gap-1 rounded-lg border border-border bg-muted/40 p-1"
        >
          {tabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={mode === tab.value}
              onClick={() => {
                setMode(tab.value);
                setError(null);
                setSuccess(false);
              }}
              className={`flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium transition-colors ${
                mode === tab.value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <tab.Icon size={14} className="shrink-0" />
              {tab.label}
            </button>
          ))}
        </div>

        <div className="px-6 pb-6 pt-2 space-y-4">
          {!currentFile ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t("noFile")}</p>
          ) : (
            <>
              {/* ── N-up tab ───────────────────────────────────────────────── */}
              {mode === "nup" && (
                <>
                  <form onSubmit={submitNup} className="space-y-4">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">{t("nup.title")}</h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">{t("nup.intro")}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <FieldLabel htmlFor="imp-cols">{t("nup.cols")}</FieldLabel>
                        <input
                          id="imp-cols"
                          type="number"
                          min={1}
                          value={cols}
                          disabled={busy}
                          onChange={(e) => setCols(Math.max(1, Math.trunc(Number(e.target.value) || 1)))}
                          className={numberInputClass}
                        />
                      </div>
                      <div>
                        <FieldLabel htmlFor="imp-rows">{t("nup.rows")}</FieldLabel>
                        <input
                          id="imp-rows"
                          type="number"
                          min={1}
                          value={rows}
                          disabled={busy}
                          onChange={(e) => setRows(Math.max(1, Math.trunc(Number(e.target.value) || 1)))}
                          className={numberInputClass}
                        />
                      </div>
                      <div className="col-span-2">
                        <FieldLabel htmlFor="imp-sheet">{t("nup.sheet")}</FieldLabel>
                        <select
                          id="imp-sheet"
                          value={sheet}
                          disabled={busy}
                          onChange={(e) => setSheet(e.target.value as SheetPreset)}
                          className={numberInputClass}
                        >
                          <option value="a4p">{t("nup.sheetA4Portrait")}</option>
                          <option value="a4l">{t("nup.sheetA4Landscape")}</option>
                          <option value="letter">{t("nup.sheetLetter")}</option>
                        </select>
                      </div>
                      <div>
                        <FieldLabel htmlFor="imp-margin">{t("nup.margin")}</FieldLabel>
                        <input
                          id="imp-margin"
                          type="number"
                          min={0}
                          step="any"
                          value={margin}
                          disabled={busy}
                          onChange={(e) => setMargin(Math.max(0, Number(e.target.value) || 0))}
                          className={numberInputClass}
                        />
                      </div>
                      <div>
                        <FieldLabel htmlFor="imp-gutter">{t("nup.gutter")}</FieldLabel>
                        <input
                          id="imp-gutter"
                          type="number"
                          min={0}
                          step="any"
                          value={gutter}
                          disabled={busy}
                          onChange={(e) => setGutter(Math.max(0, Number(e.target.value) || 0))}
                          className={numberInputClass}
                        />
                      </div>
                    </div>
                    <button
                      type="submit"
                      disabled={busy}
                      className="w-full h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {busy && <Loader2 size={14} className="animate-spin" />}
                      <Grid2x2 size={14} />
                      {t("nup.submit")}
                    </button>
                  </form>

                  <hr className="border-border" />

                  <form onSubmit={submitPlacePage} className="space-y-4">
                    <div>
                      <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                        <StampIcon size={14} className="text-muted-foreground" />
                        {t("placePage.title")}
                      </h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">{t("placePage.intro")}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <FieldLabel htmlFor="imp-pp-target">{t("placePage.target")}</FieldLabel>
                        <input
                          id="imp-pp-target"
                          type="number"
                          min={1}
                          value={ppTarget}
                          disabled={busy}
                          onChange={(e) => setPpTarget(Math.max(1, Math.trunc(Number(e.target.value) || 1)))}
                          className={numberInputClass}
                        />
                      </div>
                      <div>
                        <FieldLabel htmlFor="imp-pp-source">{t("placePage.source")}</FieldLabel>
                        <input
                          id="imp-pp-source"
                          type="number"
                          min={1}
                          value={ppSource}
                          disabled={busy}
                          onChange={(e) => setPpSource(Math.max(1, Math.trunc(Number(e.target.value) || 1)))}
                          className={numberInputClass}
                        />
                      </div>
                      <div>
                        <FieldLabel htmlFor="imp-pp-x">{t("placePage.x")}</FieldLabel>
                        <input
                          id="imp-pp-x"
                          type="number"
                          step="any"
                          value={ppX}
                          disabled={busy}
                          onChange={(e) => setPpX(Number(e.target.value) || 0)}
                          className={numberInputClass}
                        />
                      </div>
                      <div>
                        <FieldLabel htmlFor="imp-pp-y">{t("placePage.y")}</FieldLabel>
                        <input
                          id="imp-pp-y"
                          type="number"
                          step="any"
                          value={ppY}
                          disabled={busy}
                          onChange={(e) => setPpY(Number(e.target.value) || 0)}
                          className={numberInputClass}
                        />
                      </div>
                      <div>
                        <FieldLabel htmlFor="imp-pp-sx">{t("placePage.scaleX")}</FieldLabel>
                        <input
                          id="imp-pp-sx"
                          type="number"
                          min={0}
                          step="any"
                          value={ppScaleX}
                          disabled={busy}
                          onChange={(e) => setPpScaleX(Math.max(0, Number(e.target.value) || 0))}
                          className={numberInputClass}
                        />
                      </div>
                      <div>
                        <FieldLabel htmlFor="imp-pp-sy">{t("placePage.scaleY")}</FieldLabel>
                        <input
                          id="imp-pp-sy"
                          type="number"
                          min={0}
                          step="any"
                          value={ppScaleY}
                          disabled={busy}
                          onChange={(e) => setPpScaleY(Math.max(0, Number(e.target.value) || 0))}
                          className={numberInputClass}
                        />
                      </div>
                    </div>
                    <button
                      type="submit"
                      disabled={busy}
                      className="w-full h-10 rounded-md border border-input bg-background px-4 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {busy && <Loader2 size={14} className="animate-spin" />}
                      <StampIcon size={14} />
                      {t("placePage.submit")}
                    </button>
                  </form>
                </>
              )}

              {/* ── Document JavaScript tab ────────────────────────────────── */}
              {mode === "js" && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">{t("js.title")}</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">{t("js.intro")}</p>
                  </div>

                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">{t("js.listTitle")}</p>
                    {scriptsLoading ? (
                      <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
                        <Loader2 size={14} className="animate-spin" />
                        {t("loading")}
                      </div>
                    ) : scriptsError ? (
                      <p className="text-sm text-destructive">{scriptsError}</p>
                    ) : scripts.length === 0 ? (
                      <div className="rounded-md border border-dashed border-border bg-muted/20 px-3 py-4 text-center text-sm text-muted-foreground">
                        {t("js.empty")}
                      </div>
                    ) : (
                      <ul className="space-y-1.5">
                        {scripts.map((s) => (
                          <li
                            key={s.name}
                            className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-3 py-2"
                          >
                            <span className="truncate text-sm font-medium text-foreground">{s.name}</span>
                            <button
                              type="button"
                              onClick={() => removeScript(s.name)}
                              disabled={busy}
                              aria-label={t("js.remove", { name: s.name })}
                              className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-destructive disabled:opacity-50"
                            >
                              <Trash2 size={14} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <form onSubmit={submitJsAdd} className="space-y-3">
                    <div>
                      <FieldLabel htmlFor="imp-js-name">{t("js.name")}</FieldLabel>
                      <input
                        id="imp-js-name"
                        value={jsName}
                        disabled={busy}
                        placeholder={t("js.namePlaceholder")}
                        onChange={(e) => setJsName(e.target.value)}
                        className={numberInputClass}
                      />
                    </div>
                    <div>
                      <FieldLabel htmlFor="imp-js-script">{t("js.script")}</FieldLabel>
                      <textarea
                        id="imp-js-script"
                        value={jsScript}
                        disabled={busy}
                        rows={4}
                        placeholder={t("js.scriptPlaceholder")}
                        onChange={(e) => setJsScript(e.target.value)}
                        className="w-full px-3 py-2 rounded-md border border-input bg-background font-mono text-xs focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={busy || jsName.trim() === "" || jsScript.trim() === ""}
                      className="w-full h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {busy && <Loader2 size={14} className="animate-spin" />}
                      <Plus size={14} />
                      {t("js.add")}
                    </button>
                  </form>
                </div>
              )}

              {/* ── Optional-content (layers) tab ──────────────────────────── */}
              {mode === "ocg" && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">{t("ocg.title")}</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">{t("ocg.intro")}</p>
                  </div>

                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">{t("ocg.layersTitle")}</p>
                    {layersLoading ? (
                      <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
                        <Loader2 size={14} className="animate-spin" />
                        {t("loading")}
                      </div>
                    ) : layersError ? (
                      <p className="text-sm text-destructive">{layersError}</p>
                    ) : layers.length === 0 ? (
                      <div className="rounded-md border border-dashed border-border bg-muted/20 px-3 py-4 text-center text-sm text-muted-foreground">
                        {t("ocg.emptyLayers")}
                      </div>
                    ) : (
                      <ul className="space-y-1.5">
                        {layers.map((layer) => (
                          <li
                            key={layer.id}
                            className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-3 py-2"
                          >
                            <span className="truncate text-sm font-medium text-foreground">{layer.name}</span>
                            <span className="flex items-center gap-2 text-xs text-muted-foreground">
                              {layer.visible ? (
                                <span className="inline-flex items-center gap-1">
                                  <Eye size={12} />
                                  {t("ocg.visible")}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1">
                                  <EyeOff size={12} />
                                  {t("ocg.hidden")}
                                </span>
                              )}
                              {layer.locked && (
                                <span className="inline-flex items-center gap-1">
                                  <Lock size={12} />
                                  {t("ocg.locked")}
                                </span>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <form onSubmit={submitOcgBegin} className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <FieldLabel htmlFor="imp-ocg-page">{t("ocg.page")}</FieldLabel>
                        <input
                          id="imp-ocg-page"
                          type="number"
                          min={1}
                          value={ocgPage}
                          disabled={busy}
                          onChange={(e) => setOcgPage(Math.max(1, Math.trunc(Number(e.target.value) || 1)))}
                          className={numberInputClass}
                        />
                      </div>
                      <div>
                        <FieldLabel htmlFor="imp-ocg-layer">{t("ocg.layer")}</FieldLabel>
                        <select
                          id="imp-ocg-layer"
                          value={ocgLayerChoice}
                          disabled={busy}
                          onChange={(e) => setOcgLayerChoice(e.target.value)}
                          className={numberInputClass}
                        >
                          <option value="new">{t("ocg.newLayer")}</option>
                          {layers.map((layer) => (
                            <option key={layer.id} value={String(layer.id)}>
                              {layer.name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    {ocgLayerChoice === "new" && (
                      <div>
                        <FieldLabel htmlFor="imp-ocg-name">{t("ocg.layerName")}</FieldLabel>
                        <input
                          id="imp-ocg-name"
                          value={ocgNewName}
                          disabled={busy}
                          placeholder={t("ocg.layerNamePlaceholder")}
                          onChange={(e) => setOcgNewName(e.target.value)}
                          className={numberInputClass}
                        />
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">{t("ocg.beginHint")}</p>
                    <button
                      type="submit"
                      disabled={busy || ocgBeginInvalid}
                      className="w-full h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {busy && <Loader2 size={14} className="animate-spin" />}
                      <Layers size={14} />
                      {t("ocg.begin")}
                    </button>
                  </form>

                  <hr className="border-border" />

                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3 items-end">
                      <div>
                        <FieldLabel htmlFor="imp-ocg-endpage">{t("ocg.page")}</FieldLabel>
                        <input
                          id="imp-ocg-endpage"
                          type="number"
                          min={1}
                          value={ocgEndPage}
                          disabled={busy}
                          onChange={(e) => setOcgEndPage(Math.max(1, Math.trunc(Number(e.target.value) || 1)))}
                          className={numberInputClass}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={submitOcgEnd}
                        disabled={busy}
                        className="h-9 rounded-md border border-input bg-background px-4 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50 flex items-center justify-center gap-2"
                      >
                        {busy && <Loader2 size={14} className="animate-spin" />}
                        {t("ocg.end")}
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground">{t("ocg.endHint")}</p>
                  </div>
                </div>
              )}

              {error && <p className="text-sm text-destructive">{error}</p>}
              {success && (
                <p className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 size={14} />
                  {t("downloaded")}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
