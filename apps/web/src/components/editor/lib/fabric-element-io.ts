"use client";

/**
 * fabric-element-io.ts
 *
 * Pure helpers used by the editor (`editor-canvas.tsx`, mounted both standalone
 * and embedded in the continuous Word-like view):
 *
 *   - fabricObjectToElement : serialise a Fabric object back to an Element for
 *     persistence (the inverse of the overlay renderer).
 *   - sampleBackgroundUnder : sample the rasterised PDF background colour under
 *     a text object (to mask the original glyph during inline edit).
 *   - parseColorToRgb       : CSS colour → [r,g,b] tuple.
 *
 * Extracted verbatim from editor-canvas.tsx so the single-page editor and the
 * continuous editor produce byte-identical results — one implementation, no
 * drift. None of these depend on React/component state.
 */

import type { FabricObject } from "fabric";
import type {
  Element,
  ShapeType,
  FieldType,
  AnnotationElement,
  FormFieldElement,
  TextElement,
  TextStyle,
} from "@giga-pdf/types";
// Shared run<->Fabric-styles mapping (single source of truth with
// render-elements.ts) so character-level styling round-trips identically.
import { fabricStylesToRuns, type FabricStylesMap } from "./text-runs";

/** Fabric object carrying our custom `.data` metadata. */
export interface FabricObjectWithData extends FabricObject {
  data?: { elementId?: string; [key: string]: unknown };
}

/** Génère un ID unique. */
export function generateId(): string {
  return `el_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Le poids de police peut arriver en mot-clé CSS (bold/normal) ou en
// nombre CSS (400/600/700…). Normalise les deux conventions : toute valeur
// numérique ≥ 600 compte comme bold (semi-bold et au-delà).
export function isBoldFontWeight(weight: string | number | undefined): boolean {
  if (typeof weight === "number") return weight >= 600;
  if (!weight) return false;
  if (weight === "bold" || weight === "bolder") return true;
  const numeric = Number.parseInt(weight, 10);
  return Number.isFinite(numeric) && numeric >= 600;
}

/**
 * Lit la VALEUR courante d'un champ de formulaire éditable depuis l'objet
 * Fabric qui le matérialise, pour que la saisie utilisateur soit persistée :
 *
 *   - text / dropdown (saisie libre) : le texte tapé dans l'IText (`obj.text`),
 *     en ignorant le placeholder affiché quand le champ est vide.
 *   - checkbox / radio : l'état coché stocké sur `data.fieldChecked` (togglé au
 *     clic), normalisé selon le type (`boolean` pour checkbox, valeur d'option
 *     ou "" pour radio).
 *   - listbox / signature / button : valeur d'origine inchangée (édités
 *     ailleurs, pas au clavier sur le canvas).
 *
 * Le `value` du FormFieldElement est typé `string | boolean | string[]`.
 */
export function readFormFieldValue(
  obj: FabricObjectWithData,
  field: FormFieldElement,
): FormFieldElement["value"] {
  const fieldType = field.fieldType;

  if (fieldType === "checkbox") {
    return obj.data?.fieldChecked === true;
  }

  if (fieldType === "radio") {
    // A checked radio carries its export value (the selected option); unchecked
    // radios serialise back to "" so the group has at most one value.
    if (obj.data?.fieldChecked === true) {
      const exportValue = obj.data?.fieldExportValue;
      if (typeof exportValue === "string" && exportValue.length > 0) {
        return exportValue;
      }
      const firstOption = field.options?.[0];
      return typeof firstOption === "string" ? firstOption : "";
    }
    return "";
  }

  if (fieldType === "text" || fieldType === "dropdown") {
    const textObj = obj as FabricObjectWithData & { text?: string };
    const typed = textObj.text ?? "";
    // The IText shows the placeholder text when the field is empty; never
    // persist the placeholder as a real value.
    const placeholder = obj.data?.fieldPlaceholder;
    if (typeof placeholder === "string" && typed === placeholder) {
      return "";
    }
    return typed;
  }

  // listbox / signature / button — keep the stored value untouched.
  return field.value;
}

/**
 * Convertit un objet Fabric en Element pour la persistance. Inverse exact du
 * renderer d'overlay (`render-elements.ts`). Retourne null pour un type inconnu.
 */
export function fabricObjectToElement(
  obj: FabricObjectWithData,
): Element | null {
  const elementId = obj.data?.elementId || generateId();
  const scaleY = obj.scaleY ?? 1;
  // A user resize bakes obj.scaleX into bounds.width here. There is no longer a
  // cosmetic anti-overflow scaleX to neutralise (the renderer no longer squashes
  // text to fit — see render-elements.ts), so scaleX is taken verbatim.
  const scaleX = obj.scaleX ?? 1;

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

  // Form fields FIRST — before the i-text/text branch. An editable form field
  // is rendered as an IText (text fields) or a marked Rect (checkbox/radio), so
  // `typeName` may be "i-text". Without this early guard, a text-field IText
  // would fall into the text branch below and be serialised as free `type:"text"`
  // — destroying its field identity (fieldType/fieldName/options) and breaking
  // the AcroForm reconstruction at bake time. `data.formFieldElement` is the
  // canonical full element (stashed at creation AND by renderElementsOverlay),
  // re-merged with the object's live bounds/transform so move/resize is honoured
  // without losing business props. The current VALUE is re-read from the live
  // Fabric object (typed text for text fields, checked state for check/radio)
  // so user input is actually persisted.
  const storedFormFieldEarly = obj.data?.formFieldElement as
    | FormFieldElement
    | undefined;
  if (storedFormFieldEarly && storedFormFieldEarly.type === "form_field") {
    const liveValue = readFormFieldValue(obj, storedFormFieldEarly);
    return {
      ...storedFormFieldEarly,
      ...baseElement,
      type: "form_field" as const,
      fieldType: storedFormFieldEarly.fieldType,
      value: liveValue,
    };
  }

  if (typeName === "i-text" || typeName === "text" || typeName === "textbox") {
    const textObj = obj as FabricObjectWithData & {
      text?: string;
      fontSize?: number;
      fontFamily?: string;
      fontWeight?: string | number;
      fontStyle?: string;
      fill?: string;
      textAlign?: string;
      lineHeight?: number;
      charSpacing?: number;
      originY?: string;
    };
    const textObjWithStyles = textObj as typeof textObj & {
      underline?: boolean;
      linethrough?: boolean;
      textBackgroundColor?: string;
      styles?: FabricStylesMap;
    };
    const data = (obj as FabricObjectWithData).data;
    const fontSize = textObj.fontSize || 16;
    // Word-like partial formatting: read Fabric's native per-character styles
    // map back into our flat, coalesced model runs. `undefined` when the text
    // is uniformly styled — the `runs` field is then omitted (legacy shape).
    const styleRuns = fabricStylesToRuns(
      textObj.text || "",
      textObjWithStyles.styles,
    );

    // Inverse of the renderer transform: Fabric IText was created with
    //   top = bounds.y + fontSize + descenderOffset, originY = 'bottom'
    // so the PDF baseline = top - descenderOffset = bounds.y + fontSize.
    // To recover the original bounds.y (= top of glyph in browser coords)
    // we therefore subtract (fontSize + descenderOffset) from obj.top.
    const isOriginYBottom = textObj.originY === "bottom";
    const descenderOffset = isOriginYBottom ? fontSize * 0.22 : 0;
    const topOfGlyphY = (obj.top || 0) - descenderOffset - fontSize;

    // Preserve the parser-extracted PDF font name so the bake side
    // (apply-elements -> updateText -> font lookup) can re-use the
    // SAME font as the original glyph instead of falling back to a
    // generic Arial. The Fabric fontFamily ("gigapdf-…") is only valid
    // in the browser FontFace registry, never on the server-side
    // pdf-engine, so we must hand back originalFont separately.
    const originalFont = (data?.originalFont as string | null) ?? null;
    const fontFamilyForRoundTrip =
      originalFont || textObj.fontFamily || "Arial";

    return {
      ...baseElement,
      // Top-left corner of the glyph bbox in browser coords. height = fontSize
      // covers approximately ascender+descender — close enough to mask the
      // glyph cleanly without bleeding into the line above/below.
      bounds: {
        x: obj.left || 0,
        y: topOfGlyphY,
        width: (obj.width || 100) * scaleX,
        height: fontSize,
      },
      type: "text" as const,
      content: textObj.text || "",
      // Character-level style runs (Word-like partial formatting). Omitted
      // (spread of {}) when the text is uniformly styled, so the serialised
      // shape is byte-identical to the legacy one for unstyled runs.
      ...(styleRuns ? { runs: styleRuns } : {}),
      style: {
        fontFamily: fontFamilyForRoundTrip,
        fontSize,
        // Numeric CSS weights (600/700) must round-trip as "bold" too —
        // applyTextFormat and parsed PDFs can both produce them.
        fontWeight: isBoldFontWeight(textObj.fontWeight) ? "bold" : "normal",
        fontStyle: textObj.fontStyle === "italic" ? "italic" : "normal",
        color: (textObj.fill as string) || "#000000",
        opacity: obj.opacity ?? 1,
        textAlign:
          (textObj.textAlign as "left" | "center" | "right" | "justify") ||
          "left",
        lineHeight: textObj.lineHeight || 1.2,
        letterSpacing: textObj.charSpacing || 0,
        writingMode: "horizontal-tb" as const,
        underline: textObjWithStyles.underline || false,
        strikethrough: textObjWithStyles.linethrough || false,
        backgroundColor: textObjWithStyles.textBackgroundColor || null,
        verticalAlign: "baseline" as const,
        originalFont,
      },
      ocrConfidence: null,
      linkUrl: (data?.linkUrl as string) || null,
      linkPage: (data?.linkPage as number) || null,
      // Carry the ORIGINAL engine run index (stamped onto data by the
      // renderer for parsed runs) so an edited text run keeps its in-place
      // identity: apply-operations uses it to fire replaceText/moveElement
      // instead of redact+add. Never regenerated — newly-added text has no
      // index in data, so this stays undefined and falls back to add.
      index: data?.index as number | undefined,
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
    const rawSrc = imgObj.getSrc?.() ?? "";
    // Sniff the actual mimetype from the data URL prefix so the backend
    // can pick the right embed path (pdf-lib only handles PNG and JPEG;
    // anything else must be flagged here, not silently mislabelled "png"
    // and re-detected by header bytes downstream).
    const mimeMatch = rawSrc.match(
      /^data:image\/(png|jpe?g|webp|gif|avif);base64,/i,
    );
    const detected = mimeMatch?.[1]?.toLowerCase().replace("jpeg", "jpg");
    const originalFormat: string = detected ?? "png";
    return {
      ...baseElement,
      type: "image" as const,
      source: {
        type: "embedded" as const,
        dataUrl: rawSrc,
        originalFormat,
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
      // Carry the ORIGINAL engine unified element index (stamped on data by the
      // renderer for parsed images) so a moved/resized image keeps its in-place
      // identity: apply-operations fires transformElement/removeElement instead
      // of redact+add. Newly-added images have no index → stays undefined → add.
      index: obj.data?.index as number | undefined,
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
    | "highlight"
    | "underline"
    | "strikeout"
    | "strikethrough"
    | "squiggly"
    | "note"
    | "comment"
    | "freetext"
    | "stamp"
    | "line"
    | "arrow"
    | "link";
  if (dataAnnotationType) {
    const isLineLike =
      dataAnnotationType === "line" || dataAnnotationType === "arrow";
    return {
      ...baseElement,
      type: "annotation" as const,
      annotationType: dataAnnotationType,
      content: (obj.data?.content as string) ?? "",
      style: {
        color: (obj.stroke as string) || (obj.fill as string) || "#ffff00",
        opacity: obj.opacity ?? 1,
        // strokeWidth drives the line/arrow thickness in the PDF annotation.
        ...(isLineLike
          ? {
              strokeWidth:
                (obj.data?.strokeWidth as number) ??
                (obj.strokeWidth as number) ??
                2,
            }
          : {}),
      },
      linkDestination:
        (obj.data?.linkDestination as AnnotationElement["linkDestination"]) ??
        null,
      popup: null,
      author: (obj.data?.author as string) ?? undefined,
      // For line/arrow, explicit endpoints when present; otherwise the
      // backend renderer falls back to the diagonal of `bounds`.
      ...(isLineLike && obj.data?.linePoints
        ? { linePoints: obj.data.linePoints as AnnotationElement["linePoints"] }
        : {}),
      // quads is omitted — renderer falls back to bounds when undefined
    } as AnnotationElement;
  }

  // Form fields carrying `data.formFieldElement` are already handled by the
  // early guard at the top of this function (before the i-text branch), so an
  // editable text-field IText is serialised as a field, never as free text.

  if (["rect", "circle", "triangle", "ellipse", "line"].includes(typeName)) {
    let shapeTypeResult: ShapeType = "rectangle";
    if (typeName === "circle") shapeTypeResult = "circle";
    if (typeName === "ellipse") shapeTypeResult = "ellipse";
    if (typeName === "line") shapeTypeResult = "line";
    if (typeName === "triangle") shapeTypeResult = "triangle";

    // Parsed shapes are TRANSPARENT hit-targets in view (the raster shows the
    // real shape) and only reveal their real fill/stroke while selected. So
    // prefer the originals stashed on `data.*` — `obj.fill`/`obj.stroke` are
    // "transparent" whenever the shape is currently masked (not selected),
    // which would otherwise bake "transparent" into the PDF on save/move.
    // Newly-drawn shapes have no `data.original*` → fall back to the live value.
    const liveFill = (obj.fill as string) || null;
    const liveStroke = (obj.stroke as string) || null;
    const isMasked = (v: string | null) => v === null || v === "transparent";
    const stashedFill = obj.data?.originalFill;
    const stashedStroke = obj.data?.originalStroke;
    const stashedStrokeWidth = obj.data?.originalStrokeWidth;
    const resolvedFill =
      isMasked(liveFill) && typeof stashedFill === "string"
        ? stashedFill
        : liveFill;
    const resolvedStroke =
      isMasked(liveStroke) && typeof stashedStroke === "string"
        ? stashedStroke
        : liveStroke;
    const resolvedStrokeWidth =
      (!obj.strokeWidth || obj.strokeWidth === 0) &&
      typeof stashedStrokeWidth === "number" &&
      stashedStrokeWidth > 0
        ? stashedStrokeWidth
        : obj.strokeWidth || 1;

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
        fillColor: resolvedFill,
        fillOpacity: obj.opacity ?? 1,
        strokeColor: resolvedStroke,
        strokeWidth: resolvedStrokeWidth,
        strokeOpacity: 1,
        strokeDashArray: [],
      },
      // Carry the ORIGINAL engine unified element index (stamped on data by the
      // renderer for parsed shapes) so a moved/resized shape keeps its in-place
      // identity: apply-operations fires transformElement/removeElement instead
      // of redact+add. Newly-added shapes have no index → stays undefined → add.
      index: obj.data?.index as number | undefined,
    };
  }

  // Fallback legacy : Groups créés avant l'introduction de
  // data.formFieldElement (dont la zone de signature du draw tool).
  if (obj.data?.formFieldType) {
    const ft = obj.data.formFieldType as FieldType;
    const isBooleanField = ft === "checkbox";
    const isRadioField = ft === "radio";
    const isListField = ft === "dropdown" || ft === "listbox";
    return {
      ...baseElement,
      type: "form_field" as const,
      fieldType: ft,
      fieldName: (obj.data.fieldName as string) ?? `${ft}_${Date.now()}`,
      value: isBooleanField
        ? false
        : isRadioField
          ? ((obj.data.exportValue as string) ?? "")
          : isListField
            ? []
            : "",
      defaultValue: isBooleanField ? false : isListField ? [] : "",
      options:
        isListField || isRadioField
          ? ((obj.data.options as string[]) ?? (isListField ? [] : null))
          : null,
      properties: {
        required: Boolean(obj.data.required),
        readOnly: false,
        maxLength: null,
        multiline: Boolean(obj.data.multiline),
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
      placeholder: (obj.data.placeholder as string) || null,
      tooltip: null,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Paragraph (multi-line Textbox) decomposition for save
// ---------------------------------------------------------------------------

/** A source run snapshot stashed on a paragraph Textbox's `data.paragraphRuns`. */
interface StashedParagraphRun {
  elementId: string;
  index?: number;
  bounds: { x: number; y: number; width: number; height: number };
  content: string;
}

/**
 * Minimal Fabric text shape we read style off when decomposing a Textbox. `fill`
 * is NOT redeclared (it is inherited from FabricObject as `string | TFiller |
 * null`); we read it through a cast at the use site, like fabricObjectToElement.
 */
interface FabricTextLike extends FabricObjectWithData {
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: string | number;
  fontStyle?: string;
  textAlign?: string;
  lineHeight?: number;
  charSpacing?: number;
  underline?: boolean;
  linethrough?: boolean;
}

/**
 * Build a single-line TextElement for one decomposed paragraph line. Style is
 * read from the LIVE Textbox (so a colour/size/weight change made on the block
 * applies to every line); `originalFont`, `elementId`, engine `index` and the
 * source `bounds` are inherited from the source run so the apply pipeline keeps
 * the run's in-place identity (`replaceText`). `dx`/`dy` translate the run if the
 * whole block was moved. A line with no source run (paragraph grew) gets a fresh
 * id, no index (→ add) and a synthesised bounds stacked under the previous line.
 */
function lineToTextElement(
  tb: FabricTextLike,
  content: string,
  source: StashedParagraphRun | null,
  fallbackBounds: { x: number; y: number; width: number; height: number },
  dx: number,
  dy: number,
): TextElement {
  const fontSize = tb.fontSize || source?.bounds.height || 12;
  const originalFont = (tb.data?.originalFont as string | null) ?? null;
  const fontFamilyForRoundTrip = originalFont || tb.fontFamily || "Arial";
  const bounds = source
    ? {
        x: source.bounds.x + dx,
        y: source.bounds.y + dy,
        width: source.bounds.width,
        height: fontSize,
      }
    : { ...fallbackBounds };

  const style: TextStyle = {
    fontFamily: fontFamilyForRoundTrip,
    fontSize,
    fontWeight: isBoldFontWeight(tb.fontWeight) ? "bold" : "normal",
    fontStyle: tb.fontStyle === "italic" ? "italic" : "normal",
    color: (tb.fill as string) || "#000000",
    opacity: tb.opacity ?? 1,
    textAlign:
      (tb.textAlign as "left" | "center" | "right" | "justify") || "left",
    lineHeight: tb.lineHeight || 1.2,
    letterSpacing: tb.charSpacing || 0,
    writingMode: "horizontal-tb",
    underline: tb.underline || false,
    strikethrough: tb.linethrough || false,
    backgroundColor: null,
    verticalAlign: "baseline",
    originalFont,
  };

  return {
    elementId: source?.elementId || generateId(),
    type: "text",
    bounds,
    transform: {
      rotation: tb.angle || 0,
      scaleX: 1,
      scaleY: 1,
      skewX: tb.skewX || 0,
      skewY: tb.skewY || 0,
    },
    layerId: null,
    locked: !tb.selectable,
    visible: tb.visible ?? true,
    content,
    style,
    ocrConfidence: null,
    linkUrl: null,
    linkPage: null,
    // Source run index → lossless replaceText; undefined for added lines → add.
    ...(source?.index !== undefined ? { index: source.index } : {}),
  };
}

/**
 * Serialise a Fabric object to the Element(s) to persist. The INVERSE of the
 * overlay renderer, but able to emit MORE THAN ONE element so a coalesced
 * paragraph (multi-line {@link import("../render-elements").ParagraphGroup}
 * Textbox) is DECOMPOSED back into its individual single-line runs on save.
 *
 * Why decompose: the bake pipeline (`addText`/`replaceText`) writes ONE run per
 * call and gives no line-break semantics to a "\n" inside `content`. Persisting
 * a paragraph as one multi-line TextElement would therefore drop every line but
 * the first. We instead map the edited lines back onto the source runs:
 *
 *   - line i ↔ source run i  → run keeps its `index`/`elementId`/`bounds`
 *     (in-place `replaceText`), with the current line text + the live block
 *     style, translated by the block's move delta;
 *   - fewer lines than runs (lines deleted) → surplus runs serialise with
 *     `content:""` so `replaceText` erases them;
 *   - more lines than runs (lines added)    → extra lines become NEW runs
 *     (no `index` → add), stacked under the last line at the block's line step.
 *
 * Any non-paragraph object returns a single-element array (or empty for an
 * unknown type), so existing 1:1 callers keep their exact behaviour.
 */
export function fabricObjectToElements(obj: FabricObjectWithData): Element[] {
  const data = obj.data;
  const typeName = (obj as FabricObject & { type?: string }).type ?? "";
  const isTextual =
    typeName === "i-text" || typeName === "text" || typeName === "textbox";
  const runs = data?.paragraphRuns as StashedParagraphRun[] | undefined;

  // Not a coalesced paragraph → keep the canonical 1:1 behaviour.
  if (
    data?.isParagraph !== true ||
    !isTextual ||
    !Array.isArray(runs) ||
    runs.length === 0
  ) {
    const single = fabricObjectToElement(obj);
    return single ? [single] : [];
  }

  const tb = obj as FabricTextLike;
  const editedLines = (tb.text ?? "").split("\n");

  // Block move delta: source block top-left vs the Textbox's current top-left.
  const originLeft = Math.min(...runs.map((r) => r.bounds.x));
  const originTop = Math.min(...runs.map((r) => r.bounds.y));
  const dx = (obj.left ?? originLeft) - originLeft;
  const dy = (obj.top ?? originTop) - originTop;

  const fontSize = tb.fontSize || runs[0]!.bounds.height || 12;
  const lineHeight = tb.lineHeight && tb.lineHeight > 0 ? tb.lineHeight : 1.2;
  const lineStep = fontSize * lineHeight;
  const blockWidth = (tb.width || runs[0]!.bounds.width) * (tb.scaleX ?? 1);

  const out: Element[] = [];
  const lastSource = runs[runs.length - 1]!;

  // 1) Every edited line maps onto its source run (or becomes a new run).
  for (let i = 0; i < editedLines.length; i++) {
    const source = i < runs.length ? runs[i]! : null;
    // New line (paragraph grew): stack it under the last source line.
    const fallbackBounds = {
      x: lastSource.bounds.x + dx,
      y: lastSource.bounds.y + dy + (i - (runs.length - 1)) * lineStep,
      width: blockWidth,
      height: fontSize,
    };
    out.push(
      lineToTextElement(tb, editedLines[i]!, source, fallbackBounds, dx, dy),
    );
  }

  // 2) Lines were deleted: erase the surplus source runs (replaceText "").
  for (let i = editedLines.length; i < runs.length; i++) {
    const source = runs[i]!;
    const fallbackBounds = {
      x: source.bounds.x + dx,
      y: source.bounds.y + dy,
      width: source.bounds.width,
      height: fontSize,
    };
    out.push(lineToTextElement(tb, "", source, fallbackBounds, dx, dy));
  }

  return out;
}

/**
 * Échantillonne la couleur de fond (raster PDF) sous un objet texte, pour
 * masquer le glyphe original pendant l'édition inline. Retourne null si le
 * canvas est tainted (CORS) ou si aucun pixel exploitable.
 */
export function sampleBackgroundUnder(
  obj: FabricObject,
  textRgb?: [number, number, number] | null,
): string | null {
  const o = obj as unknown as {
    left?: number;
    top?: number;
    width?: number;
    height?: number;
    originY?: string;
    canvas?: { lowerCanvasEl?: HTMLCanvasElement; getZoom?: () => number };
  };
  const lower = o.canvas?.lowerCanvasEl;
  if (!lower) return null;
  const ctx = lower.getContext("2d");
  if (!ctx) return null;
  const zoom = o.canvas?.getZoom?.() ?? 1;
  const left = o.left ?? 0;
  const top = o.top ?? 0;
  const width = o.width ?? 0;
  const height = o.height ?? 0;
  // For text we use originY='bottom' (top = baseline). Translate to a
  // top-left bbox so the probes land in the right places.
  const topLeftY = o.originY === "bottom" ? top - height : top;

  // Probe a fan of points spread across:
  //   - the inside of the bbox (between glyphs we mostly hit the background)
  //   - the immediate edge (1-2 px out of the glyph but still inside any
  //     thin coloured band, e.g. the red "Somme à payer" banner)
  //   - the wider edge (4-6 px out, captures larger uniform areas)
  // We then drop pixels that match the text colour (so the glyph itself
  // doesn't contaminate the result) and pick the dominant remaining shade.
  const probes: Array<[number, number]> = [];
  // Inside bbox sweep
  for (let f = 0.1; f <= 0.9; f += 0.1) {
    probes.push([left + width * f, topLeftY + height * 0.5]);
  }
  // Top / bottom edges (just inside, then 2px and 5px outside)
  for (const dy of [-5, -2, 1, height - 1, height + 2, height + 5]) {
    probes.push([left + width * 0.5, topLeftY + dy]);
    probes.push([left + width * 0.25, topLeftY + dy]);
    probes.push([left + width * 0.75, topLeftY + dy]);
  }
  // Left / right edges
  for (const dx of [-5, -2, width + 2, width + 5]) {
    probes.push([left + dx, topLeftY + height * 0.5]);
  }

  const counts = new Map<string, number>();
  for (const [cx, cy] of probes) {
    const px = Math.round(cx * zoom);
    const py = Math.round(cy * zoom);
    if (px < 0 || py < 0 || px >= lower.width || py >= lower.height) continue;
    let pixel: Uint8ClampedArray;
    try {
      pixel = ctx.getImageData(px, py, 1, 1).data;
    } catch {
      return null; // tainted canvas (CORS) — cannot read
    }
    const r = pixel[0]!;
    const g = pixel[1]!;
    const b = pixel[2]!;
    // Skip pixels that match the text colour within ±20 — they are
    // glyph fragments, not background.
    if (textRgb) {
      const dr = Math.abs(r - textRgb[0]);
      const dg = Math.abs(g - textRgb[1]);
      const db = Math.abs(b - textRgb[2]);
      if (dr < 20 && dg < 20 && db < 20) continue;
    }
    // Quantize to 8-step buckets so anti-aliasing fringes vote together.
    // Math.round(255/8)*8 = 256 — clamp back into [0, 255] so the rgb()
    // string we forward to apply-elements stays in pdf-lib's valid range
    // (it rejects red/green/blue > 1.0 with a misleading 500).
    const qr = Math.min(255, Math.round(r / 8) * 8);
    const qg = Math.min(255, Math.round(g / 8) * 8);
    const qb = Math.min(255, Math.round(b / 8) * 8);
    const key = `${qr},${qg},${qb}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  const [winner] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]!;
  const [r, g, b] = winner.split(",").map((n) => Number(n));
  return `rgb(${r}, ${g}, ${b})`;
}

// Parse a CSS colour string like '#ffffff' or 'rgb(255, 0, 0)' into rgb tuple.
// Returns null for unsupported formats — caller skips text-colour filtering.
export function parseColorToRgb(
  color: string | undefined | null,
): [number, number, number] | null {
  if (!color) return null;
  const c = color.trim().toLowerCase();
  if (c.startsWith("#")) {
    const hex = c.slice(1);
    if (hex.length === 3) {
      return [
        parseInt(hex[0]! + hex[0]!, 16),
        parseInt(hex[1]! + hex[1]!, 16),
        parseInt(hex[2]! + hex[2]!, 16),
      ];
    }
    if (hex.length === 6) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
      ];
    }
    return null;
  }
  const m = c.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
}
