"use client";

import React, {
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";
import {
  Loader2,
  AlertCircle,
  ScanSearch,
  Type,
  Image as ImageIcon,
  Trash2,
  RotateCcw,
  X,
  SquareDashedMousePointer,
  Undo2,
  Square,
  MessageSquare,
  FormInput,
  Move,
} from "lucide-react";
import { useOpenPdf } from "@giga-pdf/api";
import type { TextElement, ImageElement, ShapeElement, AnnotationElement, FormFieldElement } from "@giga-pdf/types";
import { cn } from "@/lib/utils";

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface ElementModification {
  action: "update" | "delete";
  pageNumber: number;
  element: Record<string, unknown>;
  oldBounds: { x: number; y: number; width: number; height: number };
}

export interface ContentEditLayerProps {
  /** The current PDF file to analyze */
  currentFile: File | null;
  /** Current page number (0-indexed) */
  currentPageIndex: number;
  /** Current zoom level */
  zoom: number;
  /** Whether content edit mode is active */
  isActive: boolean;
  /** Callback when modifications change */
  onModificationsChange: (modifications: ElementModification[]) => void;
  /** Reference to the rendered PDF canvas for background sampling */
  canvasRef?: React.RefObject<HTMLCanvasElement>;
}

// ─── Internal Types ───────────────────────────────────────────────────────────

type ParsedElement = TextElement | ImageElement | ShapeElement | AnnotationElement | FormFieldElement;

interface ZoneState {
  /** elementId → modification */
  modifications: Map<string, ElementModification>;
  /** elementId currently open for text editing */
  activeEditId: string | null;
  /** current textarea value while editing */
  editValue: string;
  /** elementId hovered */
  hoveredZoneId: string | null;
  /** elementId with image replacement preview dataUrl */
  imagePreviewMap: Map<string, string>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isTextElement(el: ParsedElement): el is TextElement {
  return el.type === "text";
}

function isImageElement(el: ParsedElement): el is ImageElement {
  return el.type === "image";
}

function isShapeElement(el: ParsedElement): el is ShapeElement {
  return el.type === "shape";
}

function isAnnotationElement(el: ParsedElement): el is AnnotationElement {
  return el.type === "annotation";
}

function isFormFieldElement(el: ParsedElement): el is FormFieldElement {
  return el.type === "form_field";
}

/** Read a File as a base64 data URL */
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read image file"));
    reader.readAsDataURL(file);
  });
}

function elementLabel(el: ParsedElement): string {
  if (isTextElement(el)) {
    const preview = el.content.slice(0, 32);
    return preview.length < el.content.length ? `${preview}…` : preview;
  }
  if (isImageElement(el)) {
    return `Image (${Math.round(el.bounds.width)}×${Math.round(el.bounds.height)} pt)`;
  }
  if (isShapeElement(el)) {
    return `Shape: ${el.shapeType}`;
  }
  if (isAnnotationElement(el)) {
    return `Annotation: ${el.annotationType}`;
  }
  if (isFormFieldElement(el)) {
    return `Form: ${el.fieldType} — ${el.fieldName}`;
  }
  return "Unknown element";
}

/**
 * Capture a rectangular region from a canvas as a data URL.
 * Used to sample the background behind text zones so the inline editor
 * can display the real page background instead of a plain white overlay.
 * Falls back to null if the canvas is tainted or the region is invalid.
 */
function captureCanvasRegion(
  canvas: HTMLCanvasElement,
  bounds: { x: number; y: number; width: number; height: number },
  zoom: number,
): string | null {
  try {
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    // The bounds are in PDF points scaled by zoom; the canvas may have a
    // different pixel ratio (e.g. devicePixelRatio backing store).
    const canvasScale = canvas.width / (canvas.clientWidth || 1);

    const x = Math.max(0, Math.floor(bounds.x * zoom * canvasScale));
    const y = Math.max(0, Math.floor(bounds.y * zoom * canvasScale));
    const w = Math.min(
      canvas.width - x,
      Math.ceil(bounds.width * zoom * canvasScale),
    );
    const h = Math.min(
      canvas.height - y,
      Math.ceil(bounds.height * zoom * canvasScale),
    );

    if (w <= 0 || h <= 0) return null;

    const imageData = ctx.getImageData(x, y, w, h);

    const tmpCanvas = document.createElement("canvas");
    tmpCanvas.width = w;
    tmpCanvas.height = h;
    const tmpCtx = tmpCanvas.getContext("2d");
    if (!tmpCtx) return null;
    tmpCtx.putImageData(imageData, 0, 0);

    return tmpCanvas.toDataURL("image/png");
  } catch {
    // Canvas may be tainted (cross-origin) — fall back gracefully
    return null;
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface ZoneTooltipProps {
  element: ParsedElement;
}

function ZoneTooltip({ element }: ZoneTooltipProps) {
  if (isTextElement(element)) {
    return (
      <div
        className={cn(
          "pointer-events-none absolute -top-8 left-0 z-50",
          "flex items-center gap-1.5 whitespace-nowrap",
          "rounded-md border border-border bg-popover px-2 py-1",
          "text-[10px] text-popover-foreground shadow-md",
        )}
      >
        <Type className="h-3 w-3 flex-shrink-0 text-blue-500" />
        <span className="font-mono">{element.style.fontFamily}</span>
        <span className="text-muted-foreground">{element.style.fontSize}pt</span>
        {element.style.fontWeight === "bold" && (
          <span className="font-bold text-muted-foreground">B</span>
        )}
        {element.style.fontStyle === "italic" && (
          <span className="italic text-muted-foreground">I</span>
        )}
      </div>
    );
  }
  if (isImageElement(element)) {
    return (
      <div
        className={cn(
          "pointer-events-none absolute -top-8 left-0 z-50",
          "flex items-center gap-1.5 whitespace-nowrap",
          "rounded-md border border-border bg-popover px-2 py-1",
          "text-[10px] text-popover-foreground shadow-md",
        )}
      >
        <ImageIcon className="h-3 w-3 flex-shrink-0 text-green-500" />
        <span>
          {element.source.originalDimensions.width}×
          {element.source.originalDimensions.height}px
        </span>
        <span className="text-muted-foreground uppercase">
          {element.source.originalFormat}
        </span>
      </div>
    );
  }
  if (isShapeElement(element)) {
    return (
      <div
        className={cn(
          "pointer-events-none absolute -top-8 left-0 z-50",
          "flex items-center gap-1.5 whitespace-nowrap",
          "rounded-md border border-border bg-popover px-2 py-1",
          "text-[10px] text-popover-foreground shadow-md",
        )}
      >
        <Square className="h-3 w-3 flex-shrink-0 text-purple-500" />
        <span className="capitalize">{element.shapeType}</span>
        {element.style?.strokeColor && (
          <span
            className="inline-block h-2.5 w-2.5 rounded-full border border-border"
            style={{ backgroundColor: element.style.strokeColor }}
          />
        )}
      </div>
    );
  }
  if (isAnnotationElement(element)) {
    return (
      <div
        className={cn(
          "pointer-events-none absolute -top-8 left-0 z-50",
          "flex items-center gap-1.5 whitespace-nowrap",
          "rounded-md border border-border bg-popover px-2 py-1",
          "text-[10px] text-popover-foreground shadow-md",
        )}
      >
        <MessageSquare className="h-3 w-3 flex-shrink-0 text-orange-500" />
        <span className="capitalize">{element.annotationType}</span>
        {element.content && (
          <span className="max-w-[120px] truncate text-muted-foreground">
            {element.content}
          </span>
        )}
      </div>
    );
  }
  if (isFormFieldElement(element)) {
    return (
      <div
        className={cn(
          "pointer-events-none absolute -top-8 left-0 z-50",
          "flex items-center gap-1.5 whitespace-nowrap",
          "rounded-md border border-border bg-popover px-2 py-1",
          "text-[10px] text-popover-foreground shadow-md",
        )}
      >
        <FormInput className="h-3 w-3 flex-shrink-0 text-teal-500" />
        <span className="capitalize">{element.fieldType}</span>
        <span className="text-muted-foreground">{element.fieldName}</span>
      </div>
    );
  }
  return null;
}

// ─── Inline Text Editor ────────────────────────────────────────────────────────

interface InlineTextEditorProps {
  element: TextElement;
  zoom: number;
  value: string;
  onChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  /** Captured background image data URL from the canvas */
  backgroundImage: string | null;
}

function InlineTextEditor({
  element,
  zoom,
  value,
  onChange,
  onConfirm,
  onCancel,
  backgroundImage,
}: InlineTextEditorProps) {
  const { bounds, style } = element;
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
    textareaRef.current?.select();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        onConfirm();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    },
    [onConfirm, onCancel],
  );

  return (
    <div
      style={{
        position: "absolute",
        left: bounds.x * zoom,
        top: bounds.y * zoom,
        width: bounds.width * zoom,
        minHeight: bounds.height * zoom,
        zIndex: 40,
      }}
    >
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onConfirm}
        onKeyDown={handleKeyDown}
        style={{
          width: "100%",
          minHeight: bounds.height * zoom,
          fontFamily: style.fontFamily,
          fontSize: style.fontSize * zoom,
          color: style.color,
          textAlign: style.textAlign,
          lineHeight: style.lineHeight,
          fontWeight: style.fontWeight,
          fontStyle: style.fontStyle,
          letterSpacing: style.letterSpacing,
          textDecoration: [
            style.underline ? "underline" : "",
            style.strikethrough ? "line-through" : "",
          ]
            .filter(Boolean)
            .join(" "),
          background: backgroundImage
            ? `url(${backgroundImage}) no-repeat center / cover`
            : "rgba(255,255,255,0.95)",
          border: "2px solid rgb(59 130 246)",
          borderRadius: 2,
          padding: "1px 2px",
          resize: "none",
          outline: "none",
          overflow: "hidden",
          boxSizing: "border-box",
        }}
        className="ring-2 ring-blue-500 shadow-lg"
      />
    </div>
  );
}

// ─── Image Zone ────────────────────────────────────────────────────────────────

interface ImageZoneControlsProps {
  element: ImageElement;
  zoom: number;
  previewDataUrl: string | null;
  onReplace: (file: File) => void;
  onClose: () => void;
}

function ImageZoneControls({
  element,
  zoom,
  previewDataUrl,
  onReplace,
  onClose,
}: ImageZoneControlsProps) {
  const { bounds } = element;
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      style={{
        position: "absolute",
        left: bounds.x * zoom,
        top: bounds.y * zoom,
        width: bounds.width * zoom,
        height: bounds.height * zoom,
        zIndex: 40,
      }}
      className="flex flex-col items-center justify-center bg-black/40 backdrop-blur-[1px] rounded"
    >
      {previewDataUrl !== null && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={previewDataUrl}
          alt="Replacement preview"
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            position: "absolute",
            inset: 0,
            borderRadius: 2,
          }}
        />
      )}
      <div className="relative z-10 flex items-center gap-1.5 bg-black/70 rounded-md px-2 py-1.5 shadow">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onReplace(file);
          }}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            "flex items-center gap-1 text-[10px] font-medium text-white",
            "rounded px-2 py-0.5 bg-green-600 hover:bg-green-500 transition-colors",
          )}
        >
          <ImageIcon className="h-3 w-3" />
          Replace image
        </button>
        <button
          onClick={onClose}
          className="p-0.5 text-white/70 hover:text-white transition-colors"
          aria-label="Close image controls"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── Toolbar ──────────────────────────────────────────────────────────────────

interface ToolbarProps {
  modificationCount: number;
  onSelectAllText: () => void;
  onUndoLast: () => void;
  onClearAll: () => void;
  canUndo: boolean;
}

function Toolbar({
  modificationCount,
  onSelectAllText,
  onUndoLast,
  onClearAll,
  canUndo,
}: ToolbarProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 px-3 py-1.5",
        "border-b border-blue-200 bg-blue-50/90 dark:bg-blue-950/70 dark:border-blue-800",
        "backdrop-blur-sm",
      )}
    >
      {/* Mode badge */}
      <div className="flex items-center gap-1.5 mr-1">
        <SquareDashedMousePointer className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
        <span className="text-xs font-semibold text-blue-700 dark:text-blue-300">
          Content Edit Mode
        </span>
      </div>

      <div className="h-4 w-px bg-blue-200 dark:bg-blue-700" />

      {/* Modification count */}
      <span
        className={cn(
          "text-xs font-medium tabular-nums",
          modificationCount > 0
            ? "text-amber-700 dark:text-amber-400"
            : "text-muted-foreground",
        )}
      >
        {modificationCount} modification{modificationCount !== 1 ? "s" : ""}
      </span>

      <div className="flex-1" />

      {/* Actions */}
      <button
        onClick={onSelectAllText}
        className={cn(
          "flex items-center gap-1 rounded px-2 py-0.5",
          "text-[10px] font-medium text-blue-700 dark:text-blue-300",
          "hover:bg-blue-100 dark:hover:bg-blue-900 transition-colors",
        )}
      >
        <SquareDashedMousePointer className="h-3 w-3" />
        Select all
      </button>

      <button
        onClick={onUndoLast}
        disabled={!canUndo}
        className={cn(
          "flex items-center gap-1 rounded px-2 py-0.5",
          "text-[10px] font-medium text-blue-700 dark:text-blue-300",
          "hover:bg-blue-100 dark:hover:bg-blue-900 transition-colors",
          "disabled:opacity-40 disabled:cursor-not-allowed",
        )}
      >
        <Undo2 className="h-3 w-3" />
        Undo last
      </button>

      <button
        onClick={onClearAll}
        disabled={modificationCount === 0}
        className={cn(
          "flex items-center gap-1 rounded px-2 py-0.5",
          "text-[10px] font-medium text-destructive",
          "hover:bg-destructive/10 transition-colors",
          "disabled:opacity-40 disabled:cursor-not-allowed",
        )}
      >
        <Trash2 className="h-3 w-3" />
        Clear all
      </button>
    </div>
  );
}

// ─── Empty / Loading States ───────────────────────────────────────────────────

function LayerOverlayShell({
  children,
  toolbar,
}: {
  children: React.ReactNode;
  toolbar: React.ReactNode;
}) {
  return (
    <div className="absolute inset-0 z-20 flex flex-col overflow-hidden rounded-sm">
      {toolbar}
      <div className="relative flex-1">{children}</div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

/**
 * ContentEditLayer — transparent overlay enabling deep in-place editing of
 * existing PDF content (text and images) on the current page.
 *
 * Mount this as an absolutely-positioned sibling that covers the editor canvas.
 * When `isActive` is false the component renders nothing.
 */
export function ContentEditLayer({
  currentFile,
  currentPageIndex,
  zoom,
  isActive,
  onModificationsChange,
  canvasRef,
}: ContentEditLayerProps) {
  const openPdf = useOpenPdf();

  const [parsedElements, setParsedElements] = useState<ParsedElement[]>([]);
  const [loading, setLoading] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  // Zone interaction state grouped for readability
  const [zoneState, setZoneState] = useState<ZoneState>({
    modifications: new Map(),
    activeEditId: null,
    editValue: "",
    hoveredZoneId: null,
    imagePreviewMap: new Map(),
  });

  // Track the last file+page combo we parsed to avoid redundant calls
  const lastParsedKey = useRef<string | null>(null);

  // ── Parse PDF when isActive changes or file/page changes ──────────────────

  useEffect(() => {
    if (!isActive || !currentFile) {
      setParsedElements([]);
      setParseError(null);
      lastParsedKey.current = null;
      return;
    }

    const key = `${currentFile.name}:${currentFile.size}:${currentPageIndex}`;
    if (lastParsedKey.current === key) return;

    let cancelled = false;

    const parse = async () => {
      setLoading(true);
      setParseError(null);
      try {
        const result = await openPdf.mutateAsync({
          file: currentFile,
          options: {
            extractText: true,
            extractImages: true,
            extractAnnotations: true,
            extractFormFields: true,
          },
        });

        if (cancelled) return;

        const page = result.pages[currentPageIndex];
        if (!page) {
          setParsedElements([]);
          lastParsedKey.current = key;
          return;
        }

        const visible = page.elements.filter(
          (el): el is ParsedElement =>
            el.visible &&
            !el.locked &&
            (el.type === "text" || el.type === "image" || el.type === "shape" || el.type === "annotation" || el.type === "form_field"),
        );

        setParsedElements(visible);
        lastParsedKey.current = key;
      } catch (err) {
        if (!cancelled) {
          setParseError(
            err instanceof Error
              ? err.message
              : "Failed to parse PDF content.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void parse();

    return () => {
      cancelled = true;
    };
    // openPdf.mutateAsync is stable within the mutation instance
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, currentFile, currentPageIndex]);

  // ── Modification helpers ───────────────────────────────────────────────────

  const pushModification = useCallback(
    (elementId: string, mod: ElementModification) => {
      setZoneState((prev) => {
        const next = new Map(prev.modifications);
        next.set(elementId, mod);
        return { ...prev, modifications: next };
      });
      setZoneState((prev) => {
        // Fire callback after state settled; collect from the latest map
        const all = Array.from(prev.modifications.values());
        // Use queueMicrotask to allow React to finish the update
        queueMicrotask(() => onModificationsChange(all));
        return prev;
      });
    },
    [onModificationsChange],
  );

  const removeModification = useCallback(
    (elementId: string) => {
      setZoneState((prev) => {
        const next = new Map(prev.modifications);
        next.delete(elementId);
        const all = Array.from(next.values());
        queueMicrotask(() => onModificationsChange(all));
        return { ...prev, modifications: next };
      });
    },
    [onModificationsChange],
  );

  // ── Text editing ──────────────────────────────────────────────────────────

  const handleTextZoneClick = useCallback(
    (element: TextElement, e: React.MouseEvent) => {
      e.stopPropagation();
      // Do not re-open if already editing this element
      setZoneState((prev) => {
        if (prev.activeEditId === element.elementId) return prev;
        return {
          ...prev,
          activeEditId: element.elementId,
          editValue: element.content,
        };
      });
    },
    [],
  );

  const handleConfirmEdit = useCallback(
    (element: TextElement) => {
      setZoneState((prev) => {
        if (prev.activeEditId !== element.elementId) return prev;
        const newContent = prev.editValue;

        if (newContent !== element.content) {
          const mod: ElementModification = {
            action: "update",
            pageNumber: currentPageIndex,
            element: { ...element, content: newContent } as unknown as Record<
              string,
              unknown
            >,
            oldBounds: {
              x: element.bounds.x,
              y: element.bounds.y,
              width: element.bounds.width,
              height: element.bounds.height,
            },
          };
          const next = new Map(prev.modifications);
          next.set(element.elementId, mod);
          const all = Array.from(next.values());
          queueMicrotask(() => onModificationsChange(all));
          return { ...prev, modifications: next, activeEditId: null };
        }

        return { ...prev, activeEditId: null };
      });
    },
    [currentPageIndex, onModificationsChange],
  );

  const handleCancelEdit = useCallback(() => {
    setZoneState((prev) => ({ ...prev, activeEditId: null }));
  }, []);

  // ── Image replacement ─────────────────────────────────────────────────────

  const [activeImageId, setActiveImageId] = useState<string | null>(null);

  const handleImageZoneClick = useCallback(
    (element: ImageElement, e: React.MouseEvent) => {
      e.stopPropagation();
      setActiveImageId((prev) =>
        prev === element.elementId ? null : element.elementId,
      );
    },
    [],
  );

  const handleImageReplace = useCallback(
    async (element: ImageElement, file: File) => {
      try {
        const dataUrl = await readFileAsDataUrl(file);
        const mod: ElementModification = {
          action: "update",
          pageNumber: currentPageIndex,
          element: {
            ...element,
            source: { ...element.source, dataUrl },
          } as unknown as Record<string, unknown>,
          oldBounds: {
            x: element.bounds.x,
            y: element.bounds.y,
            width: element.bounds.width,
            height: element.bounds.height,
          },
        };
        setZoneState((prev) => {
          const nextMods = new Map(prev.modifications);
          nextMods.set(element.elementId, mod);
          const nextPreviews = new Map(prev.imagePreviewMap);
          nextPreviews.set(element.elementId, dataUrl);
          const all = Array.from(nextMods.values());
          queueMicrotask(() => onModificationsChange(all));
          return {
            ...prev,
            modifications: nextMods,
            imagePreviewMap: nextPreviews,
          };
        });
        setActiveImageId(null);
      } catch {
        // Silently ignore read failures — user can retry
      }
    },
    [currentPageIndex, onModificationsChange],
  );

  // ── Delete zone ───────────────────────────────────────────────────────────

  const handleDeleteZone = useCallback(
    (element: ParsedElement, e: React.MouseEvent) => {
      e.stopPropagation();
      const mod: ElementModification = {
        action: "delete",
        pageNumber: currentPageIndex,
        element: element as unknown as Record<string, unknown>,
        oldBounds: {
          x: element.bounds.x,
          y: element.bounds.y,
          width: element.bounds.width,
          height: element.bounds.height,
        },
      };
      pushModification(element.elementId, mod);
    },
    [currentPageIndex, pushModification],
  );

  const handleRestoreZone = useCallback(
    (elementId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      removeModification(elementId);
      // Also clear image preview if any
      setZoneState((prev) => {
        if (!prev.imagePreviewMap.has(elementId)) return prev;
        const next = new Map(prev.imagePreviewMap);
        next.delete(elementId);
        return { ...prev, imagePreviewMap: next };
      });
    },
    [removeModification],
  );

  // ── Toolbar actions ────────────────────────────────────────────────────────

  const handleSelectAllText = useCallback(() => {
    // Opens the first undeleted text zone for editing; subsequent calls iterate
    const firstText = parsedElements.find(
      (el) =>
        isTextElement(el) &&
        zoneState.modifications.get(el.elementId)?.action !== "delete",
    );
    if (firstText && isTextElement(firstText)) {
      setZoneState((prev) => ({
        ...prev,
        activeEditId: firstText.elementId,
        editValue: firstText.content,
      }));
    }
  }, [parsedElements, zoneState.modifications]);

  const modificationHistory = useRef<string[]>([]);

  const handleUndoLast = useCallback(() => {
    const history = modificationHistory.current;
    if (history.length === 0) return;
    const lastId = history[history.length - 1];
    if (lastId) {
      removeModification(lastId);
      modificationHistory.current = history.slice(0, -1);
    }
  }, [removeModification]);

  const handleClearAll = useCallback(() => {
    setZoneState((prev) => ({
      ...prev,
      modifications: new Map(),
      imagePreviewMap: new Map(),
      activeEditId: null,
    }));
    modificationHistory.current = [];
    onModificationsChange([]);
  }, [onModificationsChange]);

  // Track modification history for undo
  useEffect(() => {
    const ids = Array.from(zoneState.modifications.keys());
    modificationHistory.current = ids;
  }, [zoneState.modifications]);

  // ── Derived values ─────────────────────────────────────────────────────────

  const modCount = zoneState.modifications.size;

  const toolbar = (
    <Toolbar
      modificationCount={modCount}
      onSelectAllText={handleSelectAllText}
      onUndoLast={handleUndoLast}
      onClearAll={handleClearAll}
      canUndo={modCount > 0}
    />
  );

  // ── Render nothing when not active ────────────────────────────────────────

  if (!isActive) return null;

  // ── Loading state ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <LayerOverlayShell toolbar={toolbar}>
        <div className="flex h-full items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
            <p className="text-sm text-muted-foreground">
              Scanning PDF content…
            </p>
          </div>
        </div>
      </LayerOverlayShell>
    );
  }

  // ── Error state ───────────────────────────────────────────────────────────

  if (parseError !== null) {
    return (
      <LayerOverlayShell toolbar={toolbar}>
        <div className="flex h-full items-center justify-center p-6">
          <div className="flex flex-col items-center gap-3 text-center">
            <AlertCircle className="h-6 w-6 text-destructive" />
            <p className="text-sm font-medium text-destructive">
              Failed to parse content
            </p>
            <p className="text-xs text-muted-foreground">{parseError}</p>
          </div>
        </div>
      </LayerOverlayShell>
    );
  }

  // ── No file ───────────────────────────────────────────────────────────────

  if (!currentFile) {
    return (
      <LayerOverlayShell toolbar={toolbar}>
        <div className="flex h-full items-center justify-center">
          <p className="text-sm text-muted-foreground">
            No PDF file open. Load a file to edit its content.
          </p>
        </div>
      </LayerOverlayShell>
    );
  }

  // ── Empty page ────────────────────────────────────────────────────────────

  if (parsedElements.length === 0) {
    return (
      <LayerOverlayShell toolbar={toolbar}>
        <div className="flex h-full items-center justify-center">
          <div className="flex flex-col items-center gap-3 text-center">
            <ScanSearch className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No editable content found on this page.
            </p>
          </div>
        </div>
      </LayerOverlayShell>
    );
  }

  // ── Main editing surface ──────────────────────────────────────────────────

  return (
    <LayerOverlayShell toolbar={toolbar}>
      {/* Click-away to close active editors */}
      <div
        className="absolute inset-0"
        onClick={() => {
          setZoneState((prev) => ({ ...prev, activeEditId: null }));
          setActiveImageId(null);
        }}
      />

      {parsedElements.map((element) => {
        const { elementId, bounds } = element;
        const mod = zoneState.modifications.get(elementId);
        const isDeleted = mod?.action === "delete";
        const isModified = mod?.action === "update";
        const isTextEditing =
          isTextElement(element) && zoneState.activeEditId === elementId;
        const isImageControls =
          isImageElement(element) && activeImageId === elementId;
        const isHovered = zoneState.hoveredZoneId === elementId;
        const imagePreview = zoneState.imagePreviewMap.get(elementId) ?? null;

        const left = bounds.x * zoom;
        const top = bounds.y * zoom;
        const width = bounds.width * zoom;
        const height = bounds.height * zoom;

        return (
          <div
            key={elementId}
            style={{ position: "absolute", left, top, width, height }}
            onMouseEnter={() =>
              setZoneState((prev) => ({
                ...prev,
                hoveredZoneId: elementId,
              }))
            }
            onMouseLeave={() =>
              setZoneState((prev) => ({
                ...prev,
                hoveredZoneId: prev.hoveredZoneId === elementId ? null : prev.hoveredZoneId,
              }))
            }
            onContextMenu={(e) => {
              e.preventDefault();
              if (!isDeleted) {
                handleDeleteZone(element, e);
              }
            }}
          >
            {/* ── Deleted overlay ─────────────────────────────────── */}
            {isDeleted ? (
              <div
                className="absolute inset-0 rounded-sm border-2 border-red-500 bg-red-100/30"
                style={{ zIndex: 30 }}
              >
                {/* Diagonal strikethrough */}
                <div
                  className="absolute inset-0 overflow-hidden rounded-sm"
                  aria-hidden="true"
                >
                  <div
                    style={{
                      position: "absolute",
                      top: "50%",
                      left: "-10%",
                      width: "120%",
                      height: 2,
                      background: "rgb(239 68 68 / 0.7)",
                      transform: `rotate(${
                        width > 0
                          ? Math.atan2(height, width) * (180 / Math.PI)
                          : 45
                      }deg)`,
                      transformOrigin: "center",
                    }}
                  />
                </div>
                {/* Restore button */}
                <button
                  onClick={(e) => handleRestoreZone(elementId, e)}
                  className={cn(
                    "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2",
                    "flex items-center gap-1 rounded px-2 py-0.5",
                    "text-[10px] font-medium text-white bg-red-600 hover:bg-red-500",
                    "shadow transition-colors",
                  )}
                >
                  <RotateCcw className="h-3 w-3" />
                  Restore
                </button>
              </div>
            ) : (
              <>
                {/* ── Text zone ──────────────────────────────────── */}
                {isTextElement(element) && !isTextEditing && (
                  <div
                    className={cn(
                      "absolute inset-0 cursor-text rounded-sm border-2 border-dashed transition-colors",
                      isModified
                        ? "border-yellow-500 bg-yellow-100/30"
                        : isHovered
                          ? "border-blue-400 bg-blue-50/20"
                          : "border-transparent",
                    )}
                    onClick={(e) => handleTextZoneClick(element, e)}
                    role="button"
                    tabIndex={0}
                    aria-label={`Edit text: ${elementLabel(element)}`}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleTextZoneClick(
                          element,
                          e as unknown as React.MouseEvent,
                        );
                      }
                    }}
                  >
                    {/* Modified badge */}
                    {isModified && (
                      <span
                        className={cn(
                          "absolute -top-4 right-0 text-[9px] font-semibold",
                          "rounded-t px-1 py-0.5 bg-yellow-500 text-white",
                        )}
                      >
                        edited
                      </span>
                    )}

                    {/* Hover actions */}
                    {isHovered && (
                      <div className="absolute -top-7 right-0 flex items-center gap-0.5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteZone(element, e);
                          }}
                          className="flex items-center rounded p-0.5 text-red-500 hover:bg-red-50 transition-colors"
                          aria-label="Delete element"
                          title="Delete zone (right-click shortcut)"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    )}

                    {/* Tooltip */}
                    {isHovered && <ZoneTooltip element={element} />}
                  </div>
                )}

                {/* ── Inline text editor ─────────────────────────── */}
                {isTextElement(element) && isTextEditing && (
                  <InlineTextEditor
                    element={element}
                    zoom={zoom}
                    value={zoneState.editValue}
                    onChange={(val) =>
                      setZoneState((prev) => ({ ...prev, editValue: val }))
                    }
                    onConfirm={() => handleConfirmEdit(element)}
                    onCancel={handleCancelEdit}
                    backgroundImage={
                      canvasRef?.current
                        ? captureCanvasRegion(
                            canvasRef.current,
                            element.bounds,
                            zoom,
                          )
                        : null
                    }
                  />
                )}

                {/* ── Image zone ─────────────────────────────────── */}
                {isImageElement(element) && !isImageControls && (
                  <div
                    className={cn(
                      "absolute inset-0 cursor-pointer rounded-sm border-2 border-dashed transition-colors",
                      isModified
                        ? "border-yellow-500 bg-yellow-100/20"
                        : isHovered
                          ? "border-green-400 bg-green-50/20"
                          : "border-transparent",
                    )}
                    onClick={(e) => handleImageZoneClick(element, e)}
                    role="button"
                    tabIndex={0}
                    aria-label={`Replace image (${Math.round(bounds.width)}×${Math.round(bounds.height)} pt)`}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleImageZoneClick(
                          element,
                          e as unknown as React.MouseEvent,
                        );
                      }
                    }}
                  >
                    {/* Image preview overlay when replaced */}
                    {imagePreview !== null && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={imagePreview}
                        alt="Replaced image preview"
                        className="absolute inset-0 h-full w-full rounded-sm object-contain"
                      />
                    )}

                    {/* Modified badge */}
                    {isModified && (
                      <span
                        className={cn(
                          "absolute -top-4 right-0 text-[9px] font-semibold",
                          "rounded-t px-1 py-0.5 bg-yellow-500 text-white",
                        )}
                      >
                        replaced
                      </span>
                    )}

                    {/* Hover icon */}
                    {isHovered && !imagePreview && (
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="flex items-center gap-1 rounded bg-black/50 px-2 py-1 text-[10px] text-white shadow">
                          <ImageIcon className="h-3 w-3" />
                          Click to replace
                        </div>
                      </div>
                    )}

                    {/* Hover actions */}
                    {isHovered && (
                      <div className="absolute -top-7 right-0 flex items-center gap-0.5">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteZone(element, e);
                          }}
                          className="flex items-center rounded p-0.5 text-red-500 hover:bg-red-50 transition-colors"
                          aria-label="Delete image element"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    )}

                    {/* Tooltip */}
                    {isHovered && <ZoneTooltip element={element} />}
                  </div>
                )}

                {/* ── Image replacement controls ─────────────────── */}
                {isImageElement(element) && isImageControls && (
                  <ImageZoneControls
                    element={element}
                    zoom={zoom}
                    previewDataUrl={imagePreview}
                    onReplace={(file) => handleImageReplace(element, file)}
                    onClose={() => setActiveImageId(null)}
                  />
                )}

                {/* ── Shape zone ──────────────────────────────────── */}
                {isShapeElement(element) && (
                  <div
                    className={cn(
                      "absolute inset-0 cursor-pointer rounded-sm border-2 border-dashed transition-colors",
                      isModified
                        ? "border-yellow-500 bg-yellow-100/20"
                        : isHovered
                          ? "border-purple-400 bg-purple-50/20"
                          : "border-transparent",
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                    }}
                    role="button"
                    tabIndex={0}
                    aria-label={`Edit shape: ${element.shapeType}`}
                  >
                    {/* Modified badge */}
                    {isModified && (
                      <span
                        className={cn(
                          "absolute -top-4 right-0 text-[9px] font-semibold",
                          "rounded-t px-1 py-0.5 bg-yellow-500 text-white",
                        )}
                      >
                        edited
                      </span>
                    )}

                    {/* Hover overlay with shape info */}
                    {isHovered && (
                      <>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="flex items-center gap-1 rounded bg-black/50 px-2 py-1 text-[10px] text-white shadow">
                            <Move className="h-3 w-3" />
                            Click to edit style
                          </div>
                        </div>
                        <div className="absolute -top-7 right-0 flex items-center gap-0.5">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteZone(element, e);
                            }}
                            className="flex items-center rounded p-0.5 text-red-500 hover:bg-red-50 transition-colors"
                            aria-label="Delete shape"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                        <ZoneTooltip element={element} />
                      </>
                    )}
                  </div>
                )}

                {/* ── Annotation zone ─────────────────────────────── */}
                {isAnnotationElement(element) && (
                  <div
                    className={cn(
                      "absolute inset-0 cursor-pointer rounded-sm border-2 border-dashed transition-colors",
                      isModified
                        ? "border-yellow-500 bg-yellow-100/20"
                        : isHovered
                          ? "border-orange-400 bg-orange-50/20"
                          : "border-transparent",
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (element.content) {
                        setZoneState((prev) => ({
                          ...prev,
                          activeEditId: element.elementId,
                          editValue: element.content || "",
                        }));
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    aria-label={`Edit annotation: ${element.annotationType}`}
                  >
                    {isModified && (
                      <span
                        className={cn(
                          "absolute -top-4 right-0 text-[9px] font-semibold",
                          "rounded-t px-1 py-0.5 bg-yellow-500 text-white",
                        )}
                      >
                        edited
                      </span>
                    )}

                    {isHovered && (
                      <>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="flex items-center gap-1 rounded bg-black/50 px-2 py-1 text-[10px] text-white shadow">
                            <MessageSquare className="h-3 w-3" />
                            {element.content ? "Click to edit" : element.annotationType}
                          </div>
                        </div>
                        <div className="absolute -top-7 right-0 flex items-center gap-0.5">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteZone(element, e);
                            }}
                            className="flex items-center rounded p-0.5 text-red-500 hover:bg-red-50 transition-colors"
                            aria-label="Delete annotation"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                        <ZoneTooltip element={element} />
                      </>
                    )}
                  </div>
                )}

                {/* ── Annotation inline text editor (for notes/comments) ── */}
                {isAnnotationElement(element) && zoneState.activeEditId === element.elementId && element.content && (
                  <InlineTextEditor
                    element={{
                      ...element,
                      type: "text" as const,
                      content: element.content,
                      style: {
                        fontFamily: "Arial, sans-serif",
                        fontSize: 12,
                        color: "#000000",
                        textAlign: "left" as const,
                        lineHeight: 1.2,
                        fontWeight: "normal" as const,
                        fontStyle: "normal" as const,
                        letterSpacing: 0,
                        underline: false,
                        strikethrough: false,
                        opacity: 1,
                      },
                    } as unknown as TextElement}
                    zoom={zoom}
                    value={zoneState.editValue}
                    onChange={(val) =>
                      setZoneState((prev) => ({ ...prev, editValue: val }))
                    }
                    onConfirm={() => {
                      setZoneState((prev) => {
                        if (prev.activeEditId !== element.elementId) return prev;
                        const newContent = prev.editValue;
                        if (newContent !== element.content) {
                          const mod: ElementModification = {
                            action: "update",
                            pageNumber: currentPageIndex,
                            element: { ...element, content: newContent } as unknown as Record<string, unknown>,
                            oldBounds: {
                              x: element.bounds.x,
                              y: element.bounds.y,
                              width: element.bounds.width,
                              height: element.bounds.height,
                            },
                          };
                          const next = new Map(prev.modifications);
                          next.set(element.elementId, mod);
                          const all = Array.from(next.values());
                          queueMicrotask(() => onModificationsChange(all));
                          return { ...prev, modifications: next, activeEditId: null };
                        }
                        return { ...prev, activeEditId: null };
                      });
                    }}
                    onCancel={handleCancelEdit}
                    backgroundImage={null}
                  />
                )}

                {/* ── Form field zone ─────────────────────────────── */}
                {isFormFieldElement(element) && (
                  <div
                    className={cn(
                      "absolute inset-0 cursor-pointer rounded-sm border-2 border-dashed transition-colors",
                      isModified
                        ? "border-yellow-500 bg-yellow-100/20"
                        : isHovered
                          ? "border-teal-400 bg-teal-50/20"
                          : "border-transparent",
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (element.fieldType === "text") {
                        setZoneState((prev) => ({
                          ...prev,
                          activeEditId: element.elementId,
                          editValue: (element.value as string) || "",
                        }));
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    aria-label={`Edit form field: ${element.fieldName}`}
                  >
                    {isModified && (
                      <span
                        className={cn(
                          "absolute -top-4 right-0 text-[9px] font-semibold",
                          "rounded-t px-1 py-0.5 bg-yellow-500 text-white",
                        )}
                      >
                        edited
                      </span>
                    )}

                    {isHovered && (
                      <>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="flex items-center gap-1 rounded bg-black/50 px-2 py-1 text-[10px] text-white shadow">
                            <FormInput className="h-3 w-3" />
                            {element.fieldType}: {element.fieldName}
                          </div>
                        </div>
                        <div className="absolute -top-7 right-0 flex items-center gap-0.5">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteZone(element, e);
                            }}
                            className="flex items-center rounded p-0.5 text-red-500 hover:bg-red-50 transition-colors"
                            aria-label="Delete form field"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                        <ZoneTooltip element={element} />
                      </>
                    )}
                  </div>
                )}

                {/* ── Form field inline text editor (for text/textarea fields) ── */}
                {isFormFieldElement(element) && zoneState.activeEditId === element.elementId && (element.fieldType === "text") && (
                  <InlineTextEditor
                    element={{
                      ...element,
                      type: "text" as const,
                      content: (element.value as string) || "",
                      style: {
                        fontFamily: "Arial, sans-serif",
                        fontSize: 11,
                        color: "#000000",
                        textAlign: "left" as const,
                        lineHeight: 1.2,
                        fontWeight: "normal" as const,
                        fontStyle: "normal" as const,
                        letterSpacing: 0,
                        underline: false,
                        strikethrough: false,
                        opacity: 1,
                      },
                    } as unknown as TextElement}
                    zoom={zoom}
                    value={zoneState.editValue}
                    onChange={(val) =>
                      setZoneState((prev) => ({ ...prev, editValue: val }))
                    }
                    onConfirm={() => {
                      setZoneState((prev) => {
                        if (prev.activeEditId !== element.elementId) return prev;
                        const newValue = prev.editValue;
                        if (newValue !== ((element.value as string) || "")) {
                          const mod: ElementModification = {
                            action: "update",
                            pageNumber: currentPageIndex,
                            element: { ...element, value: newValue } as unknown as Record<string, unknown>,
                            oldBounds: {
                              x: element.bounds.x,
                              y: element.bounds.y,
                              width: element.bounds.width,
                              height: element.bounds.height,
                            },
                          };
                          const next = new Map(prev.modifications);
                          next.set(element.elementId, mod);
                          const all = Array.from(next.values());
                          queueMicrotask(() => onModificationsChange(all));
                          return { ...prev, modifications: next, activeEditId: null };
                        }
                        return { ...prev, activeEditId: null };
                      });
                    }}
                    onCancel={handleCancelEdit}
                    backgroundImage={null}
                  />
                )}
              </>
            )}
          </div>
        );
      })}
    </LayerOverlayShell>
  );
}
