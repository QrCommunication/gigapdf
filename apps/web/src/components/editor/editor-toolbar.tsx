"use client";

import React, { useState, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import type {
  Tool,
  ShapeType,
  AnnotationType,
  FieldType,
  FieldCreationKind,
  Element,
  TextStyle,
} from "@giga-pdf/types";
import { FontPicker } from "@giga-pdf/ui";
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
  Merge,
  Scissors,
  Lock,
  FileSignature,
  FileText,
  Layers,
  FileSearch,
  FileCode,
  SquareDashedMousePointer,
  Search,
  Droplet,
  ScanText,
  FileCheck2,
  Minimize2,
  TextCursorInput,
  AlignJustify,
  CheckSquare,
  CircleDot,
  List,
  CalendarDays,
  Maximize,
  MoveHorizontal,
  Rows3,
  RectangleVertical,
} from "lucide-react";
import { MergeDialog } from "./merge-dialog";
import { SplitDialog } from "./split-dialog";
import { EncryptDialog } from "./encrypt-dialog";
import { SignDialog } from "./sign-dialog";
import { MetadataDialog } from "./metadata-dialog";
import { ConvertDialog } from "./convert-dialog";
import { SearchDialog } from "./search-dialog";
import { WatermarkDialog } from "./watermark-dialog";
import { OcrDialog } from "./ocr-dialog";
import { PdfADialog } from "./pdfa-dialog";
import { CompressDialog } from "./compress-dialog";

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
  /** Type de champ de formulaire sélectionné */
  fieldType?: FieldType;
  /** Callback pour changer le type de champ de formulaire */
  onFieldTypeChange?: (fieldType: FieldType) => void;
  /** Variante de création du champ (palette complète : multiligne, date, groupe radio…) */
  fieldKind?: FieldCreationKind;
  /** Callback pour changer la variante de création du champ */
  onFieldKindChange?: (fieldKind: FieldCreationKind) => void;
  /** Mode d'affichage des pages : page unique ou défilement continu. */
  viewMode?: "single" | "continuous";
  /** Callback pour basculer le mode d'affichage. */
  onViewModeChange?: (mode: "single" | "continuous") => void;
  /** Mode de zoom adaptatif actif (page / largeur / null = manuel) */
  fitMode?: "page" | "width" | null;
  /** Ajuster la page entière au viewport (Ctrl+0) */
  onFitPage?: () => void;
  /** Ajuster la largeur de page au viewport */
  onFitWidth?: () => void;
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
  /** Element actuellement selectionne */
  selectedElement?: Element | null;
  /** Callback pour mettre a jour le style d'un element */
  onElementStyleChange?: (elementId: string, style: Partial<TextStyle>) => void;
  /** Fichier PDF actuellement ouvert (pour les opérations merge/split/encrypt) */
  currentFile?: File | null;
  /** Callback pour afficher/masquer le panneau formulaires */
  onToggleFormsPanel?: () => void;
  /** Callback pour aplatir le PDF courant */
  onFlattenPdf?: () => void;
  onToggleMetadataDialog?: () => void;
  onToggleConvertDialog?: () => void;
  /** Whether content edit mode is active */
  isContentEditActive?: boolean;
  /** Callback to toggle content edit mode */
  onToggleContentEdit?: () => void;
  /** Callback when a search hit is clicked — caller scrolls to the target page. */
  onSearchGoToPage?: (
    pageNumber: number,
    hit: {
      pageNumber: number;
      matchIndex: number;
      bbox: [number, number, number, number];
    },
  ) => void;
  /**
   * Callback quand le filigrane est appliqué au document courant (mode
   * « Appliquer au document » du WatermarkDialog). Reçoit le PDF filigrané.
   */
  onWatermarkApplied?: (blob: Blob) => void;
  /**
   * Callback quand la compression est appliquée au document courant (mode
   * « Appliquer au document » du CompressDialog). Reçoit le PDF compressé.
   */
  onCompressApplied?: (blob: Blob) => void;
  /**
   * Callback quand l'OCR « PDF cherchable » est appliqué au document
   * courant. Reçoit le PDF avec son calque de texte invisible.
   */
  onOcrApplied?: (blob: Blob) => void;
  /**
   * Callback quand la signature numérique est appliquée au document courant
   * (mode « Appliquer au document » du SignDialog). Reçoit le PDF signé.
   */
  onSignApplied?: (blob: Blob) => void;
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
  const t = useTranslations("editor.toolbar");
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
            title={preset === "transparent" ? t("transparent") : preset}
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
// Font value mapping for FontPicker (value -> family)
const FONT_VALUE_TO_FAMILY: Record<string, string> = {
  arial: "Arial, sans-serif",
  helvetica: "Helvetica, sans-serif",
  times: "'Times New Roman', serif",
  courier: "'Courier New', monospace",
  georgia: "Georgia, serif",
  verdana: "Verdana, sans-serif",
  palatino: "Palatino, serif",
  garamond: "Garamond, serif",
  bookman: "Bookman, serif",
  "comic-sans": "'Comic Sans MS', cursive",
  trebuchet: "'Trebuchet MS', sans-serif",
  impact: "Impact, sans-serif",
  "lucida-console": "'Lucida Console', monospace",
  tahoma: "Tahoma, sans-serif",
  "century-gothic": "'Century Gothic', sans-serif",
  optima: "Optima, sans-serif",
  futura: "Futura, sans-serif",
  rockwell: "Rockwell, serif",
  baskerville: "Baskerville, serif",
  didot: "Didot, serif",
};

// Reverse mapping: family -> value
function getFontValueFromFamily(family: string): string {
  const normalizedFamily = family.toLowerCase();
  for (const [value, fontFamily] of Object.entries(FONT_VALUE_TO_FAMILY)) {
    const normalizedFontFamily = fontFamily.toLowerCase();
    const baseFontName = normalizedFontFamily.split(",")[0]?.replace(/'/g, "") ?? "";
    if (normalizedFontFamily.includes(normalizedFamily) || normalizedFamily.includes(baseFontName)) {
      return value;
    }
  }
  // Default fallback based on common font names
  if (normalizedFamily.includes("arial")) return "arial";
  if (normalizedFamily.includes("helvetica")) return "helvetica";
  if (normalizedFamily.includes("times")) return "times";
  if (normalizedFamily.includes("courier")) return "courier";
  return "arial";
}

// Available font sizes
const FONT_SIZES = [8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72];

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
  fieldKind = "text",
  onFieldKindChange,
  viewMode = "continuous",
  onViewModeChange,
  fitMode = null,
  onFitPage,
  onFitWidth,
  strokeColor = "#000000",
  onStrokeColorChange,
  fillColor = "transparent",
  onFillColorChange,
  strokeWidth = 2,
  onStrokeWidthChange,
  onDelete,
  onDuplicate,
  onAddImage,
  selectedElement,
  onElementStyleChange,
  currentFile,
  onToggleFormsPanel,
  onFlattenPdf,
  isContentEditActive,
  onToggleContentEdit,
  onSearchGoToPage,
  onWatermarkApplied,
  onCompressApplied,
  onOcrApplied,
  onSignApplied,
}: EditorToolbarProps) {
  const t = useTranslations("editor.toolbar");
  const tProperties = useTranslations("editor.properties.text");
  const [showShapeDropdown, setShowShapeDropdown] = useState(false);
  const [showAnnotationDropdown, setShowAnnotationDropdown] = useState(false);
  const [showFieldDropdown, setShowFieldDropdown] = useState(false);
  const [showZoomDropdown, setShowZoomDropdown] = useState(false);
  const [showColorDropdown, setShowColorDropdown] = useState(false);
  const [showMergeDialog, setShowMergeDialog] = useState(false);
  const [showSplitDialog, setShowSplitDialog] = useState(false);
  const [showEncryptDialog, setShowEncryptDialog] = useState(false);
  const [showSignDialog, setShowSignDialog] = useState(false);
  const [showMetadataDialog, setShowMetadataDialog] = useState(false);
  const [showConvertDialog, setShowConvertDialog] = useState(false);
  const [showSearchDialog, setShowSearchDialog] = useState(false);
  const [showWatermarkDialog, setShowWatermarkDialog] = useState(false);
  const [showOcrDialog, setShowOcrDialog] = useState(false);
  const [showPdfADialog, setShowPdfADialog] = useState(false);
  const [showCompressDialog, setShowCompressDialog] = useState(false);

  // Font controls — derived-with-override pattern (replaces the previous
  // setState-in-useEffect sync that triggered react-hooks/set-state-in-effect):
  // the displayed values DERIVE from the selected text element during render;
  // a manual pick is stored as an override KEYED BY elementId, so switching
  // the selection naturally falls back to the new element's derived values
  // (the stale override no longer matches) without any effect.
  const selectedTextElement =
    selectedElement?.type === "text" ? selectedElement : null;
  const [fontValueOverride, setFontValueOverride] = useState<{
    elementId: string;
    value: string;
  } | null>(null);
  const [fontSizeOverride, setFontSizeOverride] = useState<{
    elementId: string;
    size: number;
  } | null>(null);

  const derivedFontValue = selectedTextElement
    ? getFontValueFromFamily(
        selectedTextElement.style?.fontFamily || "Arial, sans-serif",
      )
    : "arial";
  const derivedFontSize = selectedTextElement?.style?.fontSize || 14;

  const selectedFontValue =
    fontValueOverride &&
    fontValueOverride.elementId === selectedTextElement?.elementId
      ? fontValueOverride.value
      : derivedFontValue;
  const selectedFontSize =
    fontSizeOverride &&
    fontSizeOverride.elementId === selectedTextElement?.elementId
      ? fontSizeOverride.size
      : derivedFontSize;

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

  // Presets de zoom (menu déroulant) — bornes moteur : 10 % à 800 %.
  const zoomPresets = [0.5, 0.75, 1, 1.25, 1.5, 2, 4];
  const MIN_TOOLBAR_ZOOM = 0.1;
  const MAX_TOOLBAR_ZOOM = 8;

  // Palette de création des champs de formulaire (variantes riches).
  const fieldKinds: {
    kind: FieldCreationKind;
    icon: React.ReactNode;
    labelKey: string;
  }[] = [
    { kind: "text", icon: <TextCursorInput size={16} />, labelKey: "fields.text" },
    { kind: "multiline", icon: <AlignJustify size={16} />, labelKey: "fields.multiline" },
    { kind: "checkbox", icon: <CheckSquare size={16} />, labelKey: "fields.checkbox" },
    { kind: "radio_group", icon: <CircleDot size={16} />, labelKey: "fields.radioGroup" },
    { kind: "dropdown", icon: <List size={16} />, labelKey: "fields.dropdown" },
    { kind: "date", icon: <CalendarDays size={16} />, labelKey: "fields.date" },
  ];

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

      {/* Outil dessin = zone de signature (draw tool) */}
      <ToolButton
        icon={<PenTool size={20} />}
        label={t("draw")}
        isActive={activeTool === "draw"}
        onClick={() => onToolChange("draw")}
      />

      {/* Champ de formulaire avec dropdown (text/checkbox/radio/dropdown) */}
      <div className="relative">
        <ToolButton
          icon={<FileText size={20} />}
          label={t("formField") || "Champ"}
          isActive={activeTool === "form_field"}
          hasDropdown
          onClick={() => {
            onToolChange("form_field");
            setShowFieldDropdown(!showFieldDropdown);
          }}
        />
        <Dropdown
          isOpen={showFieldDropdown}
          onClose={() => setShowFieldDropdown(false)}
        >
          <div className="flex flex-col gap-1 min-w-[180px]">
            {fieldKinds.map(({ kind, icon, labelKey }) => (
              <button
                key={kind}
                type="button"
                onClick={() => {
                  onFieldKindChange?.(kind);
                  onToolChange("form_field");
                  setShowFieldDropdown(false);
                }}
                className={`
                  flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors
                  ${
                    fieldKind === kind
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

      {/* Font controls (visible only for text elements) */}
      {selectedElement?.type === "text" && onElementStyleChange && (
        <>
          <div className="flex items-center gap-2">
            <FontPicker
              value={selectedFontValue}
              onChange={(font) => {
                setFontValueOverride({
                  elementId: selectedElement.elementId,
                  value: font.value,
                });
                onElementStyleChange(selectedElement.elementId, {
                  fontFamily: font.family,
                });
              }}
              className="h-8 w-[160px]"
              placeholder={tProperties("fontFamily")}
            />
            <select
              value={selectedFontSize}
              onChange={(e) => {
                const size = parseInt(e.target.value, 10);
                setFontSizeOverride({
                  elementId: selectedElement.elementId,
                  size,
                });
                onElementStyleChange(selectedElement.elementId, {
                  fontSize: size,
                });
              }}
              className="h-8 w-16 px-2 rounded border bg-background text-sm"
              title={tProperties("fontSize")}
            >
              {FONT_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>
          <Separator />
        </>
      )}

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

      {/* View mode — défilement continu (toutes les pages) vs page unique.
          Anchored to the right cluster (ml-auto) just before the zoom group. */}
      {onViewModeChange && (
        <>
          <div className="ml-auto flex items-center gap-1">
            <ToolButton
              icon={<RectangleVertical size={20} />}
              label={t("viewModeSingle")}
              isActive={viewMode === "single"}
              onClick={() => onViewModeChange("single")}
            />
            <ToolButton
              icon={<Rows3 size={20} />}
              label={t("viewModeContinuous")}
              isActive={viewMode === "continuous"}
              onClick={() => onViewModeChange("continuous")}
            />
          </div>
          <Separator />
        </>
      )}

      {/* Zoom — boutons ± à pas multiplicatif + menu presets/ajustements.
          Le bouton central affiche TOUJOURS la valeur courante (y compris
          un zoom arbitraire issu de la molette ou d'un mode fit). `ml-auto`
          ancre le cluster à droite quand le toggle de vue est absent ; quand
          il est présent, le toggle (ml-auto, en premier) gagne l'espace et le
          zoom se cale juste après lui. */}
      <div className="flex items-center gap-1 ml-auto">
        <ToolButton
          icon={<ZoomOut size={20} />}
          label={t("zoomOut")}
          onClick={() =>
            onZoomChange(Math.max(MIN_TOOLBAR_ZOOM, zoom / 1.25))
          }
          disabled={zoom <= MIN_TOOLBAR_ZOOM + 0.001}
        />

        <div className="relative">
          <button
            type="button"
            onClick={() => setShowZoomDropdown(!showZoomDropdown)}
            title={t("zoomLevel")}
            className="h-8 min-w-[72px] px-2 rounded border bg-background text-sm flex items-center justify-center gap-1 hover:bg-muted transition-colors"
          >
            <span>{Math.round(zoom * 100)}%</span>
            <ChevronDown size={12} />
          </button>
          <Dropdown
            isOpen={showZoomDropdown}
            onClose={() => setShowZoomDropdown(false)}
          >
            <div className="flex flex-col gap-1 min-w-[176px]">
              <button
                type="button"
                onClick={() => {
                  onFitPage?.();
                  setShowZoomDropdown(false);
                }}
                className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors ${
                  fitMode === "page"
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                }`}
              >
                <Maximize size={16} />
                <span>{t("fitPage")}</span>
                <span className="ml-auto text-[10px] text-muted-foreground">
                  Ctrl+0
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  onFitWidth?.();
                  setShowZoomDropdown(false);
                }}
                className={`flex items-center gap-2 px-2 py-1.5 rounded text-sm transition-colors ${
                  fitMode === "width"
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted"
                }`}
              >
                <MoveHorizontal size={16} />
                <span>{t("fitWidth")}</span>
              </button>
              <div className="h-px bg-border my-1" />
              {zoomPresets.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    onZoomChange(preset);
                    setShowZoomDropdown(false);
                  }}
                  className={`px-2 py-1.5 rounded text-sm text-left transition-colors ${
                    fitMode === null && Math.abs(zoom - preset) < 0.001
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-muted"
                  }`}
                >
                  {Math.round(preset * 100)}%
                </button>
              ))}
            </div>
          </Dropdown>
        </div>

        <ToolButton
          icon={<ZoomIn size={20} />}
          label={t("zoomIn")}
          onClick={() =>
            onZoomChange(Math.min(MAX_TOOLBAR_ZOOM, zoom * 1.25))
          }
          disabled={zoom >= MAX_TOOLBAR_ZOOM - 0.001}
        />
      </div>

      {/* Content Edit Mode */}
      <ToolButton
        icon={<SquareDashedMousePointer size={20} />}
        label={t("contentEdit")}
        isActive={isContentEditActive}
        onClick={() => onToggleContentEdit?.()}
      />

      <Separator />

      {/* PDF Tools */}
      <ToolButton
        icon={<Merge size={20} />}
        label={t("merge")}
        onClick={() => setShowMergeDialog(true)}
      />
      <ToolButton
        icon={<Scissors size={20} />}
        label={t("split")}
        onClick={() => setShowSplitDialog(true)}
      />
      <ToolButton
        icon={<Lock size={20} />}
        label={t("encrypt")}
        onClick={() => setShowEncryptDialog(true)}
      />
      <ToolButton
        icon={<FileSignature size={20} />}
        label={t("sign")}
        onClick={() => setShowSignDialog(true)}
      />
      <ToolButton
        icon={<FileText size={20} />}
        label={t("forms")}
        onClick={() => onToggleFormsPanel?.()}
      />
      <ToolButton
        icon={<FileSearch size={20} />}
        label={t("metadata")}
        onClick={() => setShowMetadataDialog(true)}
      />
      <ToolButton
        icon={<FileCode size={20} />}
        label={t("convert")}
        onClick={() => setShowConvertDialog(true)}
      />
      <ToolButton
        icon={<Layers size={20} />}
        label={t("flatten")}
        onClick={() => onFlattenPdf?.()}
      />
      <ToolButton
        icon={<Minimize2 size={20} />}
        label={t("compress")}
        onClick={() => setShowCompressDialog(true)}
      />
      <ToolButton
        icon={<Search size={20} />}
        label="Rechercher"
        onClick={() => setShowSearchDialog(true)}
      />
      <ToolButton
        icon={<Droplet size={20} />}
        label="Filigrane"
        onClick={() => setShowWatermarkDialog(true)}
      />
      <ToolButton
        icon={<ScanText size={20} />}
        label="OCR"
        onClick={() => setShowOcrDialog(true)}
      />
      <ToolButton
        icon={<FileCheck2 size={20} />}
        label="PDF/A"
        onClick={() => setShowPdfADialog(true)}
      />

      {/* PDF operation dialogs */}
      <MergeDialog
        open={showMergeDialog}
        onClose={() => setShowMergeDialog(false)}
      />
      <SplitDialog
        open={showSplitDialog}
        onClose={() => setShowSplitDialog(false)}
        currentFile={currentFile}
      />
      <EncryptDialog
        open={showEncryptDialog}
        onClose={() => setShowEncryptDialog(false)}
        currentFile={currentFile}
      />
      <SignDialog
        open={showSignDialog}
        onClose={() => setShowSignDialog(false)}
        currentFile={currentFile ?? null}
        baseFilename={currentFile?.name}
        onApplied={onSignApplied}
      />
      <MetadataDialog
        isOpen={showMetadataDialog}
        onClose={() => setShowMetadataDialog(false)}
        currentFile={currentFile ?? null}
      />
      <ConvertDialog
        isOpen={showConvertDialog}
        onClose={() => setShowConvertDialog(false)}
      />
      <SearchDialog
        open={showSearchDialog}
        onClose={() => setShowSearchDialog(false)}
        currentFile={currentFile ?? null}
        onGoToPage={(pageNumber, hit) => {
          onSearchGoToPage?.(pageNumber, hit);
        }}
      />
      <WatermarkDialog
        open={showWatermarkDialog}
        onClose={() => setShowWatermarkDialog(false)}
        currentFile={currentFile ?? null}
        baseFilename={currentFile?.name}
        onApplied={onWatermarkApplied}
      />
      <OcrDialog
        open={showOcrDialog}
        onClose={() => setShowOcrDialog(false)}
        currentFile={currentFile ?? null}
        baseFilename={currentFile?.name}
        onApplied={onOcrApplied}
      />
      <PdfADialog
        open={showPdfADialog}
        onClose={() => setShowPdfADialog(false)}
        currentFile={currentFile ?? null}
        baseFilename={currentFile?.name}
      />
      <CompressDialog
        open={showCompressDialog}
        onClose={() => setShowCompressDialog(false)}
        currentFile={currentFile ?? null}
        baseFilename={currentFile?.name}
        onApplied={onCompressApplied}
      />
    </div>
  );
}
