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
  | "hand"
  | "zoom";

export type ShapeSubtype = "rectangle" | "ellipse" | "line" | "polygon" | "path";
export type AnnotationSubtype = "highlight" | "underline" | "strikeout" | "note" | "link";
export type FormFieldSubtype = "text" | "checkbox" | "radio" | "dropdown" | "signature";
