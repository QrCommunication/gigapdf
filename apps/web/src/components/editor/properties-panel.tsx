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
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import type {
  Element,
  TextElement,
  ShapeElement,
  ImageElement,
  AnnotationElement,
  FormFieldElement,
  LayerObject,
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
  /**
   * Noms des champs de formulaire du DOCUMENT (toutes pages), pour la
   * validation d'unicité du nom. Les widgets radio d'un même groupe
   * partagent légitimement leur nom — l'appelant exclut le groupe courant.
   */
  allFieldNames?: string[];
  /**
   * Calques utilisateur du document (Phase 2 "Layer Groups"), pour le menu
   * déroulant "Layer" de la section commune. Absent / vide ⇒ menu masqué.
   */
  userLayers?: LayerObject[];
  /** Affecter l'élément sélectionné à un calque (ou `null` pour le détacher). */
  onAssignElementToLayer?: (elementId: string, layerId: string | null) => void;
}

/** Charset AcroForm sûr pour un nom de champ (lettres, chiffres, _ . -). */
const FIELD_NAME_PATTERN = /^[A-Za-z0-9_.\-]+$/;

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

// ============= Propriétés d'un champ de formulaire =============

interface FormFieldPropertiesProps {
  element: FormFieldElement;
  onElementUpdate?: (elementId: string, updates: Partial<Element>) => void;
  /** Noms des autres champs du document (unicité). */
  otherFieldNames: string[];
}

/**
 * Éditeur complet d'un champ de formulaire : nom (validé unique + charset),
 * tooltip, placeholder, drapeaux (required/readOnly/multiline), valeur par
 * défaut, éditeur d'options (dropdown/radio/listbox), taille de police et
 * alignement. Toute édition passe par le même onElementUpdate que le reste
 * du panel ; les objets imbriqués (properties/style) sont renvoyés ENTIERS
 * car le merge amont est shallow.
 *
 * Monté avec key={elementId} : le brouillon de nom se réinitialise à chaque
 * changement de sélection.
 */
function FormFieldProperties({
  element,
  onElementUpdate,
  otherFieldNames,
}: FormFieldPropertiesProps) {
  const t = useTranslations("editor.properties.formField");

  // Brouillon local du nom : un nom invalide (charset/duplicat) reste
  // affiché avec l'erreur mais n'est PAS propagé au scene graph.
  const [nameDraft, setNameDraft] = useState(element.fieldName);
  const trimmedDraft = nameDraft.trim();
  const nameCharsetValid = FIELD_NAME_PATTERN.test(trimmedDraft);
  const nameIsDuplicate =
    nameCharsetValid &&
    trimmedDraft !== element.fieldName &&
    otherFieldNames.includes(trimmedDraft);
  const nameError = !nameCharsetValid
    ? t("nameInvalid")
    : nameIsDuplicate
      ? t("nameDuplicate")
      : null;

  const commitName = (value: string) => {
    setNameDraft(value);
    const trimmed = value.trim();
    if (!FIELD_NAME_PATTERN.test(trimmed)) return;
    if (trimmed !== element.fieldName && otherFieldNames.includes(trimmed)) {
      return;
    }
    if (trimmed !== element.fieldName) {
      onElementUpdate?.(element.elementId, {
        fieldName: trimmed,
      } as Partial<FormFieldElement>);
    }
  };

  const updateProperties = (
    patch: Partial<FormFieldElement["properties"]>,
  ) => {
    onElementUpdate?.(element.elementId, {
      properties: { ...element.properties, ...patch },
    } as Partial<FormFieldElement>);
  };

  const updateStyle = (patch: Partial<FormFieldElement["style"]>) => {
    onElementUpdate?.(element.elementId, {
      style: { ...element.style, ...patch },
    } as Partial<FormFieldElement>);
  };

  const updateOptions = (options: string[]) => {
    onElementUpdate?.(element.elementId, {
      options,
    } as Partial<FormFieldElement>);
  };

  const isTextLike = element.fieldType === "text";
  const hasOptions =
    element.fieldType === "dropdown" ||
    element.fieldType === "listbox" ||
    element.fieldType === "radio";
  const options = element.options ?? [];

  const inputClass =
    "w-full h-8 px-2 rounded border bg-background text-sm";

  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-muted-foreground block mb-1">
          {t("fieldType")}
        </label>
        <div className="text-sm capitalize">{element.fieldType}</div>
      </div>

      {/* Nom — unique par document, charset AcroForm */}
      <div>
        <label className="text-xs text-muted-foreground block mb-1">
          {t("name")}
        </label>
        <input
          type="text"
          value={nameDraft}
          onChange={(e) => commitName(e.target.value)}
          className={`${inputClass} ${nameError ? "border-destructive" : ""}`}
          placeholder="champ_1"
          aria-invalid={nameError !== null}
        />
        {nameError ? (
          <p className="mt-1 text-[10px] text-destructive">{nameError}</p>
        ) : null}
      </div>

      {/* Libellé / infobulle (→ /TU AcroForm) */}
      <div>
        <label className="text-xs text-muted-foreground block mb-1">
          {t("tooltip")}
        </label>
        <input
          type="text"
          value={element.tooltip ?? ""}
          onChange={(e) =>
            onElementUpdate?.(element.elementId, {
              tooltip: e.target.value || null,
            } as Partial<FormFieldElement>)
          }
          className={inputClass}
        />
      </div>

      {/* Placeholder (aide visuelle éditeur) */}
      {isTextLike ? (
        <div>
          <label className="text-xs text-muted-foreground block mb-1">
            {t("placeholder")}
          </label>
          <input
            type="text"
            value={element.placeholder ?? ""}
            onChange={(e) =>
              onElementUpdate?.(element.elementId, {
                placeholder: e.target.value || null,
              } as Partial<FormFieldElement>)
            }
            className={inputClass}
          />
        </div>
      ) : null}

      {/* Drapeaux */}
      <div className="space-y-1.5">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={element.properties.required}
            onChange={(e) => updateProperties({ required: e.target.checked })}
            className="w-4 h-4"
          />
          <span className="text-xs text-muted-foreground">{t("required")}</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={element.properties.readOnly}
            onChange={(e) => updateProperties({ readOnly: e.target.checked })}
            className="w-4 h-4"
          />
          <span className="text-xs text-muted-foreground">{t("readOnly")}</span>
        </label>
        {isTextLike ? (
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={element.properties.multiline}
              onChange={(e) => updateProperties({ multiline: e.target.checked })}
              className="w-4 h-4"
            />
            <span className="text-xs text-muted-foreground">
              {t("multiline")}
            </span>
          </label>
        ) : null}
      </div>

      {/* Valeur par défaut */}
      {element.fieldType === "checkbox" ? (
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={element.defaultValue === true}
            onChange={(e) =>
              onElementUpdate?.(element.elementId, {
                defaultValue: e.target.checked,
                value: e.target.checked,
              } as Partial<FormFieldElement>)
            }
            className="w-4 h-4"
          />
          <span className="text-xs text-muted-foreground">
            {t("checkedByDefault")}
          </span>
        </label>
      ) : element.fieldType === "dropdown" ||
        element.fieldType === "listbox" ||
        element.fieldType === "radio" ? (
        <div>
          <label className="text-xs text-muted-foreground block mb-1">
            {t("defaultValue")}
          </label>
          <select
            value={
              typeof element.defaultValue === "string"
                ? element.defaultValue
                : ""
            }
            onChange={(e) =>
              onElementUpdate?.(element.elementId, {
                defaultValue: e.target.value,
              } as Partial<FormFieldElement>)
            }
            className={inputClass}
          >
            <option value="">{t("noDefault")}</option>
            {options.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div>
          <label className="text-xs text-muted-foreground block mb-1">
            {t("defaultValue")}
          </label>
          <input
            type="text"
            value={
              typeof element.defaultValue === "string"
                ? element.defaultValue
                : ""
            }
            onChange={(e) =>
              onElementUpdate?.(element.elementId, {
                defaultValue: e.target.value,
              } as Partial<FormFieldElement>)
            }
            className={inputClass}
          />
        </div>
      )}

      {/* Longueur max (texte) */}
      {isTextLike ? (
        <div>
          <label className="text-xs text-muted-foreground block mb-1">
            {t("maxLength")}
          </label>
          <input
            type="number"
            min={0}
            value={element.properties.maxLength ?? ""}
            onChange={(e) => {
              const parsed = parseInt(e.target.value, 10);
              updateProperties({
                maxLength:
                  Number.isFinite(parsed) && parsed > 0 ? parsed : null,
              });
            }}
            className={inputClass}
            placeholder="—"
          />
        </div>
      ) : null}

      {/* Éditeur d'options (dropdown / listbox / radio) */}
      {hasOptions ? (
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-muted-foreground">
              {t("options")}
            </label>
            <button
              type="button"
              onClick={() =>
                updateOptions([
                  ...options,
                  `${t("newOption")} ${options.length + 1}`,
                ])
              }
              title={t("addOption")}
              aria-label={t("addOption")}
              className="h-6 w-6 flex items-center justify-center rounded border hover:bg-accent transition-colors"
            >
              <Plus size={12} />
            </button>
          </div>
          <div className="space-y-1">
            {options.map((option, index) => (
              <div key={`${index}-${option}`} className="flex items-center gap-1">
                <input
                  type="text"
                  defaultValue={option}
                  onBlur={(e) => {
                    const next = [...options];
                    next[index] = e.target.value.trim() || option;
                    if (next[index] !== option) updateOptions(next);
                  }}
                  className="flex-1 h-7 px-2 rounded border bg-background text-xs min-w-0"
                />
                <button
                  type="button"
                  onClick={() => {
                    if (index === 0) return;
                    const next = [...options];
                    [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
                    updateOptions(next);
                  }}
                  disabled={index === 0}
                  title={t("moveUp")}
                  aria-label={t("moveUp")}
                  className="h-7 w-6 flex items-center justify-center rounded border hover:bg-accent transition-colors disabled:opacity-40"
                >
                  <ArrowUp size={11} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (index >= options.length - 1) return;
                    const next = [...options];
                    [next[index], next[index + 1]] = [next[index + 1]!, next[index]!];
                    updateOptions(next);
                  }}
                  disabled={index >= options.length - 1}
                  title={t("moveDown")}
                  aria-label={t("moveDown")}
                  className="h-7 w-6 flex items-center justify-center rounded border hover:bg-accent transition-colors disabled:opacity-40"
                >
                  <ArrowDown size={11} />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    updateOptions(options.filter((_, i) => i !== index))
                  }
                  title={t("removeOption")}
                  aria-label={t("removeOption")}
                  className="h-7 w-6 flex items-center justify-center rounded border hover:bg-accent text-destructive transition-colors"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
            {options.length === 0 ? (
              <p className="text-[10px] text-muted-foreground italic">
                {t("noOptions")}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Police + alignement */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">
            {t("fontSize")}
          </label>
          <input
            type="number"
            min={4}
            max={72}
            value={element.style.fontSize}
            onChange={(e) => {
              const parsed = parseFloat(e.target.value);
              if (Number.isFinite(parsed) && parsed > 0) {
                updateStyle({ fontSize: parsed });
              }
            }}
            className={inputClass}
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">
            {t("textAlign")}
          </label>
          <select
            value={element.style.textAlign ?? "left"}
            onChange={(e) =>
              updateStyle({
                textAlign: e.target.value as "left" | "center" | "right",
              })
            }
            className={inputClass}
          >
            <option value="left">{t("alignLeft")}</option>
            <option value="center">{t("alignCenter")}</option>
            <option value="right">{t("alignRight")}</option>
          </select>
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
  allFieldNames = [],
  userLayers = [],
  onAssignElementToLayer,
}: PropertiesPanelProps) {
  const t = useTranslations("editor.properties");

  const selectedElement = selectedElements.length === 1 ? selectedElements[0] : null;
  const hasMultipleSelection = selectedElements.length > 1;

  // Calques utilisateur triés par `order` décroissant (cohérent avec le panneau
  // calques) pour le menu déroulant "Layer" de la section commune.
  const sortedUserLayers = [...userLayers].sort((a, b) => b.order - a.order);

  // Render pour élément texte
  const renderTextProperties = (element: TextElement) => (
    <div className="space-y-3">
      {/* Contenu éditable directement — indépendant du clic sur le canvas
          (utile quand le hit-target ne couvre pas exactement le texte rendu).
          Commit au blur → onElementUpdate({ content }) → édition in-place
          (replaceText) via le même chemin que les autres propriétés. La key
          réinitialise le textarea quand on change d'élément sélectionné. */}
      <div>
        <label className="text-xs text-muted-foreground block mb-1">
          {t("text.content")}
        </label>
        <textarea
          key={element.elementId}
          dir={element.style?.direction ?? "ltr"}
          defaultValue={element.content ?? ""}
          onBlur={(e) => {
            const next = e.target.value;
            if (next !== (element.content ?? "")) {
              onElementUpdate?.(element.elementId, {
                content: next,
              } as Partial<TextElement>);
            }
          }}
          rows={3}
          placeholder={t("text.contentPlaceholder")}
          className="w-full px-2 py-1.5 rounded border bg-background text-sm resize-y"
        />
      </div>

      <div>
        <label className="text-xs text-muted-foreground block mb-1">
          {t("text.direction")}
        </label>
        <select
          value={element.style?.direction ?? "ltr"}
          onChange={(e) =>
            onElementUpdate?.(element.elementId, {
              style: {
                ...element.style,
                direction: e.target.value as "ltr" | "rtl",
              },
            } as Partial<TextElement>)
          }
          className="w-full h-8 px-2 rounded border bg-background text-sm"
        >
          <option value="ltr">{t("text.ltr")}</option>
          <option value="rtl">{t("text.rtl")}</option>
        </select>
      </div>

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

      {/* Calque utilisateur (Phase 2 "Layer Groups"). Affiché uniquement quand
          l'appelant fournit l'action ET au moins un calque existe. */}
      {onAssignElementToLayer && sortedUserLayers.length > 0 && (
        <>
          <h4 className="font-medium text-sm">{t("layer")}</h4>
          <select
            value={element.layerId ?? ""}
            onChange={(e) =>
              onAssignElementToLayer(element.elementId, e.target.value || null)
            }
            className="w-full h-8 px-2 rounded border bg-background text-sm"
            aria-label={t("layer")}
          >
            <option value="">{t("layerNone")}</option>
            {sortedUserLayers.map((layer) => (
              <option key={layer.layerId} value={layer.layerId}>
                {layer.name}
              </option>
            ))}
          </select>
        </>
      )}
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
              {selectedElement.type === "form_field" && (
                <FormFieldProperties
                  key={selectedElement.elementId}
                  element={selectedElement as FormFieldElement}
                  onElementUpdate={onElementUpdate}
                  otherFieldNames={allFieldNames.filter(
                    (name) =>
                      name !== (selectedElement as FormFieldElement).fieldName,
                  )}
                />
              )}
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
