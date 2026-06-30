"use client";

import React, { useEffect, useRef, useState } from "react";
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
  ImageUp,
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
import type { DocumentFontOption } from "@giga-pdf/editor";

/**
 * One character-range style span for an in-place text-run restyle, matching
 * `GigaPdfDoc.setTextRunStyle(page, index, spans)`. `start`/`end` are UTF-16
 * indices into the run's decoded text; `color` is `[r, g, b]` in `0..=1`.
 */
export interface TextRunStyleSpan {
  start: number;
  end: number;
  color?: [number, number, number];
  sizePt?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
}

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
  /**
   * Polices RÉELLES du document (faces embarquées chargées par `useEmbeddedFonts`).
   * Listées en tête du sélecteur de police du texte, AVANT le petit set système
   * de repli. Absent / vide ⇒ seules les polices système sont proposées
   * (comportement historique). Choisir une police document applique sa face
   * réelle (`gigapdf-{docId}-{fontId}`) + son nom d'origine à l'élément, pour un
   * rendu 1:1 avec le PDF.
   */
  documentFonts?: DocumentFontOption[];
  /**
   * 1-based number of the active page. When provided together with
   * {@link getDocumentBytes}, the panel shows the "Page boxes" section — an
   * editor for the five PDF boundary boxes (Media/Crop/Bleed/Trim/Art) of this
   * page. Absent ⇒ section hidden (backward-compatible default).
   */
  pageNumber?: number;
  /**
   * Returns the current PDF bytes (the editor's prepared blob), or `null` when
   * none is available. Used by the "Page boxes" section to read (`mode=get`) and
   * write (`mode=set`) the page boundary boxes via `/api/pdf/page-boxes`.
   * Absent ⇒ section hidden.
   */
  getDocumentBytes?: () => Promise<Blob | null>;
  /**
   * Called with the modified PDF bytes after a page box is written, so the
   * editor can adopt the new document. Absent ⇒ the box is still written
   * server-side, but the editor keeps its current bytes until the next reload.
   */
  onPageBoxesApplied?: (bytes: Uint8Array) => void;
  /**
   * Apply a Word-like style to an EXISTING parsed text run **in place**
   * (vectorial restyle via `setTextRunStyle`, not a redact + re-draw). Shown for
   * a parsed text element (one carrying an engine run `index >= 0`) together
   * with {@link PropertiesPanelProps.pageNumber}. `index` is the run index on
   * `page`; `spans` carry the chosen style over `[start, end)` character ranges.
   * Absent ⇒ the "apply style to run" action is hidden.
   */
  onApplyTextStyle?: (args: {
    page: number;
    index: number;
    spans: TextRunStyleSpan[];
  }) => void;
  /**
   * Replace the pixels of the selected image IN PLACE (engine `replaceImage` via
   * `/api/pdf/replace-image`) — the image keeps its position / scale / rotation,
   * only the raster changes. Called with the image's engine UNIFIED element
   * `index` (from `imageElements()`, carried on `ImageElement.index`) and the
   * chosen bitmap. Shown only for a parsed image (one carrying an `index >= 0`).
   * Absent ⇒ the "Replace image" action is hidden.
   */
  onReplaceImage?: (args: { index: number; file: File }) => void;
}

/**
 * Parse a `#rrggbb` (or `#rgb`) hex string into an `[r, g, b]` triple in
 * `0..=1`, or `undefined` when it isn't a valid hex colour (so the span simply
 * omits `color` and the run keeps its existing fill).
 */
function hexToRgb01(hex: string | null | undefined): [number, number, number] | undefined {
  if (!hex) return undefined;
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h[0]! + h[0]! + h[1]! + h[1]! + h[2]! + h[2]!;
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return undefined;
  const n = parseInt(h, 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

/** Charset AcroForm sûr pour un nom de champ (lettres, chiffres, _ . -). */
const FIELD_NAME_PATTERN = /^[A-Za-z0-9_.\-]+$/;

/**
 * Petit set de polices SYSTÈME proposé en repli sous les polices du document.
 * Leur `value` est une famille CSS générique (pas une face embarquée) — le
 * renderer les rend via la branche CSS de `resolveTextFont`.
 */
const SYSTEM_FONT_FAMILIES: ReadonlyArray<string> = [
  "Arial",
  "Helvetica",
  "Times New Roman",
  "Courier New",
  "Georgia",
];

/** Préfixe des valeurs de police « document » dans le sélecteur (= face réelle). */
const DOC_FONT_FACE_PREFIX = "gigapdf-";

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

// ============= Style d'une forme (P3 "vector restyle") =============

/** Presets de pointillé proposés dans le menu déroulant (clé i18n → tableau). */
const DASH_PRESETS: ReadonlyArray<{ value: number[]; labelKey: string }> = [
  { value: [], labelKey: "shape.dashSolid" },
  { value: [4, 4], labelKey: "shape.dashDashed" },
  { value: [1, 4], labelKey: "shape.dashDotted" },
  { value: [8, 4], labelKey: "shape.dashLong" },
];

/** Tableaux de pointillé égaux élément par élément (ordre inclus). */
function dashEquals(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Index du preset de pointillé correspondant, ou 0 (Solid) si aucun. */
function dashPresetIndex(dash: number[] | undefined): number {
  const arr = dash ?? [];
  const found = DASH_PRESETS.findIndex((p) => dashEquals(p.value, arr));
  return found >= 0 ? found : 0;
}

interface ShapeStylePropertiesProps {
  element: ShapeElement;
  onElementUpdate?: (elementId: string, updates: Partial<Element>) => void;
}

/**
 * Section "Shape Style" — éditeur de remplissage / contour / épaisseur /
 * pointillé / opacités pour une forme vectorielle. Chaque changement renvoie le
 * style ENTIER (spread + champ écrasé) via `onElementUpdate` : le pipeline
 * update → operations-store → apply-operations bake la modif IN PLACE
 * (`setPathStyle`) quand la géométrie est inchangée, sinon redact + add.
 *
 * Les curseurs d'opacité sont anti-rebond (~150 ms) — un drag ne génère qu'un
 * seul update final (l'opacité passe forcément par le fallback redact + add côté
 * moteur, donc on évite d'empiler des dizaines de re-bakes). Les sélecteurs de
 * couleur, l'épaisseur et le pointillé propagent immédiatement (changement
 * discret). Monté avec `key={elementId}` : l'état local se réinitialise au
 * changement de sélection.
 */
function ShapeStyleProperties({ element, onElementUpdate }: ShapeStylePropertiesProps) {
  const t = useTranslations("editor.properties");

  // Curseurs d'opacité : valeur locale réactive + propagation anti-rebond.
  const [fillOpacity, setFillOpacity] = useState(element.style?.fillOpacity ?? 1);
  const [strokeOpacity, setStrokeOpacity] = useState(element.style?.strokeOpacity ?? 1);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const update = (patch: Partial<ShapeElement["style"]>) => {
    onElementUpdate?.(element.elementId, {
      style: { ...element.style, ...patch },
    } as Partial<ShapeElement>);
  };

  const debouncedUpdate = (patch: Partial<ShapeElement["style"]>) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => update(patch), 150);
  };

  return (
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
            onChange={(e) => update({ fillColor: e.target.value })}
            aria-label={t("shape.fill")}
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
            onChange={(e) => update({ strokeColor: e.target.value })}
            aria-label={t("shape.stroke")}
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
          value={element.style?.strokeWidth ?? 1}
          onChange={(e) => {
            const parsed = parseFloat(e.target.value);
            if (Number.isFinite(parsed) && parsed >= 0) {
              update({ strokeWidth: parsed });
            }
          }}
          min={0}
          max={50}
          step={0.5}
          aria-label={t("shape.strokeWidth")}
          className="w-full h-8 px-2 rounded border bg-background text-sm"
        />
      </div>

      <div>
        <label className="text-xs text-muted-foreground block mb-1">
          {t("shape.dash")}
        </label>
        <select
          value={dashPresetIndex(element.style?.strokeDashArray)}
          onChange={(e) => {
            const preset = DASH_PRESETS[parseInt(e.target.value, 10)];
            if (preset) update({ strokeDashArray: [...preset.value] });
          }}
          aria-label={t("shape.dash")}
          className="w-full h-8 px-2 rounded border bg-background text-sm"
        >
          {DASH_PRESETS.map((preset, index) => (
            <option key={preset.labelKey} value={index}>
              {t(preset.labelKey)}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="text-xs text-muted-foreground block mb-1">
          {t("shape.fillOpacity")}
        </label>
        <input
          type="range"
          value={fillOpacity * 100}
          onChange={(e) => {
            const next = parseInt(e.target.value, 10) / 100;
            setFillOpacity(next);
            debouncedUpdate({ fillOpacity: next });
          }}
          min={0}
          max={100}
          aria-label={t("shape.fillOpacity")}
          className="w-full"
        />
      </div>

      <div>
        <label className="text-xs text-muted-foreground block mb-1">
          {t("shape.strokeOpacity")}
        </label>
        <input
          type="range"
          value={strokeOpacity * 100}
          onChange={(e) => {
            const next = parseInt(e.target.value, 10) / 100;
            setStrokeOpacity(next);
            debouncedUpdate({ strokeOpacity: next });
          }}
          min={0}
          max={100}
          aria-label={t("shape.strokeOpacity")}
          className="w-full"
        />
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
// ============= Boîtes de page (Media/Crop/Bleed/Trim/Art) =============

/** One of the five PDF page boundary boxes (ISO 32000-1 §14.11.2). */
type PageBoxKindLocal = "media" | "crop" | "bleed" | "trim" | "art";
/** An effective box rect `[x0, y0, x1, y1]` in user-space points. */
type Rect4 = [number, number, number, number];
/** Editable origin+size draft for one box (strings, since they back inputs). */
type BoxDraft = { x: string; y: string; w: string; h: string };

/**
 * The route's `get` payload shape: the five effective rects plus the per-box
 * `declared` flags. Mirrors {@link import("@qrcommunication/gigapdf-lib").PageBoxes}
 * (declared locally so this client component never imports the WASM package).
 */
interface PageBoxesData {
  media: Rect4;
  crop: Rect4;
  bleed: Rect4;
  trim: Rect4;
  art: Rect4;
  declared: Record<PageBoxKindLocal, boolean>;
}

/** Display + apply order, matching ISO 32000-1 §14.11.2 / PAGE_BOX_KINDS. */
const PAGE_BOX_KIND_ORDER: readonly PageBoxKindLocal[] = [
  "media",
  "crop",
  "bleed",
  "trim",
  "art",
] as const;

/** Draft field → i18n key under `editor.pageBoxes.fields`. */
const PAGE_BOX_FIELD_KEY: Record<keyof BoxDraft, string> = {
  x: "x",
  y: "y",
  w: "width",
  h: "height",
};

/** Round to 2 decimals for display (points can be fractional). */
function fmtPoint(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** Effective rect `[x0,y0,x1,y1]` → an origin+size draft `{x,y,w,h}`. */
function rectToDraft([x0, y0, x1, y1]: Rect4): BoxDraft {
  return {
    x: fmtPoint(x0),
    y: fmtPoint(y0),
    w: fmtPoint(x1 - x0),
    h: fmtPoint(y1 - y0),
  };
}

function boxesToDrafts(boxes: PageBoxesData): Record<PageBoxKindLocal, BoxDraft> {
  return {
    media: rectToDraft(boxes.media),
    crop: rectToDraft(boxes.crop),
    bleed: rectToDraft(boxes.bleed),
    trim: rectToDraft(boxes.trim),
    art: rectToDraft(boxes.art),
  };
}

/** A draft is applyable when x/y/w/h are finite and the box has positive area. */
function isDraftValid(d: BoxDraft): boolean {
  const x = Number(d.x);
  const y = Number(d.y);
  const w = Number(d.w);
  const h = Number(d.h);
  return [x, y, w, h].every(Number.isFinite) && w > 0 && h > 0;
}

/**
 * "Boîtes de page" — reads the five boundary boxes of the active page
 * (`/api/pdf/page-boxes` `mode=get`) and lets the user rewrite any of them
 * (`mode=set`). Self-contained: given the active page number and a way to read
 * the document bytes, it owns its fetch + apply lifecycle. Each box is edited as
 * origin + size in points (the engine's `setPageBox` shape); the `declared`
 * badge distinguishes a real box from one inherited/defaulted by the ISO chain.
 */
function PageBoxesSection({
  pageNumber,
  getDocumentBytes,
  onPageBoxesApplied,
}: {
  pageNumber: number;
  getDocumentBytes: () => Promise<Blob | null>;
  onPageBoxesApplied?: (bytes: Uint8Array) => void;
}) {
  const t = useTranslations("editor.pageBoxes");
  const [boxes, setBoxes] = useState<PageBoxesData | null>(null);
  const [drafts, setDrafts] = useState<Record<PageBoxKindLocal, BoxDraft> | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [savingKind, setSavingKind] = useState<PageBoxKindLocal | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  // `getDocumentBytes` may change identity each render (the editor recreates its
  // prepared-blob callback); read it through a ref so the load effect only
  // re-runs on page change or an explicit retry — never on unrelated re-renders.
  const getBytesRef = useRef(getDocumentBytes);
  useEffect(() => {
    getBytesRef.current = getDocumentBytes;
  }, [getDocumentBytes]);

  useEffect(() => {
    let aborted = false;
    setStatus("loading");
    void (async () => {
      try {
        const blob = await getBytesRef.current();
        if (!blob) {
          if (!aborted) setStatus("error");
          return;
        }
        const form = new FormData();
        form.append("file", new File([blob], "document.pdf", { type: "application/pdf" }));
        form.append("page", String(pageNumber));
        form.append("mode", "get");
        const res = await fetch("/api/pdf/page-boxes", { method: "POST", body: form });
        if (aborted) return;
        if (!res.ok) {
          setStatus("error");
          return;
        }
        const json = (await res.json()) as { success?: boolean; boxes?: PageBoxesData };
        if (aborted) return;
        if (!json.success || !json.boxes) {
          setStatus("error");
          return;
        }
        setBoxes(json.boxes);
        setDrafts(boxesToDrafts(json.boxes));
        setStatus("ready");
      } catch {
        if (!aborted) setStatus("error");
      }
    })();
    return () => {
      aborted = true;
    };
  }, [pageNumber, reloadToken]);

  const updateDraft = (kind: PageBoxKindLocal, field: keyof BoxDraft, value: string) =>
    setDrafts((prev) =>
      prev ? { ...prev, [kind]: { ...prev[kind], [field]: value } } : prev,
    );

  const applyBox = async (kind: PageBoxKindLocal) => {
    if (!drafts) return;
    const d = drafts[kind];
    if (!isDraftValid(d)) return;
    const x = Number(d.x);
    const y = Number(d.y);
    const w = Number(d.w);
    const h = Number(d.h);

    setSavingKind(kind);
    try {
      const blob = await getBytesRef.current();
      if (!blob) {
        setStatus("error");
        return;
      }
      const form = new FormData();
      form.append("file", new File([blob], "document.pdf", { type: "application/pdf" }));
      form.append("page", String(pageNumber));
      form.append("mode", "set");
      form.append("kind", kind);
      form.append("x", String(x));
      form.append("y", String(y));
      form.append("w", String(w));
      form.append("h", String(h));
      const res = await fetch("/api/pdf/page-boxes", { method: "POST", body: form });
      if (!res.ok) {
        setStatus("error");
        return;
      }
      const applied = new Uint8Array(await res.arrayBuffer());
      onPageBoxesApplied?.(applied);
      // Optimistic local sync: the set response is binary (no JSON to re-read),
      // so reflect the written rect + mark the box declared. A page change or
      // retry re-fetches the authoritative state from the new bytes.
      setBoxes((prev) =>
        prev
          ? {
              ...prev,
              [kind]: [x, y, x + w, y + h] as Rect4,
              declared: { ...prev.declared, [kind]: true },
            }
          : prev,
      );
    } catch {
      setStatus("error");
    } finally {
      setSavingKind(null);
    }
  };

  return (
    <div className="mt-4 pt-4 border-t">
      <h4 className="font-medium text-sm mb-1">{t("title")}</h4>
      <p className="text-[11px] text-muted-foreground mb-2">{t("description")}</p>

      {status === "loading" && (
        <p className="text-xs text-muted-foreground py-1">{t("loading")}</p>
      )}

      {status === "error" && (
        <div className="text-xs text-muted-foreground py-1">
          <p>{t("error")}</p>
          <button
            type="button"
            onClick={() => setReloadToken((n) => n + 1)}
            className="mt-1 text-primary hover:underline"
          >
            {t("retry")}
          </button>
        </div>
      )}

      {status === "ready" && drafts && boxes && (
        <div className="space-y-3">
          {PAGE_BOX_KIND_ORDER.map((kind) => {
            const draft = drafts[kind];
            const valid = isDraftValid(draft);
            const declared = boxes.declared[kind];
            const saving = savingKind === kind;
            return (
              <div key={kind} className="rounded-md border border-border p-2">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-medium">{t(`kinds.${kind}`)}</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded ${
                      declared
                        ? "bg-primary/10 text-primary"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    {declared ? t("declared") : t("inherited")}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {(["x", "y", "w", "h"] as const).map((field) => (
                    <label key={field} className="block">
                      <span className="block text-[10px] text-muted-foreground mb-0.5">
                        {t(`fields.${PAGE_BOX_FIELD_KEY[field]}`)} ({t("unit")})
                      </span>
                      <input
                        type="number"
                        inputMode="decimal"
                        value={draft[field]}
                        onChange={(e) => updateDraft(kind, field, e.target.value)}
                        className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs"
                      />
                    </label>
                  ))}
                </div>
                {!valid && (
                  <p className="mt-1 text-[10px] text-destructive">{t("invalid")}</p>
                )}
                <button
                  type="button"
                  disabled={savingKind !== null || !valid}
                  onClick={() => void applyBox(kind)}
                  className="mt-1.5 w-full px-2 py-1 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {saving ? t("applying") : t("apply")}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============= Couleur prépresse (#86) & Dégradé (#85) =============

/**
 * Local mirror of the engine's `Color` union (ISO 32000-1 §8.6) — the prepress
 * spaces surfaced in the panel. Declared here so this client component never
 * imports the WASM package (same rule as {@link PageBoxesData}). The `icc`
 * colour space is route-only (it needs an uploaded profile); the panel exposes
 * an ICC **output intent** uploader instead.
 */
type PrepressColorSpace = "rgb" | "cmyk" | "gray" | "separation";
type PrepressColor =
  | { space: "rgb"; rgb: number }
  | { space: "cmyk"; c: number; m: number; y: number; k: number }
  | { space: "gray"; gray: number }
  | { space: "separation"; name: string; tint: number; cmyk: [number, number, number, number] };

/** A `{ x, y, w, h }` bake rect in PDF user space (origin bottom-left). */
interface PdfRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Editable origin+size draft for a bake rect (strings — they back inputs). */
type RectDraft = { x: string; y: string; w: string; h: string };

interface PageGeo {
  width: number;
  height: number;
  rotation: number;
}

/**
 * Lower a web element rect (origin top-left, Y-down — PDF points at scale 1) to
 * a PDF user-space rect (origin bottom-left, Y-up), honouring the page
 * `/Rotate`. The same flip as `@giga-pdf/pdf-engine`'s `webToPdf` (used by the
 * redaction/render helpers), inlined to keep the panel free of the heavy
 * pdf-engine barrel. Used only to PRE-FILL the editable rect fields — the user
 * sees and can adjust the result before baking.
 */
function webBoundsToPdfRect(
  bounds: { x: number; y: number; width: number; height: number },
  geo: PageGeo | undefined,
): PdfRect {
  const { x, width: w, height: h } = bounds;
  if (!geo) return { x, y: bounds.y, w, h };
  if ((geo.rotation ?? 0) === 180) return { x: geo.width - x - w, y: bounds.y, w, h };
  // rotation 0 / 90 / 270 → plain Y-flip against the displayed page height.
  return { x, y: geo.height - bounds.y - h, w, h };
}

/** Round to 2 decimals for display (points can be fractional). */
function fmtRect(n: number): string {
  return String(Math.round(n * 100) / 100);
}

function pdfRectToDraft(r: PdfRect): RectDraft {
  return { x: fmtRect(r.x), y: fmtRect(r.y), w: fmtRect(r.w), h: fmtRect(r.h) };
}

/** Parse a rect draft; `null` if any field is non-finite or the area is ≤ 0. */
function draftToRect(d: RectDraft): PdfRect | null {
  const x = Number(d.x);
  const y = Number(d.y);
  const w = Number(d.w);
  const h = Number(d.h);
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}

function hexToRgbInt(hex: string): number {
  return parseInt(hex.replace(/^#/, ""), 16) & 0xffffff;
}

/** Clamp a 0…100 percentage input to the engine's normalised 0…1 component. */
function pctToUnit(pct: number): number {
  return Math.min(1, Math.max(0, pct / 100));
}

/** POST a bake to /api/pdf/color and resolve the modified PDF bytes. */
async function postColorBake(
  getDocumentBytes: () => Promise<Blob | null>,
  fields: { key: string; value: string | Blob }[],
): Promise<Uint8Array> {
  const blob = await getDocumentBytes();
  if (!blob) throw new Error("no-document-bytes");
  const form = new FormData();
  form.append("file", new File([blob], "document.pdf", { type: "application/pdf" }));
  for (const { key, value } of fields) form.append(key, value);
  const res = await fetch("/api/pdf/color", { method: "POST", body: form });
  if (!res.ok) throw new Error(`bake-failed-${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

const BAKE_INPUT_CLASS = "w-full rounded-md border border-input bg-background px-2 py-1 text-xs";

/** Shared X/Y/W/H point editor for the colour + gradient bake rects. */
function RectFields({
  rect,
  onChange,
  labels,
}: {
  rect: RectDraft;
  onChange: (field: keyof RectDraft, value: string) => void;
  labels: { x: string; y: string; width: string; height: string; unit: string };
}) {
  const fields: ReadonlyArray<{ key: keyof RectDraft; label: string }> = [
    { key: "x", label: labels.x },
    { key: "y", label: labels.y },
    { key: "w", label: labels.width },
    { key: "h", label: labels.height },
  ];
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {fields.map(({ key, label }) => (
        <label key={key} className="block">
          <span className="block text-[10px] text-muted-foreground mb-0.5">
            {label} ({labels.unit})
          </span>
          <input
            type="number"
            inputMode="decimal"
            value={rect[key]}
            onChange={(e) => onChange(key, e.target.value)}
            className={BAKE_INPUT_CLASS}
          />
        </label>
      ))}
    </div>
  );
}

interface BakeSectionProps {
  element: Element;
  pageInfo?: PageGeo;
  pageNumber: number;
  getDocumentBytes: () => Promise<Blob | null>;
  /** Adopt the modified PDF bytes returned by the bake (editor reloads). */
  onApplied?: (bytes: Uint8Array) => void;
}

/** One labelled 0…100 component input (CMYK / gray / tint), shown as a percent. */
function PercentField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="block text-[10px] text-muted-foreground mb-0.5">{label}</span>
      <input
        type="number"
        min={0}
        max={100}
        value={value}
        onChange={(e) => {
          const parsed = parseFloat(e.target.value);
          onChange(Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : 0);
        }}
        className={BAKE_INPUT_CLASS}
      />
    </label>
  );
}

/**
 * "Couleur (prépresse)" — #86. Bakes a press-ready filled rectangle over the
 * selected element's area in any authored colour space (RGB / CMYK / spot
 * `Separation` / gray), with optional overprint (trapping) and an independent
 * ICC output-intent embed. Self-contained like {@link PageBoxesSection}: given
 * the active page + a way to read the document bytes, it owns its bake +
 * adopt-bytes lifecycle via `/api/pdf/color`. Mounted with `key={elementId}`,
 * so the draft resets on every selection change.
 */
function PrepressColorSection({
  element,
  pageInfo,
  pageNumber,
  getDocumentBytes,
  onApplied,
}: BakeSectionProps) {
  const t = useTranslations("editor.colors");
  const [space, setSpace] = useState<PrepressColorSpace>("cmyk");
  const [hex, setHex] = useState("#1d4ed8");
  const [cmyk, setCmyk] = useState({ c: 100, m: 66, y: 0, k: 2 });
  const [gray, setGray] = useState(0);
  const [spotName, setSpotName] = useState("PANTONE 286 C");
  const [spotTint, setSpotTint] = useState(100);
  const [spotCmyk, setSpotCmyk] = useState({ c: 100, m: 66, y: 0, k: 2 });
  const [opacity, setOpacity] = useState(100);
  const [overprintFill, setOverprintFill] = useState(false);
  const [overprintStroke, setOverprintStroke] = useState(false);
  const [overprintMode, setOverprintMode] = useState(false);
  const [rect, setRect] = useState<RectDraft>(() =>
    pdfRectToDraft(webBoundsToPdfRect(element.bounds, pageInfo)),
  );
  const [status, setStatus] = useState<"idle" | "applying" | "error">("idle");

  // ICC output intent (addOutputIntent) — an independent document-level action.
  const [iccFile, setIccFile] = useState<File | null>(null);
  const [iccCondition, setIccCondition] = useState("");
  const [iccStatus, setIccStatus] = useState<"idle" | "applying" | "error">("idle");

  const buildColor = (): PrepressColor => {
    switch (space) {
      case "rgb":
        return { space: "rgb", rgb: hexToRgbInt(hex) };
      case "cmyk":
        return { space: "cmyk", c: pctToUnit(cmyk.c), m: pctToUnit(cmyk.m), y: pctToUnit(cmyk.y), k: pctToUnit(cmyk.k) };
      case "gray":
        return { space: "gray", gray: pctToUnit(gray) };
      case "separation":
        return {
          space: "separation",
          name: spotName.trim() || "Spot",
          tint: pctToUnit(spotTint),
          cmyk: [pctToUnit(spotCmyk.c), pctToUnit(spotCmyk.m), pctToUnit(spotCmyk.y), pctToUnit(spotCmyk.k)] as [
            number,
            number,
            number,
            number,
          ],
        };
    }
  };

  const parsedRect = draftToRect(rect);

  const apply = async () => {
    if (!parsedRect) return;
    setStatus("applying");
    try {
      const fields: { key: string; value: string | Blob }[] = [
        { key: "page", value: String(pageNumber) },
        { key: "operation", value: "fill" },
        {
          key: "payload",
          value: JSON.stringify({ rect: parsedRect, color: buildColor(), opacity: pctToUnit(opacity) }),
        },
      ];
      if (overprintFill || overprintStroke) {
        fields.push({
          key: "overprint",
          value: JSON.stringify({ fill: overprintFill, stroke: overprintStroke, mode: overprintMode ? 1 : 0 }),
        });
      }
      const bytes = await postColorBake(getDocumentBytes, fields);
      onApplied?.(bytes);
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  };

  const embedIcc = async () => {
    if (!iccFile || iccCondition.trim() === "") return;
    setIccStatus("applying");
    try {
      const bytes = await postColorBake(getDocumentBytes, [
        { key: "page", value: String(pageNumber) },
        { key: "operation", value: "output-intent" },
        { key: "iccProfile", value: iccFile },
        { key: "condition", value: iccCondition.trim() },
      ]);
      onApplied?.(bytes);
      setIccStatus("idle");
    } catch {
      setIccStatus("error");
    }
  };

  return (
    <div className="mt-4 pt-4 border-t">
      <h4 className="font-medium text-sm mb-1">{t("title")}</h4>
      <p className="text-[11px] text-muted-foreground mb-2">{t("description")}</p>

      <div className="space-y-3">
        {/* Colour space */}
        <div>
          <label className="text-xs text-muted-foreground block mb-1">{t("space")}</label>
          <select
            value={space}
            onChange={(e) => setSpace(e.target.value as PrepressColorSpace)}
            className="w-full h-8 px-2 rounded border bg-background text-sm"
            aria-label={t("space")}
          >
            <option value="cmyk">{t("spaceCmyk")}</option>
            <option value="separation">{t("spaceSeparation")}</option>
            <option value="gray">{t("spaceGray")}</option>
            <option value="rgb">{t("spaceRgb")}</option>
          </select>
        </div>

        {/* Space-specific components */}
        {space === "rgb" && (
          <div>
            <label className="text-xs text-muted-foreground block mb-1">{t("color")}</label>
            <input
              type="color"
              value={hex}
              onChange={(e) => setHex(e.target.value)}
              aria-label={t("color")}
              className="w-full h-8 rounded border bg-background"
            />
          </div>
        )}

        {space === "cmyk" && (
          <div className="grid grid-cols-2 gap-2">
            <PercentField label={t("cyan")} value={cmyk.c} onChange={(v) => setCmyk((p) => ({ ...p, c: v }))} />
            <PercentField label={t("magenta")} value={cmyk.m} onChange={(v) => setCmyk((p) => ({ ...p, m: v }))} />
            <PercentField label={t("yellow")} value={cmyk.y} onChange={(v) => setCmyk((p) => ({ ...p, y: v }))} />
            <PercentField label={t("black")} value={cmyk.k} onChange={(v) => setCmyk((p) => ({ ...p, k: v }))} />
          </div>
        )}

        {space === "gray" && (
          <PercentField label={t("gray")} value={gray} onChange={setGray} />
        )}

        {space === "separation" && (
          <div className="space-y-2">
            <label className="block">
              <span className="block text-[10px] text-muted-foreground mb-0.5">{t("spotName")}</span>
              <input
                type="text"
                value={spotName}
                onChange={(e) => setSpotName(e.target.value)}
                placeholder={t("spotNamePlaceholder")}
                className={BAKE_INPUT_CLASS}
              />
            </label>
            <PercentField label={t("tint")} value={spotTint} onChange={setSpotTint} />
            <span className="block text-[10px] text-muted-foreground">{t("approxCmyk")}</span>
            <div className="grid grid-cols-2 gap-2">
              <PercentField label={t("cyan")} value={spotCmyk.c} onChange={(v) => setSpotCmyk((p) => ({ ...p, c: v }))} />
              <PercentField label={t("magenta")} value={spotCmyk.m} onChange={(v) => setSpotCmyk((p) => ({ ...p, m: v }))} />
              <PercentField label={t("yellow")} value={spotCmyk.y} onChange={(v) => setSpotCmyk((p) => ({ ...p, y: v }))} />
              <PercentField label={t("black")} value={spotCmyk.k} onChange={(v) => setSpotCmyk((p) => ({ ...p, k: v }))} />
            </div>
          </div>
        )}

        {/* Rect (pre-filled from the selected element, editable) */}
        <div>
          <label className="text-[10px] text-muted-foreground block mb-1">{t("rect")}</label>
          <RectFields
            rect={rect}
            onChange={(field, value) => setRect((prev) => ({ ...prev, [field]: value }))}
            labels={{ x: t("x"), y: t("y"), width: t("width"), height: t("height"), unit: t("unit") }}
          />
        </div>

        {/* Opacity */}
        <div>
          <label className="text-xs text-muted-foreground block mb-1">{t("opacity")}</label>
          <input
            type="range"
            min={0}
            max={100}
            value={opacity}
            onChange={(e) => setOpacity(parseInt(e.target.value, 10))}
            aria-label={t("opacity")}
            className="w-full"
          />
        </div>

        {/* Overprint (trapping) */}
        <div className="space-y-1.5">
          <span className="text-xs text-muted-foreground block">{t("overprint")}</span>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={overprintFill}
              onChange={(e) => setOverprintFill(e.target.checked)}
              className="w-4 h-4"
            />
            <span className="text-xs text-muted-foreground">{t("overprintFill")}</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={overprintStroke}
              onChange={(e) => setOverprintStroke(e.target.checked)}
              className="w-4 h-4"
            />
            <span className="text-xs text-muted-foreground">{t("overprintStroke")}</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={overprintMode}
              onChange={(e) => setOverprintMode(e.target.checked)}
              className="w-4 h-4"
            />
            <span className="text-xs text-muted-foreground">{t("overprintMode")}</span>
          </label>
        </div>

        {!parsedRect && <p className="text-[10px] text-destructive">{t("invalidRect")}</p>}
        {status === "error" && <p className="text-[10px] text-destructive">{t("error")}</p>}

        <button
          type="button"
          disabled={!parsedRect || status === "applying"}
          onClick={() => void apply()}
          className="w-full px-2 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {status === "applying" ? t("applying") : t("apply")}
        </button>

        {/* ICC output intent — independent document-level embed */}
        <div className="pt-2 border-t">
          <h5 className="text-xs font-medium mb-0.5">{t("outputIntent")}</h5>
          <p className="text-[10px] text-muted-foreground mb-1.5">{t("outputIntentDescription")}</p>
          <label className="block mb-1.5">
            <span className="block text-[10px] text-muted-foreground mb-0.5">{t("iccProfile")}</span>
            <input
              type="file"
              accept=".icc,.icm,application/vnd.iccprofile"
              onChange={(e) => setIccFile(e.target.files?.[0] ?? null)}
              className="w-full text-[11px]"
            />
          </label>
          <label className="block mb-1.5">
            <span className="block text-[10px] text-muted-foreground mb-0.5">{t("condition")}</span>
            <input
              type="text"
              value={iccCondition}
              onChange={(e) => setIccCondition(e.target.value)}
              placeholder={t("conditionPlaceholder")}
              className={BAKE_INPUT_CLASS}
            />
          </label>
          {iccStatus === "error" && <p className="text-[10px] text-destructive mb-1">{t("embedError")}</p>}
          <button
            type="button"
            disabled={!iccFile || iccCondition.trim() === "" || iccStatus === "applying"}
            onClick={() => void embedIcc()}
            className="w-full px-2 py-1 text-xs rounded-md border bg-background hover:bg-accent disabled:opacity-50"
          >
            {iccStatus === "applying" ? t("embedding") : t("embed")}
          </button>
        </div>
      </div>
    </div>
  );
}

type GradientKind = "linear" | "radial";
type LinearDirection = "horizontal" | "vertical" | "diagonal";
interface GradientStopDraft {
  offset: number;
  hex: string;
}

/** Derive the shading axis (`coords`) from the rect + kind/direction. */
function deriveGradientCoords(kind: GradientKind, direction: LinearDirection, r: PdfRect): number[] {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  if (kind === "radial") return [cx, cy, 0, cx, cy, Math.max(r.w, r.h) / 2];
  switch (direction) {
    case "horizontal":
      return [r.x, cy, r.x + r.w, cy];
    case "vertical":
      return [cx, r.y, cx, r.y + r.h];
    case "diagonal":
      return [r.x, r.y, r.x + r.w, r.y + r.h];
  }
}

/**
 * "Dégradé" — #85. Bakes an axial (linear) or radial gradient over the selected
 * element's area via `addGradient`. The user sets the kind, direction (linear),
 * ≥ 2 colour stops, the rect, opacity and `/Extend`; the shading axis is derived
 * from the rect. Self-contained like {@link PrepressColorSection}; mounted with
 * `key={elementId}` so the draft resets on each selection change.
 */
function GradientSection({ element, pageInfo, pageNumber, getDocumentBytes, onApplied }: BakeSectionProps) {
  const t = useTranslations("editor.gradients");
  const [kind, setKind] = useState<GradientKind>("linear");
  const [direction, setDirection] = useState<LinearDirection>("horizontal");
  const [stops, setStops] = useState<GradientStopDraft[]>([
    { offset: 0, hex: "#1d4ed8" },
    { offset: 1, hex: "#9333ea" },
  ]);
  const [opacity, setOpacity] = useState(100);
  const [extend, setExtend] = useState(true);
  const [rect, setRect] = useState<RectDraft>(() =>
    pdfRectToDraft(webBoundsToPdfRect(element.bounds, pageInfo)),
  );
  const [status, setStatus] = useState<"idle" | "applying" | "error">("idle");

  const updateStop = (index: number, patch: Partial<GradientStopDraft>) =>
    setStops((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  const addStop = () => setStops((prev) => [...prev, { offset: 1, hex: "#ffffff" }]);
  const removeStop = (index: number) =>
    setStops((prev) => (prev.length > 2 ? prev.filter((_, i) => i !== index) : prev));

  const parsedRect = draftToRect(rect);
  const canApply = parsedRect !== null && stops.length >= 2;

  const apply = async () => {
    if (!parsedRect || stops.length < 2) return;
    setStatus("applying");
    try {
      const spec = {
        kind,
        coords: deriveGradientCoords(kind, direction, parsedRect),
        stops: stops.map((s) => ({
          offset: Math.min(1, Math.max(0, s.offset)),
          rgb: hexToRgbInt(s.hex),
        })),
        rect: parsedRect,
        extend: [extend, extend] as [boolean, boolean],
        opacity: pctToUnit(opacity),
      };
      const bytes = await postColorBake(getDocumentBytes, [
        { key: "page", value: String(pageNumber) },
        { key: "operation", value: "gradient" },
        { key: "payload", value: JSON.stringify(spec) },
      ]);
      onApplied?.(bytes);
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  };

  return (
    <div className="mt-4 pt-4 border-t">
      <h4 className="font-medium text-sm mb-1">{t("title")}</h4>
      <p className="text-[11px] text-muted-foreground mb-2">{t("description")}</p>

      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">{t("kind")}</label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as GradientKind)}
              className="w-full h-8 px-2 rounded border bg-background text-sm"
              aria-label={t("kind")}
            >
              <option value="linear">{t("linear")}</option>
              <option value="radial">{t("radial")}</option>
            </select>
          </div>
          {kind === "linear" && (
            <div>
              <label className="text-xs text-muted-foreground block mb-1">{t("direction")}</label>
              <select
                value={direction}
                onChange={(e) => setDirection(e.target.value as LinearDirection)}
                className="w-full h-8 px-2 rounded border bg-background text-sm"
                aria-label={t("direction")}
              >
                <option value="horizontal">{t("horizontal")}</option>
                <option value="vertical">{t("vertical")}</option>
                <option value="diagonal">{t("diagonal")}</option>
              </select>
            </div>
          )}
        </div>

        {/* Colour stops (≥ 2) */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs text-muted-foreground">{t("stops")}</label>
            <button
              type="button"
              onClick={addStop}
              title={t("addStop")}
              aria-label={t("addStop")}
              className="h-6 w-6 flex items-center justify-center rounded border hover:bg-accent transition-colors"
            >
              <Plus size={12} />
            </button>
          </div>
          <div className="space-y-1.5">
            {stops.map((stop, index) => (
              <div key={index} className="flex items-center gap-1.5">
                <input
                  type="color"
                  value={stop.hex}
                  onChange={(e) => updateStop(index, { hex: e.target.value })}
                  aria-label={t("color")}
                  className="h-7 w-8 rounded border bg-background shrink-0"
                />
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.05}
                  value={stop.offset}
                  onChange={(e) => {
                    const parsed = parseFloat(e.target.value);
                    updateStop(index, {
                      offset: Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0,
                    });
                  }}
                  aria-label={t("offset")}
                  className="flex-1 h-7 px-2 rounded border bg-background text-xs min-w-0"
                />
                <button
                  type="button"
                  onClick={() => removeStop(index)}
                  disabled={stops.length <= 2}
                  title={t("removeStop")}
                  aria-label={t("removeStop")}
                  className="h-7 w-6 flex items-center justify-center rounded border hover:bg-accent text-destructive transition-colors disabled:opacity-40"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          </div>
          {stops.length < 2 && <p className="mt-1 text-[10px] text-destructive">{t("minStops")}</p>}
        </div>

        {/* Rect (pre-filled from the selected element, editable) */}
        <div>
          <label className="text-[10px] text-muted-foreground block mb-1">{t("rect")}</label>
          <RectFields
            rect={rect}
            onChange={(field, value) => setRect((prev) => ({ ...prev, [field]: value }))}
            labels={{ x: t("x"), y: t("y"), width: t("width"), height: t("height"), unit: t("unit") }}
          />
        </div>

        <div>
          <label className="text-xs text-muted-foreground block mb-1">{t("opacity")}</label>
          <input
            type="range"
            min={0}
            max={100}
            value={opacity}
            onChange={(e) => setOpacity(parseInt(e.target.value, 10))}
            aria-label={t("opacity")}
            className="w-full"
          />
        </div>

        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={extend}
            onChange={(e) => setExtend(e.target.checked)}
            className="w-4 h-4"
          />
          <span className="text-xs text-muted-foreground">{t("extend")}</span>
        </label>

        {status === "error" && <p className="text-[10px] text-destructive">{t("error")}</p>}

        <button
          type="button"
          disabled={!canApply || status === "applying"}
          onClick={() => void apply()}
          className="w-full px-2 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {status === "applying" ? t("applying") : t("apply")}
        </button>
      </div>
    </div>
  );
}

export function PropertiesPanel({
  selectedElements,
  onElementUpdate,
  pageInfo,
  zoom,
  allFieldNames = [],
  userLayers = [],
  onAssignElementToLayer,
  documentFonts = [],
  pageNumber,
  getDocumentBytes,
  onPageBoxesApplied,
  onApplyTextStyle,
  onReplaceImage,
}: PropertiesPanelProps) {
  const t = useTranslations("editor.properties");

  // Map face name → option, so a selection on a document font can also write
  // the run's `originalFont` (the renderer's variant-aware resolution key).
  const documentFontByFace = new Map(
    documentFonts.map((font) => [font.faceName, font] as const),
  );

  const selectedElement = selectedElements.length === 1 ? selectedElements[0] : null;
  const hasMultipleSelection = selectedElements.length > 1;

  // Calques utilisateur triés par `order` décroissant (cohérent avec le panneau
  // calques) pour le menu déroulant "Layer" de la section commune.
  const sortedUserLayers = [...userLayers].sort((a, b) => b.order - a.order);

  // Valeur courante du sélecteur de police pour un run texte. Quand le run
  // porte un `originalFont` correspondant à une police document chargée, on
  // sélectionne sa face réelle ; sinon on retombe sur la famille CSS stockée
  // dans `fontFamily` (police système) — défaut "Arial".
  const selectedFontValue = (element: TextElement): string => {
    const orig = element.style?.originalFont;
    if (orig) {
      const docMatch = documentFonts.find((f) => f.originalName === orig);
      if (docMatch) return docMatch.faceName;
    }
    const family = element.style?.fontFamily;
    if (family && documentFontByFace.has(family)) return family;
    return family || "Arial";
  };

  // Applique le choix du sélecteur au run. Une police document écrit la face
  // réelle dans `fontFamily` ET le nom d'origine dans `originalFont` (clé de
  // résolution variant-aware du renderer). Une police système écrit la famille
  // CSS et efface `originalFont` (sinon le renderer continuerait de résoudre la
  // police embarquée précédente).
  const applyFontSelection = (element: TextElement, value: string): void => {
    const docFont = value.startsWith(DOC_FONT_FACE_PREFIX)
      ? documentFontByFace.get(value)
      : undefined;
    const style = docFont
      ? { ...element.style, fontFamily: docFont.faceName, originalFont: docFont.originalName }
      : { ...element.style, fontFamily: value, originalFont: null };
    onElementUpdate?.(element.elementId, { style } as Partial<TextElement>);
  };

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
          value={selectedFontValue(element)}
          onChange={(e) => applyFontSelection(element, e.target.value)}
          className="w-full h-8 px-2 rounded border bg-background text-sm"
        >
          {/* Polices du document (faces réelles) — en tête pour un rendu 1:1. */}
          {documentFonts.length > 0 && (
            <optgroup label={t("text.documentFonts")}>
              {documentFonts.map((font) => (
                <option key={font.faceName} value={font.faceName}>
                  {font.label}
                </option>
              ))}
            </optgroup>
          )}
          {/* Polices système — repli quand aucune police document ne convient. */}
          <optgroup label={t("text.systemFonts")}>
            {SYSTEM_FONT_FAMILIES.map((family) => (
              <option key={family} value={family}>
                {family}
              </option>
            ))}
          </optgroup>
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

      {/* Word-like in-place restyle of the EXISTING parsed run (vectorial,
          `setTextRunStyle`) — applies the element's CURRENT style (the values
          edited above) to the whole run. Shown only for a parsed run (engine
          `index >= 0`) when the page number + handler are wired. */}
      {onApplyTextStyle &&
        pageNumber != null &&
        typeof element.index === "number" &&
        element.index >= 0 &&
        (element.content?.length ?? 0) > 0 && (
          <div className="pt-2 border-t space-y-1">
            <button
              type="button"
              onClick={() => {
                // Re-narrow inside the closure (the JSX guard above doesn't
                // flow into this callback's types).
                if (pageNumber == null) return;
                const runIndex = element.index;
                if (typeof runIndex !== "number" || runIndex < 0) return;
                const end = element.content?.length ?? 0;
                if (end === 0) return;
                const style = element.style;
                const span: TextRunStyleSpan = { start: 0, end };
                const color = hexToRgb01(style?.color);
                if (color) span.color = color;
                if (typeof style?.fontSize === "number") span.sizePt = style.fontSize;
                if (style?.fontWeight === "bold") span.bold = true;
                if (style?.fontStyle === "italic") span.italic = true;
                if (style?.underline) span.underline = true;
                if (style?.strikethrough) span.strike = true;
                onApplyTextStyle({ page: pageNumber, index: runIndex, spans: [span] });
              }}
              className="w-full px-2 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {t("text.applyRunStyle")}
            </button>
            <p className="text-[10px] leading-snug text-muted-foreground">
              {t("text.applyRunStyleHint")}
            </p>
          </div>
        )}
    </div>
  );

  // Render pour élément annotation (highlight, underline, note, comment, …)
  const renderAnnotationProperties = (element: AnnotationElement) => (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-muted-foreground block mb-1">
          {t("annotation.type")}
        </label>
        <div className="text-sm capitalize">{element.annotationType}</div>
      </div>
      <div>
        <label className="text-xs text-muted-foreground block mb-1">
          {t("annotation.content")}
        </label>
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
        <label className="text-xs text-muted-foreground block mb-1">
          {t("annotation.color")}
        </label>
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
        <label className="text-xs text-muted-foreground block mb-1">
          {t("annotation.opacity")}
        </label>
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
  const renderImageProperties = (element: ImageElement) => {
    // "Replace image" is offered only for a PARSED image (one carrying a real
    // engine unified element `index >= 0`) when the bake plumbing is wired
    // (onReplaceImage + the active pageNumber). A freshly-added image has no
    // index yet → the in-place swap can't target it, so the action is hidden.
    const imgIndex = element.index;
    const canReplace =
      !!onReplaceImage &&
      typeof pageNumber === "number" &&
      typeof imgIndex === "number" &&
      imgIndex >= 0;
    return (
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

        {canReplace ? (
          <label className="inline-flex w-full items-center justify-center gap-2 cursor-pointer rounded border px-3 py-1.5 text-sm hover:bg-accent">
            <ImageUp size={14} />
            <span>{t("image.replace")}</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/tiff"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file && imgIndex !== undefined) {
                  onReplaceImage?.({ index: imgIndex, file });
                }
                // Reset so picking the SAME file again re-fires onChange.
                e.target.value = "";
              }}
            />
          </label>
        ) : null}
      </div>
    );
  };

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
              {selectedElement.type === "shape" && (
                <ShapeStyleProperties
                  key={selectedElement.elementId}
                  element={selectedElement as ShapeElement}
                  onElementUpdate={onElementUpdate}
                />
              )}
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

            {/* Couleur prépresse (#86) + Dégradé (#85) — bake une couleur prête
                pour l'impression / un dégradé sur la zone de l'élément
                sélectionné. Affichées uniquement quand l'appelant fournit le
                numéro de page actif ET un accès aux octets du document (même
                gating que la section "Boîtes de page" ; le résultat est adopté
                via le même canal `onPageBoxesApplied`). */}
            {pageNumber != null && getDocumentBytes && (
              <>
                <PrepressColorSection
                  key={`color-${selectedElement.elementId}`}
                  element={selectedElement}
                  pageInfo={pageInfo}
                  pageNumber={pageNumber}
                  getDocumentBytes={getDocumentBytes}
                  onApplied={onPageBoxesApplied}
                />
                <GradientSection
                  key={`gradient-${selectedElement.elementId}`}
                  element={selectedElement}
                  pageInfo={pageInfo}
                  pageNumber={pageNumber}
                  getDocumentBytes={getDocumentBytes}
                  onApplied={onPageBoxesApplied}
                />
              </>
            )}
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

        {/* Boîtes de page (Media/Crop/Bleed/Trim/Art) — affichée uniquement quand
            l'appelant fournit le numéro de page actif ET un accès aux octets du
            document (sinon masquée, comportement historique préservé). */}
        {pageNumber != null && getDocumentBytes && (
          <PageBoxesSection
            pageNumber={pageNumber}
            getDocumentBytes={getDocumentBytes}
            onPageBoxesApplied={onPageBoxesApplied}
          />
        )}
      </div>
    </div>
  );
}
