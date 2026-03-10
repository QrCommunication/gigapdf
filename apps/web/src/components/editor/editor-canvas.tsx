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
  /** ID du document (session backend) — utilisé pour rendre le fond PDF */
  documentId?: string | null;
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

  // Ref pour documentId (évite les closures stale dans loadPage)
  const documentIdRef = useRef(documentId);

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
    documentIdRef.current = documentId;
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
  // Ref pour historyIndex — évite les closures stale dans saveHistory
  const historyIndexRef = useRef(-1);
  useEffect(() => { historyIndexRef.current = historyIndex; }, [historyIndex]);
  const isUpdatingHistoryRef = useRef(false);

  // Ref pour tracker le contenu original des textes (pour detecter les vraies modifications)
  const originalContentRef = useRef<Map<string, string>>(new Map());

  // Sauvegarder l'état dans l'historique
  // Utilise historyIndexRef pour éviter une closure stale (sinon saveHistory est
  // recréé à chaque changement d'index, ce qui force la recréation de tous ses
  // dépendants et provoque des re-rendus en cascade).
  const saveHistory = useCallback(
    (canvas: FabricCanvas) => {
      const json = JSON.stringify(canvas.toObject(["data"]));
      setHistoryStack((prev) => {
        const newStack = prev.slice(0, historyIndexRef.current + 1);
        return [...newStack, json];
      });
      setHistoryIndex((prev) => prev + 1);
    },
    [] // stable — lit historyIndexRef.current au moment de l'appel
  );

  // Convertir un objet Fabric.js en Element
  const fabricObjectToElement = useCallback(
    (obj: FabricObjectWithData): Element | null => {
      const elementId = obj.data?.elementId || generateId();
      const scaleX = obj.scaleX ?? 1;
      const scaleY = obj.scaleY ?? 1;

      // Base element properties matching ElementBase interface
      const baseElement = {
        elementId,
        bounds: {
          x: obj.left || 0,
          y: obj.top || 0,
          width: (obj.width || 100) * scaleX,
          height: (obj.height || 100) * scaleY,
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
            fontSize: textObj.fontSize || 16,
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
      if (isUpdatingHistoryRef.current) return;
      if (!e.target) return;
      // Ignorer le fond PDF (image non-éditable ajoutée en arrière-plan)
      if ((e.target as FabricObjectWithData).data?.isPdfBackground) return;
      const element = fabricObjectToElement(e.target as FabricObjectWithData);
      if (element) {
        console.log("[EditorCanvas] Object added:", element.elementId, element.type);
        onElementAddedRef.current?.(element);
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
        width: (page?.dimensions?.width || width) * zoom,
        height: (page?.dimensions?.height || height) * zoom,
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
                  stroke: "transparent",
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

      // Charger la page initiale via loadPage (inclut fond PDF).
      // On doit le faire ici car le useEffect [page, loadPage] vérifie
      // fabricRef.current synchroniquement AVANT que l'import("fabric") se
      // résout → il est déjà sorti sans rien faire.
      if (page) {
        previousPageRef.current = page.pageId;
        loadPage(page, fabricModule).then(() => {
          saveHistory(canvas);
        }).catch(() => {
          saveHistory(canvas);
        });
      } else {
        // Sauvegarder l'état initial du canvas vide
        saveHistory(canvas);
      }
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
    const baseOptions = {
      left: element.bounds.x,
      top: element.bounds.y,
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
        const textObj = new IText(element.content || t("defaultText"), {
          ...baseOptions,
          fontSize: element.style.fontSize || 16,
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
              img.set({
                ...baseOptions,
                scaleX: element.bounds.width / originalWidth,
                scaleY: element.bounds.height / originalHeight,
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
          stroke: hasStroke ? element.style.strokeColor : "transparent",
          strokeWidth: hasStroke ? element.style.strokeWidth : 0,
          opacity: element.style.fillOpacity ?? 1,
          rx: element.geometry?.cornerRadius || 0,  // Border radius support
          ry: element.geometry?.cornerRadius || 0,
        };
        const width = element.bounds.width || 100;
        const height = element.bounds.height || 100;

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
              width: 100,
              height: 100,
            });
        }
      }

      case "annotation": {
        // AnnotationElement structure
        const annoOptions = {
          ...baseOptions,
          opacity: element.style?.opacity ?? 1,
        };
        const annoWidth = element.bounds.width || 100;
        const annoHeight = element.bounds.height || 20;
        const annoColor = element.style?.color || "#ff0000";

        switch (element.annotationType) {
          case "highlight":
            return new Rect({
              ...annoOptions,
              width: annoWidth,
              height: annoHeight,
              fill: "rgba(255, 255, 0, 0.3)",
              stroke: "transparent",
            });
          case "underline":
            return new Line([0, 0, annoWidth, 0], {
              ...annoOptions,
              stroke: annoColor,
              strokeWidth: 2,
            });
          case "strikethrough":
          case "strikeout":
            return new Line([0, 0, annoWidth, 0], {
              ...annoOptions,
              stroke: annoColor,
              strokeWidth: 1,
            });
          case "note":
            return new Rect({
              ...annoOptions,
              width: 30,
              height: 30,
              fill: "#ffeb3b",
              stroke: "#ffc107",
              strokeWidth: 1,
            });
          case "comment":
            return new Circle({
              ...annoOptions,
              radius: 15,
              fill: "#2196f3",
              stroke: "#1976d2",
              strokeWidth: 1,
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
    async (pageData: PageObject, fabricModule: typeof import("fabric")) => {
      if (!fabricRef.current) return;
      const canvas = fabricRef.current;

      // Bloquer les événements object:added/removed pendant le chargement pour
      // éviter d'envoyer des appels API pour des éléments déjà existants
      isUpdatingHistoryRef.current = true;

      canvas.clear();
      canvas.backgroundColor = "#ffffff";

      // --- Rendu du fond PDF ---
      // On rend la page PDF comme une image Fabric.js non-sélectionnable à
      // l'index 0, de sorte qu'elle soit affectée par canvas.setZoom() comme
      // tous les autres objets (backgroundImage ne l'est pas).
      const docId = documentIdRef.current;
      if (docId) {
        try {
          const pdfUrl = `/backend-api/api/v1/documents/${docId}/download`;
          const response = await fetch(pdfUrl, { credentials: "include" });
          if (response.ok) {
            const arrayBuffer = await response.arrayBuffer();
            // Import dynamique pour éviter les problèmes SSR
            const { PDFRenderer } = await import("@giga-pdf/canvas");
            const renderer = new PDFRenderer();
            await renderer.loadDocument(arrayBuffer);
            // Rendre à une résolution plus élevée (HiDPI) pour un rendu net,
            // puis réduire l'image via scaleX/scaleY pour garder les dimensions PDF correctes.
            const renderScale = Math.min(window.devicePixelRatio || 2, 3);
            const dataUrl = await renderer.renderPageToDataURL(pageData.pageNumber, { scale: renderScale });
            renderer.dispose();

            const bgImg = await fabricModule.FabricImage.fromURL(dataUrl);
            bgImg.set({
              left: 0,
              top: 0,
              scaleX: 1 / renderScale,
              scaleY: 1 / renderScale,
              selectable: false,
              evented: false,
              hasControls: false,
              hasBorders: false,
            });
            (bgImg as FabricObjectWithData).data = { isPdfBackground: true };
            canvas.add(bgImg); // canvas est vide ici → bgImg est à l'index 0
          }
        } catch (e) {
          console.warn("[EditorCanvas] Could not render PDF background:", e);
        }
      }

      // --- Charger les éléments éditables par-dessus le fond PDF ---
      (pageData.elements || []).forEach((element) => {
        const obj = elementToFabricObject(element, fabricModule);
        if (obj) {
          (obj as FabricObjectWithData).data = { elementId: element.elementId };
          canvas.add(obj);
        }
      });

      canvas.renderAll();
      isUpdatingHistoryRef.current = false;
    },
    []
  );

  // Mettre à jour la page quand elle change
  useEffect(() => {
    if (!fabricRef.current || !page) return;
    if (previousPageRef.current === page.pageId) return;
    previousPageRef.current = page.pageId;

    import("fabric").then((fabricModule) => {
      loadPage(page, fabricModule);
    });
  }, [page, loadPage]);

  // Mettre à jour le zoom
  useEffect(() => {
    if (!fabricRef.current || !page) return;
    const canvas = fabricRef.current;
    canvas.setZoom(zoom);
    canvas.setDimensions({
      width: (page.dimensions?.width || width) * zoom,
      height: (page.dimensions?.height || height) * zoom,
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
  }, [historyIndex, historyStack, onCanvasReady]);

  // Calculer les dimensions du canvas basées sur la page
  const canvasWidth = page?.dimensions?.width || width;
  const canvasHeight = page?.dimensions?.height || height;

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
