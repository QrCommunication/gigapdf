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
 *
 * WORD-LIKE PARTIAL FORMATTING. When a text element is in inline-edit mode with
 * a character SUB-SELECTION, the canvas reports that range's live style via
 * `textSelectionStyle` (non-null) and exposes `applyTextSelectionStyle`. In
 * that mode every control applies to JUST the selected characters (Fabric
 * `setSelectionStyles`, persisted as `TextElement.runs`) and its active state
 * reflects the selection — falling back to the whole-element flow when there is
 * no sub-selection (caret only / not editing). Fully backward-compatible: with
 * no edit selection the behaviour is exactly the previous whole-element one.
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
  /**
   * Word-like PARTIAL formatting. Live style of the character sub-selection
   * inside the text element being inline-edited, or `null` when none. When
   * non-null AND {@link applyTextSelectionStyle} is provided, controls target
   * the SELECTION and their active state reflects it.
   */
  textSelectionStyle?: Partial<TextStyle> | null;
  /**
   * Apply a style patch to the active text edit SUB-SELECTION. Returns `true`
   * when a sub-range was styled; `false` when no text is being edited with a
   * selection — the control then falls back to the whole-element flow.
   */
  applyTextSelectionStyle?: (patch: Partial<TextStyle>) => boolean;
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
  textSelectionStyle = null,
  applyTextSelectionStyle,
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

  // Word-like PARTIAL mode is active when the canvas reports a live character
  // sub-selection AND the selection-style applier is wired. In that mode the
  // *character-level* fields (B/I/U/S, colour, size, font) reflect the
  // selection; paragraph-level fields (alignment, line spacing) stay element-
  // scoped (Fabric has no per-character alignment).
  const selectionMode = textSelectionStyle !== null && !!applyTextSelectionStyle;
  // For active-state of a per-character field: in selection mode read it from
  // the selection style (absent = mixed/none ⇒ inactive); otherwise from the
  // element. A consistent bold selection ⇒ Bold lit; a mixed one ⇒ Bold off.
  const charField = <K extends keyof TextStyle>(key: K): TextStyle[K] | undefined =>
    selectionMode ? textSelectionStyle?.[key] : style?.[key];

  const isBold = charField("fontWeight") === "bold";
  const isItalic = charField("fontStyle") === "italic";
  const isUnderline = charField("underline") === true;
  const isStrike = charField("strikethrough") === true;
  // Alignment / highlight stay element-scoped (paragraph-level).
  const align: TextAlignValue = style?.textAlign ?? "left";
  const hasHighlight = !!style?.backgroundColor;
  const color = (charField("color") as string | undefined) || style?.color || "#000000";
  const highlight = style?.backgroundColor || DEFAULT_HIGHLIGHT;

  /**
   * Apply a CHARACTER-LEVEL style patch. In partial mode it targets the live
   * text sub-selection (persisted as `runs`); if that reports "no selection"
   * (returns false) or partial mode is off, it falls back to fanning the patch
   * out to every selected text element (whole-element, legacy behaviour).
   */
  const patchChars = (patch: Partial<TextStyle>) => {
    if (applyTextSelectionStyle && applyTextSelectionStyle(patch)) return;
    for (const el of selectedTextElements) {
      onElementStyleChange(el.elementId, patch);
    }
  };

  /**
   * Apply a PARAGRAPH/element-level style patch (alignment, line spacing,
   * highlight). Always whole-element — these have no per-character meaning.
   */
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
          patchChars({ fontWeight: isBold ? "normal" : "bold" })
        }
      />
      <FormatButton
        icon={<Italic size={20} />}
        label={t("italic")}
        isActive={isItalic}
        onClick={() =>
          patchChars({ fontStyle: isItalic ? "normal" : "italic" })
        }
      />
      <FormatButton
        icon={<Underline size={20} />}
        label={t("underline")}
        isActive={isUnderline}
        onClick={() => patchChars({ underline: !isUnderline })}
      />
      <FormatButton
        icon={<Strikethrough size={20} />}
        label={t("strikethrough")}
        isActive={isStrike}
        onClick={() => patchChars({ strikethrough: !isStrike })}
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
          onChange={(e) => patchChars({ color: e.target.value })}
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
