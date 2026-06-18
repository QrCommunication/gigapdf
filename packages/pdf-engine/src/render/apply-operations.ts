/**
 * High-level entry point for applying a batch of element operations to a PDF.
 *
 * Two layered strategies, applied in order, so every edit takes the cleanest
 * path the engine can express:
 *
 *   ── In-place pass (preferred for text) ──────────────────────────────────
 *   When an `update`/`delete` targets a `text` element that carries a valid
 *   engine run `index` (from `GigaPdfDoc.textElements().index`) AND the change
 *   is expressible by the engine's font-aware in-place ops, we mutate the run
 *   directly:
 *     - text-content and/or position only  → `replaceText` (+ `moveElement`)
 *     - delete                             → `removeElement`
 *   This rewrites the original content stream (font, size, colour and position
 *   preserved), so there is NO duplicate left behind and NO redaction needed —
 *   copy/paste in the result reveals exactly one run.
 *
 *   ── Redact + add fallback (everything else) ─────────────────────────────
 *   The canonical 2-pass pipeline, unchanged, for every op the in-place pass
 *   does not handle: no/invalid index, FORM-XObject text, style changes
 *   `replaceText` can't express (font/size/colour differ), non-text types and
 *   plain `add`s.
 *     Phase 1 — applyRedactions(bytes, redactionTargets) physically removes
 *               original glyphs/images/line-art from the oldBounds area of
 *               every fallback update + delete.
 *     Phase 2 — re-open the engine, run every add op (plus every fallback
 *               update re-cast as add at the NEW element bounds). Save.
 *
 * Re-architecture (in-place ↔ redact+add ordering)
 * =================================================
 * The in-place ops MUST run before the redact pass — but the redact pass needs
 * the bytes that result from those edits, not the original input. So we open a
 * mutating handle from the input, apply the in-place ops, `save()` to obtain
 * `afterInPlaceBytes`, then run the existing redact + add 2-pass on
 * `afterInPlaceBytes` for the REMAINING (fallback) ops only. In-place text
 * edits never move the OTHER elements on the page, so the redaction bounds of
 * the fallback ops still line up exactly with their on-page regions.
 *
 * Batch index stability
 * =====================
 * `removeElement` shifts the indices of every later run on the same page;
 * `replaceText`/`moveElement` do not change the run count. The robust rule is
 * therefore to process a page's in-place ops in DESCENDING index order — a
 * remove can only invalidate HIGHER indices, which have already been processed,
 * so a lower (not-yet-processed) index is never disturbed. If two in-place
 * edits target the same `(page, index)` that's a caller bug: last wins, logged.
 *
 * This is the single source of truth for the edit pipeline. All routes
 * (`/api/pdf/apply-elements`, `/api/pdf/text`, `/api/pdf/image`, and any
 * future single-element route) call this helper instead of the legacy
 * mask-based `updateText` / `updateImage` / `deleteElementArea`.
 */

import { openDocument, saveDocument, closeDocument } from '../engine/document-handle';
import type { PDFDocumentHandle } from '../engine/document-handle';
import { setFontCacheForHandle } from '../utils/font-cache-port';
import type { FontCachePort } from '../utils/font-cache-port';
import { addText } from './text-renderer';
import { addImage } from './image-renderer';
import { addShape } from './shape-renderer';
import { addAnnotation } from './annotation-renderer';
import { addFormField } from './form-renderer';
import { applyRedactions } from './engine-redact';
import type { RedactionTarget } from './engine-redact';
import { rgbToHex } from '../utils';
import { webToPdf } from '../utils/coordinates';
import { engineLogger } from '../utils/logger';
import type {
  TextElement,
  ImageElement,
  ShapeElement,
  AnnotationElement,
  FormFieldElement,
  Bounds,
} from '@giga-pdf/types';

export interface ElementOperation {
  /** `add`: materialise new content; `update`: redact oldBounds + add at element.bounds; `delete`: redact bounds only. */
  action: 'add' | 'update' | 'delete';
  /** 1-based page number. */
  pageNumber: number;
  /** Element payload (must include `type`). For `delete`, only `bounds` may be present. */
  element: Record<string, unknown>;
  /** Web-coordinate bounds of the area to redact (required for `update`, optional for `delete`). */
  oldBounds?: { x: number; y: number; width: number; height: number };
}

export interface ApplyOperationsOptions {
  /** Optional Prisma-backed font cache for Type1/CFF→TTF conversion memoisation. */
  fontCache?: FontCachePort;
}

export interface ApplyOperationsResult {
  /** Final PDF bytes after the in-place pass and both fallback passes. */
  bytes: Uint8Array;
  /** Number of redaction targets accumulated from the FALLBACK update + delete ops. */
  redactionTargetsCount: number;
  /** Number of redactions the engine actually applied (may be smaller if some pages were out of range). */
  redactionsApplied: number;
  /** True when Phase 1 redaction completed successfully. False when it errored and we fell back. */
  redactionSucceeded: boolean;
  /** Number of `add` (+ re-cast fallback `update`) ops applied in Phase 2. */
  addsApplied: number;
  /** Number of `replaceText` in-place text-content edits applied. */
  inPlaceReplaced: number;
  /** Number of `moveElement` in-place repositions applied. */
  inPlaceMoved: number;
  /** Number of `removeElement` in-place deletes applied. */
  inPlaceRemoved: number;
}

type ImageDataExtractor = (element: Record<string, unknown>) => Uint8Array | undefined;

/**
 * Default image-data extractor: pulls `element.source.dataUrl` (base64 data
 * URL) and decodes it via Node's Buffer. Callers can override via
 * `applyOperations(bytes, ops, { extractImageData })` to support other
 * image-source schemes (S3 object refs, FormData blobs, etc.).
 */
const defaultExtractImageData: ImageDataExtractor = (element) => {
  const source = element['source'] as Record<string, unknown> | undefined;
  if (!source) return undefined;
  const dataUrl = source['dataUrl'];
  if (typeof dataUrl !== 'string' || !dataUrl) return undefined;
  const commaIndex = dataUrl.indexOf(',');
  const base64 = commaIndex !== -1 ? dataUrl.slice(commaIndex + 1) : dataUrl;
  return new Uint8Array(Buffer.from(base64, 'base64'));
};

// ── In-place helpers ───────────────────────────────────────────────────────

/** Largest array index the engine accepts (anything `>=` this is a sentinel). */
const MAX_RUN_INDEX = 2 ** 31;

/** A position delta below this (in PDF points) is treated as "no move". */
const MOVE_TOLERANCE = 0.5;

/**
 * Validate an engine run index. The engine assigns a negative sentinel (e.g.
 * `-1`) — and could assign a huge out-of-range value — to FORM-XObject text it
 * cannot edit in place; both are rejected so such ops take the safe fallback.
 */
function isValidRunIndex(index: unknown): index is number {
  return (
    typeof index === 'number' &&
    Number.isInteger(index) &&
    index >= 0 &&
    index < MAX_RUN_INDEX
  );
}

/**
 * Whether the NEW text element keeps the SAME font family, size and colour as
 * the engine run it targets — i.e. only its text and/or position changed.
 * `replaceText` re-encodes the run through its existing font and cannot change
 * the typeface, point size or fill colour, so a mismatch must fall back to the
 * redact + add path (which materialises a brand-new run with the new style).
 */
function styleMatchesRun(
  element: TextElement,
  run: { fontFamily: string; bold: boolean; italic: boolean; fontSize: number; color: [number, number, number] },
): boolean {
  const style = element.style;
  if (!style) return false;

  // Font size — within a sub-point tolerance (the engine reports the effective
  // glyph size, which can carry tiny rounding vs the editor's stored value).
  if (Math.abs(style.fontSize - run.fontSize) > 0.5) return false;

  // Weight / slant — the editor models these as `fontWeight`/`fontStyle`.
  const runBold = run.bold ? 'bold' : 'normal';
  const runItalic = run.italic ? 'italic' : 'normal';
  if ((style.fontWeight ?? 'normal') !== runBold) return false;
  if ((style.fontStyle ?? 'normal') !== runItalic) return false;

  // Fill colour — compare as normalised `#rrggbb`. The run colour is an
  // engine RGB triple (0..1 per channel); reuse the same hex conversion the
  // extractor applies so the comparison is exact.
  const runHex = rgbToHex(run.color[0], run.color[1], run.color[2]).toLowerCase();
  const elementHex = (style.color ?? '').toLowerCase();
  if (elementHex !== runHex) return false;

  // Font family — compare case-insensitively; `originalFont` (the engine-
  // resolved `/BaseFont`) is the closest match to the run's reported family.
  const runFamily = run.fontFamily.toLowerCase();
  const elementFamily = (style.originalFont ?? style.fontFamily ?? '').toLowerCase();
  if (elementFamily !== runFamily) return false;

  return true;
}

/** One classified in-place op, resolved against the run currently at `index`. */
interface InPlaceOp {
  pageNumber: number;
  index: number;
  /** `replace`: set new text (+ optional move); `remove`: delete the run. */
  kind: 'replace' | 'remove';
  /** New text content (for `replace`). */
  newText?: string;
  /** PDF-space deltas for an accompanying `moveElement` (for `replace`). */
  move?: { dx: number; dy: number };
  /** Diagnostics. */
  originalIndex: number;
}

export async function applyOperations(
  inputBytes: Uint8Array | Buffer,
  operations: ElementOperation[],
  options: ApplyOperationsOptions & { extractImageData?: ImageDataExtractor } = {},
): Promise<ApplyOperationsResult> {
  const inputBuffer = Buffer.isBuffer(inputBytes)
    ? inputBytes
    : Buffer.from(inputBytes);
  const extractImageData = options.extractImageData ?? defaultExtractImageData;

  // ── In-place pass: open a mutating handle on the INPUT, edit runs directly ──
  //
  // We do this first because the redact pass below must operate on the bytes
  // that result from the in-place edits, not the pristine input. Ops that can't
  // be handled in place are collected in `fallbackOps` for the redact + add
  // pipeline that follows.
  const inPlaceHandle = await openDocument(inputBuffer);

  // PDF user-space bounds from web bounds for a given page (rotation-aware).
  const toPdfBounds = (
    handle: PDFDocumentHandle,
    pageNumber: number,
    webBounds: { x: number; y: number; width: number; height: number },
  ): RedactionTarget['bounds'] => {
    const { width: pageW, height: pageH, rotation } = handle._doc.pageInfo(pageNumber);
    return webToPdf(
      webBounds.x,
      webBounds.y,
      webBounds.width,
      webBounds.height,
      pageH,
      pageW,
      rotation as 0 | 90 | 180 | 270,
    );
  };

  // Cache of `textElements(page)` results keyed by page, so we read each page's
  // runs at most once while classifying (and so a later `removeElement` can't
  // perturb the snapshot we classified against — we apply by index afterwards).
  const runsByPage = new Map<number, ReturnType<typeof inPlaceHandle._doc.textElements>>();
  const runsFor = (page: number) => {
    let runs = runsByPage.get(page);
    if (!runs) {
      runs = inPlaceHandle._doc.textElements(page);
      runsByPage.set(page, runs);
    }
    return runs;
  };

  const inPlaceOps: InPlaceOp[] = [];
  const fallbackOps: ElementOperation[] = [];

  for (let opIndex = 0; opIndex < operations.length; opIndex++) {
    const op = operations[opIndex]!;
    const { action, pageNumber, element } = op;
    const elementType = element['type'] as string | undefined;

    // Only text elements carrying a valid engine run index are eligible. `add`
    // always materialises brand-new content (no existing run to edit).
    const rawIndex = (element as Partial<TextElement>).index;
    const eligible =
      (action === 'update' || action === 'delete') &&
      elementType === 'text' &&
      isValidRunIndex(rawIndex);

    if (!eligible) {
      fallbackOps.push(op);
      continue;
    }

    const index = rawIndex as number;
    const run = runsFor(pageNumber).find((r) => r.index === index);

    if (action === 'delete') {
      if (!run) {
        // Index no longer resolves (stale edit) — redact the bounds instead.
        fallbackOps.push(op);
        continue;
      }
      inPlaceOps.push({ pageNumber, index, kind: 'remove', originalIndex: opIndex });
      continue;
    }

    // action === 'update'
    const textElement = element as unknown as TextElement;
    if (!run || !styleMatchesRun(textElement, run)) {
      // No matching run, or a font/size/colour change `replaceText` can't
      // express → fall back so the new style is honoured.
      fallbackOps.push(op);
      continue;
    }

    // Position delta (PDF user space). `update` without `oldBounds` is rejected
    // by the fallback path, but here we may still have moved — derive the delta
    // from the element's NEW bounds vs the supplied `oldBounds` (if any).
    let move: InPlaceOp['move'];
    if (op.oldBounds && textElement.bounds) {
      const pdfOld = toPdfBounds(inPlaceHandle, pageNumber, op.oldBounds);
      const pdfNew = toPdfBounds(inPlaceHandle, pageNumber, textElement.bounds);
      const dx = pdfNew.x - pdfOld.x;
      const dy = pdfNew.y - pdfOld.y;
      if (Math.abs(dx) > MOVE_TOLERANCE || Math.abs(dy) > MOVE_TOLERANCE) {
        move = { dx, dy };
      }
    }

    inPlaceOps.push({
      pageNumber,
      index,
      kind: 'replace',
      newText: textElement.content ?? '',
      move,
      originalIndex: opIndex,
    });
  }

  // Apply the in-place ops PER PAGE in DESCENDING index order so a
  // `removeElement` never invalidates a not-yet-processed lower index.
  let inPlaceReplaced = 0;
  let inPlaceMoved = 0;
  let inPlaceRemoved = 0;

  if (inPlaceOps.length > 0) {
    const byPage = new Map<number, InPlaceOp[]>();
    for (const ip of inPlaceOps) {
      const bucket = byPage.get(ip.pageNumber);
      if (bucket) bucket.push(ip);
      else byPage.set(ip.pageNumber, [ip]);
    }

    for (const [page, ops] of byPage) {
      // Detect duplicate targets on the same page (caller bug) — last wins.
      const seen = new Set<number>();
      for (const ip of ops) {
        if (seen.has(ip.index)) {
          engineLogger.warn('applyOperations: duplicate in-place op for same run', {
            page,
            index: ip.index,
          });
        }
        seen.add(ip.index);
      }

      ops.sort((a, b) => b.index - a.index); // descending

      for (const ip of ops) {
        try {
          if (ip.kind === 'remove') {
            if (inPlaceHandle._doc.removeElement(page, ip.index)) inPlaceRemoved++;
          } else {
            if (inPlaceHandle._doc.replaceText(page, ip.index, ip.newText ?? '')) {
              inPlaceReplaced++;
            }
            if (ip.move) {
              if (inPlaceHandle._doc.moveElement(page, ip.index, ip.move.dx, ip.move.dy)) {
                inPlaceMoved++;
              }
            }
          }
        } catch (err) {
          // An in-place op that throws must not abort the batch — log and let
          // the page fall through unchanged. (Editing is best-effort; the
          // remaining fallback pass below still runs for the other ops.)
          engineLogger.warn('applyOperations: in-place op failed', {
            page,
            index: ip.index,
            kind: ip.kind,
            originalIndex: ip.originalIndex,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  }

  // Serialise the in-place edits, then release the mutating handle. The redact
  // + add pipeline below re-opens from these bytes.
  const afterInPlaceBytes =
    inPlaceOps.length > 0
      ? new Uint8Array(await saveDocument(inPlaceHandle))
      : new Uint8Array(inputBuffer);
  closeDocument(inPlaceHandle);

  // ── Phase 0: page metadata for the FALLBACK ops' web → PDF conversion ───────
  const metaHandle = await openDocument(Buffer.from(afterInPlaceBytes));

  // Classify the fallback ops into redaction targets + add ops.
  const redactionTargets: RedactionTarget[] = [];
  const addOps: Array<{
    pageNumber: number;
    element: Record<string, unknown>;
    elementType: string | undefined;
    originalIndex: number;
  }> = [];

  for (let opIndex = 0; opIndex < fallbackOps.length; opIndex++) {
    const op = fallbackOps[opIndex]!;
    const { action, pageNumber, element, oldBounds } = op;
    const elementType = element['type'] as string | undefined;

    if (action === 'add') {
      addOps.push({ pageNumber, element, elementType, originalIndex: opIndex });
    } else if (action === 'update') {
      if (!oldBounds) {
        throw new Error(
          `applyOperations: oldBounds is required for update operations (op[${opIndex}], element type: ${elementType ?? 'unknown'}).`,
        );
      }
      redactionTargets.push({
        pageNumber,
        bounds: toPdfBounds(metaHandle, pageNumber, oldBounds),
      });
      // Re-cast as add at element.bounds (the NEW position carried by the element).
      addOps.push({ pageNumber, element, elementType, originalIndex: opIndex });
    } else if (action === 'delete') {
      const bounds = (element['bounds'] ?? oldBounds) as Bounds | undefined;
      if (bounds) {
        redactionTargets.push({
          pageNumber,
          bounds: toPdfBounds(metaHandle, pageNumber, bounds),
        });
      }
    }
  }

  // Phase 0 done — release the metadata-only handle (frees its WASM document).
  closeDocument(metaHandle);

  // ── Phase 1: redaction on the post-in-place bytes ───────────────────────────
  let workingBytes: Uint8Array = afterInPlaceBytes;
  let redactionsApplied = 0;
  let redactionSucceeded = true;

  if (redactionTargets.length > 0) {
    try {
      const result = await applyRedactions(workingBytes, redactionTargets);
      workingBytes = result.bytes;
      redactionsApplied = result.applied;
    } catch (err) {
      redactionSucceeded = false;
      engineLogger.warn('applyOperations: redaction failed, proceeding without', {
        error: err instanceof Error ? err.message : String(err),
        targetCount: redactionTargets.length,
      });
    }
  }

  // ── Phase 2: native add pass on (potentially redacted) bytes ────────────────
  const handle = await openDocument(Buffer.from(workingBytes));
  if (options.fontCache) {
    setFontCacheForHandle(handle, options.fontCache);
  }

  let addsApplied = 0;
  for (const op of addOps) {
    const { pageNumber, element, elementType, originalIndex } = op;
    try {
      switch (elementType) {
        case 'text': {
          await addText(handle, pageNumber, element as unknown as TextElement);
          break;
        }
        case 'image': {
          const imageData = extractImageData(element);
          if (imageData) {
            await addImage(handle, pageNumber, element as unknown as ImageElement, imageData);
          }
          break;
        }
        case 'shape': {
          addShape(handle, pageNumber, element as unknown as ShapeElement);
          break;
        }
        case 'annotation': {
          await addAnnotation(handle, pageNumber, element as unknown as AnnotationElement);
          break;
        }
        case 'form_field': {
          addFormField(handle, pageNumber, element as unknown as FormFieldElement);
          break;
        }
        default:
          // Unknown type: skip silently (the redaction may still have run).
          continue;
      }
      addsApplied++;
    } catch (opError) {
      const elementId = element['elementId'] ?? element['id'];
      const annotated = new Error(
        `applyOperations: op[${originalIndex}] failed (type=${elementType ?? 'unknown'}, page=${pageNumber}, elementId=${elementId ?? 'n/a'}): ${opError instanceof Error ? opError.message : String(opError)}`,
      );
      if (opError instanceof Error) {
        (annotated as Error & { cause?: unknown }).cause = opError;
      }
      throw annotated;
    }
  }

  const finalBytes = await saveDocument(handle);
  closeDocument(handle);

  return {
    bytes: new Uint8Array(finalBytes),
    redactionTargetsCount: redactionTargets.length,
    redactionsApplied,
    redactionSucceeded,
    addsApplied,
    inPlaceReplaced,
    inPlaceMoved,
    inPlaceRemoved,
  };
}
