"use client";

import React from "react";
import {
  Replace,
  ClipboardCopy,
  Scissors,
  ClipboardPaste,
  Paintbrush,
} from "lucide-react";
import { useTranslations } from "next-intl";

export interface EditorEditToolsProps {
  /** Open the find & replace dialog. */
  onFindReplace: () => void;
  /** Copy the current selection to the in-app clipboard. */
  onCopy: () => void;
  /** Cut the current selection (copy + delete). */
  onCut: () => void;
  /** Paste the in-app clipboard (offset clones). */
  onPaste: () => void;
  /** Pick up the formatting of the selected text element ("copy format"). */
  onCopyFormat: () => void;
  /** True while at least one element is selected. */
  hasSelection: boolean;
  /** True when a single text element is selected (format painter source). */
  canCopyFormat: boolean;
  /** True when the in-app clipboard has content to paste. */
  canPaste: boolean;
  /** True while a format has been picked up and is armed to be applied. */
  formatPainterArmed: boolean;
}

interface ToolButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  isActive?: boolean;
}

function ToolButton({
  icon,
  label,
  onClick,
  disabled,
  isActive,
}: ToolButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={isActive}
      className={`p-2 rounded-lg transition-colors flex items-center gap-1 ${
        isActive
          ? "bg-primary text-primary-foreground"
          : "hover:bg-muted text-muted-foreground hover:text-foreground"
      } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
    >
      {icon}
    </button>
  );
}

function Separator() {
  return <div className="w-px h-6 bg-border mx-1" />;
}

/**
 * EditorEditTools — a compact secondary toolbar row for the P7 editing
 * toolset (find & replace, clipboard, format painter). Kept as a standalone
 * component (rendered right under the main EditorToolbar) so the primary
 * toolbar file stays untouched and merges remain conflict-free.
 */
export function EditorEditTools({
  onFindReplace,
  onCopy,
  onCut,
  onPaste,
  onCopyFormat,
  hasSelection,
  canCopyFormat,
  canPaste,
  formatPainterArmed,
}: EditorEditToolsProps) {
  const t = useTranslations("editor.editTools");

  return (
    <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border bg-background/60">
      <ToolButton
        icon={<Replace size={18} />}
        label={t("findReplace.open")}
        onClick={onFindReplace}
      />

      <Separator />

      <ToolButton
        icon={<ClipboardCopy size={18} />}
        label={t("clipboard.copy")}
        onClick={onCopy}
        disabled={!hasSelection}
      />
      <ToolButton
        icon={<Scissors size={18} />}
        label={t("clipboard.cut")}
        onClick={onCut}
        disabled={!hasSelection}
      />
      <ToolButton
        icon={<ClipboardPaste size={18} />}
        label={t("clipboard.paste")}
        onClick={onPaste}
        disabled={!canPaste}
      />

      <Separator />

      <ToolButton
        icon={<Paintbrush size={18} />}
        label={
          formatPainterArmed
            ? t("formatPainter.applyHint")
            : t("formatPainter.copy")
        }
        onClick={onCopyFormat}
        disabled={!formatPainterArmed && !canCopyFormat}
        isActive={formatPainterArmed}
      />
    </div>
  );
}
