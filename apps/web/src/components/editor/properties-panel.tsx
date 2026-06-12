"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import {
  AlignStartVertical,
  AlignCenterVertical,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignCenterHorizontal,
  AlignEndHorizontal,
} from "lucide-react";
import type {
  Element,
  TextElement,
  ShapeElement,
  ImageElement,
  AnnotationElement,
  FormFieldElement,
} from "@giga-pdf/types";

export interface PropertiesPanelProps {
  /** Élément(s) sélectionné(s) */
  selectedElements: Element[];
  /** Callback pour modifier un élément */
  onElementUpdate?: (elementId: string, updates: Partial<Element>) => void;
  /** Informations sur la page */
  pageInfo?: {
    width: number;
    height: number;
    rotation: number;
  };
  /** Niveau de zoom */
  zoom: number;
}

// ============= Édition batch (multi-sélection) =============

type BatchAlignAction = "left" | "centerH" | "right" | "top" | "centerV" | "bottom";

const BATCH_ALIGN_ACTIONS: ReadonlyArray<{
  action: BatchAlignAction;
  labelKey: string;
  Icon: React.ComponentType<{ size?: number | string }>;
}> = [
  { action: "left", labelKey: "batch.alignLeft", Icon: AlignStartVertical },
  { action: "centerH", labelKey: "batch.alignCenterH", Icon: AlignCenterVertical },
  { action: "right", labelKey: "batch.alignRight", Icon: AlignEndVertical },
  { action: "top", labelKey: "batch.alignTop", Icon: AlignStartHorizontal },
  { action: "centerV", labelKey: "batch.alignCenterV", Icon: AlignCenterHorizontal },
  { action: "bottom", labelKey: "batch.alignBottom", Icon: AlignEndHorizontal },
];

/**
 * Opacité représentative d'un élément, ou null si son style ne la supporte pas.
 * Les shapes n'ont pas d'`opacity` plate : on lit `fillOpacity` comme valeur
 * représentative (l'écriture met fill + stroke au même niveau).
 */
function getBatchOpacity(element: Element): number | null {
  switch (element.type) {
    case "text":
    case "image":
    case "annotation":
      return element.style?.opacity ?? 1;
    case "shape":
      return element.style?.fillOpacity ?? 1;
    default:
      // form_field : FieldStyle n'expose aucune opacité
      return null;
  }
}

/**
 * Update partiel d'opacité pour un élément — même shape `{ style: {...} }`
 * que les éditeurs unitaires du panel (spread du style existant + champ écrasé).
 */
function buildBatchOpacityUpdate(element: Element, opacity: number): Partial<Element> | null {
  switch (element.type) {
    case "text":
      return { style: { ...element.style, opacity } } as Partial<TextElement>;
    case "image":
      return { style: { ...element.style, opacity } } as Partial<ImageElement>;
    case "annotation":
      return { style: { ...element.style, opacity } } as Partial<AnnotationElement>;
    case "shape":
      return {
        style: { ...element.style, fillOpacity: opacity, strokeOpacity: opacity },
      } as Partial<ShapeElement>;
    default:
      return null;
  }
}

/** Valeur commune d'une liste, ou null si hétérogène / vide / non définie. */
function commonValue<T>(values: readonly T[]): T | null {
  const first = values[0];
  if (first === undefined || first === null) return null;
  return values.every((v) => v === first) ? first : null;
}

interface BatchPropertiesProps {
  elements: Element[];
  onElementUpdate?: (elementId: string, updates: Partial<Element>) => void;
}

/**
 * Section d'édition groupée affichée quand plusieurs éléments sont sélectionnés.
 * Chaque action fan-out le même `onElementUpdate(elementId, Partial<Element>)`
 * que l'édition unitaire — aucun nouveau mécanisme de propagation.
 *
 * Remontée avec une `key` dérivée des elementIds : le state local (valeurs des
 * contrôles) se réinitialise à chaque changement de sélection.
 */
function BatchProperties({ elements, onElementUpdate }: BatchPropertiesProps) {
  const t = useTranslations("editor.properties");

  // ----- Opacité (éléments dont le style la supporte) -----
  const opacityValues = elements
    .map((el) => getBatchOpacity(el))
    .filter((v): v is number => v !== null);
  const hasOpacityCapable = opacityValues.length > 0;

  // ----- Champs couleur communs au sous-ensemble des types présents -----
  const allTextLike = elements.every(
    (el) => el.type === "text" || el.type === "annotation"
  );
  const allShapes = elements.every((el) => el.type === "shape");

  // State local : le scene graph n'est rafraîchi qu'en différé après un update
  // panel (même comportement qu'en sélection simple) — on trace donc la
  // dernière valeur appliquée pour que les contrôles restent réactifs.
  // null = valeurs hétérogènes ("—") tant que l'utilisateur n'a pas édité.
  const [opacity, setOpacity] = useState<number | null>(() =>
    commonValue(opacityValues)
  );
  const [color, setColor] = useState<string | null>(() =>
    allTextLike
      ? commonValue(
          elements.map((el) =>
            el.type === "text" || el.type === "annotation"
              ? (el.style?.color ?? null)
              : null
          )
        )
      : null
  );
  const [fillColor, setFillColor] = useState<string | null>(() =>
    allShapes
      ? commonValue(
          elements.map((el) => (el.type === "shape" ? (el.style?.fillColor ?? null) : null))
        )
      : null
  );
  const [strokeColor, setStrokeColor] = useState<string | null>(() =>
    allShapes
      ? commonValue(
          elements.map((el) => (el.type === "shape" ? (el.style?.strokeColor ?? null) : null))
        )
      : null
  );

  const applyOpacity = (value: number) => {
    setOpacity(value);
    for (const el of elements) {
      const updates = buildBatchOpacityUpdate(el, value);
      if (updates) onElementUpdate?.(el.elementId, updates);
    }
  };

  const applyColor = (value: string) => {
    setColor(value);
    for (const el of elements) {
      if (el.type === "text") {
        onElementUpdate?.(el.elementId, {
          style: { ...el.style, color: value },
        } as Partial<TextElement>);
      } else if (el.type === "annotation") {
        onElementUpdate?.(el.elementId, {
          style: { ...el.style, color: value },
        } as Partial<AnnotationElement>);
      }
    }
  };

  const applyShapeColor = (field: "fillColor" | "strokeColor", value: string) => {
    if (field === "fillColor") {
      setFillColor(value);
    } else {
      setStrokeColor(value);
    }
    for (const el of elements) {
      if (el.type === "shape") {
        onElementUpdate?.(el.elementId, {
          style: { ...el.style, [field]: value },
        } as Partial<ShapeElement>);
      }
    }
  };

  // Alignement relatif : calcul pur sur les bounds de la sélection
  // (min/max/centre du bounding box global), appliqué via le même
  // `onElementUpdate({ bounds })` que les inputs X/Y unitaires.
  const applyAlign = (action: BatchAlignAction) => {
    const minX = Math.min(...elements.map((el) => el.bounds.x));
    const maxRight = Math.max(...elements.map((el) => el.bounds.x + el.bounds.width));
    const minY = Math.min(...elements.map((el) => el.bounds.y));
    const maxBottom = Math.max(...elements.map((el) => el.bounds.y + el.bounds.height));

    for (const el of elements) {
      let x = el.bounds.x;
      let y = el.bounds.y;
      switch (action) {
        case "left":
          x = minX;
          break;
        case "centerH":
          x = (minX + maxRight) / 2 - el.bounds.width / 2;
          break;
        case "right":
          x = maxRight - el.bounds.width;
          break;
        case "top":
          y = minY;
          break;
        case "centerV":
          y = (minY + maxBottom) / 2 - el.bounds.height / 2;
          break;
        case "bottom":
          y = maxBottom - el.bounds.height;
          break;
      }
      if (x !== el.bounds.x || y !== el.bounds.y) {
        onElementUpdate?.(el.elementId, { bounds: { ...el.bounds, x, y } });
      }
    }
  };

  const mixedBadge = (
    <span className="ml-1 text-muted-foreground" title={t("batch.mixed")}>
      —
    </span>
  );

  return (
    <div className="space-y-4">
      {/* Opacité */}
      {hasOpacityCapable && (
        <div>
          <label className="text-xs text-muted-foreground block mb-1">
            {t("batch.opacity")}
            {opacity === null && mixedBadge}
          </label>
          <input
            type="range"
            value={(opacity ?? 1) * 100}
            onChange={(e) => applyOpacity(parseInt(e.target.value, 10) / 100)}
            min={0}
            max={100}
            aria-label={t("batch.opacity")}
            className="w-full"
          />
        </div>
      )}

      {/* Couleur commune (text / annotation) */}
      {allTextLike && (
        <div>
          <label className="text-xs text-muted-foreground block mb-1">
            {t("batch.color")}
            {color === null && mixedBadge}
          </label>
          <input
            type="color"
            value={color ?? "#000000"}
            onChange={(e) => applyColor(e.target.value)}
            aria-label={t("batch.color")}
            className="w-full h-8 rounded border bg-background"
          />
        </div>
      )}

      {/* Couleurs communes (shapes) */}
      {allShapes && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">
              {t("batch.fill")}
              {fillColor === null && mixedBadge}
            </label>
            <input
              type="color"
              value={fillColor ?? "#ffffff"}
              onChange={(e) => applyShapeColor("fillColor", e.target.value)}
              aria-label={t("batch.fill")}
              className="w-full h-8 rounded border bg-background"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">
              {t("batch.stroke")}
              {strokeColor === null && mixedBadge}
            </label>
            <input
              type="color"
              value={strokeColor ?? "#000000"}
              onChange={(e) => applyShapeColor("strokeColor", e.target.value)}
              aria-label={t("batch.stroke")}
              className="w-full h-8 rounded border bg-background"
            />
          </div>
        </div>
      )}

      {/* Alignement entre éléments */}
      <div>
        <h4 className="font-medium text-sm mb-2">{t("batch.align")}</h4>
        <div className="grid grid-cols-3 gap-1">
          {BATCH_ALIGN_ACTIONS.map(({ action, labelKey, Icon }) => (
            <button
              key={action}
              type="button"
              onClick={() => applyAlign(action)}
              title={t(labelKey)}
              aria-label={t(labelKey)}
              className="h-8 flex items-center justify-center rounded border bg-background hover:bg-accent transition-colors"
            >
              <Icon size={16} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Panel affichant les propriétés de l'élément sélectionné.
 */
export function PropertiesPanel({
  selectedElements,
  onElementUpdate,
  pageInfo,
  zoom,
}: PropertiesPanelProps) {
  const t = useTranslations("editor.properties");

  const selectedElement = selectedElements.length === 1 ? selectedElements[0] : null;
  const hasMultipleSelection = selectedElements.length > 1;

  // Render pour élément texte
  const renderTextProperties = (element: TextElement) => (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-muted-foreground block mb-1">
          {t("text.fontFamily")}
        </label>
        <select
          value={element.style?.fontFamily || "Arial"}
          onChange={(e) =>
            onElementUpdate?.(element.elementId, {
              style: { ...element.style, fontFamily: e.target.value },
            } as Partial<TextElement>)
          }
          className="w-full h-8 px-2 rounded border bg-background text-sm"
        >
          <option value="Arial">Arial</option>
          <option value="Helvetica">Helvetica</option>
          <option value="Times New Roman">Times New Roman</option>
          <option value="Courier New">Courier New</option>
          <option value="Georgia">Georgia</option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">
            {t("text.fontSize")}
          </label>
          <input
            type="number"
            value={element.style?.fontSize || 12}
            onChange={(e) =>
              onElementUpdate?.(element.elementId, {
                style: { ...element.style, fontSize: parseFloat(e.target.value) },
              } as Partial<TextElement>)
            }
            min={1}
            max={200}
            className="w-full h-8 px-2 rounded border bg-background text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">
            {t("text.color")}
          </label>
          <input
            type="color"
            value={element.style?.color || "#000000"}
            onChange={(e) =>
              onElementUpdate?.(element.elementId, {
                style: { ...element.style, color: e.target.value },
              } as Partial<TextElement>)
            }
            className="w-full h-8 rounded border bg-background"
          />
        </div>
      </div>

      <div>
        <label className="text-xs text-muted-foreground block mb-1">
          {t("text.opacity")}
        </label>
        <input
          type="range"
          value={(element.style?.opacity || 1) * 100}
          onChange={(e) =>
            onElementUpdate?.(element.elementId, {
              style: { ...element.style, opacity: parseInt(e.target.value) / 100 },
            } as Partial<TextElement>)
          }
          min={0}
          max={100}
          className="w-full"
        />
      </div>
    </div>
  );

  // Render pour élément forme
  const renderShapeProperties = (element: ShapeElement) => (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-muted-foreground block mb-1">
          {t("shape.type")}
        </label>
        <div className="text-sm">{element.shapeType}</div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">
            {t("shape.fill")}
          </label>
          <input
            type="color"
            value={element.style?.fillColor || "#ffffff"}
            onChange={(e) =>
              onElementUpdate?.(element.elementId, {
                style: { ...element.style, fillColor: e.target.value },
              } as Partial<ShapeElement>)
            }
            className="w-full h-8 rounded border bg-background"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">
            {t("shape.stroke")}
          </label>
          <input
            type="color"
            value={element.style?.strokeColor || "#000000"}
            onChange={(e) =>
              onElementUpdate?.(element.elementId, {
                style: { ...element.style, strokeColor: e.target.value },
              } as Partial<ShapeElement>)
            }
            className="w-full h-8 rounded border bg-background"
          />
        </div>
      </div>

      <div>
        <label className="text-xs text-muted-foreground block mb-1">
          {t("shape.strokeWidth")}
        </label>
        <input
          type="number"
          value={element.style?.strokeWidth || 1}
          onChange={(e) =>
            onElementUpdate?.(element.elementId, {
              style: { ...element.style, strokeWidth: parseFloat(e.target.value) },
            } as Partial<ShapeElement>)
          }
          min={0}
          max={50}
          step={0.5}
          className="w-full h-8 px-2 rounded border bg-background text-sm"
        />
      </div>
    </div>
  );

  // Render pour élément annotation (highlight, underline, note, comment, …)
  const renderAnnotationProperties = (element: AnnotationElement) => (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-muted-foreground block mb-1">Type</label>
        <div className="text-sm capitalize">{element.annotationType}</div>
      </div>
      <div>
        <label className="text-xs text-muted-foreground block mb-1">Contenu</label>
        <textarea
          value={element.content ?? ""}
          onChange={(e) =>
            onElementUpdate?.(element.elementId, {
              content: e.target.value,
            } as Partial<AnnotationElement>)
          }
          rows={3}
          className="w-full px-2 py-1 rounded border bg-background text-sm resize-y"
        />
      </div>
      <div>
        <label className="text-xs text-muted-foreground block mb-1">Couleur</label>
        <input
          type="color"
          value={element.style?.color ?? "#ffff00"}
          onChange={(e) =>
            onElementUpdate?.(element.elementId, {
              style: { ...element.style, color: e.target.value },
            } as Partial<AnnotationElement>)
          }
          className="w-full h-8 rounded border bg-background"
        />
      </div>
      <div>
        <label className="text-xs text-muted-foreground block mb-1">Opacité</label>
        <input
          type="range"
          value={(element.style?.opacity ?? 1) * 100}
          onChange={(e) =>
            onElementUpdate?.(element.elementId, {
              style: { ...element.style, opacity: parseInt(e.target.value) / 100 },
            } as Partial<AnnotationElement>)
          }
          min={0}
          max={100}
          className="w-full"
        />
      </div>
    </div>
  );

  // Render pour champ de formulaire (text, checkbox, radio, dropdown, signature)
  const renderFormFieldProperties = (element: FormFieldElement) => (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-muted-foreground block mb-1">Type de champ</label>
        <div className="text-sm capitalize">{element.fieldType}</div>
      </div>
      <div>
        <label className="text-xs text-muted-foreground block mb-1">Nom du champ</label>
        <input
          type="text"
          value={element.fieldName ?? ""}
          onChange={(e) =>
            onElementUpdate?.(element.elementId, {
              fieldName: e.target.value,
            } as Partial<FormFieldElement>)
          }
          className="w-full h-8 px-2 rounded border bg-background text-sm"
          placeholder="champ_1"
        />
      </div>
      <div>
        <label className="text-xs text-muted-foreground block mb-1">Placeholder</label>
        <input
          type="text"
          value={(element as { placeholder?: string }).placeholder ?? ""}
          onChange={(e) =>
            onElementUpdate?.(element.elementId, {
              placeholder: e.target.value,
            } as unknown as Partial<FormFieldElement>)
          }
          className="w-full h-8 px-2 rounded border bg-background text-sm"
        />
      </div>
      <div className="flex items-center gap-2">
        <input
          id={`required-${element.elementId}`}
          type="checkbox"
          checked={Boolean((element as { required?: boolean }).required)}
          onChange={(e) =>
            onElementUpdate?.(element.elementId, {
              required: e.target.checked,
            } as unknown as Partial<FormFieldElement>)
          }
          className="w-4 h-4"
        />
        <label
          htmlFor={`required-${element.elementId}`}
          className="text-xs text-muted-foreground"
        >
          Champ obligatoire
        </label>
      </div>
    </div>
  );

  // Render pour élément image
  const renderImageProperties = (element: ImageElement) => (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-muted-foreground block mb-1">
          {t("image.dimensions")}
        </label>
        <div className="text-sm">
          {element.bounds.width.toFixed(0)} x {element.bounds.height.toFixed(0)} px
        </div>
      </div>

      <div>
        <label className="text-xs text-muted-foreground block mb-1">
          {t("image.opacity")}
        </label>
        <input
          type="range"
          value={(element.style?.opacity || 1) * 100}
          onChange={(e) =>
            onElementUpdate?.(element.elementId, {
              style: { ...element.style, opacity: parseInt(e.target.value) / 100 },
            } as Partial<ImageElement>)
          }
          min={0}
          max={100}
          className="w-full"
        />
      </div>
    </div>
  );

  // Render propriétés communes (position, taille)
  const renderCommonProperties = (element: Element) => (
    <div className="space-y-3 mb-4">
      <h4 className="font-medium text-sm">{t("position")}</h4>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">X</label>
          <input
            type="number"
            value={element.bounds.x.toFixed(0)}
            onChange={(e) =>
              onElementUpdate?.(element.elementId, {
                bounds: { ...element.bounds, x: parseFloat(e.target.value) },
              })
            }
            className="w-full h-8 px-2 rounded border bg-background text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Y</label>
          <input
            type="number"
            value={element.bounds.y.toFixed(0)}
            onChange={(e) =>
              onElementUpdate?.(element.elementId, {
                bounds: { ...element.bounds, y: parseFloat(e.target.value) },
              })
            }
            className="w-full h-8 px-2 rounded border bg-background text-sm"
          />
        </div>
      </div>

      <h4 className="font-medium text-sm">{t("size")}</h4>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">{t("width")}</label>
          <input
            type="number"
            value={element.bounds.width.toFixed(0)}
            onChange={(e) =>
              onElementUpdate?.(element.elementId, {
                bounds: { ...element.bounds, width: parseFloat(e.target.value) },
              })
            }
            className="w-full h-8 px-2 rounded border bg-background text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">{t("height")}</label>
          <input
            type="number"
            value={element.bounds.height.toFixed(0)}
            onChange={(e) =>
              onElementUpdate?.(element.elementId, {
                bounds: { ...element.bounds, height: parseFloat(e.target.value) },
              })
            }
            className="w-full h-8 px-2 rounded border bg-background text-sm"
          />
        </div>
      </div>
    </div>
  );

  return (
    <div className="properties-panel w-64 bg-muted/30 border-l flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b">
        <h3 className="font-medium text-sm">{t("title")}</h3>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {!selectedElement && !hasMultipleSelection ? (
          <div className="text-sm text-muted-foreground text-center py-8">
            {t("noSelection")}
          </div>
        ) : hasMultipleSelection ? (
          <div>
            {/* Compteur existant conservé en tête de section */}
            <div className="text-sm text-muted-foreground text-center py-2 mb-3 border-b">
              {t("multipleSelection", { count: selectedElements.length })}
            </div>
            <BatchProperties
              key={selectedElements.map((el) => el.elementId).join("|")}
              elements={selectedElements}
              onElementUpdate={onElementUpdate}
            />
          </div>
        ) : selectedElement ? (
          <div>
            {/* Type badge */}
            <div className="mb-4">
              <span className="inline-block px-2 py-1 bg-primary/10 text-primary text-xs rounded">
                {t(`types.${selectedElement.type}`)}
              </span>
            </div>

            {/* Propriétés communes */}
            {renderCommonProperties(selectedElement)}

            {/* Propriétés spécifiques par type */}
            <div className="border-t pt-3">
              {selectedElement.type === "text" && renderTextProperties(selectedElement as TextElement)}
              {selectedElement.type === "shape" && renderShapeProperties(selectedElement as ShapeElement)}
              {selectedElement.type === "image" && renderImageProperties(selectedElement as ImageElement)}
              {selectedElement.type === "annotation" && renderAnnotationProperties(selectedElement as AnnotationElement)}
              {selectedElement.type === "form_field" && renderFormFieldProperties(selectedElement as FormFieldElement)}
            </div>
          </div>
        ) : null}

        {/* Page info */}
        {pageInfo && (
          <div className="mt-4 pt-4 border-t">
            <h4 className="font-medium text-sm mb-2">{t("pageInfo")}</h4>
            <div className="space-y-1 text-xs text-muted-foreground">
              <div>
                {t("pageDimensions")}: {pageInfo.width} x {pageInfo.height}
              </div>
              <div>{t("zoom")}: {Math.round(zoom * 100)}%</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
