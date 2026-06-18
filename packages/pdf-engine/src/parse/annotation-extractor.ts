import { randomUUID } from 'node:crypto';
import type {
  AnnotationElement as EditorAnnotationElement,
  AnnotationType as EditorAnnotationType,
  LinkDestination,
} from '@giga-pdf/types';
import type { AnnotationInfo } from '@qrcommunication/gigapdf-lib';
import { pdfToWeb, rgbToHex } from '../utils';
import { getEngine } from '../wasm';

// ---------------------------------------------------------------------------
// Annotation extractor — backed by the native engine (no pdfjs).
//
// The engine's `annotations(page)` returns the full markup metadata (author,
// subject, dates, colour, opacity, quad points, ink list, stamp name, link
// target). Widget annotations (form fields, including signature fields) are
// surfaced by the form-extractor instead, so they're filtered out here.
// ---------------------------------------------------------------------------

// ─── Public standalone types (spec) ─────────────────────────────────────────

export type AnnotationType =
  | 'highlight'
  | 'underline'
  | 'strikeout'
  | 'squiggly'
  | 'text-note'        // sticky note (/Subtype Text)
  | 'free-text'        // text caption (/Subtype FreeText)
  | 'stamp'            // Approved, Draft, etc.
  | 'ink'              // freehand drawing
  | 'line'
  | 'square'
  | 'circle'
  | 'polygon'
  | 'polyline'
  | 'link'
  | 'file-attachment'
  | 'sound'
  | 'movie'
  | 'widget'           // form field — filtered out (handled by form-extractor)
  | 'signature'
  | 'redact';

export interface AnnotationElement {
  elementId: string;
  pageNumber: number;
  type: AnnotationType;
  bounds: { x: number; y: number; width: number; height: number };
  author?: string;         // /T
  subject?: string;        // /Subj
  content?: string;        // /Contents
  createdDate?: string;    // /CreationDate → ISO 8601
  modifiedDate?: string;   // /M → ISO 8601
  color?: string;          // /C → hex (#rrggbb)
  opacity?: number;        // /CA

  // Type-specific fields
  quadPoints?: number[];   // highlight / underline / strikeout / squiggly
  linkTarget?: { uri?: string; page?: number };
  inkPoints?: number[][];  // ink freehand paths
  stampName?: string;      // e.g. 'Approved', 'Draft'
  signature?: { signerName?: string; signedAt?: string; verified?: boolean };
}

// ─── Subtype → type maps ─────────────────────────────────────────────────────

const SUBTYPE_MAP: Record<string, AnnotationType> = {
  Text: 'text-note',
  FreeText: 'free-text',
  Highlight: 'highlight',
  Underline: 'underline',
  StrikeOut: 'strikeout',
  Squiggly: 'squiggly',
  Stamp: 'stamp',
  Ink: 'ink',
  Line: 'line',
  Square: 'square',
  Circle: 'circle',
  Polygon: 'polygon',
  PolyLine: 'polyline',
  Link: 'link',
  FileAttachment: 'file-attachment',
  Sound: 'sound',
  Movie: 'movie',
  Redact: 'redact',
};

// Editor scene-graph annotation types (the subset the editor renders).
const SUBTYPE_TO_EDITOR: Record<string, EditorAnnotationType> = {
  Text: 'note',
  Link: 'link',
  FreeText: 'freetext',
  Highlight: 'highlight',
  Underline: 'underline',
  Squiggly: 'squiggly',
  StrikeOut: 'strikeout',
  Stamp: 'stamp',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Engine RGB (`0..=1`, length 0 or 3) → `#rrggbb`, or undefined when absent. */
function colorHex(color: number[]): string | undefined {
  if (color.length < 3) return undefined;
  return rgbToHex(color[0]!, color[1]!, color[2]!);
}

/**
 * Parse a PDF date string (D:YYYYMMDDHHmmSSOHH'mm') to ISO 8601.
 * Returns undefined if parsing fails.
 */
function parsePdfDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  // Strip optional "D:" prefix
  const s = raw.startsWith('D:') ? raw.slice(2) : raw;
  if (s.length < 4) return undefined;

  const year   = s.slice(0, 4);
  const month  = s.slice(4, 6)  || '01';
  const day    = s.slice(6, 8)  || '01';
  const hour   = s.slice(8, 10) || '00';
  const minute = s.slice(10, 12) || '00';
  const second = s.slice(12, 14) || '00';

  let tz = 'Z';
  const tzPart = s.slice(14);
  if (tzPart.startsWith('Z')) {
    tz = 'Z';
  } else if (tzPart.startsWith('+') || tzPart.startsWith('-')) {
    const sign = tzPart[0];
    const tzH  = tzPart.slice(1, 3) || '00';
    const tzM  = tzPart.replace(/'/g, '').slice(3, 5) || '00';
    tz = `${sign}${tzH}:${tzM}`;
  }

  try {
    return new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}${tz}`).toISOString();
  } catch {
    return undefined;
  }
}

/**
 * Convert PDF QuadPoints (8 values per quad, in PDF coords) to web coords.
 * Returns flat array of x,y pairs in web coordinate space.
 */
function convertQuadPoints(qp: number[], pageHeight: number): number[] | undefined {
  if (qp.length < 8) return undefined;
  const result: number[] = [];
  for (let i = 0; i + 1 < qp.length; i += 2) {
    result.push(qp[i]!);                        // x unchanged
    result.push(pageHeight - (qp[i + 1] ?? 0)); // y flipped
  }
  return result;
}

/** Convert an /InkList (array of stroke arrays in PDF coords) to web coords. */
function convertInkPoints(inkList: number[][], pageHeight: number): number[][] | undefined {
  if (inkList.length === 0) return undefined;
  return inkList.map((path) => {
    const pts: number[] = [];
    for (let i = 0; i + 1 < path.length; i += 2) {
      pts.push(path[i]!);
      pts.push(pageHeight - (path[i + 1] ?? 0));
    }
    return pts;
  });
}

/** Web bounds (top-left origin) from an engine annotation's `/Rect` corners. */
function rectToWebBounds(
  info: AnnotationInfo,
  pageHeight: number,
): { x: number; y: number; width: number; height: number } {
  const x = Math.min(info.x0, info.x1);
  const y = Math.min(info.y0, info.y1);
  const width = Math.abs(info.x1 - info.x0);
  const height = Math.abs(info.y1 - info.y0);
  return pdfToWeb(x, y, width, height, pageHeight);
}

// ─── Public API: extractAnnotations (raw bytes) ───────────────────────────────

/**
 * Extract all non-Widget annotations from a PDF document (or a single page).
 *
 * @param pdfBytes  Raw PDF data (ArrayBuffer or Uint8Array).
 * @param pageNumber  1-based page number. Omit to extract from all pages.
 * @returns Flat list of AnnotationElement objects in web coordinates.
 */
export async function extractAnnotations(
  pdfBytes: ArrayBuffer | Uint8Array,
  pageNumber?: number,
): Promise<AnnotationElement[]> {
  const results: AnnotationElement[] = [];
  const giga = await getEngine();
  const bytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
  const doc = giga.open(bytes);
  try {
    const pageCount = doc.pageCount();
    const pages =
      pageNumber !== undefined
        ? [pageNumber].filter((p) => p >= 1 && p <= pageCount)
        : Array.from({ length: pageCount }, (_, i) => i + 1);

    for (const pn of pages) {
      const pageHeight = doc.pageInfo(pn).height;
      for (const info of doc.annotations(pn)) {
        const element = buildAnnotationElement(info, pn, pageHeight);
        if (element !== null) results.push(element);
      }
    }
  } finally {
    doc.close();
  }
  return results;
}

/**
 * Build a standalone AnnotationElement from an engine annotation. Returns null
 * for Widget annotations (handled by the form-extractor) or unknown subtypes.
 */
function buildAnnotationElement(
  info: AnnotationInfo,
  pageNumber: number,
  pageHeight: number,
): AnnotationElement | null {
  if (info.subtype === 'Widget') return null;
  const annotationType = SUBTYPE_MAP[info.subtype];
  if (!annotationType) return null;

  const element: AnnotationElement = {
    elementId: randomUUID(),
    pageNumber,
    type: annotationType,
    bounds: rectToWebBounds(info, pageHeight),
  };

  if (info.author) element.author = info.author;
  if (info.subject) element.subject = info.subject;
  if (info.contents) element.content = info.contents;
  const created = parsePdfDate(info.created);
  if (created) element.createdDate = created;
  const modified = parsePdfDate(info.modified);
  if (modified) element.modifiedDate = modified;
  const color = colorHex(info.color);
  if (color) element.color = color;
  if (typeof info.opacity === 'number') element.opacity = info.opacity;

  // ── Type-specific enrichment ──────────────────────────────────────────────

  if (
    annotationType === 'highlight' ||
    annotationType === 'underline' ||
    annotationType === 'strikeout' ||
    annotationType === 'squiggly'
  ) {
    const webQP = convertQuadPoints(info.quadPoints, pageHeight);
    if (webQP !== undefined) element.quadPoints = webQP;
  }

  if (annotationType === 'link') {
    const linkTarget: AnnotationElement['linkTarget'] = {};
    if (info.linkUri) linkTarget.uri = info.linkUri;
    else if (info.linkPage > 0) linkTarget.page = info.linkPage;
    if (linkTarget.uri !== undefined || linkTarget.page !== undefined) {
      element.linkTarget = linkTarget;
    }
  }

  if (annotationType === 'ink') {
    const webInk = convertInkPoints(info.inkList, pageHeight);
    if (webInk !== undefined) element.inkPoints = webInk;
  }

  if (annotationType === 'stamp' && info.name) {
    element.stampName = info.name;
  }

  return element;
}

// ─── Editor-centric extractor (used by parser.ts) ────────────────────────────

/**
 * Extract editor annotation elements for an entire PDF, grouped by 1-based page
 * number. Opens the document once. Widget (form) annotations are skipped — the
 * form-extractor surfaces them. Returns an empty map on failure.
 */
export async function extractAnnotationElementsByPage(
  pdfBytes: Buffer | ArrayBuffer | Uint8Array,
): Promise<Map<number, EditorAnnotationElement[]>> {
  const byPage = new Map<number, EditorAnnotationElement[]>();
  try {
    const giga = await getEngine();
    const bytes = pdfBytes instanceof Uint8Array ? pdfBytes : new Uint8Array(pdfBytes);
    const doc = giga.open(bytes);
    try {
      const pageCount = doc.pageCount();
      for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
        const pageHeight = doc.pageInfo(pageNumber).height;
        const elements: EditorAnnotationElement[] = [];
        for (const info of doc.annotations(pageNumber)) {
          if (info.subtype === 'Widget') continue;
          const annotationType = SUBTYPE_TO_EDITOR[info.subtype];
          if (!annotationType) continue;

          let linkDestination: LinkDestination | null = null;
          if (annotationType === 'link') {
            if (info.linkUri) {
              linkDestination = { type: 'external', pageNumber: null, url: info.linkUri, position: null };
            } else if (info.linkPage > 0) {
              linkDestination = { type: 'internal', pageNumber: info.linkPage, url: null, position: null };
            }
          }

          elements.push({
            elementId: randomUUID(),
            type: 'annotation',
            bounds: rectToWebBounds(info, pageHeight),
            transform: { rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 },
            layerId: null,
            locked: false,
            visible: true,
            annotationType,
            content: info.contents,
            style: { color: colorHex(info.color) ?? '#000000', opacity: info.opacity },
            linkDestination,
            popup: null,
          });
        }
        if (elements.length > 0) byPage.set(pageNumber, elements);
      }
    } finally {
      doc.close();
    }
  } catch {
    // leave the map empty on failure
  }
  return byPage;
}

/** Editor annotation elements on a single page (wrapper over the grouped map). */
export async function extractAnnotationElements(
  pdfBytes: Buffer | ArrayBuffer | Uint8Array,
  pageNumber: number,
): Promise<EditorAnnotationElement[]> {
  return (await extractAnnotationElementsByPage(pdfBytes)).get(pageNumber) ?? [];
}
