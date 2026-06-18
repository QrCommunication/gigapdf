/**
 * High-level entry point for applying a batch of element operations to a PDF.
 *
 * Implements the canonical 2-pass pipeline:
 *
 *   Phase 0 — open input bytes with the engine only to extract per-page
 *             metadata (height, width, rotation) needed for the
 *             web → PDF user-space coordinate conversion. No mutation.
 *
 *   Phase 1 — applyRedactions(inputBytes, redactionTargets) physically
 *             removes original glyphs / images / line-art from the
 *             oldBounds area of every update + delete op. Operates on
 *             the pristine input bytes. Falls back to the input bytes
 *             unchanged if the redaction pass errors out (degraded: doublons visible).
 *
 *   Phase 2 — re-open the engine on the redacted bytes, run every add op
 *             (plus every update op re-cast as add at the NEW element
 *             bounds). Save.
 *
 * This is the single source of truth for the edit pipeline. All routes
 * (`/api/pdf/apply-elements`, `/api/pdf/text`, `/api/pdf/image`, and any
 * future single-element route) call this helper instead of the legacy
 * mask-based `updateText` / `updateImage` / `deleteElementArea`.
 */

import { openDocument, saveDocument, closeDocument } from '../engine/document-handle';
import { setFontCacheForHandle } from '../utils/font-cache-port';
import type { FontCachePort } from '../utils/font-cache-port';
import { addText } from './text-renderer';
import { addImage } from './image-renderer';
import { addShape } from './shape-renderer';
import { addAnnotation } from './annotation-renderer';
import { addFormField } from './form-renderer';
import { applyRedactions } from './engine-redact';
import type { RedactionTarget } from './engine-redact';
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
  /** Final PDF bytes after both passes. */
  bytes: Uint8Array;
  /** Number of redaction targets accumulated from update + delete ops. */
  redactionTargetsCount: number;
  /** Number of redactions the engine actually applied (may be smaller if some pages were out of range). */
  redactionsApplied: number;
  /** True when Phase 1 redaction completed successfully. False when it errored and we fell back. */
  redactionSucceeded: boolean;
  /** Number of `add` (+ re-cast `update`) ops applied in Phase 2. */
  addsApplied: number;
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

export async function applyOperations(
  inputBytes: Uint8Array | Buffer,
  operations: ElementOperation[],
  options: ApplyOperationsOptions & { extractImageData?: ImageDataExtractor } = {},
): Promise<ApplyOperationsResult> {
  const inputBuffer = Buffer.isBuffer(inputBytes)
    ? inputBytes
    : Buffer.from(inputBytes);
  const extractImageData = options.extractImageData ?? defaultExtractImageData;

  // ── Phase 0: extract page metadata via the engine (no mutation) ─────────
  const metaHandle = await openDocument(inputBuffer);

  const toPdfBounds = (
    pageNumber: number,
    webBounds: { x: number; y: number; width: number; height: number },
  ): RedactionTarget['bounds'] => {
    const { width: pageW, height: pageH, rotation } = metaHandle._doc.pageInfo(pageNumber);
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

  // Classify ops into the two buckets.
  const redactionTargets: RedactionTarget[] = [];
  const addOps: Array<{
    pageNumber: number;
    element: Record<string, unknown>;
    elementType: string | undefined;
    originalIndex: number;
  }> = [];

  for (let opIndex = 0; opIndex < operations.length; opIndex++) {
    const op = operations[opIndex]!;
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
        bounds: toPdfBounds(pageNumber, oldBounds),
      });
      // Re-cast as add at element.bounds (the NEW position carried by the element).
      addOps.push({ pageNumber, element, elementType, originalIndex: opIndex });
    } else if (action === 'delete') {
      const bounds = (element['bounds'] ?? oldBounds) as Bounds | undefined;
      if (bounds) {
        redactionTargets.push({
          pageNumber,
          bounds: toPdfBounds(pageNumber, bounds),
        });
      }
    }
  }

  // Phase 0 done — release the metadata-only handle (frees its WASM document).
  closeDocument(metaHandle);

  // ── Phase 1: redaction on the pristine input ────────────────────────────
  let workingBytes: Uint8Array = new Uint8Array(inputBuffer);
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

  // ── Phase 2: native add pass on (potentially redacted) bytes ────────────
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
  };
}
