/**
 * render-elements.ts
 *
 * Utilitaire dédié au rendu des éléments parsés (text, image, form_field,
 * annotation, shape) sur un canvas Fabric.js.
 *
 * Usage (dans editor-canvas.tsx) :
 *   import { renderElementsOverlay, clearElementsOverlay } from './render-elements';
 *   const objects = await renderElementsOverlay(canvas, elements, fabric, { scale, onElementSelected });
 */

import type { Canvas as FabricCanvas, FabricObject } from "fabric";
import type * as FabricNamespace from "fabric";
import type {
  Element,
  TextElement,
  ImageElement,
  ShapeElement,
  AnnotationElement,
  FormFieldElement,
} from "@giga-pdf/types";
import { logger } from "@giga-pdf/logger";

type FabricModule = typeof FabricNamespace;

// ---------------------------------------------------------------------------
// Types publics
// ---------------------------------------------------------------------------

export interface RenderElementsOptions {
  /** Callback déclenché quand un élément est sélectionné (via fabric 'selection:created'/'selection:updated') */
  onElementSelected?: (elementId: string) => void;
  /** Si true, les objets ne sont pas sélectionnables ni interactifs (mode lecture seule) */
  readonly?: boolean;
  /** Facteur d'échelle appliqué aux coordonnées (si le canvas a un zoom différent du PDF natif) */
  scale?: number;
}

/** Metadata stockée dans obj.data pour tout objet rendu par cet utilitaire */
export interface ElementObjectData {
  elementId: string;
  elementType: string;
  isPdfBackground?: boolean;
  // Champs supplémentaires selon le type d'élément
  originalFont?: string | null;
  fieldName?: string;
  fieldType?: string;
}

// ---------------------------------------------------------------------------
// Helpers internes
// ---------------------------------------------------------------------------

/**
 * Propriétés Fabric communes à tous les éléments rendus.
 * Garantit que chaque objet porte ses métadonnées dans `data`.
 */
function buildCommonProps(
  element: Element,
  scale: number,
  readonly: boolean,
): Record<string, unknown> {
  const { bounds } = element;
  return {
    left: bounds.x * scale,
    top: bounds.y * scale,
    selectable: !readonly,
    evented: !readonly,
    hasControls: !readonly,
    hasBorders: !readonly,
    lockMovementX: readonly,
    lockMovementY: readonly,
    data: {
      elementId: element.elementId,
      elementType: element.type,
    } satisfies ElementObjectData,
  };
}

// ---------------------------------------------------------------------------
// Renderers par type d'élément
// ---------------------------------------------------------------------------

function renderText(
  element: TextElement,
  fabric: FabricModule,
  common: Record<string, unknown>,
  scale: number,
): FabricObject {
  const { style, content } = element;
  // Use fabric.Text (single-line, non-wrapping) instead of fabric.Textbox
  // because pdfjs extracts each text run as a standalone single-line item.
  // fabric.Text positions text with baseline at (left, top + fontSize * ~0.88),
  // which matches how PDF stores baselines.
  const obj = new fabric.Text(content, {
    ...common,
    fontSize: style.fontSize * scale,
    fontFamily: style.fontFamily,
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    fill: style.color,
    textAlign: style.textAlign,
    lineHeight: 1,
    charSpacing: style.letterSpacing * 1000, // Fabric uses thousandths of em
    underline: style.underline,
    linethrough: style.strikethrough,
    opacity: style.opacity,
    backgroundColor: style.backgroundColor ?? "",
  }) as unknown as FabricObject;

  // Enrichir data avec les infos de police originale pour la sauvegarde
  (obj as unknown as { data: ElementObjectData }).data.originalFont =
    style.originalFont;

  return obj;
}

async function renderImage(
  element: ImageElement,
  fabric: FabricModule,
  common: Record<string, unknown>,
  scale: number,
): Promise<FabricObject | null> {
  const { bounds, source, style } = element;
  const { dataUrl } = source;

  if (!dataUrl) {
    // Pas de données disponibles : skip silencieux
    return null;
  }

  const img = await fabric.FabricImage.fromURL(dataUrl, {
    crossOrigin: "anonymous",
  });

  img.set({
    ...common,
    scaleX: (bounds.width * scale) / (img.width || 1),
    scaleY: (bounds.height * scale) / (img.height || 1),
    opacity: style.opacity,
  });

  return img;
}

function renderAnnotation(
  element: AnnotationElement,
  fabric: FabricModule,
  common: Record<string, unknown>,
  scale: number,
): FabricObject {
  const { bounds, annotationType, style } = element;
  const isHighlight = annotationType === "highlight";
  const isUnderline = annotationType === "underline" || annotationType === "squiggly";
  const isStrike =
    annotationType === "strikeout" || annotationType === "strikethrough";

  // Couleur de fond selon le type d'annotation
  let fillColor = "rgba(0,0,0,0)";
  if (isHighlight) {
    // Convertir la couleur hexadécimale en rgba avec opacité réduite
    fillColor = hexToRgba(style.color, style.opacity * 0.4);
  }

  const strokeColor =
    isUnderline || isStrike ? style.color : "rgba(0,0,0,0)";

  return new fabric.Rect({
    ...common,
    width: bounds.width * scale,
    height: bounds.height * scale,
    fill: fillColor,
    stroke: strokeColor,
    strokeWidth: isHighlight ? 0 : 1,
    opacity: style.opacity,
  });
}

function renderFormField(
  element: FormFieldElement,
  fabric: FabricModule,
  common: Record<string, unknown>,
  scale: number,
): FabricObject {
  const { bounds, fieldName, fieldType, style } = element;

  const obj = new fabric.Rect({
    ...common,
    width: bounds.width * scale,
    height: bounds.height * scale,
    fill: style.backgroundColor ?? "rgba(0, 100, 255, 0.06)",
    stroke: style.borderColor ?? "#0066cc",
    strokeDashArray: [4, 4],
    strokeWidth: style.borderWidth || 1,
  });

  // Enrichir data avec les infos du champ formulaire
  const data = (obj as unknown as { data: ElementObjectData }).data;
  data.fieldName = fieldName;
  data.fieldType = fieldType;

  return obj;
}

function renderShape(
  element: ShapeElement,
  fabric: FabricModule,
  common: Record<string, unknown>,
  scale: number,
): FabricObject {
  const { bounds, style, geometry } = element;

  const baseProps = {
    ...common,
    fill: style.fillColor ?? "transparent",
    stroke: style.strokeColor ?? "#000000",
    strokeWidth: style.strokeWidth,
    strokeDashArray:
      style.strokeDashArray.length > 0 ? style.strokeDashArray : undefined,
    opacity: style.fillOpacity,
  };

  // Si le shape a un pathData SVG, utiliser fabric.Path pour plus de fidélité
  if (geometry.pathData) {
    return new fabric.Path(geometry.pathData, {
      ...baseProps,
      left: (baseProps as Record<string, unknown>).left as number,
      top: (baseProps as Record<string, unknown>).top as number,
    });
  }

  return new fabric.Rect({
    ...baseProps,
    width: bounds.width * scale,
    height: bounds.height * scale,
    rx: geometry.cornerRadius * scale,
    ry: geometry.cornerRadius * scale,
  });
}

// ---------------------------------------------------------------------------
// API publique
// ---------------------------------------------------------------------------

/**
 * Rend tous les éléments parsés en objets Fabric.js sur le canvas donné.
 *
 * - Async pour gérer FabricImage.fromURL
 * - Chaque élément est rendu dans un try/catch : un échec n'interrompt pas les autres
 * - Les objets créés portent `data.elementId` pour être retrouvés / supprimés
 *
 * @returns Liste des FabricObjects effectivement ajoutés au canvas
 */
export async function renderElementsOverlay(
  canvas: FabricCanvas,
  elements: Element[],
  fabric: FabricModule,
  options: RenderElementsOptions = {},
): Promise<FabricObject[]> {
  const { readonly = false, scale = 1, onElementSelected } = options;
  const created: FabricObject[] = [];

  for (const element of elements) {
    // Garantie défensive : bounds obligatoires
    if (!element.bounds) continue;

    const common = buildCommonProps(element, scale, readonly);
    let obj: FabricObject | null = null;

    try {
      switch (element.type) {
        case "text":
          obj = renderText(element as TextElement, fabric, common, scale);
          break;

        case "image":
          obj = await renderImage(element as ImageElement, fabric, common, scale);
          break;

        case "annotation":
          obj = renderAnnotation(
            element as AnnotationElement,
            fabric,
            common,
            scale,
          );
          break;

        case "form_field":
          obj = renderFormField(
            element as FormFieldElement,
            fabric,
            common,
            scale,
          );
          break;

        case "shape":
          obj = renderShape(element as ShapeElement, fabric, common, scale);
          break;

        default:
          // Type inconnu : skip sans erreur
          break;
      }
    } catch (err) {
      logger.warn("[renderElements] échec pour l'élément", {
        elementId: element.elementId,
        elementType: element.type,
        error: err instanceof Error ? err.message : String(err),
      });
      // Continuer avec l'élément suivant
      continue;
    }

    if (obj !== null) {
      canvas.add(obj);
      created.push(obj);
    }
  }

  canvas.requestRenderAll();

  // Attacher les handlers de sélection si callback fourni et mode non-readonly
  if (onElementSelected && !readonly) {
    attachSelectionHandlers(canvas, onElementSelected);
  }

  return created;
}

/**
 * Supprime du canvas tous les objets correspondant à des éléments parsés
 * (identifiés par `data.elementId`). Préserve les objets de fond PDF
 * (`data.isPdfBackground === true`).
 *
 * @returns Nombre d'objets supprimés
 */
export function clearElementsOverlay(canvas: FabricCanvas): number {
  const toRemove = canvas.getObjects().filter((obj) => {
    const data = (obj as unknown as { data?: ElementObjectData }).data;
    return data?.elementId !== undefined && !data?.isPdfBackground;
  });

  for (const obj of toRemove) {
    canvas.remove(obj);
  }

  canvas.requestRenderAll();
  return toRemove.length;
}

// ---------------------------------------------------------------------------
// Helpers privés
// ---------------------------------------------------------------------------

/**
 * Attache les listeners `selection:created` et `selection:updated` pour
 * propager l'ID de l'élément sélectionné au callback.
 * Idempotent : si les listeners sont déjà présents, éviter les doublons
 * via un flag sur le canvas.
 */
function attachSelectionHandlers(
  canvas: FabricCanvas,
  onElementSelected: (id: string) => void,
): void {
  const canvasWithMeta = canvas as unknown as {
    _renderElementsHandlerAttached?: boolean;
  };

  if (canvasWithMeta._renderElementsHandlerAttached) return;
  canvasWithMeta._renderElementsHandlerAttached = true;

  const handleSelection = (e: { selected?: FabricObject[] }) => {
    const active = e.selected?.[0];
    const data = (active as unknown as { data?: ElementObjectData })?.data;
    if (data?.elementId) {
      onElementSelected(data.elementId);
    }
  };

  canvas.on("selection:created", handleSelection);
  canvas.on("selection:updated", handleSelection);
}

/**
 * Convertit une couleur hexadécimale (#RRGGBB ou #RGB) en rgba(r,g,b,a).
 * Retourne la couleur originale en cas de format non reconnu.
 */
function hexToRgba(hex: string, alpha: number): string {
  const sanitized = hex.replace("#", "");
  const full =
    sanitized.length === 3
      ? sanitized
          .split("")
          .map((c) => c + c)
          .join("")
      : sanitized;

  const r = parseInt(full.substring(0, 2), 16);
  const g = parseInt(full.substring(2, 4), 16);
  const b = parseInt(full.substring(4, 6), 16);

  if (isNaN(r) || isNaN(g) || isNaN(b)) return hex;

  return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`;
}
