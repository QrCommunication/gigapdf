"use client";

import React, { useRef, useEffect, useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import type {
  PageObject,
  Tool,
  Element,
  ShapeType,
  AnnotationType,
  AnnotationElement,
  FieldType,
  Bounds,
} from "@giga-pdf/types";
import type { Canvas as FabricCanvas, FabricObject } from "fabric";
import { clientLogger } from "@/lib/client-logger";

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
  /**
   * Resolver for embedded PDF font names: maps the original font ID (e.g. "g_d0_f1")
   * to a CSS font-family registered via FontFace API. When the embedded font is loaded,
   * text is rendered with the SAME font as the PDF background. Returns null for unknown.
   */
  getFontFaceName?: (originalName: string) => string | null;
  /** Type de forme sélectionné */
  shapeType?: ShapeType;
  /** Type d'annotation sélectionné */
  annotationType?: AnnotationType;
  /** Type de champ de formulaire sélectionné (text/checkbox/radio/dropdown) */
  fieldType?: FieldType;
  /** Couleur de contour */
  strokeColor?: string;
  /** Couleur de remplissage */
  fillColor?: string;
  /** Épaisseur du contour */
  strokeWidth?: number;
  /** Callback quand un élément est ajouté */
  onElementAdded?: (element: Element) => void;
  /** Callback quand un élément est modifié. oldBounds = bounds AVANT
   *  cette modification (utilisé par apply-elements pour clear la zone
   *  d'origine avant de redessiner — sinon le glyphe original reste). */
  onElementModified?: (element: Element, oldBounds?: Bounds) => void;
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

// Bake an alpha value into a hex/rgb colour string. Used for shape fill/
// stroke so a shape with mixed-alpha paint (fill 0.5 + stroke 1.0) keeps
// both layers correct. Pass-through transparent / empty strings unchanged.
function colorWithAlpha(color: string, alpha: number): string {
  if (!color || color === "transparent" || color === "none") return "transparent";
  const a = Math.max(0, Math.min(1, alpha ?? 1));
  if (a >= 0.999) return color;
  const hex = color.trim();
  if (hex.startsWith("#")) {
    let r = 0, g = 0, b = 0;
    if (hex.length === 4) {
      r = parseInt(hex[1]! + hex[1]!, 16);
      g = parseInt(hex[2]! + hex[2]!, 16);
      b = parseInt(hex[3]! + hex[3]!, 16);
    } else if (hex.length === 7) {
      r = parseInt(hex.slice(1, 3), 16);
      g = parseInt(hex.slice(3, 5), 16);
      b = parseInt(hex.slice(5, 7), 16);
    } else {
      return color;
    }
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }
  if (hex.startsWith("rgb(")) {
    return hex.replace(/^rgb\(/, "rgba(").replace(/\)$/, `, ${a})`);
  }
  return color;
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
  getFontFaceName,
  shapeType = "rectangle",
  annotationType = "highlight",
  fieldType = "text",
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
  const fieldTypeRef = useRef(fieldType);
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
    fieldTypeRef.current = fieldType;
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
  // Map des bounds connus PAR elementId AVANT chaque modification. Sans
  // cette source, queueUpdate envoie les NOUVELLES bounds comme oldBounds
  // → updateText() côté pdf-engine clear la mauvaise zone et l'ancien
  // glyphe parsé du PDF reste visible (texte dupliqué). On capture les
  // bounds initiaux à chaque load + à chaque création/modification, et
  // on les passe au callback onElementModified pour qu'apply-elements
  // ait la bonne zone à effacer.
  const lastKnownBoundsRef = useRef<Map<string, Bounds>>(new Map());

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

      // Check object type using Fabric's `type` property (stable string).
      // We CANNOT use obj.constructor.name here — production bundlers minify
      // class names (IText becomes "t" in Turbopack output), so any check
      // against "IText"/"Rect"/etc. silently fails and fabricObjectToElement
      // returns null. The Fabric `type` getter returns the same string in
      // dev and prod ("i-text", "rect", "image", …) and is the canonical
      // way to discriminate Fabric object types.
      const typeName = (obj as FabricObject & { type?: string }).type ?? "";

      if (typeName === "i-text" || typeName === "text" || typeName === "textbox") {
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

      if (typeName === "image") {
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

      // Annotations are stored as Fabric Rect/Line/Circle but carry a
      // data.annotationType marker. If we returned them as "shape" they'd
      // be drawn as regular graphics and the /Annot dict would never be
      // created — annotations must come out as AnnotationElement so the
      // backend renderer produces real PDF annotations (highlight,
      // underline, sticky note, freetext…).
      const dataAnnotationType = (obj.data?.annotationType ?? null) as
        | null
        | 'highlight'
        | 'underline'
        | 'strikeout'
        | 'strikethrough'
        | 'squiggly'
        | 'note'
        | 'comment'
        | 'freetext'
        | 'stamp'
        | 'link';
      if (dataAnnotationType) {
        return {
          ...baseElement,
          type: 'annotation' as const,
          annotationType: dataAnnotationType,
          content: (obj.data?.content as string) ?? '',
          style: {
            color: (obj.stroke as string) || (obj.fill as string) || '#ffff00',
            opacity: obj.opacity ?? 1,
          },
          linkDestination: (obj.data?.linkDestination as AnnotationElement['linkDestination']) ?? null,
          popup: null,
          author: (obj.data?.author as string) ?? undefined,
          // quads is omitted — renderer falls back to bounds when undefined
        } as AnnotationElement;
      }

      if (["rect", "circle", "triangle", "ellipse", "line"].includes(typeName)) {
        let shapeTypeResult: ShapeType = "rectangle";
        if (typeName === "circle") shapeTypeResult = "circle";
        if (typeName === "ellipse") shapeTypeResult = "ellipse";
        if (typeName === "line") shapeTypeResult = "line";
        if (typeName === "triangle") shapeTypeResult = "triangle";

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

      // Form fields — Group with data.formFieldType set by mouse:down.
      // text/checkbox/radio/dropdown/signature all round-trip through the
      // same mapping so the backend can emit the right PDF AcroForm widget.
      if (typeName === "group" && obj.data?.formFieldType) {
        const ft = obj.data.formFieldType as FieldType;
        const isBooleanField = ft === "checkbox" || ft === "radio";
        const isListField = ft === "dropdown" || ft === "listbox";
        return {
          ...baseElement,
          type: "form_field" as const,
          fieldType: ft,
          fieldName: (obj.data.fieldName as string) ?? `${ft}_${Date.now()}`,
          value: isBooleanField ? false : isListField ? [] : "",
          defaultValue: isBooleanField ? false : isListField ? [] : "",
          options: isListField ? ((obj.data.options as string[]) ?? []) : null,
          properties: {
            required: Boolean(obj.data.required),
            readOnly: false,
            maxLength: null,
            multiline: false,
            password: false,
            comb: false,
          },
          style: {
            fontFamily: "Arial",
            fontSize: 12,
            textColor: "#000000",
            backgroundColor: "#ffffff",
            borderColor: "#cccccc",
            borderWidth: 1,
          },
          format: { type: "none" as const, pattern: null },
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
    // Use Fabric `type` (stable across minification) — see fabricObjectToElement above.
    const typeName = (obj as FabricObject & { type?: string }).type ?? "";

    if (typeName === "i-text" || typeName === "textbox" || typeName === "text") {
      const elementId = obj.data?.elementId;
      const currentText = (obj as FabricObjectWithData & { text?: string }).text || "";

      if (elementId) {
        // Sauvegarder le contenu original avant edition
        originalContentRef.current.set(elementId, currentText);
        clientLogger.debug("[EditorCanvas] Text editing started, saved original content:", elementId, `"${currentText}"`);
      }
    }
  }, []);

  // Handler appele quand le texte change en temps reel
  const handleTextChanged = useCallback((e: { target?: FabricObject }) => {
    if (!e.target) return;
    const obj = e.target as FabricObjectWithData;
    const elementId = obj.data?.elementId;
    const currentText = (obj as FabricObjectWithData & { text?: string }).text || "";

    clientLogger.debug("[EditorCanvas] Text changed in real-time:", elementId, `"${currentText}"`);
  }, []);

  // Handler appele quand un texte sort du mode edition
  const handleTextEditingExited = useCallback((e: { target?: FabricObject }) => {
    if (!e.target) return;
    const obj = e.target as FabricObjectWithData;
    const elementId = obj.data?.elementId;
    const currentText = (obj as FabricObjectWithData & { text?: string }).text || "";
    const originalText = elementId ? originalContentRef.current.get(elementId) : undefined;

    if (originalText !== undefined && originalText !== currentText) {
      clientLogger.debug(`[EditorCanvas] Text editing exited with CONTENT CHANGE: "${originalText}" -> "${currentText}"`);
    } else {
      clientLogger.debug("[EditorCanvas] Text editing exited (no content change)");
    }

    // Note: On ne supprime pas du map ici car object:modified peut etre appele apres
    // Le map sera nettoye au prochain text:editing:entered pour le meme element
  }, []);

  const handleObjectModified = useCallback(
    (e: { target?: FabricObject }) => {
      if (!e.target) return;
      const obj = e.target as FabricObjectWithData;
      const elementId = obj.data?.elementId;
      // Use Fabric `type` (stable across minification) — see fabricObjectToElement above.
      const typeName = (obj as FabricObject & { type?: string }).type ?? "";

      // Detecter le TYPE de modification
      let modificationType: ModificationType = 'position';

      // Verifier si c'est un objet texte et si le contenu a change
      if (typeName === "i-text" || typeName === "textbox" || typeName === "text") {
        const originalText = elementId ? originalContentRef.current.get(elementId) : undefined;
        const currentText = (obj as FabricObjectWithData & { text?: string }).text || "";

        if (originalText !== undefined && originalText !== currentText) {
          modificationType = 'content';
          clientLogger.debug(`[EditorCanvas] Text content MODIFIED: "${originalText}" -> "${currentText}"`);
          // Mettre a jour le contenu original pour les prochaines comparaisons
          if (elementId) {
            originalContentRef.current.set(elementId, currentText);
          }
        } else {
          clientLogger.debug("[EditorCanvas] Element position/style changed only (no content change)");
        }
      } else {
        clientLogger.debug("[EditorCanvas] Non-text element modified (position/style)");
      }

      const element = fabricObjectToElement(obj);
      if (element) {
        clientLogger.debug("[EditorCanvas] Object modified:", element.elementId, element.type, "modification:", modificationType);
        // Récupère les bounds connues AVANT cette modification — c'est
        // ces bounds qui doivent être passées à updateText pour clear
        // la zone d'origine. Sans ça : doublon visuel post-bake.
        const oldBounds = lastKnownBoundsRef.current.get(element.elementId);
        // Mettre à jour pour la prochaine modification
        lastKnownBoundsRef.current.set(element.elementId, element.bounds);
        onElementModifiedRef.current?.(element, oldBounds);
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
        clientLogger.debug("[EditorCanvas] Object added:", element.elementId, element.type);
        // Mémoriser les bounds initiales (utilisé par handleObjectModified)
        lastKnownBoundsRef.current.set(element.elementId, element.bounds);
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
        clientLogger.debug("[EditorCanvas] Object removed:", elementId);
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

        clientLogger.debug("[EditorCanvas] mouse:down - tool:", currentTool);

        let newObj: FabricObject | null = null;

        try {
          switch (currentTool) {
            case "text": {
              clientLogger.debug("[EditorCanvas] Creating IText with:", { pointer, strokeColor: currentStrokeColor });
              newObj = new IText(t("defaultText") || "Text", {
                left: pointer.x,
                top: pointer.y,
                fontSize: 16,
                fontFamily: "Arial",
                fill: currentStrokeColor,
              });
              (newObj as FabricObjectWithData).data = { elementId: generateId() };
              clientLogger.debug("[EditorCanvas] IText created successfully:", newObj);
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
            // Crée le champ selon le fieldType sélectionné dans la toolbar.
            // text/checkbox/radio/dropdown ont des visuels distincts pour
            // que l'utilisateur identifie le type au coup d'œil.
            const currentFieldType = fieldTypeRef.current;
            let formFieldGroup: InstanceType<typeof Group>;

            switch (currentFieldType) {
              case "checkbox": {
                formFieldGroup = new Group(
                  [
                    new Rect({
                      left: 0,
                      top: 0,
                      width: 20,
                      height: 20,
                      fill: "#ffffff",
                      stroke: "#555555",
                      strokeWidth: 1.5,
                      rx: 2,
                      ry: 2,
                    }),
                  ],
                  { left: pointer.x, top: pointer.y },
                );
                break;
              }
              case "radio": {
                formFieldGroup = new Group(
                  [
                    new Circle({
                      left: 0,
                      top: 0,
                      radius: 10,
                      fill: "#ffffff",
                      stroke: "#555555",
                      strokeWidth: 1.5,
                    }),
                  ],
                  { left: pointer.x, top: pointer.y },
                );
                break;
              }
              case "dropdown":
              case "listbox": {
                formFieldGroup = new Group(
                  [
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
                    new FabricText("Sélectionner…", {
                      left: 10,
                      top: 8,
                      fontSize: 12,
                      fontFamily: "Arial",
                      fill: "#999999",
                    }),
                    new FabricText("▾", {
                      left: 175,
                      top: 6,
                      fontSize: 14,
                      fontFamily: "Arial",
                      fill: "#666666",
                    }),
                  ],
                  { left: pointer.x, top: pointer.y },
                );
                break;
              }
              case "text":
              default: {
                formFieldGroup = new Group(
                  [
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
                    new FabricText(t("textPlaceholder"), {
                      left: 10,
                      top: 8,
                      fontSize: 12,
                      fontFamily: "Arial",
                      fill: "#999999",
                    }),
                  ],
                  { left: pointer.x, top: pointer.y },
                );
                break;
              }
            }

            (formFieldGroup as FabricObjectWithData).data = {
              elementId: generateId(),
              formFieldType: currentFieldType,
              fieldName: `${currentFieldType}_${Date.now()}`,
              required: false,
              placeholder: currentFieldType === "text" ? t("textPlaceholder") : "",
            };
            newObj = formFieldGroup;
            break;
          }

          case "draw": {
            // Zone de signature — visuel distinct (bordure dashed, label
            // "Signature" au centre) pour que l'utilisateur comprenne tout
            // de suite que ce n'est pas un simple champ texte.
            const signatureGroup = new Group(
              [
                new Rect({
                  left: 0,
                  top: 0,
                  width: 240,
                  height: 60,
                  fill: "rgba(255, 248, 220, 0.6)",
                  stroke: "#8b5a2b",
                  strokeWidth: 1.5,
                  strokeDashArray: [6, 4],
                  rx: 4,
                  ry: 4,
                }),
                new FabricText("✍  Signature", {
                  left: 70,
                  top: 20,
                  fontSize: 16,
                  fontFamily: "Arial",
                  fontStyle: "italic",
                  fill: "#8b5a2b",
                }),
              ],
              {
                left: pointer.x,
                top: pointer.y,
              },
            );
            (signatureGroup as FabricObjectWithData).data = {
              elementId: generateId(),
              formFieldType: "signature",
              fieldName: `signature_${Date.now()}`,
              required: false,
              placeholder: "Signature",
            };
            newObj = signatureGroup;
            break;
          }
          }
        } catch (error) {
          clientLogger.error("[EditorCanvas] Error creating object:", error);
        }

        if (newObj) {
          clientLogger.debug("[EditorCanvas] Adding new object to canvas:", currentTool, (newObj as FabricObjectWithData).data?.elementId);
          currentCanvas.add(newObj);
          currentCanvas.setActiveObject(newObj);
          currentCanvas.renderAll();
          saveHistory(currentCanvas);
          clientLogger.debug("[EditorCanvas] Object added to canvas, total objects:", currentCanvas.getObjects().length);
        } else {
          clientLogger.debug("[EditorCanvas] mouse:down - newObj is null for tool:", currentTool);
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

  /**
   * Renders real PDF elements (text/image/shape/annotation/form_field) from the scene graph
   * onto the Fabric canvas, layered above the PDF background image.
   *
   * Performance note: images are loaded in parallel via Promise.all to stay within 500ms
   * for typical 100-element pages. The canvas is rendered once after all sync objects are
   * added; async image loads each trigger a targeted renderAll on completion.
   */
  const renderElementsOverlay = async (
    canvas: FabricCanvas,
    elements: Element[],
    fabricModule: typeof import("fabric")
  ): Promise<void> => {
    const { Rect, Circle, Ellipse, Triangle, Line, IText, FabricImage, Path: FabricPath, Polygon } = fabricModule;

    // Collect image-load promises to await them all before the final renderAll
    const imageLoadPromises: Promise<void>[] = [];

    // 1. SORT BY Z-ORDER LAYER: shapes (background fills, banner rectangles)
    //    must render BEHIND text and images. Without this, a red banner shape
    //    extracted later in the parser ends up on top of its own text label,
    //    making it unreadable. Layer order: shape < image < text < annotation < form_field.
    const layerRank: Record<string, number> = {
      shape: 0,
      image: 1,
      draw: 2,
      text: 3,
      annotation: 4,
      form_field: 5,
    };
    const sortedElements = [...elements].sort((a, b) => {
      const ra = layerRank[a.type] ?? 99;
      const rb = layerRank[b.type] ?? 99;
      return ra - rb;
    });

    // 2. DEDUPLICATE near-identical text runs. PDFs sometimes render the
    //    same string twice — generators do this for shadow/relief effects,
    //    or because they layer a vector outline (custom font) above an
    //    invisible selectable-text trace (system font fallback). Both
    //    cases produce two stacked IText objects in our scene graph; the
    //    user sees a doubled title and clicking one selects the wrong
    //    layer.
    //
    //    The signature deliberately ignores fontFamily because the duplicate
    //    typically uses a different family (embedded outline vs Helvetica
    //    fallback). Matching on content + rounded fontSize + tight position
    //    (≤2px) is enough — wider tolerance kills legitimate repeats like
    //    "RONY LICHA" appearing twice on a billing page (sender + recipient).
    //    A real shadow/outline duplicate sits within sub-pixel of its twin;
    //    if x or y differs by >2 px the layout intentionally placed two
    //    runs and we must keep both.
    // Two-tier dedupe heuristic:
    //   1. Same content + same colour + within 2px both axes  → shadow/outline
    //      (drop the second occurrence)
    //   2. Same content + same colour + same X (≤3px) + ANY Y → save-loop
    //      duplicate (form re-renders that bake the overlay back into the
    //      PDF and re-parse it). Drop the second occurrence too.
    //   Otherwise (same content, different X) it is a legitimate cross-line
    //   repeat such as "RONY LICHA" appearing on two address lines, both
    //   on the same y but offset horizontally — keep both.
    //
    //   Colour is part of the signature so a white "6,99€" on a red banner
    //   does not get killed by a black drop-shadow twin that appeared first
    //   in the parser stream.
    const seenTextSignatures = new Map<string, Array<{ x: number; y: number }>>();
    const dedupedElements = sortedElements.filter((el) => {
      if (el.type !== "text") return true;
      const textElement = el as Extract<Element, { type: "text" }>;
      const colourKey = (textElement.style.color || "#000000").toLowerCase();
      const sig = `${textElement.content}|${Math.round(textElement.style.fontSize)}|${colourKey}`;
      const positions = seenTextSignatures.get(sig);
      const here = { x: textElement.bounds.x, y: textElement.bounds.y };
      if (!positions) {
        seenTextSignatures.set(sig, [here]);
        return true;
      }
      const isDuplicate = positions.some((p) => {
        const dx = Math.abs(p.x - here.x);
        const dy = Math.abs(p.y - here.y);
        const shadowOverlap = dx <= 2 && dy <= 2;
        const verticalStack = dx <= 3; // same column, ANY Y → save-loop dupe
        return shadowOverlap || verticalStack;
      });
      if (isDuplicate) return false;
      positions.push(here);
      return true;
    });

    for (const element of dedupedElements) {
      // Guard: skip elements with missing or zero-size bounds
      if (!element.bounds || element.bounds.width <= 0 || element.bounds.height <= 0) {
        continue;
      }

      const baseOptions = {
        left: element.bounds.x,
        top: element.bounds.y,
        // Fabric 6.x defaults to originX/Y: 'center' which treats left/top as
        // the OBJECT CENTER. Parser produces top-left coords, so force origin
        // to 'left'/'top' to avoid visual offset of width/2, height/2.
        originX: "left" as const,
        originY: "top" as const,
        angle: element.transform?.rotation || 0,
        selectable: !element.locked,
        evented: !element.locked,
        visible: element.visible,
      };

      let fabricObj: FabricObject | null = null;

      switch (element.type) {
        case "text": {
          const textElement = element;
          const textObj = new IText(textElement.content || "", {
            ...baseOptions,
            width: textElement.bounds.width,
            fontSize: textElement.style.fontSize ?? 12,
            fontFamily: (() => {
              const orig = textElement.style.originalFont;
              // If we have a dynamically-loaded FontFace registered for this orig name,
              // use it (browser will render with the exact PDF embedded font).
              if (orig && getFontFaceName) {
                const registered = getFontFaceName(orig);
                if (registered) return registered;
              }
              // Otherwise fallback to the mapped standard font (Helvetica/Times/Courier).
              // Never use raw pdfjs internal names (like 'g_d0_f1') — browser has no glyphs for those.
              return textElement.style.fontFamily || "Helvetica";
            })(),
            fontWeight: textElement.style.fontWeight || "normal",
            fontStyle: textElement.style.fontStyle || "normal",
            fill: textElement.style.color || "#000000",
            opacity: textElement.style.opacity ?? 1,
            textAlign: textElement.style.textAlign || "left",
            lineHeight: textElement.style.lineHeight || 1.2,
            charSpacing: (textElement.style.letterSpacing || 0) * 10,
            underline: textElement.style.underline || false,
            linethrough: textElement.style.strikethrough || false,
            textBackgroundColor: textElement.style.backgroundColor || "",
          });
          (textObj as FabricObjectWithData).data = {
            elementId: textElement.elementId,
            type: "text",
            originalFont: textElement.style.originalFont,
            linkUrl: textElement.linkUrl,
            linkPage: textElement.linkPage,
          };
          // Style hyperlinks
          if ((textElement.linkUrl || textElement.linkPage) && !textElement.style.underline) {
            textObj.set({ underline: true });
          }
          fabricObj = textObj;
          break;
        }

        case "image": {
          const imgElement = element;
          if (imgElement.source?.dataUrl) {
            const imageUrl = resolveImageUrl(imgElement.source.dataUrl);
            const originalWidth = imgElement.source.originalDimensions?.width || imgElement.bounds.width;
            const originalHeight = imgElement.source.originalDimensions?.height || imgElement.bounds.height;
            const targetScaleX = imgElement.bounds.width / (originalWidth || 1);
            const targetScaleY = imgElement.bounds.height / (originalHeight || 1);

            const loadPromise = FabricImage.fromURL(imageUrl, { crossOrigin: "anonymous" })
              .then((img: FabricObject) => {
                img.set({
                  ...baseOptions,
                  scaleX: targetScaleX,
                  scaleY: targetScaleY,
                  opacity: imgElement.style?.opacity ?? 1,
                });
                (img as FabricObjectWithData).data = {
                  elementId: imgElement.elementId,
                  type: "image",
                };
                canvas.add(img);
              })
              .catch((err) => {
                clientLogger.error("[EditorCanvas] Failed to load image element:", imgElement.elementId, err);
              });
            imageLoadPromises.push(loadPromise);
          }
          break;
        }

        case "shape": {
          const shapeElement = element;
          const hasStroke = shapeElement.style.strokeColor && shapeElement.style.strokeWidth > 0;
          const hasFill = !!shapeElement.style.fillColor;
          // Bake fill/stroke alpha directly into the colour (rgba) instead of
          // a single composite opacity. Stroke-only paths (table borders,
          // hairline dividers) come with fillOpacity=0; using that as the
          // shape's `opacity` would invisibilise the stroke too. Encoding
          // alpha per channel lets fill+stroke shapes carry different alphas.
          const fillCss = hasFill
            ? colorWithAlpha(shapeElement.style.fillColor as string, shapeElement.style.fillOpacity ?? 1)
            : "transparent";
          const strokeCss = hasStroke
            ? colorWithAlpha(shapeElement.style.strokeColor as string, shapeElement.style.strokeOpacity ?? 1)
            : "transparent";
          const shapeOptions = {
            ...baseOptions,
            fill: fillCss,
            stroke: strokeCss,
            strokeWidth: hasStroke ? shapeElement.style.strokeWidth : 0,
            opacity: 1,
          };
          const w = shapeElement.bounds.width;
          const h = shapeElement.bounds.height;

          switch (shapeElement.shapeType) {
            case "rectangle":
              fabricObj = new Rect({
                ...shapeOptions,
                width: w,
                height: h,
                rx: shapeElement.geometry?.cornerRadius || 0,
                ry: shapeElement.geometry?.cornerRadius || 0,
              });
              break;
            case "circle":
              fabricObj = new Circle({ ...shapeOptions, radius: w / 2 });
              break;
            case "ellipse":
              fabricObj = new Ellipse({ ...shapeOptions, rx: w / 2, ry: h / 2 });
              break;
            case "line":
            case "arrow":
              fabricObj = new Line([0, 0, w, 0], shapeOptions);
              break;
            case "triangle":
              fabricObj = new Triangle({ ...shapeOptions, width: w, height: h });
              break;
            case "polygon": {
              // fabric.Polygon needs an explicit points array. We have it on
              // geometry.points (already in canvas coords).
              const pts = shapeElement.geometry?.points ?? [];
              if (pts.length >= 3) {
                fabricObj = new Polygon(pts, shapeOptions);
              } else {
                fabricObj = new Rect({ ...shapeOptions, width: w, height: h });
              }
              break;
            }
            case "path":
            default: {
              // Render via SVG pathData when available — required for any
              // shape with Bezier curves (logos, icons, complex outlines).
              // Falling back to Rect would render a meaningless filled box.
              const pathData = shapeElement.geometry?.pathData;
              if (pathData) {
                // Fabric.Path positions itself at the path's own bounding box
                // top-left, then offsets via left/top. Pass the bounds origin
                // explicitly so the path keeps its absolute canvas position.
                fabricObj = new FabricPath(pathData, {
                  ...shapeOptions,
                  // Override bounds.{x,y} from baseOptions to use the path's
                  // intrinsic bbox; otherwise the path is double-translated.
                  left: shapeElement.bounds.x,
                  top: shapeElement.bounds.y,
                  originX: "left",
                  originY: "top",
                  // fabric.Path computes its own width/height from the path —
                  // do not override.
                });
              } else {
                fabricObj = new Rect({ ...shapeOptions, width: w, height: h });
              }
            }
          }
          if (fabricObj) {
            (fabricObj as FabricObjectWithData).data = {
              elementId: shapeElement.elementId,
              type: "shape",
            };
          }
          break;
        }

        case "annotation": {
          const annoElement = element;
          const annoOptions = {
            ...baseOptions,
            opacity: annoElement.style?.opacity ?? 1,
          };
          const annoWidth = annoElement.bounds.width;
          const annoHeight = annoElement.bounds.height;
          const annoColor = annoElement.style?.color || "#ff0000";

          switch (annoElement.annotationType) {
            case "highlight":
              fabricObj = new Rect({
                ...annoOptions,
                width: annoWidth,
                height: annoHeight,
                fill: "rgba(255, 255, 0, 0.3)",
                stroke: "transparent",
              });
              break;
            case "underline":
              fabricObj = new Line([0, 0, annoWidth, 0], {
                ...annoOptions,
                stroke: annoColor,
                strokeWidth: 2,
              });
              break;
            case "strikethrough":
            case "strikeout":
              fabricObj = new Line([0, 0, annoWidth, 0], {
                ...annoOptions,
                stroke: annoColor,
                strokeWidth: 1,
              });
              break;
            case "squiggly":
              // Render as a colored underline for now
              fabricObj = new Line([0, 0, annoWidth, 0], {
                ...annoOptions,
                stroke: annoColor,
                strokeWidth: 2,
                strokeDashArray: [2, 2],
              });
              break;
            case "note":
            case "stamp":
              fabricObj = new Rect({
                ...annoOptions,
                width: Math.min(annoWidth, 30),
                height: Math.min(annoHeight, 30),
                fill: "#ffeb3b",
                stroke: "#ffc107",
                strokeWidth: 1,
              });
              break;
            case "comment":
            case "freetext":
              fabricObj = new Circle({
                ...annoOptions,
                radius: Math.min(annoWidth, annoHeight) / 2,
                fill: "#2196f3",
                stroke: "#1976d2",
                strokeWidth: 1,
              });
              break;
            case "link":
              fabricObj = new Rect({
                ...annoOptions,
                width: annoWidth,
                height: annoHeight,
                fill: "rgba(0, 100, 200, 0.1)",
                stroke: "#0066cc",
                strokeWidth: 1,
              });
              break;
            default:
              fabricObj = new Rect({
                ...annoOptions,
                width: annoWidth,
                height: annoHeight,
                fill: "rgba(255, 255, 0, 0.3)",
              });
          }
          if (fabricObj) {
            (fabricObj as FabricObjectWithData).data = {
              elementId: annoElement.elementId,
              type: "annotation",
              annotationType: annoElement.annotationType,
              linkDestination: annoElement.linkDestination,
            };
          }
          break;
        }

        case "form_field": {
          const formElement = element;
          const fieldColorMap: Record<string, string> = {
            text: "rgba(0, 100, 255, 0.08)",
            checkbox: "rgba(0, 180, 0, 0.1)",
            radio: "rgba(0, 180, 0, 0.1)",
            dropdown: "rgba(100, 0, 255, 0.08)",
            listbox: "rgba(100, 0, 255, 0.08)",
            signature: "rgba(255, 100, 0, 0.1)",
            button: "rgba(50, 50, 50, 0.1)",
          };
          const fieldBorderMap: Record<string, string> = {
            text: "#0066cc",
            checkbox: "#00aa00",
            radio: "#00aa00",
            dropdown: "#6600cc",
            listbox: "#6600cc",
            signature: "#ff6600",
            button: "#333333",
          };
          const fieldFill = fieldColorMap[formElement.fieldType] ?? "rgba(0, 100, 255, 0.08)";
          const fieldStroke = fieldBorderMap[formElement.fieldType] ?? "#0066cc";

          fabricObj = new Rect({
            ...baseOptions,
            width: formElement.bounds.width,
            height: formElement.bounds.height,
            fill: fieldFill,
            stroke: fieldStroke,
            strokeDashArray: [4, 4],
            strokeWidth: 1,
          });
          (fabricObj as FabricObjectWithData).data = {
            elementId: formElement.elementId,
            type: "form_field",
            fieldName: formElement.fieldName,
            fieldType: formElement.fieldType,
          };
          break;
        }
      }

      if (fabricObj) {
        canvas.add(fabricObj);
      }
    }

    // Wait for all async image loads before final render
    if (imageLoadPromises.length > 0) {
      await Promise.all(imageLoadPromises);
    }

    canvas.renderAll();
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
          const { getAuthToken } = await import("@/lib/api");
          const token = await getAuthToken();
          const response = await fetch(pdfUrl, {
            credentials: "include",
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          });
          if (response.ok) {
            const arrayBuffer = await response.arrayBuffer();
            // Import dynamique pour éviter les problèmes SSR
            const { PDFRenderer } = await import("@giga-pdf/canvas");
            const renderer = new PDFRenderer();
            await renderer.loadDocument(arrayBuffer);
            // Rendre à une résolution plus élevée (HiDPI) pour un rendu net,
            // puis réduire l'image via scaleX/scaleY pour garder les dimensions PDF correctes.
            const renderScale = Math.min(window.devicePixelRatio || 2, 3);
            const dataUrl = await renderer.renderPageToDataURL(pageData.pageNumber, {
              scale: renderScale,
              // Hide PDF text — Fabric overlay is the single source of editable text
              maskText: true,
            });
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
          clientLogger.warn("[EditorCanvas] Could not render PDF background:", e);
        }
      }

      // --- Charger les éléments éditables par-dessus le fond PDF ---
      // renderElementsOverlay handles all element types (text/image/shape/annotation/form_field),
      // attaches rich metadata to each Fabric object's .data property, and awaits async image loads
      // before the final canvas.renderAll() — so the canvas is fully populated in one shot.
      if (pageData.elements && pageData.elements.length > 0) {
        // Capturer les bounds initiaux POUR CHAQUE élément. Sans ça
        // la première modification d'un élément parsé efface la NOUVELLE
        // zone (oldBounds undefined → fallback element.bounds) et le
        // glyphe original reste visible.
        for (const el of pageData.elements) {
          if (el.elementId && el.bounds) {
            lastKnownBoundsRef.current.set(el.elementId, el.bounds);
          }
        }
        await renderElementsOverlay(canvas, pageData.elements, fabricModule);
      } else {
        canvas.renderAll();
      }

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
        // Capture elementIds BEFORE remove() — Fabric drops .data on
        // removed objects in some paths and the object:removed listener
        // can miss them, leaving the scene graph + Redis with stale
        // entries (and the doc never marked dirty).
        const removedIds = activeObjects
          .map((obj) => (obj as FabricObjectWithData).data?.elementId)
          .filter((id): id is string => Boolean(id));
        activeObjects.forEach((obj) => {
          fabricRef.current?.remove(obj);
        });
        fabricRef.current.discardActiveObject();
        fabricRef.current.renderAll();
        saveHistory(fabricRef.current);
        // Defense-in-depth: explicitly forward each elementId to the
        // React side. The Fabric object:removed event also fires, but
        // the parent handler is idempotent (it deselects + queues a
        // delete; running twice is a no-op for already-removed ids).
        for (const id of removedIds) {
          onElementRemovedRef.current?.(id);
        }
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
