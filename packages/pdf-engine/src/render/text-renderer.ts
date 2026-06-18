import type { PDFDocumentHandle } from '../engine/document-handle';
import { markDirty } from '../engine/document-handle';
import type { TextElement } from '@giga-pdf/types';
import { hexToPackedRgb } from '../utils/color';
import { webToPdf } from '../utils/coordinates';
import {
  loadBundledFontBytes,
  pickBundledFamily,
  pickBundledStyle,
} from '../utils/bundled-fonts';
import { engineLogger } from '../utils/logger';
import { PDFPageOutOfRangeError } from '../errors';
import { getFontCacheForHandle } from '../utils/font-cache-port';
import { downloadGoogleFont } from '../utils/google-fonts';
import type { GoogleFontQuery } from '../utils/google-fonts';

// ─── Feature Flag ──────────────────────────────────────────────────────────────

function isFontEmbedCustomEnabled(): boolean {
  return process.env['FONT_EMBED_CUSTOM_ENABLED'] === 'true';
}

// ─── Cache des polices embedées (par documentId::clé) ─────────────────────────
// Évite de ré-embeder les mêmes bytes dans le même document. La valeur est le
// `fontObj` (numéro d'objet Type0) retourné par `embedFont`, valide pour la
// durée de vie du `GigaPdfDoc` du handle.

const embeddedFontCache = new Map<string, number>();

/** Vide le cache pour un document donné (à appeler à la fermeture du handle). */
export function clearFontCache(documentId: string): void {
  for (const key of embeddedFontCache.keys()) {
    if (key.startsWith(`${documentId}::`)) {
      embeddedFontCache.delete(key);
    }
  }
}

/**
 * Résout la police à embeder pour un TextElement et renvoie son `fontObj`
 * (numéro d'objet Type0 dans le document courant).
 *
 * Stratégie (par priorité) :
 *  1. FONT_EMBED_CUSTOM_ENABLED && originalFont && fontBytes → embed direct
 *  2. originalFont → extraire la police du PDF source (engine `extractFont`) :
 *     - truetype → embed direct
 *     - cff (Type1C) → embed natif (bare-CFF enrobé en OpenType) ; type1/PFB
 *       brut non supporté nativement → fallback Google/OFL
 *  3. FontCachePort branché → résolution Google Fonts (téléchargement + cache)
 *  4. Fallback bundled OFL (Liberation/Courier Prime) — couvre aussi les
 *     familles standard (Arial→sans, Times→serif, Courier→mono) via
 *     pickBundledFamily, avec de vrais TTF (meilleures métriques que Standard-14).
 */
async function resolveFont(
  handle: PDFDocumentHandle,
  element: TextElement,
  fontBytes?: Uint8Array,
): Promise<number> {
  const { fontFamily, originalFont } = element.style;
  const doc = handle._doc;

  // Stratégie 1 : police custom avec bytes fournis (glyf-based TrueType).
  if (isFontEmbedCustomEnabled() && originalFont && fontBytes && fontBytes.byteLength > 0) {
    const key = `${handle.id}::custom::${originalFont}`;
    const cached = embeddedFontCache.get(key);
    if (cached !== undefined) return cached;
    const obj = doc.embedFont(originalFont, fontBytes);
    if (obj !== 0) {
      embeddedFontCache.set(key, obj);
      return obj;
    }
    engineLogger.warn("Impossible d'embed la police custom, fallback extraction source", {
      originalFont,
      documentId: handle.id,
    });
  }

  // Stratégie 2 : extraire la police d'origine du PDF source (zéro pdf-lib).
  if (originalFont) {
    const key = `${handle.id}::source::${originalFont}`;
    const cached = embeddedFontCache.get(key);
    if (cached !== undefined) return cached;

    const extracted = doc.extractFont(originalFont);
    if (extracted) {
      // 2.a : TrueType — embed direct.
      if (extracted.format === 'truetype') {
        const obj = doc.embedFont(originalFont, extracted.bytes);
        if (obj !== 0) {
          embeddedFontCache.set(key, obj);
          return obj;
        }
      }
      // 2.b : CFF (Type1C) / Type1 — embed natif par le moteur (zéro
      // fontforge). Le moteur enrobe le bare-CFF en OpenType ; le Type1/PFB
      // brut n'est pas (encore) supporté nativement → embedFont retourne 0 et
      // on retombe sur Google Fonts / OFL ci-dessous.
      if (extracted.format === 'cff' || extracted.format === 'type1') {
        const obj = doc.embedFont(originalFont, extracted.bytes);
        if (obj !== 0) {
          embeddedFontCache.set(key, obj);
          engineLogger.info('Police custom embed native (CFF/Type1C)', {
            originalFont,
            sourceFormat: extracted.format,
            documentId: handle.id,
          });
          return obj;
        }
        engineLogger.warn(
          'Embed natif impossible (format non supporté nativement), fallback',
          { originalFont, sourceFormat: extracted.format, documentId: handle.id },
        );
      }
    } else {
      engineLogger.warn(
        'Police originalFont non trouvée dans le PDF source, fallback',
        { originalFont, fontFamily, documentId: handle.id },
      );
    }
  }

  // Stratégie 3 : Google Fonts (si un FontCachePort est branché sur le handle).
  const googleFontCache = getFontCacheForHandle(handle);
  if (googleFontCache) {
    const requestedName = originalFont ?? fontFamily;
    const key = `${handle.id}::google::${requestedName}::${element.style.fontWeight}::${element.style.fontStyle}`;
    const cached = embeddedFontCache.get(key);
    if (cached !== undefined) return cached;

    try {
      const query: GoogleFontQuery = { name: requestedName };
      if (element.style.fontWeight === 'bold') query.weight = 700;
      if (element.style.fontStyle === 'italic') query.italic = true;

      const result = await downloadGoogleFont(query, { cache: googleFontCache });
      if (result.found) {
        const obj = doc.embedFont(result.family, result.bytes);
        if (obj !== 0) {
          embeddedFontCache.set(key, obj);
          engineLogger.info('Police résolue via Google Fonts', {
            requestedName,
            family: result.family,
            weight: result.weight,
            style: result.style,
            documentId: handle.id,
          });
          return obj;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      engineLogger.warn('Résolution Google Fonts échouée, fallback bundled OFL', {
        requestedName,
        documentId: handle.id,
        error: message,
      });
    }
  }

  // Stratégie 4 : bundled OFL (couvre aussi les familles standard).
  const bundledFamily = pickBundledFamily(originalFont ?? fontFamily);
  const bundledStyle = pickBundledStyle(
    element.style.fontWeight,
    element.style.fontStyle,
    originalFont ?? fontFamily,
  );
  const bundledKey = `${handle.id}::bundled::${bundledFamily}::${bundledStyle}`;
  const cachedBundled = embeddedFontCache.get(bundledKey);
  if (cachedBundled !== undefined) return cachedBundled;

  const bytes = loadBundledFontBytes(bundledFamily, bundledStyle);
  const obj = doc.embedFont(`${bundledFamily}-${bundledStyle}`, bytes);
  if (obj === 0) {
    throw new Error(
      `addText: impossible d'embeder la police bundled ${bundledFamily}/${bundledStyle}`,
    );
  }
  embeddedFontCache.set(bundledKey, obj);
  engineLogger.info('Police résolue via bundled OFL', {
    fontFamily,
    originalFont: originalFont ?? undefined,
    bundledFamily,
    bundledStyle,
    documentId: handle.id,
  });
  return obj;
}

// ─── API Publique ─────────────────────────────────────────────────────────────

export async function addText(
  handle: PDFDocumentHandle,
  pageNumber: number,
  element: TextElement,
  fontBytes?: Uint8Array,
): Promise<void> {
  if (pageNumber < 1 || pageNumber > handle.pageCount) {
    throw new PDFPageOutOfRangeError(pageNumber, handle.pageCount);
  }
  const { height: pageH } = handle._doc.pageInfo(pageNumber);
  const pdfRect = webToPdf(
    element.bounds.x,
    element.bounds.y,
    element.bounds.width,
    element.bounds.height,
    pageH,
  );

  const fontObj = await resolveFont(handle, element, fontBytes);
  const color = hexToPackedRgb(element.style.color);

  // Baseline anchor: the engine draws from the text baseline at (x, y), so we
  // place the baseline one fontSize below the box top — the same offset the old
  // pdf-lib path used (drawText y = top - fontSize).
  handle._doc.addText(
    pageNumber,
    pdfRect.x,
    pdfRect.y + pdfRect.height - element.style.fontSize,
    element.style.fontSize,
    element.content,
    fontObj,
    color,
    element.style.opacity,
    element.transform.rotation,
  );

  markDirty(handle._doc);
}
