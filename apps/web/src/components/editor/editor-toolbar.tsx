"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { Tool } from "@giga-pdf/types";
import {
  MousePointer2,
  Type,
  Image,
  Square,
  PenTool,
  MessageSquare,
  Hand,
  ZoomIn,
  ZoomOut,
  Undo2,
  Redo2,
  Bold,
  Italic,
  Underline,
  AlignLeft,
  AlignCenter,
  AlignRight,
} from "lucide-react";

export interface EditorToolbarProps {
  /** Outil actuellement sélectionné */
  activeTool: Tool;
  /** Callback pour changer d'outil */
  onToolChange: (tool: Tool) => void;
  /** Niveau de zoom actuel */
  zoom: number;
  /** Callback pour changer le zoom */
  onZoomChange: (zoom: number) => void;
  /** Peut annuler */
  canUndo: boolean;
  /** Peut refaire */
  canRedo: boolean;
  /** Callback pour annuler */
  onUndo: () => void;
  /** Callback pour refaire */
  onRedo: () => void;
  /** Éléments sélectionnés */
  hasSelection: boolean;
  /** Callback pour les actions de formatage */
  onFormatAction?: (action: "bold" | "italic" | "underline" | "align-left" | "align-center" | "align-right") => void;
}

interface ToolButtonProps {
  icon: React.ReactNode;
  label: string;
  isActive?: boolean;
  onClick: () => void;
  disabled?: boolean;
}

function ToolButton({ icon, label, isActive, onClick, disabled }: ToolButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={`
        p-2 rounded-lg transition-colors
        ${isActive
          ? "bg-primary text-primary-foreground"
          : "hover:bg-muted text-muted-foreground hover:text-foreground"
        }
        ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
      `}
    >
      {icon}
    </button>
  );
}

function Separator() {
  return <div className="w-px h-6 bg-border mx-1" />;
}

/**
 * Barre d'outils de l'éditeur PDF.
 */
export function EditorToolbar({
  activeTool,
  onToolChange,
  zoom,
  onZoomChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  hasSelection,
  onFormatAction,
}: EditorToolbarProps) {
  const t = useTranslations("editor.toolbar");

  // Définition des outils
  const tools: { tool: Tool; icon: React.ReactNode; labelKey: string }[] = [
    { tool: "select", icon: <MousePointer2 size={20} />, labelKey: "select" },
    { tool: "text", icon: <Type size={20} />, labelKey: "text" },
    { tool: "image", icon: <Image size={20} />, labelKey: "image" },
    { tool: "shape", icon: <Square size={20} />, labelKey: "shape" },
    { tool: "annotation", icon: <MessageSquare size={20} />, labelKey: "annotation" },
    { tool: "form_field", icon: <PenTool size={20} />, labelKey: "draw" },
    { tool: "hand", icon: <Hand size={20} />, labelKey: "pan" },
  ];

  // Presets de zoom
  const zoomPresets = [0.5, 0.75, 1, 1.25, 1.5, 2];

  return (
    <div className="editor-toolbar flex items-center gap-1 p-2 bg-background border-b">
      {/* Undo/Redo */}
      <ToolButton
        icon={<Undo2 size={20} />}
        label={t("undo")}
        onClick={onUndo}
        disabled={!canUndo}
      />
      <ToolButton
        icon={<Redo2 size={20} />}
        label={t("redo")}
        onClick={onRedo}
        disabled={!canRedo}
      />

      <Separator />

      {/* Outils principaux */}
      {tools.map(({ tool, icon, labelKey }) => (
        <ToolButton
          key={tool}
          icon={icon}
          label={t(labelKey)}
          isActive={activeTool === tool}
          onClick={() => onToolChange(tool)}
        />
      ))}

      <Separator />

      {/* Formatage texte (visible si sélection) */}
      {hasSelection && onFormatAction && (
        <>
          <ToolButton
            icon={<Bold size={20} />}
            label={t("bold")}
            onClick={() => onFormatAction("bold")}
          />
          <ToolButton
            icon={<Italic size={20} />}
            label={t("italic")}
            onClick={() => onFormatAction("italic")}
          />
          <ToolButton
            icon={<Underline size={20} />}
            label={t("underline")}
            onClick={() => onFormatAction("underline")}
          />
          <Separator />
          <ToolButton
            icon={<AlignLeft size={20} />}
            label={t("alignLeft")}
            onClick={() => onFormatAction("align-left")}
          />
          <ToolButton
            icon={<AlignCenter size={20} />}
            label={t("alignCenter")}
            onClick={() => onFormatAction("align-center")}
          />
          <ToolButton
            icon={<AlignRight size={20} />}
            label={t("alignRight")}
            onClick={() => onFormatAction("align-right")}
          />
          <Separator />
        </>
      )}

      {/* Zoom */}
      <div className="flex items-center gap-1 ml-auto">
        <ToolButton
          icon={<ZoomOut size={20} />}
          label={t("zoomOut")}
          onClick={() => onZoomChange(Math.max(0.25, zoom - 0.25))}
          disabled={zoom <= 0.25}
        />

        <select
          value={zoom}
          onChange={(e) => onZoomChange(parseFloat(e.target.value))}
          className="h-8 px-2 rounded border bg-background text-sm"
        >
          {zoomPresets.map((preset) => (
            <option key={preset} value={preset}>
              {Math.round(preset * 100)}%
            </option>
          ))}
        </select>

        <ToolButton
          icon={<ZoomIn size={20} />}
          label={t("zoomIn")}
          onClick={() => onZoomChange(Math.min(4, zoom + 0.25))}
          disabled={zoom >= 4}
        />
      </div>
    </div>
  );
}
