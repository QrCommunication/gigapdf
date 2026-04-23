import { rgb, degrees, StandardFonts, PDFName } from 'pdf-lib';
import type { PDFFont } from 'pdf-lib';
import type { PDFDocumentHandle } from '../engine/document-handle';
import { markDirty } from '../engine/document-handle';
import type { TextElement, Bounds } from '@giga-pdf/types';
import { hexToRgb } from '../utils/color';
import { webToPdf } from '../utils/coordinates';
import { resolveStandardFont } from '../utils/font-map';
import { engineLogger } from '../utils/logger';
import { PDFPageOutOfRangeError } from '../errors';

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
function extractFontBytesFromSource(
  handle: PDFDocumentHandle,
  targetFontName: string,
): Uint8Array | null {
  // Normaliser le nom cible : retirer le préfixe de sous-ensemble "ABCDEF+"
  const normalizedTarget = targetFontName.replace(/^[A-Z]{6}\+/, '').toLowerCase();

  const pages = handle._pdfDoc.getPages();
  for (const page of pages) {
    const resources = page.node.Resources();
    if (!resources) continue;

    const fontDict = resources.get(PDFName.of('Font'));
    if (!fontDict || typeof (fontDict as { entries?: unknown }).entries !== 'function') continue;

    for (const [, val] of (fontDict as unknown as { entries(): Iterable<[unknown, unknown]> }).entries()) {
      const fontObj = handle._pdfDoc.context.lookup(val as Parameters<typeof handle._pdfDoc.context.lookup>[0]);
      if (!fontObj || typeof (fontObj as unknown as { get?: unknown }).get !== 'function') continue;

      const baseFontRef = (fontObj as unknown as { get(k: unknown): unknown }).get(PDFName.of('BaseFont'));
      const baseFontName: string = baseFontRef
        ? String(baseFontRef).replace(/^\//, '').replace(/^[A-Z]{6}\+/, '')
        : '';

      if (!baseFontName.toLowerCase().includes(normalizedTarget)) continue;

      // Police trouvée — tenter d'extraire les bytes via FontDescriptor
      const bytes = extractFontProgramBytes(handle, fontObj as unknown as { get(k: unknown): unknown });
      if (bytes) return bytes;
    }
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
): Uint8Array | null {
  const ctx = handle._pdfDoc.context;

  // Type0 (composite) : DescendantFonts → CIDFont → FontDescriptor
  const descendantRef = fontObj.get(PDFName.of('DescendantFonts'));
  if (descendantRef) {
    const descArr = ctx.lookup(descendantRef as Parameters<typeof ctx.lookup>[0]);
    if (descArr && typeof (descArr as unknown as { get?: unknown }).get === 'function') {
      const cidFontRef = (descArr as unknown as { get(k: unknown): unknown }).get(0);
      const cidFont = cidFontRef ? ctx.lookup(cidFontRef as Parameters<typeof ctx.lookup>[0]) : null;
      if (cidFont && typeof (cidFont as unknown as { get?: unknown }).get === 'function') {
        const bytes = resolveDescriptorFontFile(handle, cidFont as unknown as { get(k: unknown): unknown });
        if (bytes) return bytes;
      }
    }
  }

  // Type1 / TrueType : FontDescriptor direct
  return resolveDescriptorFontFile(handle, fontObj);
}

/**
 * Résout un FontDescriptor et retourne les bytes du flux FontFile2 ou FontFile3.
 */
function resolveDescriptorFontFile(
  handle: PDFDocumentHandle,
  fontOrDescHolder: { get(k: unknown): unknown },
): Uint8Array | null {
  const ctx = handle._pdfDoc.context;

  const descriptorRef = fontOrDescHolder.get(PDFName.of('FontDescriptor'));
  if (!descriptorRef) return null;

  const descriptor = ctx.lookup(descriptorRef as Parameters<typeof ctx.lookup>[0]);
  if (!descriptor || typeof (descriptor as unknown as { get?: unknown }).get !== 'function') return null;

  const desc = descriptor as unknown as { get(k: unknown): unknown };
  const fileRef =
    desc.get(PDFName.of('FontFile2')) ??
    desc.get(PDFName.of('FontFile3')) ??
    desc.get(PDFName.of('FontFile'));

  if (!fileRef) return null;

  const stream = ctx.lookup(fileRef as Parameters<typeof ctx.lookup>[0]);
  if (!stream || typeof (stream as unknown as { getContents?: unknown }).getContents !== 'function') return null;

  return (stream as unknown as { getContents(): Uint8Array }).getContents();
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

    const extractedBytes = extractFontBytesFromSource(handle, originalFont);
    if (extractedBytes) {
      try {
        const embedded = await handle._pdfDoc.embedFont(extractedBytes, { subset: false });
        embeddedFontCache.set(cacheKey, embedded);
        return embedded;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        engineLogger.warn('Impossible d\'embed la police extraite du source, fallback StandardFont', {
          originalFont,
          documentId: handle.id,
          error: message,
        });
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

  // Stratégie 4 : fallback Helvetica avec avertissement explicite (jamais silencieux)
  engineLogger.warn(
    'Police non reconnue comme Standard Font et aucun byte custom fourni, fallback Helvetica',
    {
      fontFamily,
      originalFont: originalFont ?? undefined,
      documentId: handle.id,
      hint: 'Activer FONT_EMBED_CUSTOM_ENABLED et passer fontBytes pour préserver la police',
    },
  );

  return handle._pdfDoc.embedFont(StandardFonts.Helvetica);
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

  page.drawText(element.content, {
    x: pdfRect.x,
    y: pdfRect.y + pdfRect.height - element.style.fontSize,
    size: element.style.fontSize,
    font,
    color,
    opacity: element.style.opacity,
    rotate: degrees(element.transform.rotation),
    maxWidth: pdfRect.width,
    lineHeight: element.style.fontSize * element.style.lineHeight,
  });

  markDirty(handle._pdfDoc);
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

  page.drawRectangle({
    x: oldPdf.x,
    y: oldPdf.y,
    width: oldPdf.width,
    height: oldPdf.height,
    color: rgb(1, 1, 1),
    opacity: 1,
  });

  return addText(handle, pageNumber, element, fontBytes);
}
