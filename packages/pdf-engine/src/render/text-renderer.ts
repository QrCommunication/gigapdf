import { rgb, degrees, StandardFonts } from 'pdf-lib';
import type { PDFFont } from 'pdf-lib';
import type { PDFDocumentHandle } from '../engine/document-handle';
import { markDirty } from '../engine/document-handle';
import type { TextElement, Bounds } from '@giga-pdf/types';
import { hexToRgb } from '../utils/color';
import { webToPdf } from '../utils/coordinates';
import { resolveStandardFont, isStandardFont } from '../utils/font-map';
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
 * Résout la police à utiliser pour un TextElement.
 *
 * Stratégie (par ordre de priorité) :
 *  1. Si FONT_EMBED_CUSTOM_ENABLED && originalFont défini && fontBytes fournis → embed la police custom
 *  2. Si fontFamily correspond à une Standard Font → embed la StandardFont
 *  3. Fallback Helvetica (log de warning pour les polices custom non résolues)
 */
async function resolveFont(
  handle: PDFDocumentHandle,
  element: TextElement,
  fontBytes?: Uint8Array,
): Promise<PDFFont> {
  const { fontFamily, originalFont } = element.style;

  // Stratégie 1 : police custom avec bytes fournis
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
      // Fallback gracieux : log explicite + continuer avec StandardFont
      engineLogger.warn('Impossible d\'embed la police custom, fallback Helvetica', {
        originalFont,
        documentId: handle.id,
        error: message,
      });
    }
  }

  // Stratégie 2 : StandardFont connue
  const standardFont = resolveStandardFont(fontFamily);
  if (standardFont !== null) {
    return handle._pdfDoc.embedFont(standardFont);
  }

  // Stratégie 3 : fallback Helvetica avec avertissement explicite
  if (!isStandardFont(fontFamily)) {
    engineLogger.warn(
      'Police non reconnue comme Standard Font et aucun byte custom fourni, fallback Helvetica',
      {
        fontFamily,
        documentId: handle.id,
        hint: 'Activer FONT_EMBED_CUSTOM_ENABLED et passer fontBytes pour préserver la police',
      },
    );
  }

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
