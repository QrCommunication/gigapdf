import { rgb, degrees, PDFName, decodePDFRawStream } from 'pdf-lib';
import type { PDFFont } from 'pdf-lib';
import { createHash } from 'node:crypto';
import type { PDFDocumentHandle } from '../engine/document-handle';
import { markDirty } from '../engine/document-handle';
import type { TextElement, Bounds } from '@giga-pdf/types';
import { hexToRgb } from '../utils/color';
import { webToPdf } from '../utils/coordinates';
import { resolveStandardFont, pickFallbackStandardFont } from '../utils/font-map';
import {
  loadBundledFontBytes,
  pickBundledFamily,
  pickBundledStyle,
} from '../utils/bundled-fonts';
import { engineLogger } from '../utils/logger';
import { PDFPageOutOfRangeError } from '../errors';
import { getFontCacheForHandle } from '../utils/font-cache-port';
import {
  convertFontToTtf,
  FontForgeUnavailableError,
} from '../utils/convert-font-to-ttf';

// ─── Feature Flag ──────────────────────────────────────────────────────────────

function isFontEmbedCustomEnabled(): boolean {
  return process.env['FONT_EMBED_CUSTOM_ENABLED'] === 'true';
}

// ─── Cache polices custom (par documentId) ────────────────────────────────────
// Évite de re-fetcher les bytes à chaque opération dans la même session.
// Clé : `${documentId}::${fontId}`

const embeddedFontCache = new Map<string, PDFFont>();

/** Vide le cache pour un document donné (à appeler à la fermeture du handle). */
export function clearFontCache(documentId: string): void {
  for (const key of embeddedFontCache.keys()) {
    if (key.startsWith(`${documentId}::`)) {
      embeddedFontCache.delete(key);
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getPage(handle: PDFDocumentHandle, pageNumber: number) {
  if (pageNumber < 1 || pageNumber > handle.pageCount) {
    throw new PDFPageOutOfRangeError(pageNumber, handle.pageCount);
  }
  return handle._pdfDoc.getPage(pageNumber - 1);
}

/**
 * Tente d'extraire les bytes d'une police embarquée dans le PDFDocument source.
 *
 * Parcourt les ressources de toutes les pages à la recherche d'une police dont
 * le BaseFont correspond (partiellement, insensible à la casse) au nom demandé.
 * Supporte les polices Type0 (composite, via DescendantFonts → FontDescriptor)
 * et les polices Type1/TrueType (via FontDescriptor direct).
 *
 * @returns Les bytes bruts du programme de police, ou null si introuvable.
 */
/**
 * Normalise un nom de police pour le matching :
 *   - retire le préfixe subset "ABCDEF+"
 *   - retire les suffixes de variante usuels ("-Regular", "MT", "PS", etc.)
 *   - lowercase + strip non-alphanumeric
 *
 * Exemples :
 *   "HXBDOG+OCRB10PitchBT-Regular" → "ocrb10pitchbt"
 *   "Arial-BoldMT"                  → "arialbold"
 *   "/HelveticaNeue-Bold"           → "helveticaneuebold"
 */
function normalizeFontName(raw: string): string {
  return raw
    .replace(/^\//, '')
    .replace(/^[A-Z]{6}\+/, '')
    .replace(/(-?Regular|-?Roman|-?Book|MT|PS)$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Format of the font program embedded in a PDF FontDescriptor.
 *  - truetype : `/FontFile2` — fontkit ingests directly
 *  - cff      : `/FontFile3` (Subtype `/Type1C` or `/CIDFontType0C`) — raw CFF,
 *               needs fontforge to be turned into a TTF fontkit can use
 *  - type1    : legacy `/FontFile` — Adobe Type1 binary, same: needs fontforge
 */
export type ExtractedFontFormat = 'truetype' | 'cff' | 'type1';

export interface ExtractedFontProgram {
  bytes: Uint8Array;
  format: ExtractedFontFormat;
}

function extractFontBytesFromSource(
  handle: PDFDocumentHandle,
  targetFontName: string,
): ExtractedFontProgram | null {
  const normalizedTarget = normalizeFontName(targetFontName);
  if (!normalizedTarget) return null;

  const ctx = handle._pdfDoc.context;

  // Walk EVERY indirect object in the PDF context, not just the page-level
  // Resources. Many PDFs (Free invoices, Word/LibreOffice exports, generated
  // reports) put the Font dict on the /Pages root and have the leaf pages
  // inherit it via the /Parent chain — page.node.Resources() then returns
  // null and the page-only walk silently finds zero fonts. Scanning every
  // indirect object catches every Font regardless of how it's referenced.
  const indirectObjects = ctx.enumerateIndirectObjects();
  for (const [, obj] of indirectObjects) {
    if (!obj || typeof (obj as { get?: unknown }).get !== 'function') continue;

    // A Font dict is identified by /Type=/Font (with /Subtype telling us
    // Type0 / TrueType / Type1). Skip anything else.
    const objAsDict = obj as unknown as { get(k: unknown): unknown };
    const typeName = objAsDict.get(PDFName.of('Type'));
    if (!typeName || String(typeName) !== '/Font') continue;

    const baseFontRef = objAsDict.get(PDFName.of('BaseFont'));
    const candidateName = baseFontRef ? String(baseFontRef) : '';
    const normalizedCandidate = normalizeFontName(candidateName);
    if (!normalizedCandidate) continue;

    // Two-direction substring match (handles subset prefixes, suffix
    // variants, and pdfjs's loadedName trimming differently from pdf-lib).
    const matches =
      normalizedCandidate === normalizedTarget ||
      normalizedCandidate.includes(normalizedTarget) ||
      normalizedTarget.includes(normalizedCandidate);
    if (!matches) continue;

    const bytes = extractFontProgramBytes(
      handle,
      obj as unknown as { get(k: unknown): unknown },
    );
    if (bytes) return bytes;
  }

  return null;
}

/**
 * Extrait les bytes du programme de police depuis un objet police PDF.
 * Supporte Type0 (via DescendantFonts) et Type1/TrueType (FontDescriptor direct).
 */
function extractFontProgramBytes(
  handle: PDFDocumentHandle,
  fontObj: { get(k: unknown): unknown },
): ExtractedFontProgram | null {
  const ctx = handle._pdfDoc.context;

  // Type0 (composite) : DescendantFonts → CIDFont → FontDescriptor
  const descendantRef = fontObj.get(PDFName.of('DescendantFonts'));
  if (descendantRef) {
    const descArr = ctx.lookup(descendantRef as Parameters<typeof ctx.lookup>[0]);
    if (descArr && typeof (descArr as unknown as { get?: unknown }).get === 'function') {
      const cidFontRef = (descArr as unknown as { get(k: unknown): unknown }).get(0);
      const cidFont = cidFontRef ? ctx.lookup(cidFontRef as Parameters<typeof ctx.lookup>[0]) : null;
      if (cidFont && typeof (cidFont as unknown as { get?: unknown }).get === 'function') {
        const found = resolveDescriptorFontFile(handle, cidFont as unknown as { get(k: unknown): unknown });
        if (found) return found;
      }
    }
  }

  // Type1 / TrueType : FontDescriptor direct
  return resolveDescriptorFontFile(handle, fontObj);
}

/**
 * Résout un FontDescriptor et retourne les bytes DÉCODÉS du flux de police,
 * accompagnés du format détecté à partir du tag PDF (FontFile / FontFile2 /
 * FontFile3). Le format guide ensuite la stratégie d'embed :
 *   - truetype → fontkit accepte directement
 *   - cff / type1 → conversion fontforge requise
 */
function resolveDescriptorFontFile(
  handle: PDFDocumentHandle,
  fontOrDescHolder: { get(k: unknown): unknown },
): ExtractedFontProgram | null {
  const ctx = handle._pdfDoc.context;

  const descriptorRef = fontOrDescHolder.get(PDFName.of('FontDescriptor'));
  if (!descriptorRef) return null;

  const descriptor = ctx.lookup(descriptorRef as Parameters<typeof ctx.lookup>[0]);
  if (!descriptor || typeof (descriptor as unknown as { get?: unknown }).get !== 'function') return null;

  const desc = descriptor as unknown as { get(k: unknown): unknown };

  // Order matters: FontFile2 (TrueType) is the most embeddable, try first.
  // FontFile3 (CFF/OpenType-CFF) and FontFile (Type1) both need conversion,
  // but they expose enough format info for downstream code to decide.
  const ff2 = desc.get(PDFName.of('FontFile2'));
  const ff3 = desc.get(PDFName.of('FontFile3'));
  const ff = desc.get(PDFName.of('FontFile'));

  let fileRef: unknown;
  let format: ExtractedFontFormat;
  if (ff2) {
    fileRef = ff2;
    format = 'truetype';
  } else if (ff3) {
    fileRef = ff3;
    format = 'cff';
  } else if (ff) {
    fileRef = ff;
    format = 'type1';
  } else {
    return null;
  }

  const stream = ctx.lookup(fileRef as Parameters<typeof ctx.lookup>[0]);
  if (!stream) return null;

  // Streams in PDFs are typically /FlateDecode-compressed. `getContents()`
  // returns the encoded bytes (raw zlib for the OCRB Type1C in Free's
  // invoices). We MUST decode them before handing to fontkit / fontforge,
  // otherwise the converter sees zlib magic and fails.
  let bytes: Uint8Array | null = null;
  try {
    bytes = decodePDFRawStream(stream as Parameters<typeof decodePDFRawStream>[0]).decode();
  } catch {
    // Fall back to raw bytes for unencoded streams (rare).
    if (typeof (stream as unknown as { getContents?: unknown }).getContents === 'function') {
      bytes = (stream as unknown as { getContents(): Uint8Array }).getContents();
    }
  }
  if (!bytes || bytes.byteLength === 0) return null;

  return { bytes, format };
}

/**
 * Convert Type1/CFF source bytes to TTF, going through the FontCachePort
 * (typically the Prisma `font_cache` table) so that the same source font
 * never gets converted twice on the same VPS.
 *
 * Returns null only if no fallback is possible — fontforge missing AND
 * no cached entry. Caller falls through to the bundled OFL family.
 */
async function convertWithCache(
  handle: PDFDocumentHandle,
  sourceBytes: Uint8Array,
  sourceFormat: ExtractedFontFormat,
  originalFont: string,
): Promise<Uint8Array | null> {
  const sha256 = createHash('sha256').update(sourceBytes).digest('hex');
  const cache = getFontCacheForHandle(handle);

  if (cache) {
    try {
      const hit = await cache.get(sha256);
      if (hit && hit.byteLength > 0) {
        engineLogger.info('Font cache HIT (DB)', {
          originalFont,
          sha256: sha256.slice(0, 12),
          documentId: handle.id,
        });
        return hit;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      engineLogger.warn('Font cache lookup failed, on continue sans', {
        originalFont,
        sha256: sha256.slice(0, 12),
        documentId: handle.id,
        error: message,
      });
    }
  }

  let ttf: Uint8Array;
  try {
    ttf = await convertFontToTtf(
      sourceBytes,
      sourceFormat === 'truetype' ? 'unknown' : sourceFormat,
    );
  } catch (err) {
    if (err instanceof FontForgeUnavailableError) {
      engineLogger.warn(
        'fontforge non installé, conversion impossible — fallback bundled OFL',
        { originalFont, documentId: handle.id },
      );
    } else {
      const message = err instanceof Error ? err.message : String(err);
      engineLogger.warn('Conversion fontforge échouée — fallback bundled OFL', {
        originalFont,
        sourceFormat,
        documentId: handle.id,
        error: message,
      });
    }
    return null;
  }

  if (cache) {
    try {
      await cache.set(sha256, ttf, {
        family: originalFont.replace(/^[A-Z]{6}\+/, '').split(/[-,]/)[0] ?? originalFont,
        postscriptName: originalFont,
        source: sourceFormat === 'cff' ? 'converted-cff' : 'converted-type1',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      engineLogger.warn('Font cache write failed (best-effort)', {
        originalFont,
        sha256: sha256.slice(0, 12),
        documentId: handle.id,
        error: message,
      });
    }
  }

  return ttf;
}

/**
 * Résout la police à utiliser pour un TextElement.
 *
 * Stratégie (par ordre de priorité) :
 *  1. Si FONT_EMBED_CUSTOM_ENABLED && originalFont défini && fontBytes fournis → embed la police custom
 *  2. Si originalFont défini → tenter d'extraire la police du PDF source et la ré-embeder
 *  3. Si fontFamily correspond à une Standard Font → embed la StandardFont
 *  4. Fallback Helvetica avec warning explicite (jamais silencieux)
 */
async function resolveFont(
  handle: PDFDocumentHandle,
  element: TextElement,
  fontBytes?: Uint8Array,
): Promise<PDFFont> {
  const { fontFamily, originalFont } = element.style;

  // Stratégie 1 : police custom avec bytes fournis (FONT_EMBED_CUSTOM_ENABLED requis)
  if (isFontEmbedCustomEnabled() && originalFont && fontBytes && fontBytes.byteLength > 0) {
    const cacheKey = `${handle.id}::custom::${originalFont}`;
    const cached = embeddedFontCache.get(cacheKey);
    if (cached) return cached;

    try {
      // subset: false — nécessaire pour permettre l'ajout de caractères arbitraires
      const embedded = await handle._pdfDoc.embedFont(fontBytes, { subset: false });
      embeddedFontCache.set(cacheKey, embedded);
      return embedded;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      engineLogger.warn('Impossible d\'embed la police custom, fallback vers extraction source', {
        originalFont,
        documentId: handle.id,
        error: message,
      });
    }
  }

  // Stratégie 2 : originalFont défini → tenter l'extraction depuis le PDF source
  if (originalFont) {
    const cacheKey = `${handle.id}::source::${originalFont}`;
    const cached = embeddedFontCache.get(cacheKey);
    if (cached) return cached;

    const extracted = extractFontBytesFromSource(handle, originalFont);
    if (extracted) {
      // Stratégie 2.a : TrueType — fontkit l'avale tel quel.
      if (extracted.format === 'truetype') {
        try {
          const embedded = await handle._pdfDoc.embedFont(extracted.bytes, { subset: false });
          embeddedFontCache.set(cacheKey, embedded);
          return embedded;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          engineLogger.warn(
            'Impossible d\'embed le TrueType extrait du source, on tente la conversion fontforge',
            { originalFont, documentId: handle.id, error: message },
          );
        }
      }

      // Stratégie 2.b : Type1 ou CFF — fontkit refuse, on passe par fontforge.
      // Le résultat est cacheable par hash SHA-256 du programme source : la
      // même police extraite d'un autre PDF donnera le même TTF, donc le
      // cache DB économise un spawn de subprocess à chaque bake.
      const converted = await convertWithCache(
        handle,
        extracted.bytes,
        extracted.format,
        originalFont,
      );
      if (converted) {
        try {
          const embedded = await handle._pdfDoc.embedFont(converted, { subset: false });
          embeddedFontCache.set(cacheKey, embedded);
          engineLogger.info('Police custom embed via conversion fontforge', {
            originalFont,
            sourceFormat: extracted.format,
            documentId: handle.id,
          });
          return embedded;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          engineLogger.warn(
            'TTF converti rejeté par fontkit, fallback bundled OFL',
            { originalFont, documentId: handle.id, error: message },
          );
        }
      }
    } else {
      // Police déclarée dans originalFont mais non trouvée dans le PDF source
      engineLogger.warn(
        'Police originalFont non trouvée dans le PDF source, fallback Helvetica',
        {
          originalFont,
          fontFamily,
          documentId: handle.id,
          hint: 'La police n\'est pas embarquée dans le PDF source. Fournir fontBytes pour préserver la police.',
        },
      );
    }
  }

  // Stratégie 3 : StandardFont connue
  const standardFont = resolveStandardFont(fontFamily);
  if (standardFont !== null) {
    return handle._pdfDoc.embedFont(standardFont);
  }

  // Stratégie 4 : fallback bundled OFL (Liberation / CourierPrime).
  //
  // We ship four real TTF families with the engine — sans (Liberation Sans
  // ≈ Arial), serif (Liberation Serif ≈ Times), mono (Liberation Mono ≈
  // Courier New) and ocr (Courier Prime, closest free OCR-style font).
  // pdf-lib + fontkit can embed those reliably (TrueType is fontkit's native
  // input), so the bake gets a font with the right metric family AND with
  // full Latin Unicode coverage. This is dramatically closer to OCRB / Calibri
  // / Gotham than the StandardFonts.Helvetica fallback ever was.
  //
  // We try bundled embedding first. If reading the bundled file or the
  // embedFont call fails for any reason (read-only fs, corrupted file, etc.),
  // we fall back to the metric-picked StandardFont so the bake never crashes
  // mid-batch.
  const bundledFamily = pickBundledFamily(originalFont ?? fontFamily);
  const bundledStyle = pickBundledStyle(
    element.style.fontWeight,
    element.style.fontStyle,
    originalFont ?? fontFamily,
  );
  const bundledKey = `${handle.id}::bundled::${bundledFamily}::${bundledStyle}`;
  const cachedBundled = embeddedFontCache.get(bundledKey);
  if (cachedBundled) return cachedBundled;
  try {
    const bytes = loadBundledFontBytes(bundledFamily, bundledStyle);
    const embedded = await handle._pdfDoc.embedFont(bytes, { subset: true });
    embeddedFontCache.set(bundledKey, embedded);
    engineLogger.info('Police custom remplacée par bundled OFL', {
      fontFamily,
      originalFont: originalFont ?? undefined,
      bundledFamily,
      bundledStyle,
      documentId: handle.id,
    });
    return embedded;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const fallback = pickFallbackStandardFont(
      originalFont ?? fontFamily,
      element.style.fontWeight,
      element.style.fontStyle,
    );
    engineLogger.warn(
      'Bundled OFL non disponible, dernier recours StandardFont',
      {
        fontFamily,
        originalFont: originalFont ?? undefined,
        fallback,
        bundledFamily,
        bundledStyle,
        error: message,
        documentId: handle.id,
      },
    );
    return handle._pdfDoc.embedFont(fallback);
  }
}

// ─── API Publique ─────────────────────────────────────────────────────────────

export async function addText(
  handle: PDFDocumentHandle,
  pageNumber: number,
  element: TextElement,
  fontBytes?: Uint8Array,
): Promise<void> {
  const page = getPage(handle, pageNumber);
  const pageH = page.getHeight();
  const pdfRect = webToPdf(
    element.bounds.x,
    element.bounds.y,
    element.bounds.width,
    element.bounds.height,
    pageH,
  );

  const font = await resolveFont(handle, element, fontBytes);
  const color = hexToRgb(element.style.color);

  // Intentionally NO maxWidth: the bounds.width recorded for parsed text
  // matches the original glyph run, but as soon as the user types extra
  // characters the new content is wider. If we constrained drawText to the
  // original width pdf-lib would WRAP the new content, splitting "LICHA 2"
  // into "LICHA " on one line and "2" on the next — which is exactly the
  // missing-text symptom seen on the Free invoice repro test (pdfjs found
  // the trailing "2" on a separate line and the visible bake looked like
  // just "LICHA"). For long edits the user can resize the IText overlay
  // afterwards if needed; for typical inline edits the natural width wins.
  page.drawText(element.content, {
    x: pdfRect.x,
    y: pdfRect.y + pdfRect.height - element.style.fontSize,
    size: element.style.fontSize,
    font,
    color,
    opacity: element.style.opacity,
    rotate: degrees(element.transform.rotation),
    lineHeight: element.style.fontSize * element.style.lineHeight,
  });

  markDirty(handle._pdfDoc);
}

/**
 * Parse "rgb(r, g, b)" or "#rrggbb" into a pdf-lib RGB tuple in [0, 1].
 *
 * pdf-lib's `rgb()` constructor throws when any channel is outside [0, 1]
 * (the error message is misleading: "`red` must be at least 0 and at most
 * 1, but was actually 1.0039..."). The client sometimes forwards 256 due
 * to anti-aliasing quantization rounding; clamp defensively so a single
 * out-of-range channel never aborts a whole apply-elements batch.
 */
function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function parseStyleColorToRgb(
  raw: string | null | undefined,
): { r: number; g: number; b: number } | null {
  if (!raw) return null;
  const c = raw.trim().toLowerCase();
  if (c.startsWith('#')) {
    const hex = c.slice(1);
    if (hex.length === 3) {
      return {
        r: clamp01(parseInt(hex[0]! + hex[0]!, 16) / 255),
        g: clamp01(parseInt(hex[1]! + hex[1]!, 16) / 255),
        b: clamp01(parseInt(hex[2]! + hex[2]!, 16) / 255),
      };
    }
    if (hex.length === 6) {
      return {
        r: clamp01(parseInt(hex.slice(0, 2), 16) / 255),
        g: clamp01(parseInt(hex.slice(2, 4), 16) / 255),
        b: clamp01(parseInt(hex.slice(4, 6), 16) / 255),
      };
    }
    return null;
  }
  const m = c.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) {
    return {
      r: clamp01(Number(m[1]) / 255),
      g: clamp01(Number(m[2]) / 255),
      b: clamp01(Number(m[3]) / 255),
    };
  }
  return null;
}

export async function updateText(
  handle: PDFDocumentHandle,
  pageNumber: number,
  oldBounds: Bounds,
  element: TextElement,
  fontBytes?: Uint8Array,
): Promise<void> {
  const page = getPage(handle, pageNumber);
  const pageH = page.getHeight();
  const oldPdf = webToPdf(oldBounds.x, oldBounds.y, oldBounds.width, oldBounds.height, pageH);

  // The clear rectangle MUST match the real PDF background colour at the
  // glyph location, otherwise editing text on a coloured banner (red
  // "Somme à payer", blue card, etc.) leaves a visible white box. The
  // client samples the rendered bitmap and forwards the result via
  // element.style.backgroundColor — fall back to white only when the
  // client could not read the canvas.
  const clearRgb =
    parseStyleColorToRgb(element.style.backgroundColor) ?? { r: 1, g: 1, b: 1 };

  page.drawRectangle({
    x: oldPdf.x,
    y: oldPdf.y,
    width: oldPdf.width,
    height: oldPdf.height,
    color: rgb(clearRgb.r, clearRgb.g, clearRgb.b),
    opacity: 1,
  });

  return addText(handle, pageNumber, element, fontBytes);
}
