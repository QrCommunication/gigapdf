"use client";

import React, { useState, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import type { Tool, ShapeType, AnnotationType } from "@giga-pdf/types";
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
  Circle,
  Triangle,
  Minus,
  ArrowRight,
  Highlighter,
  MessageCircle,
  StickyNote,
  ChevronDown,
  Trash2,
  Copy,
  Palette,
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
  onFormatAction?: (
    action:
      | "bold"
      | "italic"
      | "underline"
      | "align-left"
      | "align-center"
      | "align-right"
  ) => void;
  /** Type de forme sélectionné */
  shapeType?: ShapeType;
  /** Callback pour changer le type de forme */
  onShapeTypeChange?: (shapeType: ShapeType) => void;
  /** Type d'annotation sélectionné */
  annotationType?: AnnotationType;
  /** Callback pour changer le type d'annotation */
  onAnnotationTypeChange?: (annotationType: AnnotationType) => void;
  /** Couleur de contour */
  strokeColor?: string;
  /** Callback pour changer la couleur de contour */
  onStrokeColorChange?: (color: string) => void;
  /** Couleur de remplissage */
  fillColor?: string;
  /** Callback pour changer la couleur de remplissage */
  onFillColorChange?: (color: string) => void;
  /** Épaisseur du contour */
  strokeWidth?: number;
  /** Callback pour changer l'épaisseur */
  onStrokeWidthChange?: (width: number) => void;
  /** Callback pour supprimer les éléments sélectionnés */
  onDelete?: () => void;
  /** Callback pour dupliquer les éléments sélectionnés */
  onDuplicate?: () => void;
  /** Callback pour ajouter une image */
  onAddImage?: () => void;
}

interface ToolButtonProps {
  icon: React.ReactNode;
  label: string;
  isActive?: boolean;
  onClick: () => void;
  disabled?: boolean;
  hasDropdown?: boolean;
}

function ToolButton({
  icon,
  label,
  isActive,
  onClick,
  disabled,
  hasDropdown,
}: ToolButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={`
        p-2 rounded-lg transition-colors flex items-center gap-0.5
        ${
          isActive
            ? "bg-primary text-primary-foreground"
            : "hover:bg-muted text-muted-foreground hover:text-foreground"
        }
        ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
      `}
    >
      {icon}
      {hasDropdown && <ChevronDown size={12} />}
    </button>
  );
}

function Separator() {
  return <div className="w-px h-6 bg-border mx-1" />;
}

interface DropdownProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

function Dropdown({ isOpen, onClose, children }: DropdownProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      ref={ref}
      className="absolute top-full left-0 mt-1 bg-background border rounded-lg shadow-lg p-2 z-50 min-w-[120px]"
    >
      {children}
    </div>
  );
}

interface ColorPickerProps {
  color: string;
  onChange: (color: string) => void;
  label: string;
}

function ColorPicker({ color, onChange, label }: ColorPickerProps) {
  const presetColors = [
    "#000000",
    "#ffffff",
    "#ff0000",
    "#00ff00",
    "#0000ff",
    "#ffff00",
    "#ff00ff",
    "#00ffff",
    "#ff8000",
    "#8000ff",
    "#0080ff",
    "#80ff00",
    "transparent",
  ];

  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs text-muted-foreground">{label}</label>
      <div className="flex flex-wrap gap-1">
        {presetColors.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => onChange(preset)}
            className={`
              w-6 h-6 rounded border-2 transition-colors
              ${
                color === preset
                  ? "border-primary"
                  : "border-transparent hover:border-muted-foreground"
              }
              ${preset === "transparent" ? "bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iOCIgaGVpZ2h0PSI4IiB2aWV3Qm94PSIwIDAgOCA4IiBmaWxsPSJub25lIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSI0IiBoZWlnaHQ9IjQiIGZpbGw9IiNjY2MiLz48cmVjdCB4PSI0IiB5PSI0IiB3aWR0aD0iNCIgaGVpZ2h0PSI0IiBmaWxsPSIjY2NjIi8+PC9zdmc+')]" : ""}
            `}
            style={{
              backgroundColor: preset === "transparent" ? undefined : preset,
            }}
            title={preset === "transparent" ? "Transparent" : preset}
          />
        ))}
      </div>
      <input
        type="color"
        value={color === "transparent" ? "#ffffff" : color}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-8 rounded border cursor-pointer"
      />
    </div>
  );
}

/**
 * Barre d'outils de l'éditeur PDF avec dropdowns et color picker.
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
  shapeType = "rectangle",
  onShapeTypeChange,
  annotationType = "highlight",
  onAnnotationTypeChange,
  strokeColor = "#000000",
  onStrokeColorChange,
  fillColor = "transparent",
  onFillColorChange,
  strokeWidth = 2,
  onStrokeWidthChange,
  onDelete,
  onDuplicate,
  onAddImage,
}: EditorToolbarProps) {
  const t = useTranslations("editor.toolbar");
  const [showShapeDropdown, setShowShapeDropdown] = useState(false);
  const [showAnnotationDropdown, setShowAnnotationDropdown] = useState(false);
  const [showColorDropdown, setShowColorDropdown] = useState(false);

  // Définition des formes
  const shapes: { type: ShapeType; icon: React.ReactNode; labelKey: string }[] =
    [
      { type: "rectangle", icon: <Square size={16} />, labelKey: "rectangle" },
      { type: "circle", icon: <Circle size={16} />, labelKey: "circle" },
      { type: "triangle", icon: <Triangle size={16} />, labelKey: "triangle" },
      { type: "line", icon: <Minus size={16} />, labelKey: "line" },
      { type: "arrow", icon: <ArrowRight size={16} />, labelKey: "arrow" },
    ];

  // Définition des annotations
  const annotations: {
    type: AnnotationType;
    icon: React.ReactNode;
    labelKey: string;
  }[] = [
    {
      type: "highlight",
      icon: <Highlighter size={16} />,
      labelKey: "highlight",
    },
    {
      type: "underline",
      icon: <Underline size={16} />,
      labelKey: "underline",
    },
    { type: "note", icon: <StickyNote size={16} />, labelKey: "note" },
    { type: "comment", icon: <MessageCircle size={16} />, labelKey: "comment" },
  ];

  // Outils de base
  const basicTools: { tool: Tool; icon: React.ReactNode; labelKey: string }[] =
    [
      { tool: "select", icon: <MousePointer2 size={20} />, labelKey: "select" },
      { tool: "text", icon: <Type size={20} />, labelKey: "text" },
      { tool: "hand", icon: <Hand size={20} />, labelKey: "pan" },
    ];

  // Presets de zoom
  const zoomPresets = [0.5, 0.75, 1, 1.25, 1.5, 2];

  // Icône de forme actuelle
  const currentShapeIcon =
    shapes.find((s) => s.type === shapeType)?.icon || <Square size={20} />;
  const currentAnnotationIcon =
    annotations.find((a) => a.type === annotationType)?.icon || (
      <MessageSquare size={20} />
    );

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

      {/* Outils de base */}
      {basicTools.map(({ tool, icon, labelKey }) => (
        <ToolButton
          key={tool}
          icon={icon}
          label={t(labelKey)}
          isActive={activeTool === tool}
          onClick={() => onToolChange(tool)}
        />
      ))}

      {/* Outil Image avec upload */}
      <ToolButton
        icon={<Image size={20} />}
        label={t("image")}
        isActive={activeTool === "image"}
        onClick={() => {
          onToolChange("image");
          onAddImage?.();
        }}
      />

      <Separator />

      {/* Formes avec dropdown */}
      <div className="relative">
        <ToolButton
          icon={currentShapeIcon}
          label={t("shape")}
          isActive={activeTool === "shape"}
          hasDropdown
          onClick={() => {
            onToolChange("shape");
            setShowShapeDropdown(!showShapeDropdown);
          }}
        />
        <Dropdown
          isOpen={showShapeDropdown}
          onClose={() => setShowShapeDropdown(false)}
        >
          <div className="flex flex-col gap-1">
            {shapes.map(({ type, icon, labelKey }) => (
              <button
                key={type}
                type="button"
                onClick={() => {
                  onShapeTypeChange?.(type);
                  setShowShapeDropdown(false);
                }}
                className={`
                  flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors
                  ${
                    shapeType === type
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted"
                  }
                `}
              >
                {icon}
                <span>{t(labelKey)}</span>
              </button>
            ))}
          </div>
        </Dropdown>
      </div>

      {/* Annotations avec dropdown */}
      <div className="relative">
        <ToolButton
          icon={currentAnnotationIcon}
          label={t("annotation")}
          isActive={activeTool === "annotation"}
          hasDropdown
          onClick={() => {
            onToolChange("annotation");
            setShowAnnotationDropdown(!showAnnotationDropdown);
          }}
        />
        <Dropdown
          isOpen={showAnnotationDropdown}
          onClose={() => setShowAnnotationDropdown(false)}
        >
          <div className="flex flex-col gap-1">
            {annotations.map(({ type, icon, labelKey }) => (
              <button
                key={type}
                type="button"
                onClick={() => {
                  onAnnotationTypeChange?.(type);
                  setShowAnnotationDropdown(false);
                }}
                className={`
                  flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors
                  ${
                    annotationType === type
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted"
                  }
                `}
              >
                {icon}
                <span>{t(labelKey)}</span>
              </button>
            ))}
          </div>
        </Dropdown>
      </div>

      {/* Outil dessin libre */}
      <ToolButton
        icon={<PenTool size={20} />}
        label={t("draw")}
        isActive={activeTool === "form_field"}
        onClick={() => onToolChange("form_field")}
      />

      <Separator />

      {/* Color Picker */}
      <div className="relative">
        <ToolButton
          icon={
            <div className="relative">
              <Palette size={20} />
              <div
                className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-white"
                style={{ backgroundColor: strokeColor }}
              />
            </div>
          }
          label={t("colors")}
          hasDropdown
          onClick={() => setShowColorDropdown(!showColorDropdown)}
        />
        <Dropdown
          isOpen={showColorDropdown}
          onClose={() => setShowColorDropdown(false)}
        >
          <div className="flex flex-col gap-4 p-2 min-w-[200px]">
            <ColorPicker
              color={strokeColor}
              onChange={(color) => onStrokeColorChange?.(color)}
              label={t("strokeColor")}
            />
            <ColorPicker
              color={fillColor}
              onChange={(color) => onFillColorChange?.(color)}
              label={t("fillColor")}
            />
            <div className="flex flex-col gap-2">
              <label className="text-xs text-muted-foreground">
                {t("strokeWidth")}
              </label>
              <input
                type="range"
                min="1"
                max="10"
                value={strokeWidth}
                onChange={(e) =>
                  onStrokeWidthChange?.(parseInt(e.target.value, 10))
                }
                className="w-full"
              />
              <span className="text-xs text-center">{strokeWidth}px</span>
            </div>
          </div>
        </Dropdown>
      </div>

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

      {/* Actions sur sélection */}
      {hasSelection && (
        <>
          <ToolButton
            icon={<Copy size={20} />}
            label={t("duplicate")}
            onClick={() => onDuplicate?.()}
          />
          <ToolButton
            icon={<Trash2 size={20} />}
            label={t("delete")}
            onClick={() => onDelete?.()}
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
