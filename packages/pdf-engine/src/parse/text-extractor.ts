import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type {
  PDFPageProxy,
  TextItem,
  TextMarkedContent,
} from 'pdfjs-dist/types/src/display/api';
import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import type { TextElement } from '@giga-pdf/types';
import { mapPdfFontToStandard } from '../utils';

if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = '';
}

// ---------------------------------------------------------------------------
// Internal type guards
// ---------------------------------------------------------------------------

function isTextItem(item: TextItem | TextMarkedContent): item is TextItem {
  return 'str' in item;
}

// ---------------------------------------------------------------------------
// TextBlock — richer output for the Fabric.js editor
// ---------------------------------------------------------------------------

export interface TextBlock {
  /** Stable UUID derived from content + position hash */
  elementId: string;
  pageNumber: number;
  /** Concatenated text of all coalesced runs */
  content: string;
  /** Bounds in web coordinates (origin top-left, Y down) expressed in PDF points */
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  style: {
    /** Clean PostScript family name (e.g. "Calibri"), subset prefix stripped */
    fontFamily: string;
    /** Font size in points */
    fontSize: number;
    fontWeight?: 'normal' | 'bold';
    fontStyle?: 'normal' | 'italic';
    /** Fill colour as #RRGGBB */
    color?: string;
    alignment?: 'left' | 'center' | 'right' | 'justify';
    /** Original pdfjs font name including subset prefix, e.g. "ABCDEF+Calibri" */
    originalFont?: string;
    /** Normalised font id for matching against extracted font resources */
    fontId?: string;
  };
  direction?: 'ltr' | 'rtl';
  /** Rotation in degrees (0 for upright text) */
  rotation?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip subset prefix such as "ABCDEF+" from font names. */
function stripSubsetPrefix(fontName: string): string {
  // Pattern: 6 uppercase letters followed by '+' e.g. "ABCDEF+Calibri"
  return fontName.replace(/^[A-Z]{6}\+/, '');
}

/**
 * Extract the human-readable family name from a pdfjs font name.
 * E.g. "ABCDEF+Calibri-Bold" → "Calibri"
 * E.g. "ArialMT" → "Arial"
 */
function extractFontFamily(rawFontName: string): string {
  const stripped = stripSubsetPrefix(rawFontName);

  // Remove common weight/style suffixes (case-insensitive)
  const cleaned = stripped
    .replace(/[-_,](Bold|Italic|Oblique|Light|Medium|Regular|Thin|Heavy|Black|Narrow|Wide|Condensed|Extended|Semi|Demi|Extra|Ultra)(Bold|Italic|Oblique)?/gi, '')
    .replace(/(Bold|Italic|Oblique|MT|PS|Std|Pro|Regular)$/i, '')
    .trim();

  return cleaned || stripped;
}

/**
 * Normalise a font name to a stable identifier (lowercase, no subset prefix,
 * no spaces) for matching against font resources.
 */
function normaliseFontId(rawFontName: string): string {
  return stripSubsetPrefix(rawFontName).toLowerCase().replace(/\s+/g, '-');
}

/**
 * Convert a pdfjs RGB colour array ([0..1, 0..1, 0..1]) to #RRGGBB.
 * Returns '#000000' when the value is not a valid colour triple.
 */
function rgbArrayToHex(rgb: number[] | undefined | null): string {
  if (!rgb || rgb.length < 3) return '#000000';
  const toHex = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(rgb[0]!)}${toHex(rgb[1]!)}${toHex(rgb[2]!)}`;
}

/**
 * Resolve setFillRGBColor / setStrokeRGBColor args to a hex string.
 *
 * pdfjs 3.x+ pre-resolves colours to "#rrggbb" strings (the operator
 * receives `["#cc0000"]`); older builds delivered `[r, g, b]` floats in
 * the 0-1 range. We accept both — the previous code only handled the
 * legacy float form, which is why every text element ended up #000000
 * after the upstream change.
 */
function parsePdfjsColorArgs(args: unknown[]): string | null {
  if (args.length === 0) return null;
  const first = args[0];
  if (typeof first === 'string') {
    return /^#[0-9a-f]{6}$/i.test(first) ? first.toLowerCase() : null;
  }
  if (typeof first === 'number' && args.length >= 3) {
    return rgbArrayToHex(args as number[]);
  }
  return null;
}

/**
 * Derive a stable UUID from the block content + position so the same text at
 * the same location always gets the same id (useful for diffing/editing).
 */
function deriveStableId(content: string, x: number, y: number, page: number): string {
  const hash = createHash('sha256')
    .update(`${page}:${x.toFixed(2)}:${y.toFixed(2)}:${content}`)
    .digest('hex')
    .slice(0, 32);

  // Format as UUID v4-like
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    '4' + hash.slice(13, 16),
    ((parseInt(hash[16]!, 16) & 0x3) | 0x8).toString(16) + hash.slice(17, 20),
    hash.slice(20, 32),
  ].join('-');
}

// ---------------------------------------------------------------------------
// Rotation extraction from a transform matrix
// ---------------------------------------------------------------------------

/**
 * Extract rotation angle in degrees from a PDF text transform matrix.
 * Matrix layout: [a, b, c, d, tx, ty]
 * Rotation = atan2(b, a) converted to degrees.
 */
function rotationFromTransform(transform: number[]): number {
  const a = transform[0] ?? 1;
  const b = transform[1] ?? 0;
  const angleDeg = Math.round((Math.atan2(b, a) * 180) / Math.PI);
  return angleDeg;
}

// ---------------------------------------------------------------------------
// Text run grouping logic
// ---------------------------------------------------------------------------

/** A single pdfjs text run, enriched with computed coordinates. */
interface TextRun {
  str: string;
  fontName: string;
  fontSize: number;
  /** X position in PDF coords (origin bottom-left) */
  pdfX: number;
  /** Y position in PDF coords (origin bottom-left, baseline) */
  pdfY: number;
  width: number;
  height: number;
  /** Web coords (top-left origin) */
  webX: number;
  webY: number;
  rotation: number;
  color: string;
}

/**
 * Y-tolerance in points for grouping runs onto the same visual line.
 * Two runs are on the same line when |y1 - y2| <= LINE_Y_TOLERANCE.
 */
const LINE_Y_TOLERANCE = 2;

/**
 * X-gap tolerance: runs within this many points on the same line are
 * considered part of the same block.
 */
const BLOCK_X_GAP = 6;

/**
 * Group an array of text runs into visual lines (same Y ± tolerance).
 * Within each line, runs are sorted by ascending X.
 */
function groupRunsIntoLines(runs: TextRun[]): TextRun[][] {
  if (runs.length === 0) return [];

  // Sort by PDF Y descending (top of page first), then X ascending
  const sorted = [...runs].sort((a, b) => {
    const dy = b.pdfY - a.pdfY; // higher Y = closer to top in PDF space
    return Math.abs(dy) > LINE_Y_TOLERANCE ? dy : a.pdfX - b.pdfX;
  });

  const lines: TextRun[][] = [];
  let currentLine: TextRun[] = [sorted[0]!];

  for (let i = 1; i < sorted.length; i++) {
    const run = sorted[i]!;
    const lineRef = currentLine[0]!;
    if (Math.abs(run.pdfY - lineRef.pdfY) <= LINE_Y_TOLERANCE) {
      currentLine.push(run);
    } else {
      lines.push(currentLine);
      currentLine = [run];
    }
  }
  lines.push(currentLine);

  return lines;
}

/**
 * Coalesce adjacent runs on the same line that share font name + size into
 * single text blocks. Returns an array of coalesced run groups.
 */
function coalesceLineRuns(line: TextRun[]): TextRun[][] {
  if (line.length === 0) return [];

  const groups: TextRun[][] = [];
  let currentGroup: TextRun[] = [line[0]!];

  for (let i = 1; i < line.length; i++) {
    const prev = currentGroup[currentGroup.length - 1]!;
    const curr = line[i]!;
    const sameFontSize =
      prev.fontName === curr.fontName &&
      Math.abs(prev.fontSize - curr.fontSize) < 0.5;
    const closeEnough = curr.webX - (prev.webX + prev.width) <= BLOCK_X_GAP;

    if (sameFontSize && closeEnough) {
      currentGroup.push(curr);
    } else {
      groups.push(currentGroup);
      currentGroup = [curr];
    }
  }
  groups.push(currentGroup);

  return groups;
}

// ---------------------------------------------------------------------------
// Alignment detection
// ---------------------------------------------------------------------------

/**
 * Detect the text alignment by comparing x-positions of all lines that make
 * up a multi-run block.
 *
 * Strategy (simple heuristic based on x-variance):
 * - All lines start at ~same x → 'left'
 * - All lines end at ~same x → 'right'
 * - All lines are centred (midpoints ~equal) → 'center'
 * - Otherwise → 'justify'
 *
 * For single-line blocks we default to 'left'.
 */
function detectAlignment(
  lines: Array<{ startX: number; endX: number; midX: number }>,
): 'left' | 'center' | 'right' | 'justify' {
  if (lines.length < 2) return 'left';

  const startXs = lines.map((l) => l.startX);
  const endXs = lines.map((l) => l.endX);
  const midXs = lines.map((l) => l.midX);

  const variance = (arr: number[]) => {
    const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
    return arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
  };

  const ALIGN_TOLERANCE = 3; // points

  if (Math.sqrt(variance(startXs)) <= ALIGN_TOLERANCE) return 'left';
  if (Math.sqrt(variance(endXs)) <= ALIGN_TOLERANCE) return 'right';
  if (Math.sqrt(variance(midXs)) <= ALIGN_TOLERANCE) return 'center';
  return 'justify';
}

// ---------------------------------------------------------------------------
// Colour extraction via operator list
// ---------------------------------------------------------------------------

/** A showText event with its painted position in PDF user space. */
interface ShowTextEvent {
  color: string;
  /** Baseline X in PDF user space (TM[4] composed with CTM). */
  x: number;
  /** Baseline Y in PDF user space (TM[5] composed with CTM). */
  y: number;
}

/**
 * Multiply two 2D affine matrices [a, b, c, d, e, f] in row-major form.
 *   m = [a c e]
 *       [b d f]
 *       [0 0 1]
 */
function matMul(m1: number[], m2: number[]): number[] {
  return [
    m1[0]! * m2[0]! + m1[2]! * m2[1]!,
    m1[1]! * m2[0]! + m1[3]! * m2[1]!,
    m1[0]! * m2[2]! + m1[2]! * m2[3]!,
    m1[1]! * m2[2]! + m1[3]! * m2[3]!,
    m1[0]! * m2[4]! + m1[2]! * m2[5]! + m1[4]!,
    m1[1]! * m2[4]! + m1[3]! * m2[5]! + m1[5]!,
  ];
}

/**
 * Walk the operator list and record every showText event with the colour,
 * CTM-composed baseline (x, y) — the same coordinates pdfjs reports in
 * textContent.items[i].transform[4..5]. We can then key colours by exact
 * baseline position and look them up from each text item by proximity.
 *
 * Why this is more reliable than index/char-count matching:
 *   - pdfjs may split or merge a single showText into multiple
 *     textContent items based on font/style boundaries.
 *   - includeMarkedContent / disableNormalization don't always normalise
 *     the split. Index matching drifts mid-page.
 *   - But every showText event paints at a specific (x, y) baseline that
 *     ALSO appears (within rounding) in the matching textContent item.
 *     Position keying is deterministic.
 *
 * Tracks the full PDF text state machine (Tm / Td / TD / T* / Tj / Tj' /
 * Tj" / cm) so we can compute the composed baseline at every paint.
 */
async function buildShowTextEvents(page: PDFPageProxy): Promise<ShowTextEvent[]> {
  const result: ShowTextEvent[] = [];

  let opList: Awaited<ReturnType<PDFPageProxy['getOperatorList']>>;
  try {
    opList = await page.getOperatorList();
  } catch {
    return result;
  }

  const OPS = pdfjsLib.OPS as Record<string, number>;

  let currentColor = '#000000';
  // CTM stack: graphics state save/restore (q/Q) snapshots the entire ctm.
  let ctm: number[] = [1, 0, 0, 1, 0, 0];
  const ctmStack: number[][] = [];
  // Text Line Matrix and Text Matrix — both reset to identity by BT,
  // then mutated by Tm/Td/TD/T*. T* moves TLM by leading; showText also
  // advances TM but for our purposes TM[5] at paint time equals TLM[5]
  // since glyph painting only advances horizontally.
  let tlm: number[] = [1, 0, 0, 1, 0, 0];
  let tm: number[] = [1, 0, 0, 1, 0, 0];
  let leading = 0;

  const { fnArray, argsArray } = opList;

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i] as unknown[];

    if (fn === OPS.save) {
      ctmStack.push([...ctm]);
    } else if (fn === OPS.restore) {
      ctm = ctmStack.pop() ?? [1, 0, 0, 1, 0, 0];
    } else if (fn === OPS.transform) {
      const [a, b, c, d, e, f] = args as number[];
      ctm = matMul(ctm, [a!, b!, c!, d!, e!, f!]);
    } else if (fn === OPS.beginText) {
      tlm = [1, 0, 0, 1, 0, 0];
      tm = [1, 0, 0, 1, 0, 0];
    } else if (fn === OPS.setTextMatrix) {
      // pdfjs delivers Tm as [Float32Array(6)] (nested), not as flat
      // [a,b,c,d,e,f]. Earlier code read args[0..5] and produced NaN.
      const matArg = args[0] as ArrayLike<number> | undefined;
      if (matArg && typeof matArg[0] === 'number') {
        tlm = [matArg[0]!, matArg[1]!, matArg[2]!, matArg[3]!, matArg[4]!, matArg[5]!];
        tm = [...tlm];
      }
    } else if (fn === OPS.moveText) {
      // Td: tx, ty
      const [tx, ty] = args as number[];
      tlm = matMul(tlm, [1, 0, 0, 1, tx!, ty!]);
      tm = [...tlm];
    } else if (fn === OPS.setLeadingMoveText) {
      // TD: -ty becomes leading, then Td(tx, ty)
      const [tx, ty] = args as number[];
      leading = -(ty ?? 0);
      tlm = matMul(tlm, [1, 0, 0, 1, tx!, ty!]);
      tm = [...tlm];
    } else if (fn === OPS.nextLine) {
      // T* : equivalent to TD(0, -leading)
      tlm = matMul(tlm, [1, 0, 0, 1, 0, -leading]);
      tm = [...tlm];
    } else if (fn === OPS.setLeading) {
      leading = (args[0] as number) ?? 0;
    } else if (fn === OPS.setFillRGBColor) {
      const c = parsePdfjsColorArgs(args);
      if (c) currentColor = c;
    } else if (fn === OPS.setFillGray) {
      const g = (args[0] as number) ?? 0;
      currentColor = rgbArrayToHex([g, g, g]);
    } else if (fn === OPS.setFillColor || fn === OPS.setFillColorN) {
      const hex = parsePdfjsColorArgs(args);
      if (hex) {
        currentColor = hex;
      } else if (Array.isArray(args) && args.length === 4) {
        const [c, m, y, k] = args as number[];
        const r = 1 - Math.min(1, (c ?? 0) + (k ?? 0));
        const gg = 1 - Math.min(1, (m ?? 0) + (k ?? 0));
        const bb = 1 - Math.min(1, (y ?? 0) + (k ?? 0));
        currentColor = rgbArrayToHex([r, gg, bb]);
      }
    } else if (
      fn === OPS.showText ||
      fn === OPS.showSpacedText
    ) {
      // Compose CTM·TM to get baseline in user space.
      const composed = matMul(ctm, tm);
      result.push({ color: currentColor, x: composed[4]!, y: composed[5]! });
    } else if (
      fn === OPS.nextLineShowText ||
      fn === OPS.nextLineSetSpacingShowText
    ) {
      // T' / T" implicitly do T* before the show.
      tlm = matMul(tlm, [1, 0, 0, 1, 0, -leading]);
      tm = [...tlm];
      const composed = matMul(ctm, tm);
      result.push({ color: currentColor, x: composed[4]!, y: composed[5]! });
    }
  }

  return result;
}

/**
 * Find the showText event whose baseline best matches (x, y).
 *
 * pdfjs textContent.items[i].transform[4..5] gives the same composed
 * baseline. Match by closest event within MATCH_TOLERANCE PDF points
 * (typically 0.5 — anything bigger means the matching is unreliable).
 */
function findColorAtPosition(
  events: ShowTextEvent[],
  x: number,
  y: number,
): string {
  const TOLERANCE = 0.6;
  let best: { color: string; dist: number } | null = null;
  for (const ev of events) {
    const dx = ev.x - x;
    const dy = ev.y - y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > TOLERANCE) continue;
    if (!best || dist < best.dist) best = { color: ev.color, dist };
  }
  return best?.color ?? '#000000';
}

/**
 * Build a map from approximate PDF Y baseline position to fill colour.
 * We walk the operator list looking for setFillRGBColor / setFillColor
 * before text-showing operators (showText, showSpacedText).
 *
 * Returns a Map<yBaseline (rounded to 1 dp), hexColor>.
 */
async function buildColorMap(page: PDFPageProxy): Promise<Map<string, string>> {
  const colorMap = new Map<string, string>();

  let opList: Awaited<ReturnType<PDFPageProxy['getOperatorList']>>;
  try {
    opList = await page.getOperatorList();
  } catch {
    // If operator list fails (encrypted, etc.), return empty map
    return colorMap;
  }

  // pdfjs operator codes (subset of what we need)
  // These magic numbers are from pdfjs-dist OPS enum
  const OPS = pdfjsLib.OPS as Record<string, number>;
  const OP_setFillRGBColor = OPS['setFillRGBColor']; // 82
  const OP_setFillColor = OPS['setFillColor']; // 80
  const OP_setFillColorN = OPS['setFillColorN']; // 83
  const OP_setFillGray = OPS['setFillGray']; // 81
  const OP_showText = OPS['showText']; // 45
  const OP_showSpacedText = OPS['showSpacedText']; // 46
  const OP_nextLineShowText = OPS['nextLineShowText']; // 47
  const OP_nextLineSetSpacingShowText = OPS['nextLineSetSpacingShowText']; // 48
  const OP_setFont = OPS['setFont']; // 27
  const OP_setTextMatrix = OPS['setTextMatrix']; // 31

  let currentColor = '#000000';
  let currentY = 0;

  const { fnArray, argsArray } = opList;

  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i] as unknown[];

    if (fn === OP_setFillRGBColor) {
      const c = parsePdfjsColorArgs(args);
      if (c) currentColor = c;
    } else if (fn === OP_setFillGray) {
      const g = (args[0] as number) ?? 0;
      currentColor = rgbArrayToHex([g, g, g]);
    } else if (fn === OP_setFillColor || fn === OP_setFillColorN) {
      // Could be a pre-resolved hex string, an RGB triple, or CMYK quad.
      const hex = parsePdfjsColorArgs(args);
      if (hex) {
        currentColor = hex;
      } else if (Array.isArray(args) && args.length === 4) {
        // CMYK → RGB approximation
        const [c, m, y, k] = args as number[];
        const r = 1 - Math.min(1, (c ?? 0) + (k ?? 0));
        const g = 1 - Math.min(1, (m ?? 0) + (k ?? 0));
        const b = 1 - Math.min(1, (y ?? 0) + (k ?? 0));
        currentColor = rgbArrayToHex([r, g, b]);
      }
    } else if (fn === OP_setTextMatrix) {
      // args: [a, b, c, d, tx, ty]
      const ty = (args[5] as number) ?? 0;
      currentY = ty;
    } else if (
      fn === OP_showText ||
      fn === OP_showSpacedText ||
      fn === OP_nextLineShowText ||
      fn === OP_nextLineSetSpacingShowText
    ) {
      // Key: Y rounded to 1 decimal place
      const key = currentY.toFixed(1);
      if (!colorMap.has(key)) {
        colorMap.set(key, currentColor);
      }
    } else if (fn === OP_setFont) {
      // no-op for our purposes
    }
  }

  return colorMap;
}

// ---------------------------------------------------------------------------
// extractTextElements — existing API, untouched
// ---------------------------------------------------------------------------

/**
 * Resolve the *real* PostScript font name from a pdfjs internal id.
 *
 * `item.fontName` is the loadedName (e.g. "g_d0_f1") which pdfjs assigns
 * to every font as it streams them in. The actual PostScript name
 * (e.g. "AAAAAA+Arial-BoldMT") lives on the Font object stored in
 * `page.commonObjs`. Without this lookup, every text run looks
 * identically named to mapPdfFontToStandard, which then falls back to
 * Helvetica and loses bold/italic variants.
 */
async function resolvePdfjsFontName(
  page: PDFPageProxy,
  loadedName: string,
): Promise<string> {
  const info = await resolvePdfjsFontInfo(page, loadedName);
  return info.name;
}

interface PdfFontInfo {
  name: string;
  /**
   * True for Type 3 fonts — fonts whose glyphs are defined as PDF content
   * streams (paths/operators) instead of standard outlines. Used by Free,
   * Adobe etc. to embed barcodes and ornament glyphs. They have no Unicode
   * mapping, so pdfjs surfaces them as opaque control chars; we filter
   * them out of the text layer because the same content stream emits real
   * `constructPath` ops which the drawing-extractor already captures.
   */
  isType3Font: boolean;
}

async function resolvePdfjsFontInfo(
  page: PDFPageProxy,
  loadedName: string,
): Promise<PdfFontInfo> {
  if (!loadedName) return { name: '', isType3Font: false };
  try {
    const commonObjs = (page as unknown as Record<string, unknown>)['commonObjs'];
    if (!commonObjs) return { name: loadedName, isType3Font: false };
    const api = commonObjs as {
      get: ((k: string) => unknown) & ((k: string, cb: (v: unknown) => void) => void);
      has?: (k: string) => boolean;
    };
    if (typeof api.get !== 'function') return { name: loadedName, isType3Font: false };

    const fontObj = await new Promise<unknown>((resolve) => {
      try {
        (api.get as (k: string, cb: (v: unknown) => void) => void)(loadedName, resolve);
      } catch {
        resolve(null);
      }
    });
    if (!fontObj || typeof fontObj !== 'object') {
      return { name: loadedName, isType3Font: false };
    }

    const obj = fontObj as Record<string, unknown>;
    const realName = typeof obj['name'] === 'string' ? (obj['name'] as string) : '';
    const isType3Font =
      obj['isType3Font'] === true ||
      // Some pdfjs builds expose only `type` (string) or `data.type`.
      obj['type'] === 'Type3' ||
      ((obj['data'] as Record<string, unknown> | undefined)?.['isType3Font'] === true);
    return { name: realName || loadedName, isType3Font };
  } catch {
    return { name: loadedName, isType3Font: false };
  }
}

export async function extractTextElements(
  page: PDFPageProxy,
  _pageNumber: number,
  pageHeight: number,
): Promise<TextElement[]> {
  const textContent = await page.getTextContent();
  const elements: TextElement[] = [];
  // Get viewport at scale 1 to use its transform matrix for precise coord conversion.
  // viewport.transform composes: PDF→viewport (Y flip + MediaBox offset + rotation).
  const viewport = page.getViewport({ scale: 1 });

  // Walk the operator list to capture the fill colour at every showText
  // event together with its composed baseline (CTM·TM) in PDF user space.
  // We then look up colours by spatial proximity — both showText events
  // and textContent.items expose the same composed baseline, so closest-
  // point matching is deterministic regardless of how pdfjs split the
  // textContent stream.
  const showTextEvents = await buildShowTextEvents(page);

  // Resolve all font names up-front. pdfjs streams font objects lazily; the
  // first call to commonObjs.get(name) blocks until the font is decoded, so
  // resolving them in parallel before iterating items avoids a serial wait.
  const fontNameCache = new Map<string, string>();
  const fontType3Cache = new Map<string, boolean>();
  const uniqueFontIds = new Set<string>();
  for (const item of textContent.items) {
    if (isTextItem(item) && item.fontName) uniqueFontIds.add(item.fontName);
  }
  await Promise.all(
    [...uniqueFontIds].map(async (fid) => {
      const info = await resolvePdfjsFontInfo(page, fid);
      fontNameCache.set(fid, info.name);
      fontType3Cache.set(fid, info.isType3Font);
    }),
  );

  // Index counter for matching against colorByShowTextIdx. Increments
  // only on text items pdfjs delivered (skipping marked-content blocks).
  let textIndex = 0;
  for (const item of textContent.items) {
    if (!isTextItem(item)) continue;
    if (!item.str) continue;
    // Keep whitespace-only items when they carry positional width — pdfjs
    // emits them between adjacent TJ runs ("BOULEVARD" + " " + "EUGENE") and
    // dropping them collapses the gap, producing visual overlap. We still
    // skip pure-empty strings (zero-width markers) to avoid noise.
    if (item.str.trim() === '' && (item.width ?? 0) <= 0) continue;
    // Type3 fonts encode glyphs as PDF content streams (paths). pdfjs reports
    // the codepoint as text but the character has no Unicode mapping — it
    // would render as garbage like "*[3887|437]*" in the substitute font.
    // The same glyph stream emits real path operators which the drawing
    // extractor captures, so dropping the text version keeps the visual
    // intent (barcode bars, ornaments) intact and removes the noise.
    if (fontType3Cache.get(item.fontName ?? '') === true) {
      textIndex++;
      continue;
    }

    // Compose item.transform with viewport.transform to get absolute viewport coords.
    // Handles MediaBox offset, rotation, Y-flip in one matrix multiplication.
    const combined = pdfjsLib.Util.transform(
      viewport.transform,
      item.transform as number[],
    ) as number[];
    const [vpA, vpB, , , vpE, vpF] = combined;

    // Font size in viewport space = scale factor magnitude
    const fontSize = Math.sqrt((vpA ?? 1) * (vpA ?? 1) + (vpB ?? 0) * (vpB ?? 0));
    if (fontSize < 0.1) continue;

    // Rotation angle of the baseline in canvas space (Y-down).
    // atan2(b, a) returns 0 for horizontal text, π/2 for 90° CCW, etc.
    // Convert to degrees so Fabric can consume it directly.
    const rotationRad = Math.atan2(vpB ?? 0, vpA ?? 1);
    const rotationDeg = rotationRad * 180 / Math.PI;

    // item.width is in PDF user-space units (already × fontSize). Height
    // is similarly in viewport units. For rotated text the bbox width/
    // height swap in canvas space — but the *intrinsic* run length and
    // line height (the numbers the editor needs to typeset the IText)
    // stay the same. We store the run length as bounds.width and fontSize
    // as bounds.height; callers apply bounds.rotation to orient them.
    const runLength = item.width > 0 ? item.width : fontSize * item.str.length * 0.5;
    const height = item.height > 0 ? item.height : fontSize;

    // vpE, vpF = BASELINE START in canvas (Y-down, top-left origin).
    // bounds.{x,y} is stored as the TOP-LEFT corner of the glyph bbox so
    // it matches the convention used by webToPdf() and apply-elements
    // (mask rectangle + addText assume top-left). Approximating ascender
    // as fontSize is good enough for the kind of fonts we encounter
    // (cap-height ≈ fontSize for OCRB / Helvetica / Gotham / Iliad). The
    // Fabric renderer compensates by setting top = bounds.y + fontSize
    // with originY='bottom', so the visible baseline still lands on vpF.
    const x = vpE ?? 0;
    const y = (vpF ?? 0) - fontSize;
    // Unused but suppress warning
    void pageHeight;

    // Use the real PostScript name (e.g. "Arial-BoldMT") instead of the
    // pdfjs-internal loadedName (e.g. "g_d0_f1"), so mapPdfFontToStandard
    // can detect Bold/Italic variants from the suffix.
    const realFontName = fontNameCache.get(item.fontName ?? '') ?? item.fontName ?? '';
    const { fontFamily, fontWeight, fontStyle } = mapPdfFontToStandard(realFontName);

      // Look up the colour by matching the item's composed baseline against
    // the showText events. Both use CTM·TM-composed PDF user space coords
    // — the closest event within tolerance gives the painted colour.
    const baselineX = (item.transform as number[])[4] ?? 0;
    const baselineY = (item.transform as number[])[5] ?? 0;
    const color = findColorAtPosition(showTextEvents, baselineX, baselineY);
    textIndex++;

    elements.push({
      elementId: randomUUID(),
      type: 'text',
      bounds: { x, y, width: runLength, height },
      transform: { rotation: rotationDeg, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 },
      layerId: null,
      locked: false,
      visible: true,
      content: item.str,
      style: {
        fontFamily,
        fontWeight,
        fontStyle,
        fontSize,
        color,
        opacity: 1,
        textAlign: 'left',
        lineHeight: 1.2,
        letterSpacing: 0,
        writingMode: 'horizontal-tb',
        underline: false,
        strikethrough: false,
        backgroundColor: null,
        verticalAlign: 'baseline',
        originalFont: realFontName || null,
      },
      ocrConfidence: null,
      linkUrl: null,
      linkPage: null,
    });
  }

  return elements;
}

// ---------------------------------------------------------------------------
// extractTextBlocks — new rich API for the Fabric.js editor
// ---------------------------------------------------------------------------

/**
 * Extract text blocks with precise positions, real fonts, alignment detection,
 * and colour extraction for use in the Fabric.js editor.
 *
 * Coordinates are in **web space** (origin top-left, Y increases downward),
 * expressed in PDF points (1 pt = 1/72 inch).
 *
 * @param pdfBytes - Raw PDF bytes (ArrayBuffer or Uint8Array)
 * @param pageNumber - 1-based page number. When omitted, all pages are processed.
 * @returns Array of TextBlock objects ordered top-left → bottom-right.
 */
export async function extractTextBlocks(
  pdfBytes: ArrayBuffer | Uint8Array,
  pageNumber?: number,
): Promise<TextBlock[]> {
  const loadingTask = pdfjsLib.getDocument({
    data: pdfBytes instanceof ArrayBuffer ? new Uint8Array(pdfBytes) : pdfBytes,
    // Disable worker in Node.js environment
    useWorkerFetch: false,
    isEvalSupported: false,
    useSystemFonts: true,
  });

  const pdfDoc = await loadingTask.promise;
  const numPages = pdfDoc.numPages;

  // Determine which pages to process
  const pagesToProcess =
    pageNumber !== undefined
      ? [Math.max(1, Math.min(pageNumber, numPages))]
      : Array.from({ length: numPages }, (_, i) => i + 1);

  const allBlocks: TextBlock[] = [];

  for (const pgNum of pagesToProcess) {
    const page = await pdfDoc.getPage(pgNum);
    const viewport = page.getViewport({ scale: 1 });
    const pageHeight = viewport.height;

    // Build colour map from operator list (best-effort)
    const colorMap = await buildColorMap(page);

    // Get text content
    const textContent = await page.getTextContent({
      includeMarkedContent: true,
    });

    // Resolve real PostScript font names from pdfjs internal loadedNames.
    // See `resolvePdfjsFontName` for the rationale: without this, every run
    // gets the same g_d0_fN id and we lose Bold/Italic detection.
    const fontNameCache = new Map<string, string>();
    const uniqueFontIds = new Set<string>();
    for (const item of textContent.items) {
      if (isTextItem(item) && item.fontName) uniqueFontIds.add(item.fontName);
    }
    await Promise.all(
      [...uniqueFontIds].map(async (fid) => {
        fontNameCache.set(fid, await resolvePdfjsFontName(page, fid));
      }),
    );

    // Convert pdfjs items to enriched TextRun objects
    const runs: TextRun[] = [];

    for (const item of textContent.items) {
      if (!isTextItem(item)) continue;
      if (!item.str) continue;

      const transform = item.transform as number[];
      const [a, b, , , tx, ty] = transform;
      const safeA = a ?? 1;
      const safeB = b ?? 0;
      const safeTx = tx ?? 0;
      const safeTy = ty ?? 0;

      // Font size = scale factor from transform matrix
      const fontSize = Math.sqrt(safeA * safeA + safeB * safeB);
      if (fontSize < 0.1) continue; // Skip invisible/zero-size text

      const itemHeight = item.height > 0 ? item.height : fontSize;
      const itemWidth = item.width > 0 ? item.width : fontSize * item.str.length * 0.5;

      // Compute rotation from transform matrix
      const rotation = rotationFromTransform(transform);

      // PDF coordinates (bottom-left origin)
      // In pdfjs, transform[5] (ty) positions the text BASELINE in PDF coords,
      // not the bottom of the bounding box. The ascender (~80% of font size) sits
      // ABOVE the baseline.
      const pdfX = safeTx;
      const pdfY = safeTy;

      // Web coordinates (top-left origin): flip Y to top-of-bounding-box.
      // Top of text box (in PDF) = baseline + ascender ≈ ty + fontSize * 0.8
      // Web Y = pageHeight - (ty + ascender) = pageHeight - ty - 0.8 * fontSize
      const ascender = fontSize * 0.8;
      const webX = pdfX;
      const webY = pageHeight - pdfY - ascender;

      // Look up colour from the operator list map
      const colorKey = pdfY.toFixed(1);
      const color = colorMap.get(colorKey) ?? '#000000';

      const loadedName = item.fontName ?? '';
      // Replace pdfjs internal id with the real PostScript name.
      const fontName = fontNameCache.get(loadedName) ?? loadedName;

      runs.push({
        str: item.str,
        fontName,
        fontSize,
        pdfX,
        pdfY,
        width: itemWidth,
        height: itemHeight,
        webX,
        webY,
        rotation,
        color,
      });
    }

    if (runs.length === 0) {
      page.cleanup();
      continue;
    }

    // Group runs into visual lines
    const lines = groupRunsIntoLines(runs);

    // For each line, coalesce adjacent runs with same font+size into blocks
    for (const line of lines) {
      const coalescedGroups = coalesceLineRuns(line);

      for (const group of coalescedGroups) {
        if (group.length === 0) continue;

        const firstRun = group[0]!;
        const lastRun = group[group.length - 1]!;

        // Merge content (preserve spaces that pdfjs inserts between runs)
        const content = group.map((r) => r.str).join('');
        if (!content.trim()) continue;

        // Compute bounding box in web coords
        const blockX = firstRun.webX;
        const blockY = Math.min(...group.map((r) => r.webY));
        const blockWidth = lastRun.webX + lastRun.width - firstRun.webX;
        const blockHeight = Math.max(...group.map((r) => r.height));

        // Pick dominant properties from the first run
        const rawFontName = firstRun.fontName;
        const { fontWeight, fontStyle } = mapPdfFontToStandard(rawFontName);
        const fontFamily = extractFontFamily(rawFontName);
        const fontId = normaliseFontId(rawFontName);

        // Detect text direction heuristically (RTL if most chars have code > 0x0590)
        const rtlCharCount = [...content].filter(
          (ch) => ch.codePointAt(0)! >= 0x0590 && ch.codePointAt(0)! <= 0x08ff,
        ).length;
        const direction: 'ltr' | 'rtl' =
          rtlCharCount > content.length * 0.4 ? 'rtl' : 'ltr';

        // Stable element id derived from content + position
        const elementId = deriveStableId(content, blockX, blockY, pgNum);

        allBlocks.push({
          elementId,
          pageNumber: pgNum,
          content,
          bounds: {
            x: blockX,
            y: blockY,
            width: Math.max(blockWidth, 1),
            height: Math.max(blockHeight, firstRun.fontSize),
          },
          style: {
            fontFamily,
            fontSize: firstRun.fontSize,
            fontWeight,
            fontStyle,
            color: firstRun.color,
            alignment: 'left', // Updated below during multi-line pass
            originalFont: rawFontName || undefined,
            fontId: fontId || undefined,
          },
          direction,
          rotation: firstRun.rotation !== 0 ? firstRun.rotation : undefined,
        });
      }
    }

    // ---------------------------------------------------------------------------
    // Second pass: detect alignment across lines that share the same font+size
    // and are vertically stacked (same horizontal region).
    //
    // We group blocks that are "paragraphs" (same fontFamily+size, X positions
    // overlap, vertical proximity ≤ 2 × lineHeight) and compute alignment.
    // ---------------------------------------------------------------------------
    const pageBlocks = allBlocks.filter((b) => b.pageNumber === pgNum);

    // Sort page blocks top-to-bottom, left-to-right
    pageBlocks.sort((a, b) => {
      const dy = a.bounds.y - b.bounds.y;
      return Math.abs(dy) > 1 ? dy : a.bounds.x - b.bounds.x;
    });

    // Group into paragraphs
    interface ParagraphGroup {
      blocks: TextBlock[];
    }

    const paragraphs: ParagraphGroup[] = [];
    const visited = new Set<string>();

    for (const block of pageBlocks) {
      if (visited.has(block.elementId)) continue;
      const group: TextBlock[] = [block];
      visited.add(block.elementId);

      for (const other of pageBlocks) {
        if (visited.has(other.elementId)) continue;
        if (
          other.style.fontFamily === block.style.fontFamily &&
          Math.abs(other.style.fontSize - block.style.fontSize) < 0.5 &&
          Math.abs(other.bounds.x - block.bounds.x) < block.bounds.width &&
          other.bounds.y - (block.bounds.y + block.bounds.height) <
            block.style.fontSize * 2.5
        ) {
          group.push(other);
          visited.add(other.elementId);
        }
      }

      paragraphs.push({ blocks: group });
    }

    // Compute alignment per paragraph and write back
    for (const { blocks } of paragraphs) {
      if (blocks.length < 2) continue;

      const lineInfos = blocks.map((b) => ({
        startX: b.bounds.x,
        endX: b.bounds.x + b.bounds.width,
        midX: b.bounds.x + b.bounds.width / 2,
      }));

      const alignment = detectAlignment(lineInfos);

      for (const b of blocks) {
        b.style.alignment = alignment;
      }
    }

    page.cleanup();
  }

  // Sort all blocks: page asc, then top-left → bottom-right within each page
  allBlocks.sort((a, b) => {
    if (a.pageNumber !== b.pageNumber) return a.pageNumber - b.pageNumber;
    const dy = a.bounds.y - b.bounds.y;
    return Math.abs(dy) > 1 ? dy : a.bounds.x - b.bounds.x;
  });

  await pdfDoc.destroy();

  return allBlocks;
}
