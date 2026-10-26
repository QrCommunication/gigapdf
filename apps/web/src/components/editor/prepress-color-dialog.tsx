"use client";

import React, { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { X, Loader2, Palette, Upload } from "lucide-react";
import {
  useApplyPrepressColor,
  type PrepressColor,
  type PrepressOverprint,
} from "@giga-pdf/api";
import {
  Button,
  Input,
  Slider,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
  Label,
  Switch,
} from "@giga-pdf/ui";

/** Colour space selector values. */
type ColorSpace = "rgb" | "cmyk" | "gray" | "separation";

export interface PrepressColorDialogProps {
  open: boolean;
  onClose: () => void;
  /** Current PDF file to apply the colour onto. */
  currentFile: File | null;
  /** 1-based page number for the paint operation. */
  pageNumber: number;
  /** Called with the modified PDF bytes after a successful apply. */
  onApplied?: (blob: Blob) => void;
}

/**
 * Convert an RGB hex string (#RRGGBB) to a packed 0xRRGGBB integer.
 * Returns 0 on invalid input.
 */
function hexToRgbInt(hex: string): number {
  const cleaned = hex.replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(cleaned)) return 0;
  return parseInt(cleaned, 16);
}

/**
 * Build a {@link PrepressColor} from the current dialog state.
 * Returns null when required fields are missing.
 */
function buildColor(
  space: ColorSpace,
  rgbHex: string,
  cmyk: [number, number, number, number],
  gray: number,
  spotName: string,
  spotTint: number,
  spotCmyk: [number, number, number, number],
): PrepressColor | null {
  switch (space) {
    case "rgb":
      return { space: "rgb", rgb: hexToRgbInt(rgbHex) };
    case "cmyk":
      return { space: "cmyk", c: cmyk[0], m: cmyk[1], y: cmyk[2], k: cmyk[3] };
    case "gray":
      return { space: "gray", gray };
    case "separation":
      if (!spotName.trim()) return null;
      return {
        space: "separation",
        name: spotName.trim(),
        tint: spotTint,
        cmyk: spotCmyk,
      };
  }
}

/**
 * PrepressColorDialog — applies a press-ready colour (RGB / CMYK / gray /
 * spot Separation) or embeds an ICC output intent onto the current PDF via
 * `POST /api/pdf/color`. Mirrors the CompressDialog apply/download pattern.
 *
 * The dialog does NOT modify the Fabric scene graph — it bakes the colour
 * directly into the PDF binary via the WASM engine. The caller adopts the
 * returned blob as the new document.
 */
export function PrepressColorDialog({
  open,
  onClose,
  currentFile,
  pageNumber,
  onApplied,
}: PrepressColorDialogProps) {
  const t = useTranslations("editor.colors");

  // --- Colour space state ---
  const [space, setSpace] = useState<ColorSpace>("cmyk");
  const [rgbHex, setRgbHex] = useState("#000000");
  const [cmyk, setCmyk] = useState<[number, number, number, number]>([0, 0, 0, 1]);
  const [gray, setGray] = useState(0);
  const [spotName, setSpotName] = useState("");
  const [spotTint, setSpotTint] = useState(1);
  const [spotCmyk, setSpotCmyk] = useState<[number, number, number, number]>([1, 1, 0, 0]);

  // --- Overprint state ---
  const [overprintFill, setOverprintFill] = useState(false);
  const [overprintStroke, setOverprintStroke] = useState(false);
  const [overprintMode, setOverprintMode] = useState(false);

  // --- Rectangle state (paint area in points) ---
  const [rectX, setRectX] = useState(0);
  const [rectY, setRectY] = useState(0);
  const [rectW, setRectW] = useState(200);
  const [rectH, setRectH] = useState(40);

  // --- Opacity ---
  const [opacity, setOpacity] = useState(1);

  // --- Output intent state ---
  const [iccFile, setIccFile] = useState<File | null>(null);
  const [condition, setCondition] = useState("");

  // --- Active tab: "color" or "output-intent" ---
  const [activeTab, setActiveTab] = useState<"color" | "output-intent">("color");

  const applyColor = useApplyPrepressColor();

  const handleClose = useCallback(() => {
    applyColor.reset();
    onClose();
  }, [applyColor, onClose]);

  const handleApplyColor = async () => {
    if (!currentFile || applyColor.isPending) return;

    const color = buildColor(space, rgbHex, cmyk, gray, spotName, spotTint, spotCmyk);
    if (!color) return;

    const overprint: PrepressOverprint | undefined =
      overprintFill || overprintStroke
        ? { fill: overprintFill, stroke: overprintStroke, mode: overprintMode ? 1 : 0 }
        : undefined;

    try {
      const blob = await applyColor.mutateAsync({
        file: currentFile,
        page: pageNumber,
        operation: "fill",
        payload: {
          rect: { x: rectX, y: rectY, w: rectW, h: rectH },
          color,
          opacity,
        },
        overprint,
      });
      onApplied?.(blob);
    } catch {
      // Error is surfaced via applyColor.error below.
    }
  };

  const handleEmbedOutputIntent = async () => {
    if (!currentFile || !iccFile || !condition.trim() || applyColor.isPending) return;

    try {
      const blob = await applyColor.mutateAsync({
        file: currentFile,
        page: pageNumber,
        operation: "output-intent",
        iccProfile: iccFile,
        condition: condition.trim(),
      });
      onApplied?.(blob);
    } catch {
      // Error is surfaced via applyColor.error below.
    }
  };

  if (!open) return null;

  const isApplying = applyColor.isPending;
  const error = applyColor.error;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="prepress-color-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="relative w-full max-w-lg rounded-xl border border-border bg-background shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-2">
          <div className="flex items-center gap-2">
            <Palette size={18} className="text-muted-foreground" />
            <h2 id="prepress-color-title" className="text-lg font-semibold">
              {t("title")}
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="rounded-md p-1 text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <p className="px-6 text-sm text-muted-foreground pb-2">
          {t("description")}
        </p>

        {/* Tabs: Colour vs Output Intent */}
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "color" | "output-intent")} className="px-6">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="color">{t("title")}</TabsTrigger>
            <TabsTrigger value="output-intent">{t("outputIntent")}</TabsTrigger>
          </TabsList>

          {/* ===== COLOUR TAB ===== */}
          <TabsContent value="color" className="space-y-4 mt-4 overflow-y-auto max-h-[60vh] pr-1">
            {/* Colour space selector */}
            <div>
              <Label className="text-xs text-muted-foreground mb-1 block">{t("space")}</Label>
              <Tabs value={space} onValueChange={(v) => setSpace(v as ColorSpace)}>
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="rgb">{t("spaceRgb")}</TabsTrigger>
                  <TabsTrigger value="cmyk">{t("spaceCmyk")}</TabsTrigger>
                  <TabsTrigger value="gray">{t("spaceGray")}</TabsTrigger>
                  <TabsTrigger value="separation">{t("spaceSeparation")}</TabsTrigger>
                </TabsList>

                {/* RGB */}
                <TabsContent value="rgb" className="mt-3">
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={rgbHex}
                      onChange={(e) => setRgbHex(e.target.value)}
                      className="h-10 w-10 cursor-pointer rounded border border-input"
                      aria-label={t("color")}
                    />
                    <Input
                      value={rgbHex}
                      onChange={(e) => setRgbHex(e.target.value)}
                      placeholder="#000000"
                      className="flex-1"
                    />
                  </div>
                </TabsContent>

                {/* CMYK */}
                <TabsContent value="cmyk" className="mt-3 space-y-2">
                  {(["c", "m", "y", "k"] as const).map((ch, i) => (
                    <div key={ch} className="flex items-center gap-2">
                      <Label className="w-16 text-xs uppercase">{t(ch === "c" ? "cyan" : ch === "m" ? "magenta" : ch === "y" ? "yellow" : "black")}</Label>
                      <Slider
                        value={[(cmyk[i] ?? 0) * 100]}
                        onValueChange={(vals: number[]) => {
                          const v = vals[0];
                          if (v === undefined) return;
                          const next = [...cmyk] as [number, number, number, number];
                          next[i] = v / 100;
                          setCmyk(next);
                        }}
                        min={0}
                        max={100}
                        step={1}
                        className="flex-1"
                      />
                      <span className="w-10 text-right text-xs tabular-nums">{Math.round((cmyk[i] ?? 0) * 100)}%</span>
                    </div>
                  ))}
                </TabsContent>

                {/* Gray */}
                <TabsContent value="gray" className="mt-3">
                  <div className="flex items-center gap-2">
                    <Label className="w-12 text-xs">{t("gray")}</Label>
                    <Slider
                      value={[gray * 100]}
                      onValueChange={(vals: number[]) => {
                        const v = vals[0];
                        if (v !== undefined) setGray(v / 100);
                      }}
                      min={0}
                      max={100}
                      step={1}
                      className="flex-1"
                    />
                    <span className="w-10 text-right text-xs tabular-nums">{Math.round(gray * 100)}%</span>
                  </div>
                </TabsContent>

                {/* Spot / Separation */}
                <TabsContent value="separation" className="mt-3 space-y-3">
                  <div>
                    <Label className="text-xs text-muted-foreground block mb-1">{t("spotName")}</Label>
                    <Input
                      value={spotName}
                      onChange={(e) => setSpotName(e.target.value)}
                      placeholder={t("spotNamePlaceholder")}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="w-12 text-xs">{t("tint")}</Label>
                    <Slider
                      value={[spotTint * 100]}
                      onValueChange={(vals: number[]) => {
                        const v = vals[0];
                        if (v !== undefined) setSpotTint(v / 100);
                      }}
                      min={0}
                      max={100}
                      step={1}
                      className="flex-1"
                    />
                    <span className="w-10 text-right text-xs tabular-nums">{Math.round(spotTint * 100)}%</span>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground block mb-1">{t("approxCmyk")}</Label>
                    <div className="grid grid-cols-4 gap-1">
                      {(["C", "M", "Y", "K"] as const).map((ch, i) => (
                        <div key={ch}>
                          <Label className="text-[10px] uppercase">{ch}</Label>
                          <Input
                            type="number"
                            min={0}
                            max={100}
                            value={Math.round((spotCmyk[i] ?? 0) * 100)}
                            onChange={(e) => {
                              const v = Math.min(100, Math.max(0, Number(e.target.value)));
                              const next = [...spotCmyk] as [number, number, number, number];
                              next[i] = v / 100;
                              setSpotCmyk(next);
                            }}
                            className="h-7 text-xs"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </div>

            {/* Rectangle (paint area) */}
            <div>
              <Label className="text-xs text-muted-foreground block mb-1">{t("rect")}</Label>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { label: t("x"), value: rectX, set: setRectX },
                  { label: t("y"), value: rectY, set: setRectY },
                  { label: t("width"), value: rectW, set: setRectW },
                  { label: t("height"), value: rectH, set: setRectH },
                ].map(({ label, value, set }) => (
                  <div key={label}>
                    <Label className="text-[10px] uppercase">{label}</Label>
                    <Input
                      type="number"
                      value={value}
                      onChange={(e) => set(Number(e.target.value))}
                      className="h-7 text-xs"
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Opacity */}
            <div className="flex items-center gap-2">
              <Label className="w-16 text-xs">{t("opacity")}</Label>
              <Slider
                value={[opacity * 100]}
                onValueChange={(vals: number[]) => {
                  const v = vals[0];
                  if (v !== undefined) setOpacity(v / 100);
                }}
                min={0}
                max={100}
                step={1}
                className="flex-1"
              />
              <span className="w-10 text-right text-xs tabular-nums">{Math.round(opacity * 100)}%</span>
            </div>

            {/* Overprint (only relevant for CMYK / Spot) */}
            {(space === "cmyk" || space === "separation") && (
              <div className="space-y-1.5 border-t border-border pt-3">
                <Label className="text-xs font-medium">{t("overprint")}</Label>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <Switch checked={overprintFill} onCheckedChange={setOverprintFill} />
                  <span className="text-xs text-muted-foreground">{t("overprintFill")}</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <Switch checked={overprintStroke} onCheckedChange={setOverprintStroke} />
                  <span className="text-xs text-muted-foreground">{t("overprintStroke")}</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <Switch checked={overprintMode} onCheckedChange={setOverprintMode} />
                  <span className="text-xs text-muted-foreground">{t("overprintMode")}</span>
                </label>
              </div>
            )}
          </TabsContent>

          {/* ===== OUTPUT INTENT TAB ===== */}
          <TabsContent value="output-intent" className="space-y-4 mt-4">
            <p className="text-sm text-muted-foreground">{t("outputIntentDescription")}</p>

            <div>
              <Label className="text-xs text-muted-foreground block mb-1">{t("iccProfile")}</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="file"
                  accept=".icc,.icm"
                  onChange={(e) => setIccFile(e.target.files?.[0] ?? null)}
                  className="flex-1"
                />
                {iccFile && <Upload size={14} className="text-muted-foreground" />}
              </div>
            </div>

            <div>
              <Label className="text-xs text-muted-foreground block mb-1">{t("condition")}</Label>
              <Input
                value={condition}
                onChange={(e) => setCondition(e.target.value)}
                placeholder={t("conditionPlaceholder")}
              />
            </div>
          </TabsContent>
        </Tabs>

        {/* Error message */}
        {error && (
          <div className="mx-6 mt-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {activeTab === "color" ? t("error") : t("embedError")}
          </div>
        )}

        {/* Footer actions */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border">
          <Button variant="outline" onClick={handleClose} disabled={isApplying}>
            Close
          </Button>
          {activeTab === "color" ? (
            <Button onClick={handleApplyColor} disabled={isApplying || !currentFile}>
              {isApplying && <Loader2 size={14} className="mr-1 animate-spin" />}
              {isApplying ? t("applying") : t("apply")}
            </Button>
          ) : (
            <Button
              onClick={handleEmbedOutputIntent}
              disabled={isApplying || !currentFile || !iccFile || !condition.trim()}
            >
              {isApplying && <Loader2 size={14} className="mr-1 animate-spin" />}
              {isApplying ? t("embedding") : t("embed")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}