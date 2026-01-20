"use client";

import React, { useRef, useEffect, useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import type {
  PageObject,
  Tool,
  Element,
  ShapeType,
  AnnotationType,
} from "@giga-pdf/types";
import type { Canvas as FabricCanvas, FabricObject } from "fabric";

// API base URL for image loading
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/**
 * Resolve image URL - prepend API base URL if it's a relative path
 */
function resolveImageUrl(url: string): string {
  if (!url) return "";
  // If already absolute URL, return as-is
  if (url.startsWith("http://") || url.startsWith("https://") || url.startsWith("data:")) {
    return url;
  }
  // Prepend API base URL for relative paths
  return `${API_BASE_URL}${url.startsWith("/") ? "" : "/"}${url}`;
}

// PDF uses 72 DPI as base unit
const PDF_BASE_DPI = 72;
// Preview API default DPI for high-quality rendering
const PREVIEW_DPI = 150;
// Scale factor to convert PDF points to preview pixels
const SCALE_FACTOR = PREVIEW_DPI / PDF_BASE_DPI; // ≈ 2.083

/**
 * Generate the URL for a page preview image
 */
function getPagePreviewUrl(documentId: string, pageNumber: number, dpi: number = PREVIEW_DPI): string {
  return `${API_BASE_URL}/api/v1/documents/${documentId}/pages/${pageNumber}/preview?format=png&dpi=${dpi}`;
}

export interface EditorCanvasHandle {
  /** Ajouter une image au canvas */
  addImage: (dataUrl: string, width: number, height: number) => void;
  /** Annuler la dernière action */
  undo: () => void;
  /** Refaire la dernière action annulée */
  redo: () => void;
  /** Peut annuler */
  canUndo: () => boolean;
  /** Peut refaire */
  canRedo: () => boolean;
  /** Supprimer les éléments sélectionnés */
  deleteSelected: () => void;
  /** Dupliquer les éléments sélectionnés */
  duplicateSelected: () => void;
  /** Obtenir les IDs des éléments sélectionnés */
  getSelectedIds: () => string[];
}

export interface EditorCanvasProps {
  /** Page actuelle à afficher */
  page: PageObject | null;
  /** Document ID pour charger l'aperçu de la page comme fond */
  documentId: string | null;
  /** Outil actif */
  tool: Tool;
  /** Niveau de zoom (1 = 100%) */
  zoom: number;
  /** Largeur du canvas */
  width?: number;
  /** Hauteur du canvas */
  height?: number;
  /** Type de forme sélectionné */
  shapeType?: ShapeType;
  /** Type d'annotation sélectionné */
  annotationType?: AnnotationType;
  /** Couleur de contour */
  strokeColor?: string;
  /** Couleur de remplissage */
  fillColor?: string;
  /** Épaisseur du contour */
  strokeWidth?: number;
  /** Callback quand un élément est ajouté */
  onElementAdded?: (element: Element) => void;
  /** Callback quand un élément est modifié */
  onElementModified?: (element: Element) => void;
  /** Callback quand un élément est supprimé */
  onElementRemoved?: (elementId: string) => void;
  /** Callback quand la sélection change */
  onSelectionChanged?: (elementIds: string[]) => void;
  /** Callback pour changement de zoom */
  onZoomChanged?: (zoom: number) => void;
  /** Callback appelé lorsque le canvas est prêt avec les méthodes exposées */
  onCanvasReady?: (handle: EditorCanvasHandle) => void;
  /** Callback pour les clics sur les liens hypertexte */
  onHyperlinkClick?: (linkUrl?: string | null, linkPage?: number | null) => void;
}

// Génère un ID unique
function generateId(): string {
  return `el_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Type helper for fabric objects with custom data
interface FabricObjectWithData extends FabricObject {
  data?: { elementId?: string; [key: string]: unknown };
}

/**
 * Canvas de l'éditeur PDF avec support Fabric.js.
 * Chaque élément est indépendant et éditable.
 */
export function EditorCanvas({
  page,
  documentId,
  tool,
  zoom,
  width = 800,
  height = 600,
  shapeType = "rectangle",
  annotationType = "highlight",
  strokeColor = "#000000",
  fillColor = "transparent",
  strokeWidth = 2,
  onElementAdded,
  onElementModified,
  onElementRemoved,
  onSelectionChanged,
  onZoomChanged,
  onCanvasReady,
  onHyperlinkClick,
}: EditorCanvasProps) {
  const t = useTranslations("editor.canvas");
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<FabricCanvas | null>(null);
  const previousPageRef = useRef<string | null>(null);

  // Refs for callbacks to avoid stale closures in Fabric.js event handlers
  const onElementAddedRef = useRef(onElementAdded);
  const onElementModifiedRef = useRef(onElementModified);
  const onElementRemovedRef = useRef(onElementRemoved);
  const onSelectionChangedRef = useRef(onSelectionChanged);
  const onZoomChangedRef = useRef(onZoomChanged);
  const onHyperlinkClickRef = useRef(onHyperlinkClick);

  // Refs for tool options to avoid stale closures
  const toolRef = useRef(tool);
  const shapeTypeRef = useRef(shapeType);
  const annotationTypeRef = useRef(annotationType);
  const strokeColorRef = useRef(strokeColor);
  const fillColorRef = useRef(fillColor);
  const strokeWidthRef = useRef(strokeWidth);
  const zoomRef = useRef(zoom);

  // Update refs when props change
  useEffect(() => {
    onElementAddedRef.current = onElementAdded;
    onElementModifiedRef.current = onElementModified;
    onElementRemovedRef.current = onElementRemoved;
    onSelectionChangedRef.current = onSelectionChanged;
    onZoomChangedRef.current = onZoomChanged;
    onHyperlinkClickRef.current = onHyperlinkClick;
    toolRef.current = tool;
    shapeTypeRef.current = shapeType;
    annotationTypeRef.current = annotationType;
    strokeColorRef.current = strokeColor;
    fillColorRef.current = fillColor;
    strokeWidthRef.current = strokeWidth;
    zoomRef.current = zoom;
  });

  // Historique pour undo/redo
  const [historyStack, setHistoryStack] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const isUpdatingHistoryRef = useRef(false);

  // Ref pour tracker le contenu original des textes (pour detecter les vraies modifications)
  const originalContentRef = useRef<Map<string, string>>(new Map());

  // Cache for page background images to avoid re-fetching
  const backgroundCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());

  // Sauvegarder l'état dans l'historique
  const saveHistory = useCallback(
    (canvas: FabricCanvas) => {
      const json = JSON.stringify(canvas.toObject(["data"]));
      setHistoryStack((prev) => {
        const newStack = prev.slice(0, historyIndex + 1);
        return [...newStack, json];
      });
      setHistoryIndex((prev) => prev + 1);
    },
    [historyIndex]
  );

  // Load page background image from preview API
  const loadPageBackground = useCallback(
    async (pageNumber: number, docId: string, canvas: FabricCanvas) => {
      const cacheKey = `${docId}-${pageNumber}`;

      try {
        const { FabricImage } = await import("fabric");
        const previewUrl = getPagePreviewUrl(docId, pageNumber, PREVIEW_DPI);

        // Check if we have a cached URL (browser will use cached image)
        const cached = backgroundCacheRef.current.has(cacheKey);
        if (cached) {
          console.log("[EditorCanvas] Using cached background URL for page:", pageNumber);
        } else {
          console.log("[EditorCanvas] Loading background from:", previewUrl);
        }

        const img = await FabricImage.fromURL(previewUrl, { crossOrigin: "anonymous" });
        canvas.backgroundImage = img;
        canvas.renderAll();

        // Mark as cached (browser handles actual image caching)
        if (!cached) {
          const imgElement = new Image();
          imgElement.crossOrigin = "anonymous";
          imgElement.src = previewUrl;
          backgroundCacheRef.current.set(cacheKey, imgElement);
        }

        console.log("[EditorCanvas] Background loaded for page:", pageNumber);
      } catch (error) {
        console.error("[EditorCanvas] Failed to load background:", error);
        // Fallback to white background
        canvas.backgroundColor = "#ffffff";
        canvas.renderAll();
      }
    },
    []
  );

  // Convertir un objet Fabric.js en Element
  const fabricObjectToElement = useCallback(
    (obj: FabricObjectWithData): Element | null => {
      const elementId = obj.data?.elementId || generateId();
      const scaleX = obj.scaleX ?? 1;
      const scaleY = obj.scaleY ?? 1;

      // Base element properties matching ElementBase interface
      // Divide by SCALE_FACTOR to convert back from preview pixels to PDF points
      const baseElement = {
        elementId,
        bounds: {
          x: (obj.left || 0) / SCALE_FACTOR,
          y: (obj.top || 0) / SCALE_FACTOR,
          width: ((obj.width || 100) * scaleX) / SCALE_FACTOR,
          height: ((obj.height || 100) * scaleY) / SCALE_FACTOR,
        },
        transform: {
          rotation: obj.angle || 0,
          scaleX: 1, // Already applied to bounds
          scaleY: 1,
          skewX: obj.skewX || 0,
          skewY: obj.skewY || 0,
        },
        layerId: null,
        locked: !obj.selectable,
        visible: obj.visible ?? true,
      };

      // Check object type using constructor name
      const typeName = obj.constructor.name;

      if (typeName === "IText" || typeName === "FabricText" || typeName === "Text") {
        const textObj = obj as FabricObjectWithData & {
          text?: string;
          fontSize?: number;
          fontFamily?: string;
          fontWeight?: string;
          fontStyle?: string;
          fill?: string;
          textAlign?: string;
          lineHeight?: number;
          charSpacing?: number;
        };
        const textObjWithStyles = textObj as typeof textObj & {
          underline?: boolean;
          linethrough?: boolean;
          textBackgroundColor?: string;
        };
        const data = (obj as FabricObjectWithData).data;
        return {
          ...baseElement,
          type: "text" as const,
          content: textObj.text || "",
          style: {
            fontFamily: textObj.fontFamily || "Arial",
            fontSize: (textObj.fontSize || 16) / SCALE_FACTOR,
            fontWeight: textObj.fontWeight === "bold" ? "bold" : "normal",
            fontStyle: textObj.fontStyle === "italic" ? "italic" : "normal",
            color: (textObj.fill as string) || "#000000",
            opacity: obj.opacity ?? 1,
            textAlign: (textObj.textAlign as "left" | "center" | "right" | "justify") || "left",
            lineHeight: textObj.lineHeight || 1.2,
            letterSpacing: textObj.charSpacing || 0,
            writingMode: "horizontal-tb" as const,
            // New text decorations
            underline: textObjWithStyles.underline || false,
            strikethrough: textObjWithStyles.linethrough || false,
            backgroundColor: textObjWithStyles.textBackgroundColor || null,
            verticalAlign: "baseline" as const,
            originalFont: null,
          },
          ocrConfidence: null,
          linkUrl: (data?.linkUrl as string) || null,
          linkPage: (data?.linkPage as number) || null,
        };
      }

      if (typeName === "FabricImage" || typeName === "Image") {
        const imgObj = obj as FabricObjectWithData & {
          getSrc?: () => string;
          width?: number;
          height?: number;
          scaleX?: number;
          scaleY?: number;
        };
        return {
          ...baseElement,
          type: "image" as const,
          source: {
            type: "embedded" as const,
            dataUrl: imgObj.getSrc?.() || "",
            originalFormat: "png",
            originalDimensions: {
              width: imgObj.width || 100,
              height: imgObj.height || 100,
            },
          },
          style: {
            opacity: obj.opacity ?? 1,
            blendMode: "normal" as const,
          },
          crop: null,
        };
      }

      if (["Rect", "Circle", "Triangle", "Ellipse", "Line"].includes(typeName)) {
        let shapeTypeResult: ShapeType = "rectangle";
        if (typeName === "Circle") shapeTypeResult = "circle";
        if (typeName === "Ellipse") shapeTypeResult = "ellipse";
        if (typeName === "Line") shapeTypeResult = "line";
        if (typeName === "Triangle") shapeTypeResult = "triangle";

        return {
          ...baseElement,
          type: "shape" as const,
          shapeType: shapeTypeResult,
          geometry: {
            points: [],
            pathData: null,
            cornerRadius: 0,
          },
          style: {
            fillColor: (obj.fill as string) || null,
            fillOpacity: obj.opacity ?? 1,
            strokeColor: (obj.stroke as string) || null,
            strokeWidth: obj.strokeWidth || 1,
            strokeOpacity: 1,
            strokeDashArray: [],
          },
        };
      }

      return null;
    },
    []
  );

  // Handlers d'événements - using refs to avoid stale closures
  const handleSelectionChange = useCallback(() => {
    if (!fabricRef.current) return;
    const activeObjects = fabricRef.current.getActiveObjects();
    const ids = activeObjects
      .map((obj) => (obj as FabricObjectWithData).data?.elementId)
      .filter(Boolean) as string[];
    onSelectionChangedRef.current?.(ids);
  }, []);

  // Type de modification pour distinguer position/contenu/style
  type ModificationType = 'position' | 'content' | 'style';

  // Handler appele quand un texte entre en mode edition
  const handleTextEditingEntered = useCallback((e: { target?: FabricObject }) => {
    if (!e.target) return;
    const obj = e.target as FabricObjectWithData;
    const typeName = obj.constructor.name;

    if (typeName === "IText" || typeName === "Textbox" || typeName === "FabricText") {
      const elementId = obj.data?.elementId;
      const currentText = (obj as FabricObjectWithData & { text?: string }).text || "";

      if (elementId) {
        // Sauvegarder le contenu original avant edition
        originalContentRef.current.set(elementId, currentText);
        console.log("[EditorCanvas] Text editing started, saved original content:", elementId, `"${currentText}"`);
      }
    }
  }, []);

  // Handler appele quand le texte change en temps reel
  const handleTextChanged = useCallback((e: { target?: FabricObject }) => {
    if (!e.target) return;
    const obj = e.target as FabricObjectWithData;
    const elementId = obj.data?.elementId;
    const currentText = (obj as FabricObjectWithData & { text?: string }).text || "";

    console.log("[EditorCanvas] Text changed in real-time:", elementId, `"${currentText}"`);
  }, []);

  // Handler appele quand un texte sort du mode edition
  const handleTextEditingExited = useCallback((e: { target?: FabricObject }) => {
    if (!e.target) return;
    const obj = e.target as FabricObjectWithData;
    const elementId = obj.data?.elementId;
    const currentText = (obj as FabricObjectWithData & { text?: string }).text || "";
    const originalText = elementId ? originalContentRef.current.get(elementId) : undefined;

    if (originalText !== undefined && originalText !== currentText) {
      console.log(`[EditorCanvas] Text editing exited with CONTENT CHANGE: "${originalText}" -> "${currentText}"`);
    } else {
      console.log("[EditorCanvas] Text editing exited (no content change)");
    }

    // Note: On ne supprime pas du map ici car object:modified peut etre appele apres
    // Le map sera nettoye au prochain text:editing:entered pour le meme element
  }, []);

  const handleObjectModified = useCallback(
    (e: { target?: FabricObject }) => {
      if (!e.target) return;
      const obj = e.target as FabricObjectWithData;
      const elementId = obj.data?.elementId;
      const typeName = obj.constructor.name;

      // Detecter le TYPE de modification
      let modificationType: ModificationType = 'position';

      // Verifier si c'est un objet texte et si le contenu a change
      if (typeName === "IText" || typeName === "Textbox" || typeName === "FabricText") {
        const originalText = elementId ? originalContentRef.current.get(elementId) : undefined;
        const currentText = (obj as FabricObjectWithData & { text?: string }).text || "";

        if (originalText !== undefined && originalText !== currentText) {
          modificationType = 'content';
          console.log(`[EditorCanvas] Text content MODIFIED: "${originalText}" -> "${currentText}"`);
          // Mettre a jour le contenu original pour les prochaines comparaisons
          if (elementId) {
            originalContentRef.current.set(elementId, currentText);
          }
        } else {
          console.log("[EditorCanvas] Element position/style changed only (no content change)");
        }
      } else {
        console.log("[EditorCanvas] Non-text element modified (position/style)");
      }

      const element = fabricObjectToElement(obj);
      if (element) {
        console.log("[EditorCanvas] Object modified:", element.elementId, element.type, "modification:", modificationType);
        // Appeler le callback avec l'element (le type de modification peut etre utilise plus tard)
        onElementModifiedRef.current?.(element);
      }
      if (fabricRef.current) {
        saveHistory(fabricRef.current);
      }
    },
    [fabricObjectToElement, saveHistory]
  );

  const handleObjectAdded = useCallback(
    (e: { target?: FabricObject }) => {
      console.log("[EditorCanvas] object:added event fired, isUpdatingHistory:", isUpdatingHistoryRef.current);
      if (isUpdatingHistoryRef.current) return;
      if (!e.target) {
        console.log("[EditorCanvas] object:added - no target");
        return;
      }
      const element = fabricObjectToElement(e.target as FabricObjectWithData);
      if (element) {
        console.log("[EditorCanvas] Object added:", element.elementId, element.type);
        onElementAddedRef.current?.(element);
      } else {
        console.log("[EditorCanvas] object:added - could not convert to element");
      }
    },
    [fabricObjectToElement]
  );

  const handleObjectRemoved = useCallback(
    (e: { target?: FabricObject }) => {
      if (isUpdatingHistoryRef.current) return;
      if (!e.target) return;
      const elementId = (e.target as FabricObjectWithData).data?.elementId;
      if (elementId) {
        console.log("[EditorCanvas] Object removed:", elementId);
        onElementRemovedRef.current?.(elementId);
      }
    },
    []
  );

  // Update event handlers when they change
  useEffect(() => {
    if (!fabricRef.current) return;
    const canvas = fabricRef.current;

    // Remove old handlers
    canvas.off("selection:created");
    canvas.off("selection:updated");
    canvas.off("selection:cleared");
    canvas.off("object:modified");
    canvas.off("object:added");
    canvas.off("object:removed");
    canvas.off("text:editing:entered");
    canvas.off("text:changed");
    canvas.off("text:editing:exited");

    // Re-attach updated handlers
    canvas.on("selection:created", handleSelectionChange);
    canvas.on("selection:updated", handleSelectionChange);
    canvas.on("selection:cleared", handleSelectionChange);
    canvas.on("object:modified", handleObjectModified as (e: unknown) => void);
    canvas.on("object:added", handleObjectAdded as (e: unknown) => void);
    canvas.on("object:removed", handleObjectRemoved as (e: unknown) => void);
    // Handlers pour detecter les modifications de contenu texte
    canvas.on("text:editing:entered", handleTextEditingEntered as (e: unknown) => void);
    canvas.on("text:changed", handleTextChanged as (e: unknown) => void);
    canvas.on("text:editing:exited", handleTextEditingExited as (e: unknown) => void);
  }, [handleSelectionChange, handleObjectModified, handleObjectAdded, handleObjectRemoved, handleTextEditingEntered, handleTextChanged, handleTextEditingExited]);

  // Initialiser Fabric.js
  useEffect(() => {
    if (!canvasRef.current) return;

    // Import dynamique de Fabric.js pour éviter les erreurs SSR
    import("fabric").then((fabricModule) => {
      const { Canvas, Rect, Circle, Ellipse, Triangle, Line, IText, Group, FabricText } = fabricModule;

      if (fabricRef.current) {
        fabricRef.current.dispose();
      }

      const canvas = new Canvas(canvasRef.current!, {
        width: (page?.dimensions?.width || width) * SCALE_FACTOR * zoom,
        height: (page?.dimensions?.height || height) * SCALE_FACTOR * zoom,
        backgroundColor: "#ffffff",
        selection: tool === "select",
        preserveObjectStacking: true,
      });

      fabricRef.current = canvas;

      // Event handlers
      canvas.on("selection:created", handleSelectionChange);
      canvas.on("selection:updated", handleSelectionChange);
      canvas.on("selection:cleared", handleSelectionChange);
      canvas.on("object:modified", handleObjectModified as (e: unknown) => void);
      canvas.on("object:added", handleObjectAdded as (e: unknown) => void);
      canvas.on("object:removed", handleObjectRemoved as (e: unknown) => void);
      // Handlers pour detecter les modifications de contenu texte
      canvas.on("text:editing:entered", handleTextEditingEntered as (e: unknown) => void);
      canvas.on("text:changed", handleTextChanged as (e: unknown) => void);
      canvas.on("text:editing:exited", handleTextEditingExited as (e: unknown) => void);

      // Mouse down for creating objects - using refs to get current values
      canvas.on("mouse:down", (e) => {
        if (!fabricRef.current || !e.scenePoint) return;
        const currentCanvas = fabricRef.current;

        // Si on clique sur un objet existant, ne rien créer
        if (e.target) return;

        const pointer = e.scenePoint;
        const currentTool = toolRef.current;
        const currentShapeType = shapeTypeRef.current;
        const currentAnnotationType = annotationTypeRef.current;
        const currentStrokeColor = strokeColorRef.current;
        const currentFillColor = fillColorRef.current;
        const currentStrokeWidth = strokeWidthRef.current;

        console.log("[EditorCanvas] mouse:down - tool:", currentTool);

        let newObj: FabricObject | null = null;

        try {
          switch (currentTool) {
            case "text": {
              console.log("[EditorCanvas] Creating IText with:", { pointer, strokeColor: currentStrokeColor });
              newObj = new IText(t("defaultText") || "Text", {
                left: pointer.x,
                top: pointer.y,
                fontSize: 16,
                fontFamily: "Arial",
                fill: currentStrokeColor,
              });
              (newObj as FabricObjectWithData).data = { elementId: generateId() };
              console.log("[EditorCanvas] IText created successfully:", newObj);
              break;
            }

          case "shape": {
            const shapeOptions = {
              left: pointer.x,
              top: pointer.y,
              fill: currentFillColor,
              stroke: currentStrokeColor,
              strokeWidth: currentStrokeWidth,
            };

            switch (currentShapeType) {
              case "rectangle":
                newObj = new Rect({
                  ...shapeOptions,
                  width: 100,
                  height: 80,
                });
                break;
              case "circle":
                newObj = new Circle({
                  ...shapeOptions,
                  radius: 50,
                });
                break;
              case "ellipse":
                newObj = new Ellipse({
                  ...shapeOptions,
                  rx: 60,
                  ry: 40,
                });
                break;
              case "triangle":
                newObj = new Triangle({
                  ...shapeOptions,
                  width: 100,
                  height: 100,
                });
                break;
              case "line":
              case "arrow":
                newObj = new Line([0, 0, 100, 0], shapeOptions);
                break;
            }
            if (newObj) {
              (newObj as FabricObjectWithData).data = { elementId: generateId() };
            }
            break;
          }

          case "annotation": {
            switch (currentAnnotationType) {
              case "highlight":
                newObj = new Rect({
                  left: pointer.x,
                  top: pointer.y,
                  width: 100,
                  height: 20,
                  fill: "rgba(255, 255, 0, 0.3)",
                  stroke: undefined,
                });
                break;
              case "underline":
                newObj = new Line([0, 0, 100, 0], {
                  left: pointer.x,
                  top: pointer.y,
                  stroke: "#ff0000",
                  strokeWidth: 2,
                });
                break;
              case "strikethrough":
                newObj = new Line([0, 0, 100, 0], {
                  left: pointer.x,
                  top: pointer.y,
                  stroke: "#ff0000",
                  strokeWidth: 1,
                });
                break;
              case "note":
                newObj = new Rect({
                  left: pointer.x,
                  top: pointer.y,
                  width: 30,
                  height: 30,
                  fill: "#ffeb3b",
                  stroke: "#ffc107",
                  strokeWidth: 1,
                });
                break;
              case "comment":
                newObj = new Circle({
                  left: pointer.x,
                  top: pointer.y,
                  radius: 15,
                  fill: "#2196f3",
                  stroke: "#1976d2",
                  strokeWidth: 1,
                });
                break;
            }
            if (newObj) {
              (newObj as FabricObjectWithData).data = { elementId: generateId() };
            }
            break;
          }

          case "form_field": {
            // Créer un champ de formulaire (text input)
            const formFieldGroup = new Group(
              [
                // Fond du champ
                new Rect({
                  left: 0,
                  top: 0,
                  width: 200,
                  height: 30,
                  fill: "#ffffff",
                  stroke: "#cccccc",
                  strokeWidth: 1,
                  rx: 4,
                  ry: 4,
                }),
                // Texte placeholder
                new FabricText(t("textPlaceholder"), {
                  left: 10,
                  top: 8,
                  fontSize: 12,
                  fontFamily: "Arial",
                  fill: "#999999",
                }),
              ],
              {
                left: pointer.x,
                top: pointer.y,
              }
            );
            (formFieldGroup as FabricObjectWithData).data = {
              elementId: generateId(),
              formFieldType: "text",
              fieldName: `field_${Date.now()}`,
              required: false,
              placeholder: t("textPlaceholder"),
            };
            newObj = formFieldGroup;
            break;
          }
          }
        } catch (error) {
          console.error("[EditorCanvas] Error creating object:", error);
        }

        if (newObj) {
          console.log("[EditorCanvas] Adding new object to canvas:", currentTool, (newObj as FabricObjectWithData).data?.elementId);
          currentCanvas.add(newObj);
          currentCanvas.setActiveObject(newObj);
          currentCanvas.renderAll();
          saveHistory(currentCanvas);
          console.log("[EditorCanvas] Object added to canvas, total objects:", currentCanvas.getObjects().length);
        } else {
          console.log("[EditorCanvas] mouse:down - newObj is null for tool:", currentTool);
        }
      });

      // Mouse wheel for zoom - using refs
      canvas.on("mouse:wheel", (opt) => {
        const event = opt.e as WheelEvent;
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          const delta = event.deltaY > 0 ? -0.1 : 0.1;
          const newZoom = Math.min(4, Math.max(0.25, zoomRef.current + delta));
          onZoomChangedRef.current?.(newZoom);
        }
      });

      // Double-click for hyperlinks - using refs
      canvas.on("mouse:dblclick", (e) => {
        if (!e.target) return;
        const obj = e.target as FabricObjectWithData;
        const data = obj.data;
        if (data?.linkUrl || data?.linkPage) {
          onHyperlinkClickRef.current?.(data.linkUrl as string | null, data.linkPage as number | null);
        }
      });

      // Charger la page initiale
      if (page && page.elements) {
        page.elements.forEach((element) => {
          const obj = elementToFabricObject(element, fabricModule);
          if (obj) {
            (obj as FabricObjectWithData).data = { elementId: element.elementId };
            canvas.add(obj);
          }
        });
        canvas.renderAll();
      }

      // Sauvegarder l'état initial
      saveHistory(canvas);
    });

    return () => {
      if (fabricRef.current) {
        fabricRef.current.dispose();
        fabricRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Convertir un Element en objet Fabric.js
  const elementToFabricObject = (
    element: Element,
    fabricModule: typeof import("fabric")
  ): FabricObject | null => {
    const { Rect, Circle, Ellipse, Triangle, Line, IText, FabricImage } = fabricModule;

    // Base options from the new Element structure
    // Apply SCALE_FACTOR to convert PDF coordinates to preview pixels
    const baseOptions = {
      left: element.bounds.x * SCALE_FACTOR,
      top: element.bounds.y * SCALE_FACTOR,
      angle: element.transform.rotation || 0,
      scaleX: element.transform.scaleX || 1,
      scaleY: element.transform.scaleY || 1,
      skewX: element.transform.skewX || 0,
      skewY: element.transform.skewY || 0,
      selectable: !element.locked,
      visible: element.visible,
    };

    switch (element.type) {
      case "text": {
        // TextElement structure with full styling
        // Scale fontSize to match preview DPI
        const scaledFontSize = (element.style.fontSize || 16) * SCALE_FACTOR;
        const textObj = new IText(element.content || t("defaultText"), {
          ...baseOptions,
          fontSize: scaledFontSize,
          fontFamily: element.style.originalFont || element.style.fontFamily || "Arial",
          fontWeight: element.style.fontWeight || "normal",
          fontStyle: element.style.fontStyle || "normal",
          fill: element.style.color || "#000000",
          opacity: element.style.opacity ?? 1,
          textAlign: element.style.textAlign || "left",
          lineHeight: element.style.lineHeight || 1.2,
          charSpacing: (element.style.letterSpacing || 0) * 10, // Convert to Fabric units
          underline: element.style.underline || false,
          linethrough: element.style.strikethrough || false,
          textBackgroundColor: element.style.backgroundColor || "",
        });

        // Store link info for click handling
        if (element.linkUrl || element.linkPage) {
          (textObj as FabricObjectWithData).data = {
            ...((textObj as FabricObjectWithData).data || {}),
            elementId: element.elementId,
            linkUrl: element.linkUrl,
            linkPage: element.linkPage,
          };
          // Style links with underline and blue color if not already styled
          if (!element.style.underline) {
            textObj.set({
              underline: true,
              fill: element.style.color || "#0066cc",
            });
          }
        }

        return textObj;
      }

      case "image": {
        // ImageElement structure - images loaded asynchronously
        if (element.source?.dataUrl) {
          const imageUrl = resolveImageUrl(element.source.dataUrl);
          console.log("[EditorCanvas] Loading image:", imageUrl);

          FabricImage.fromURL(imageUrl, { crossOrigin: "anonymous" })
            .then((img: FabricObject) => {
              const originalWidth = element.source.originalDimensions?.width || 100;
              const originalHeight = element.source.originalDimensions?.height || 100;
              // Scale bounds to match preview DPI
              const scaledWidth = element.bounds.width * SCALE_FACTOR;
              const scaledHeight = element.bounds.height * SCALE_FACTOR;
              img.set({
                ...baseOptions,
                scaleX: scaledWidth / originalWidth,
                scaleY: scaledHeight / originalHeight,
                opacity: element.style?.opacity ?? 1,
              });
              (img as FabricObjectWithData).data = { elementId: element.elementId };
              fabricRef.current?.add(img);
              fabricRef.current?.renderAll();
              console.log("[EditorCanvas] Image loaded successfully:", element.elementId);
            })
            .catch((err) => {
              console.error("[EditorCanvas] Failed to load image:", imageUrl, err);
            });
        }
        return null;
      }

      case "shape": {
        // ShapeElement structure
        // Only show stroke if explicitly defined with color and width > 0
        const hasStroke = element.style.strokeColor && element.style.strokeWidth > 0;
        const shapeOptions = {
          ...baseOptions,
          fill: element.style.fillColor || "transparent",
          stroke: hasStroke ? element.style.strokeColor : undefined,
          strokeWidth: hasStroke ? element.style.strokeWidth * SCALE_FACTOR : 0,
          opacity: element.style.fillOpacity ?? 1,
          rx: (element.geometry?.cornerRadius || 0) * SCALE_FACTOR,  // Border radius support
          ry: (element.geometry?.cornerRadius || 0) * SCALE_FACTOR,
        };
        // Scale dimensions to match preview DPI
        const width = (element.bounds.width || 100) * SCALE_FACTOR;
        const height = (element.bounds.height || 100) * SCALE_FACTOR;

        switch (element.shapeType) {
          case "rectangle":
            return new Rect({
              ...shapeOptions,
              width,
              height,
            });
          case "circle":
            return new Circle({
              ...shapeOptions,
              radius: width / 2,
            });
          case "ellipse":
            return new Ellipse({
              ...shapeOptions,
              rx: width / 2,
              ry: height / 2,
            });
          case "line":
          case "arrow":
            return new Line([0, 0, width, 0], shapeOptions);
          case "triangle":
            return new Triangle({
              ...shapeOptions,
              width,
              height,
            });
          default:
            return new Rect({
              ...shapeOptions,
              width: 100 * SCALE_FACTOR,
              height: 100 * SCALE_FACTOR,
            });
        }
      }

      case "annotation": {
        // AnnotationElement structure
        const annoOptions = {
          ...baseOptions,
          opacity: element.style?.opacity ?? 1,
        };
        // Scale dimensions to match preview DPI
        const annoWidth = (element.bounds.width || 100) * SCALE_FACTOR;
        const annoHeight = (element.bounds.height || 20) * SCALE_FACTOR;
        const annoColor = element.style?.color || "#ff0000";

        switch (element.annotationType) {
          case "highlight":
            return new Rect({
              ...annoOptions,
              width: annoWidth,
              height: annoHeight,
              fill: "rgba(255, 255, 0, 0.3)",
              stroke: undefined,
            });
          case "underline":
            return new Line([0, 0, annoWidth, 0], {
              ...annoOptions,
              stroke: annoColor,
              strokeWidth: 2 * SCALE_FACTOR,
            });
          case "strikethrough":
          case "strikeout":
            return new Line([0, 0, annoWidth, 0], {
              ...annoOptions,
              stroke: annoColor,
              strokeWidth: 1 * SCALE_FACTOR,
            });
          case "note":
            return new Rect({
              ...annoOptions,
              width: 30 * SCALE_FACTOR,
              height: 30 * SCALE_FACTOR,
              fill: "#ffeb3b",
              stroke: "#ffc107",
              strokeWidth: 1 * SCALE_FACTOR,
            });
          case "comment":
            return new Circle({
              ...annoOptions,
              radius: 15 * SCALE_FACTOR,
              fill: "#2196f3",
              stroke: "#1976d2",
              strokeWidth: 1 * SCALE_FACTOR,
            });
          default:
            return new Rect({
              ...annoOptions,
              width: annoWidth,
              height: annoHeight,
              fill: "rgba(255, 255, 0, 0.3)",
            });
        }
      }

      default:
        return null;
    }
  };

  // Charger une page dans le canvas
  const loadPage = useCallback(
    async (pageData: PageObject, fabricModule: typeof import("fabric"), docId: string | null) => {
      if (!fabricRef.current) return;
      const canvas = fabricRef.current;

      console.log("[EditorCanvas] Loading page:", pageData.pageId);
      console.log("[EditorCanvas] Page dimensions:", pageData.dimensions);
      console.log("[EditorCanvas] Elements count:", pageData.elements?.length ?? 0);

      // Nettoyer le canvas
      canvas.clear();
      canvas.backgroundColor = "#ffffff";

      // Load page background first if documentId is available
      if (docId && pageData.pageNumber) {
        await loadPageBackground(pageData.pageNumber, docId, canvas);
      }

      // Log element types
      if (pageData.elements?.length) {
        const typeCounts: Record<string, number> = {};
        pageData.elements.forEach((el) => {
          typeCounts[el.type] = (typeCounts[el.type] || 0) + 1;
        });
        console.log("[EditorCanvas] Element types:", typeCounts);
      }

      // Charger chaque élément de la page
      (pageData.elements || []).forEach((element) => {
        console.log("[EditorCanvas] Processing element:", element.type, element.elementId);
        const obj = elementToFabricObject(element, fabricModule);
        if (obj) {
          (obj as FabricObjectWithData).data = { elementId: element.elementId };
          canvas.add(obj);
          console.log("[EditorCanvas] Added element to canvas:", element.type);
        }
      });

      console.log("[EditorCanvas] Canvas objects count:", canvas.getObjects().length);
      canvas.renderAll();
    },
    [loadPageBackground]
  );

  // Mettre à jour la page quand elle change
  useEffect(() => {
    if (!fabricRef.current || !page) return;
    if (previousPageRef.current === page.pageId) return;
    previousPageRef.current = page.pageId;

    import("fabric").then((fabricModule) => {
      loadPage(page, fabricModule, documentId);
    });
  }, [page, loadPage, documentId]);

  // Mettre à jour le zoom
  useEffect(() => {
    if (!fabricRef.current || !page) return;
    const canvas = fabricRef.current;
    canvas.setZoom(zoom);
    canvas.setDimensions({
      width: (page.dimensions?.width || width) * SCALE_FACTOR * zoom,
      height: (page.dimensions?.height || height) * SCALE_FACTOR * zoom,
    });
    canvas.renderAll();
  }, [zoom, page, width, height]);

  // Mettre à jour les options de l'outil
  useEffect(() => {
    if (!fabricRef.current) return;
    fabricRef.current.selection = tool === "select";
    fabricRef.current.defaultCursor =
      tool === "hand" ? "grab" : tool === "select" ? "default" : "crosshair";
    fabricRef.current.renderAll();
  }, [tool]);

  // Exposer les méthodes via callback
  useEffect(() => {
    if (!onCanvasReady) return;

    const handle: EditorCanvasHandle = {
      addImage: (dataUrl: string) => {
        if (!fabricRef.current) return;
        import("fabric").then(({ FabricImage }) => {
          FabricImage.fromURL(dataUrl).then((img) => {
            img.set({
              left: 50,
              top: 50,
              scaleX: Math.min(1, 400 / ((img as unknown as { width: number }).width || 400)),
              scaleY: Math.min(1, 400 / ((img as unknown as { height: number }).height || 400)),
            });
            (img as FabricObjectWithData).data = { elementId: generateId() };
            fabricRef.current?.add(img);
            fabricRef.current?.setActiveObject(img);
            fabricRef.current?.renderAll();
            if (fabricRef.current) {
              saveHistory(fabricRef.current);
            }
          });
        });
      },
      undo: () => {
        if (historyIndex <= 0 || !fabricRef.current) return;
        const newIndex = historyIndex - 1;
        const json = historyStack[newIndex];
        if (!json) return;
        isUpdatingHistoryRef.current = true;
        fabricRef.current.loadFromJSON(JSON.parse(json)).then(() => {
          fabricRef.current?.renderAll();
          setHistoryIndex(newIndex);
          isUpdatingHistoryRef.current = false;
        });
      },
      redo: () => {
        if (historyIndex >= historyStack.length - 1 || !fabricRef.current)
          return;
        const newIndex = historyIndex + 1;
        const json = historyStack[newIndex];
        if (!json) return;
        isUpdatingHistoryRef.current = true;
        fabricRef.current.loadFromJSON(JSON.parse(json)).then(() => {
          fabricRef.current?.renderAll();
          setHistoryIndex(newIndex);
          isUpdatingHistoryRef.current = false;
        });
      },
      canUndo: () => historyIndex > 0,
      canRedo: () => historyIndex < historyStack.length - 1,
      deleteSelected: () => {
        if (!fabricRef.current) return;
        const activeObjects = fabricRef.current.getActiveObjects();
        activeObjects.forEach((obj) => {
          fabricRef.current?.remove(obj);
        });
        fabricRef.current.discardActiveObject();
        fabricRef.current.renderAll();
        saveHistory(fabricRef.current);
      },
      duplicateSelected: () => {
        if (!fabricRef.current) return;
        const activeObjects = fabricRef.current.getActiveObjects();
        fabricRef.current.discardActiveObject();
        activeObjects.forEach((obj) => {
          obj.clone().then((cloned: FabricObject) => {
            cloned.set({
              left: (cloned.left || 0) + 20,
              top: (cloned.top || 0) + 20,
            });
            (cloned as FabricObjectWithData).data = { elementId: generateId() };
            fabricRef.current?.add(cloned);
          });
        });
        fabricRef.current.renderAll();
        if (fabricRef.current) {
          saveHistory(fabricRef.current);
        }
      },
      getSelectedIds: () => {
        if (!fabricRef.current) return [];
        return fabricRef.current
          .getActiveObjects()
          .map((obj) => (obj as FabricObjectWithData).data?.elementId)
          .filter(Boolean) as string[];
      },
    };

    onCanvasReady(handle);
  }, [historyIndex, historyStack, saveHistory, onCanvasReady]);

  // Calculer les dimensions du canvas basées sur la page (scaled for preview DPI)
  const canvasWidth = (page?.dimensions?.width || width) * SCALE_FACTOR;
  const canvasHeight = (page?.dimensions?.height || height) * SCALE_FACTOR;

  return (
    <div className="editor-canvas-wrapper h-full w-full flex items-center justify-center bg-gray-100 dark:bg-gray-900 overflow-auto p-8">
      <div
        ref={containerRef}
        className="canvas-container bg-white shadow-lg rounded-sm"
        style={{
          width: canvasWidth * zoom,
          height: canvasHeight * zoom,
          minWidth: canvasWidth * zoom,
          minHeight: canvasHeight * zoom,
        }}
      >
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
