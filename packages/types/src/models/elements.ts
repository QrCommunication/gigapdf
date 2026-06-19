/**
 * Element models matching backend Pydantic schemas.
 * All coordinates use web-standard system (origin top-left, Y increases downward).
 * Values are in PDF points (1 point = 1/72 inch).
 */

import type { UUID, Bounds, Point, Transform } from "./common";

// Element types
export type ElementType = "text" | "image" | "shape" | "annotation" | "form_field";

// Base element interface
export interface ElementBase {
  elementId: UUID;
  type: ElementType;
  bounds: Bounds;
  transform: Transform;
  layerId: UUID | null;
  locked: boolean;
  visible: boolean;
}

// ============= Text Element =============

export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight: "normal" | "bold";
  fontStyle: "normal" | "italic";
  color: string;
  opacity: number;
  textAlign: "left" | "center" | "right" | "justify";
  lineHeight: number;
  letterSpacing: number;
  writingMode: "horizontal-tb" | "vertical-rl";
  /**
   * Bidirectional reading direction of the run. Surfaced by the engine
   * (`GigaPdfDoc.textElements().direction`) from the script of the text so the
   * canvas (Fabric `direction`) and the layer properties panel (`dir`) edit
   * right-to-left scripts (Arabic, Hebrew, …) correctly. Absent ⇒ `"ltr"`.
   */
  direction?: "ltr" | "rtl";
  // Additional text decorations
  underline: boolean;
  strikethrough: boolean;
  backgroundColor: string | null;
  verticalAlign: "baseline" | "superscript" | "subscript";
  // Original font info for 1:1 rendering
  originalFont: string | null;
}

export interface TextElement extends ElementBase {
  type: "text";
  content: string;
  style: TextStyle;
  ocrConfidence: number | null;
  // Link support for clickable text
  linkUrl: string | null;
  linkPage: number | null;
  /**
   * Engine text-run index (from `GigaPdfDoc.textElements().index`) enabling
   * true in-place editing via `replaceText` / `moveElement` / `removeElement`.
   *
   * Present only for runs surfaced by the per-run extractor
   * (`extractTextElementsByPage`). Absent — or `< 0` (a sentinel the engine
   * uses for FORM-XObject text it cannot edit in place) — means the run is not
   * directly editable in place; the apply pipeline falls back to redact + add.
   * Coalesced text blocks span multiple runs and therefore carry no single
   * index.
   */
  index?: number;
}

// ============= Image Element =============

export interface ImageSource {
  type: "embedded" | "external";
  dataUrl: string;
  originalFormat: string;
  originalDimensions: { width: number; height: number };
}

export interface ImageStyle {
  opacity: number;
  blendMode: "normal" | "multiply" | "screen" | "overlay" | "darken" | "lighten";
  /**
   * Sampled background colour (hex, e.g. "#ffffff") under the image, captured
   * by the client when the image is placed. Used by the renderer to erase the
   * old image area without leaving a white patch on coloured backgrounds.
   */
  backgroundColor?: string;
}

export interface ImageCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageElement extends ElementBase {
  type: "image";
  source: ImageSource;
  style: ImageStyle;
  crop: ImageCrop | null;
  /**
   * Engine element index (from `GigaPdfDoc.imageElements().index`) for future
   * in-place `moveElement` / `removeElement` support.
   *
   * NOTE: the image extractor does not populate this yet — it derives a
   * synthetic positional `img_{n}` resource name instead, so this field is
   * currently always absent and the apply pipeline always uses the redact + add
   * fallback for images. Reserved so the contract is ready once the extractor
   * plumbs the real `ImageElementInfo.index`.
   */
  index?: number;
}

// ============= Shape Element =============

export type ShapeType = "rectangle" | "circle" | "ellipse" | "triangle" | "line" | "arrow" | "polygon" | "path";

export interface ShapeGeometry {
  points: Point[];
  pathData: string | null;
  cornerRadius: number;
}

export interface ShapeStyle {
  fillColor: string | null;
  fillOpacity: number;
  strokeColor: string | null;
  strokeWidth: number;
  strokeOpacity: number;
  strokeDashArray: number[];
}

export interface ShapeElement extends ElementBase {
  type: "shape";
  shapeType: ShapeType;
  geometry: ShapeGeometry;
  style: ShapeStyle;
  /**
   * Engine element index (from `GigaPdfDoc.vectorPaths().index`) for future
   * in-place `moveElement` / `removeElement` support.
   *
   * NOTE: the drawing extractor does not populate this yet — it assigns a random
   * `elementId` instead, so this field is currently always absent and the apply
   * pipeline always uses the redact + add fallback for shapes. Reserved so the
   * contract is ready once the extractor plumbs the real `VectorPathInfo.index`.
   */
  index?: number;
}

// ============= Annotation Element =============

export type AnnotationType =
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

export interface LinkDestination {
  type: "internal" | "external";
  pageNumber: number | null;
  url: string | null;
  position: Point | null;
}

export interface AnnotationPopup {
  isOpen: boolean;
  bounds: Bounds;
}

export interface AnnotationStyle {
  color: string;
  opacity: number;
  /** Stroke width for line/arrow annotations (PDF points). Defaults to 2. */
  strokeWidth?: number;
}

/**
 * Endpoints of a line/arrow annotation in web coords (Y-down). The arrowhead
 * (for `annotationType === "arrow"`) is drawn at the `(x2, y2)` end.
 */
export interface AnnotationLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Quad for a single highlight/underline/squiggly/strikeout run.
 * Four corners in web coords: top-left, top-right, bottom-left, bottom-right.
 * Maps to /QuadPoints in the PDF spec (§12.5.6.10) after Y-flip.
 */
export interface AnnotationQuad {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  x3: number;
  y3: number;
  x4: number;
  y4: number;
}

export interface AnnotationElement extends ElementBase {
  type: "annotation";
  annotationType: AnnotationType;
  content: string;
  style: AnnotationStyle;
  linkDestination: LinkDestination | null;
  popup: AnnotationPopup | null;
  /**
   * Optional author/title shown in the popup. Surfaces as /T in the PDF dict.
   */
  author?: string;
  /**
   * Runs of selected text for highlight/underline/squiggly/strikeout.
   * When omitted, the renderer falls back to a single quad covering `bounds`.
   */
  quads?: AnnotationQuad[];
  /**
   * Endpoints for line/arrow annotations (web coords). When omitted, the
   * renderer falls back to the diagonal of `bounds`.
   */
  linePoints?: AnnotationLine;
}

// ============= Form Field Element =============

export type FieldType =
  | "text"
  | "checkbox"
  | "radio"
  | "dropdown"
  | "listbox"
  | "signature"
  | "button";

export interface FieldFormat {
  type: "none" | "number" | "date" | "time" | "percentage" | "currency";
  pattern: string | null;
}

export interface FieldProperties {
  required: boolean;
  readOnly: boolean;
  maxLength: number | null;
  multiline: boolean;
  password: boolean;
  comb: boolean;
}

export interface FieldStyle {
  fontFamily: string;
  fontSize: number;
  textColor: string;
  backgroundColor: string | null;
  borderColor: string | null;
  borderWidth: number;
  /** Horizontal alignment of the field text (maps to /Q in AcroForm). */
  textAlign?: "left" | "center" | "right";
}

export interface FormFieldElement extends ElementBase {
  type: "form_field";
  fieldType: FieldType;
  fieldName: string;
  value: string | boolean | string[];
  defaultValue: string | boolean | string[];
  options: string[] | null;
  properties: FieldProperties;
  style: FieldStyle;
  format: FieldFormat;
  /** Hint text shown while the field is empty (editor-side only — not part of AcroForm). */
  placeholder?: string | null;
  /** Tooltip / alternate description (maps to /TU in AcroForm, read by screen readers). */
  tooltip?: string | null;
}

// ============= Union Type =============

export type Element =
  | TextElement
  | ImageElement
  | ShapeElement
  | AnnotationElement
  | FormFieldElement;

// ============= Layer =============

export interface LayerObject {
  layerId: UUID;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  print: boolean;
  order: number;
}

// ============= Tool Types =============

export type Tool =
  | "select"
  | "text"
  | "image"
  | "shape"
  | "annotation"
  | "form_field"
  | "draw"   // creates a signature field area
  | "redact" // draws irreversible PII redaction zones
  | "hand"
  | "zoom";

export type ShapeSubtype = "rectangle" | "ellipse" | "line" | "polygon" | "path";
export type AnnotationSubtype = "highlight" | "underline" | "strikeout" | "note" | "link";
export type FormFieldSubtype = "text" | "checkbox" | "radio" | "dropdown" | "signature";

/**
 * Creation palette for the form-field tool. Richer than FieldType: some kinds
 * map to the same PDF field type with different presets (multiline → text with
 * properties.multiline, date → text with format.type "date", radio_group →
 * N radio widgets sharing one fieldName).
 */
export type FieldCreationKind =
  | "text"
  | "multiline"
  | "date"
  | "checkbox"
  | "radio_group"
  | "dropdown";
