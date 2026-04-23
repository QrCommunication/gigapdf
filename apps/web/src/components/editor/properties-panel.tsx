"use client";

import React from "react";
import { useTranslations } from "next-intl";
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
          <div className="text-sm text-muted-foreground text-center py-8">
            {t("multipleSelection", { count: selectedElements.length })}
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
