import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFPageProxy } from 'pdfjs-dist/types/src/display/api';
import { randomUUID } from 'node:crypto';
import type {
  AnnotationElement as EditorAnnotationElement,
  AnnotationType as EditorAnnotationType,
  LinkDestination,
} from '@giga-pdf/types';
import { pdfToWeb, rgbToHex } from '../utils';

if (!pdfjsLib.GlobalWorkerOptions.workerSrc) { pdfjsLib.GlobalWorkerOptions.workerSrc = ''; }

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
  | 'widget'           // form field — returned only when caller opts in; filtered by default
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

// ─── Internal mapping: pdfjs subtype string → AnnotationType ─────────────────

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
  Widget: 'widget',
  Redact: 'redact',
  // Signature widget (typically /Subtype Widget + /FT Sig)
  // handled below via sigFlags
};

// ─── Internal mapping (legacy): annotationType number → EditorAnnotationType ─

const ANNOTATION_TYPE_MAP: Record<number, EditorAnnotationType> = {
  1: 'note',
  2: 'link',
  3: 'freetext',
  8: 'highlight',
  9: 'underline',
  10: 'squiggly',
  11: 'strikeout',
  13: 'stamp',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function colorFromUint8(color: Uint8ClampedArray | number[] | null | undefined): string {
  if (!color || color.length < 3) return '#000000';
  return rgbToHex(color[0]! / 255, color[1]! / 255, color[2]! / 255);
}

/**
 * Parse a PDF date string (D:YYYYMMDDHHmmSSOHH'mm') to ISO 8601.
 * Returns undefined if parsing fails.
 */
function parsePdfDate(raw: unknown): string | undefined {
  if (!raw || typeof raw !== 'string') return undefined;
  // Strip optional "D:" prefix
  const s = raw.startsWith('D:') ? raw.slice(2) : raw;
  // Minimum: YYYY (4 chars)
  if (s.length < 4) return undefined;

  const year   = s.slice(0, 4);
  const month  = s.slice(4, 6)  || '01';
  const day    = s.slice(6, 8)  || '01';
  const hour   = s.slice(8, 10) || '00';
  const minute = s.slice(10, 12) || '00';
  const second = s.slice(12, 14) || '00';

  // Timezone: optional OHH'mm' where O is +/-/Z
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
 * Extract the text content from pdfjs annotation object.
 * pdfjs exposes it as `contentsObj.str` (preferred) or `contents`.
 */
function extractContent(annotation: Record<string, unknown>): string | undefined {
  const obj = annotation['contentsObj'] as { str?: string } | undefined;
  const str = obj?.str ?? (typeof annotation['contents'] === 'string' ? annotation['contents'] : undefined);
  return str !== undefined && str.length > 0 ? str : undefined;
}

/**
 * Convert PDF QuadPoints (8 values per quad, in PDF coords) to web coords.
 * Returns flat array of x,y pairs in web coordinate space.
 */
function convertQuadPoints(
  qp: number[] | undefined,
  pageHeight: number,
): number[] | undefined {
  if (!qp || qp.length < 8) return undefined;
  const result: number[] = [];
  for (let i = 0; i + 1 < qp.length; i += 2) {
    result.push(qp[i]!);                        // x unchanged
    result.push(pageHeight - (qp[i + 1] ?? 0)); // y flipped
  }
  return result;
}

/**
 * Convert pdfjs InkList (array of path arrays in PDF coords) to web coords.
 */
function convertInkPoints(
  inkList: number[][] | undefined,
  pageHeight: number,
): number[][] | undefined {
  if (!inkList || inkList.length === 0) return undefined;
  return inkList.map((path) => {
    const pts: number[] = [];
    for (let i = 0; i + 1 < path.length; i += 2) {
      pts.push(path[i]!);
      pts.push(pageHeight - (path[i + 1] ?? 0));
    }
    return pts;
  });
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
  const data = pdfBytes instanceof ArrayBuffer ? new Uint8Array(pdfBytes) : pdfBytes;
  const loadingTask = pdfjsLib.getDocument({ data });
  const doc = await loadingTask.promise;

  try {
    const totalPages = doc.numPages;
    const pageNumbers: number[] =
      pageNumber !== undefined
        ? [pageNumber]
        : Array.from({ length: totalPages }, (_, i) => i + 1);

    const results: AnnotationElement[] = [];

    for (const pn of pageNumbers) {
      if (pn < 1 || pn > totalPages) continue;
      const page = await doc.getPage(pn);
      const viewport = page.getViewport({ scale: 1 });
      const annotations = await page.getAnnotations({ intent: 'display' });

      for (const ann of annotations) {
        const element = buildAnnotationElement(ann, pn, viewport.height);
        if (element !== null) {
          results.push(element);
        }
      }
    }

    return results;
  } finally {
    doc.destroy();
  }
}

/**
 * Build a standalone AnnotationElement from a raw pdfjs annotation object.
 * Returns null for Widget annotations (handled by form-extractor) or unknown subtypes.
 */
function buildAnnotationElement(
  // pdfjs does not export a concrete annotation type; use a loose record
  ann: Record<string, unknown>,
  pageNumber: number,
  pageHeight: number,
): AnnotationElement | null {
  const subtype = ann['subtype'] as string | undefined;
  if (!subtype) return null;

  // Detect signature widgets before filtering out all widgets
  const isSigWidget =
    subtype === 'Widget' &&
    (ann['fieldType'] === 'Sig' || ann['fieldType'] === 'Signature');

  if (subtype === 'Widget' && !isSigWidget) return null;

  const annotationType: AnnotationType | undefined = isSigWidget
    ? 'signature'
    : SUBTYPE_MAP[subtype];

  if (!annotationType) return null;

  // Bounds
  const rect = ann['rect'] as number[] | undefined;
  const x1 = rect?.[0] ?? 0;
  const y1 = rect?.[1] ?? 0;
  const x2 = rect?.[2] ?? 0;
  const y2 = rect?.[3] ?? 0;
  const w = Math.abs(x2 - x1);
  const h = Math.abs(y2 - y1);
  const bounds = pdfToWeb(Math.min(x1, x2), Math.min(y1, y2), w, h, pageHeight);

  // Color  (/C array: [r,g,b] normalised 0-1 in pdfjs, or Uint8ClampedArray)
  const rawColor = ann['color'] as Uint8ClampedArray | number[] | null | undefined;
  const color = (rawColor && (rawColor.length ?? 0) >= 3)
    ? colorFromUint8(rawColor)
    : undefined;

  // Opacity (/CA)
  const opacity = typeof ann['opacity'] === 'number' ? ann['opacity'] : undefined;

  // Author (/T), Subject (/Subj)
  const author = typeof ann['titleObj'] === 'object' && ann['titleObj'] !== null
    ? ((ann['titleObj'] as { str?: string })['str'] ?? undefined)
    : (typeof ann['title'] === 'string' && ann['title'].length > 0 ? ann['title'] : undefined);

  const subject = typeof ann['subj'] === 'string' && ann['subj'].length > 0
    ? ann['subj']
    : undefined;

  // Dates
  const createdDate = parsePdfDate(ann['creationDate']);
  const modifiedDate = parsePdfDate(ann['modificationDate']);

  // Content (/Contents)
  const content = extractContent(ann);

  const element: AnnotationElement = {
    elementId: randomUUID(),
    pageNumber,
    type: annotationType,
    bounds,
  };

  if (author !== undefined)       element.author       = author;
  if (subject !== undefined)      element.subject      = subject;
  if (content !== undefined)      element.content      = content;
  if (createdDate !== undefined)  element.createdDate  = createdDate;
  if (modifiedDate !== undefined) element.modifiedDate = modifiedDate;
  if (color !== undefined)        element.color        = color;
  if (opacity !== undefined)      element.opacity      = opacity;

  // ── Type-specific enrichment ──────────────────────────────────────────────

  // QuadPoints: highlight, underline, strikeout, squiggly
  if (
    annotationType === 'highlight' ||
    annotationType === 'underline' ||
    annotationType === 'strikeout' ||
    annotationType === 'squiggly'
  ) {
    const qp = ann['quadPoints'] as number[] | undefined;
    const webQP = convertQuadPoints(qp, pageHeight);
    if (webQP !== undefined) element.quadPoints = webQP;
  }

  // Link: /A (Action) → URI or page destination
  if (annotationType === 'link') {
    const uri = ann['url'] as string | undefined;
    const dest = ann['dest'];
    const unsafeUrl = ann['unsafeUrl'] as string | undefined;

    const linkTarget: AnnotationElement['linkTarget'] = {};

    if (uri) {
      linkTarget.uri = uri;
    } else if (unsafeUrl) {
      linkTarget.uri = unsafeUrl;
    }

    // Internal destination: dest can be [pageRef, /XYZ, x, y, zoom] or a named dest string
    if (!linkTarget.uri && dest !== null && dest !== undefined) {
      if (Array.isArray(dest) && dest.length > 0) {
        // dest[0] is a page reference object; pdfjs resolves it to a page index elsewhere
        // We can only report the page index if it's directly available
        const destPageIndex = ann['destPageIndex'] as number | undefined;
        if (destPageIndex !== undefined) {
          linkTarget.page = destPageIndex + 1; // convert 0-based to 1-based
        }
      }
    }

    if (linkTarget.uri !== undefined || linkTarget.page !== undefined) {
      element.linkTarget = linkTarget;
    }
  }

  // Ink: /InkList
  if (annotationType === 'ink') {
    const inkList = ann['inkLists'] as number[][] | undefined;
    const webInk = convertInkPoints(inkList, pageHeight);
    if (webInk !== undefined) element.inkPoints = webInk;
  }

  // Stamp: /Name
  if (annotationType === 'stamp') {
    const stampName = ann['name'] as string | undefined;
    if (stampName) element.stampName = stampName;
  }

  // Signature: extract from /V sig dict if present
  if (annotationType === 'signature') {
    const sigDict = ann['signatureInfo'] as Record<string, unknown> | undefined;
    if (sigDict) {
      element.signature = {
        signerName: typeof sigDict['contactInfo'] === 'string'
          ? sigDict['contactInfo']
          : (typeof sigDict['name'] === 'string' ? sigDict['name'] : undefined),
        signedAt: parsePdfDate(sigDict['signDate']),
        verified: false, // pdfjs does not perform crypto verification
      };
    } else {
      // Mark as signature slot (not yet signed)
      element.signature = { verified: false };
    }
  }

  return element;
}

// ─── Existing editor-centric extractor (kept for parser.ts) ──────────────────

/**
 * Extract annotation elements for a single already-loaded PDF page.
 * Used internally by parsePage() to produce EditorAnnotationElement objects
 * compatible with @giga-pdf/types.
 *
 * @internal
 */
export async function extractAnnotationElements(
  page: PDFPageProxy,
  _pageNumber: number,
  pageHeight: number,
): Promise<EditorAnnotationElement[]> {
  const annotations = await page.getAnnotations();
  const elements: EditorAnnotationElement[] = [];

  for (const annotation of annotations) {
    if (annotation.subtype === 'Widget') continue;

    const annotationType = ANNOTATION_TYPE_MAP[annotation.annotationType as number];
    if (!annotationType) continue;

    const [x1, y1, x2, y2] = annotation.rect as number[];
    const width = Math.abs((x2 ?? 0) - (x1 ?? 0));
    const height = Math.abs((y2 ?? 0) - (y1 ?? 0));
    const bounds = pdfToWeb(x1 ?? 0, y1 ?? 0, width, height, pageHeight);

    const color = colorFromUint8(annotation.color as Uint8ClampedArray | null | undefined);

    const contentObj = annotation.contentsObj as { str?: string } | undefined;
    const content: string =
      contentObj?.str ?? (typeof annotation.contents === 'string' ? annotation.contents : '');

    let linkDestination: LinkDestination | null = null;
    if (annotationType === 'link') {
      if (annotation.url) {
        linkDestination = {
          type: 'external',
          pageNumber: null,
          url: annotation.url as string,
          position: null,
        };
      } else if (annotation.dest) {
        linkDestination = {
          type: 'internal',
          pageNumber: null,
          url: null,
          position: null,
        };
      }
    }

    elements.push({
      elementId: randomUUID(),
      type: 'annotation',
      bounds,
      transform: { rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 },
      layerId: null,
      locked: false,
      visible: true,
      annotationType,
      content,
      style: { color, opacity: 1 },
      linkDestination,
      popup: null,
    });
  }

  return elements;
}
