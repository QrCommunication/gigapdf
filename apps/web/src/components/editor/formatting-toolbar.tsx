/**
 * formatting-toolbar.tsx
 *
 * The Word-like quick formatting cluster of the editor toolbar. Rendered only
 * when at least one *text* element is selected. Every control patches the
 * selected text element(s)' `style` through the same
 * `onElementStyleChange(elementId, Partial<TextStyle>)` flow the FontPicker and
 * the properties panel use — so edits reflect on the Fabric canvas
 * (applyLocalElementUpdate) and bake into the PDF via the operations queue
 * (queueUpdate), with no new save path.
 *
 * Toggle/active states are DERIVED from the (primary) selected element's style
 * during render: a button is "active" when the selection already carries that
 * style (e.g. bold when fontWeight === "bold"). On multi-select the edit
 * fans out to every selected text element; the displayed state follows the
 * first one.
 */

"use client";

import React, { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  Baseline,
  ChevronDown,
} from "lucide-react";
import type { TextElement, TextStyle } from "@giga-pdf/types";

/** Line-spacing presets surfaced by the quick menu (Word's common values). */
const LINE_SPACING_PRESETS: readonly number[] = [1, 1.15, 1.5, 2, 2.5, 3];

/** Default highlight colour applied when toggling highlight on with no value. */
const DEFAULT_HIGHLIGHT = "#ffff00";

type TextAlignValue = NonNullable<TextStyle["textAlign"]>;

export interface FormattingToolbarProps {
  /**
   * The text elements currently selected. The cluster only renders when this is
   * non-empty; edits fan out to all of them, the active state follows the first.
   */
  selectedTextElements: TextElement[];
  /** Patch a text element's style — same contract as the FontPicker/panel. */
  onElementStyleChange: (
    elementId: string,
    style: Partial<TextStyle>,
  ) => void;
}

interface FormatButtonProps {
  icon: React.ReactNode;
  label: string;
  isActive?: boolean;
  onClick: () => void;
}

/** A toolbar toggle button matching the editor toolbar's ToolButton styling. */
function FormatButton({ icon, label, isActive, onClick }: FormatButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-pressed={isActive ?? false}
      className={`p-2 rounded-lg transition-colors flex items-center gap-0.5 cursor-pointer ${
        isActive
          ? "bg-primary text-primary-foreground"
          : "hover:bg-muted text-muted-foreground hover:text-foreground"
      }`}
    >
      {icon}
    </button>
  );
}

function Separator() {
  return <div className="w-px h-6 bg-border mx-1" />;
}

export function FormattingToolbar({
  selectedTextElements,
  onElementStyleChange,
}: FormattingToolbarProps) {
  const t = useTranslations("editor.toolbar");
  const [showSpacing, setShowSpacing] = useState(false);
  const spacingRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showSpacing) return;
    function handleClickOutside(event: MouseEvent) {
      if (
        spacingRef.current &&
        !spacingRef.current.contains(event.target as Node)
      ) {
        setShowSpacing(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () =>
      document.removeEventListener("mousedown", handleClickOutside);
  }, [showSpacing]);

  // Source of truth for the active states = the primary (first) selection.
  const primary = selectedTextElements[0];
  if (!primary) return null;
  const style = primary.style;

  const isBold = style?.fontWeight === "bold";
  const isItalic = style?.fontStyle === "italic";
  const isUnderline = style?.underline === true;
  const isStrike = style?.strikethrough === true;
  const align: TextAlignValue = style?.textAlign ?? "left";
  const hasHighlight = !!style?.backgroundColor;
  const color = style?.color || "#000000";
  const highlight = style?.backgroundColor || DEFAULT_HIGHLIGHT;

  /** Fan a style patch out to every selected text element. */
  const patchAll = (patch: Partial<TextStyle>) => {
    for (const el of selectedTextElements) {
      onElementStyleChange(el.elementId, patch);
    }
  };

  return (
    <>
      {/* Bold / Italic / Underline / Strikethrough */}
      <FormatButton
        icon={<Bold size={20} />}
        label={t("bold")}
        isActive={isBold}
        onClick={() =>
          patchAll({ fontWeight: isBold ? "normal" : "bold" })
        }
      />
      <FormatButton
        icon={<Italic size={20} />}
        label={t("italic")}
        isActive={isItalic}
        onClick={() =>
          patchAll({ fontStyle: isItalic ? "normal" : "italic" })
        }
      />
      <FormatButton
        icon={<Underline size={20} />}
        label={t("underline")}
        isActive={isUnderline}
        onClick={() => patchAll({ underline: !isUnderline })}
      />
      <FormatButton
        icon={<Strikethrough size={20} />}
        label={t("strikethrough")}
        isActive={isStrike}
        onClick={() => patchAll({ strikethrough: !isStrike })}
      />

      <Separator />

      {/* Text colour + highlight (backgroundColor) */}
      <label
        title={t("textColor")}
        className="relative p-2 rounded-lg hover:bg-muted cursor-pointer flex items-center"
      >
        <span className="flex flex-col items-center leading-none">
          <span className="text-sm font-semibold text-foreground">A</span>
          <span
            className="block h-1 w-4 rounded-sm"
            style={{ backgroundColor: color }}
          />
        </span>
        <input
          type="color"
          value={color}
          onChange={(e) => patchAll({ color: e.target.value })}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </label>
      <div className="flex items-center">
        <label
          title={t("textHighlight")}
          className={`relative p-2 rounded-l-lg cursor-pointer flex items-center transition-colors ${
            hasHighlight
              ? "bg-primary text-primary-foreground"
              : "hover:bg-muted text-muted-foreground hover:text-foreground"
          }`}
        >
          <span className="flex flex-col items-center leading-none">
            <span className="text-sm font-semibold">H</span>
            <span
              className="block h-1 w-4 rounded-sm"
              style={{ backgroundColor: highlight }}
            />
          </span>
          <input
            type="color"
            value={highlight}
            onChange={(e) =>
              patchAll({ backgroundColor: e.target.value })
            }
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
        {hasHighlight ? (
          <button
            type="button"
            title={t("textHighlightClear")}
            onClick={() => patchAll({ backgroundColor: null })}
            className="px-1 h-9 rounded-r-lg border-l border-background/30 bg-primary text-primary-foreground hover:bg-primary/90 text-xs"
          >
            ×
          </button>
        ) : null}
      </div>

      <Separator />

      {/* Alignment — left / center / right / justify */}
      <FormatButton
        icon={<AlignLeft size={20} />}
        label={t("alignLeft")}
        isActive={align === "left"}
        onClick={() => patchAll({ textAlign: "left" })}
      />
      <FormatButton
        icon={<AlignCenter size={20} />}
        label={t("alignCenter")}
        isActive={align === "center"}
        onClick={() => patchAll({ textAlign: "center" })}
      />
      <FormatButton
        icon={<AlignRight size={20} />}
        label={t("alignRight")}
        isActive={align === "right"}
        onClick={() => patchAll({ textAlign: "right" })}
      />
      <FormatButton
        icon={<AlignJustify size={20} />}
        label={t("alignJustify")}
        isActive={align === "justify"}
        onClick={() => patchAll({ textAlign: "justify" })}
      />

      <Separator />

      {/* Line spacing — quick preset menu driving lineHeight */}
      <div className="relative" ref={spacingRef}>
        <button
          type="button"
          onClick={() => setShowSpacing((v) => !v)}
          title={t("lineSpacing")}
          className="p-2 rounded-lg transition-colors flex items-center gap-0.5 cursor-pointer hover:bg-muted text-muted-foreground hover:text-foreground"
        >
          <Baseline size={20} />
          <ChevronDown size={12} />
        </button>
        {showSpacing ? (
          <div className="absolute top-full left-0 mt-1 bg-background border rounded-lg shadow-lg p-1 z-50 min-w-[120px]">
            {LINE_SPACING_PRESETS.map((value) => {
              const active = (style?.lineHeight ?? 1.16) === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    patchAll({ lineHeight: value });
                    setShowSpacing(false);
                  }}
                  className={`flex w-full items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors ${
                    active
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted"
                  }`}
                >
                  {value.toFixed(2).replace(/\.00$/, "")}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      <Separator />
    </>
  );
}
