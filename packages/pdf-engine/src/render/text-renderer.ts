import type { PDFDocumentHandle } from '../engine/document-handle';
import { markDirty } from '../engine/document-handle';
import type { TextElement } from '@giga-pdf/types';
import { hexToPackedRgb } from '../utils/color';
import { webToPdf } from '../utils/coordinates';
import {
  base14NameFor,
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
 *  3.6 Famille base-14 standard (Helvetica/Arial, Times, Courier, Symbol,
 *     ZapfDingbats) → RÉFÉRENCE la police standard (lib 0.63+ : /Type1 nu, zéro
 *     FontFile, ~50× plus léger), rendue nativement par Adobe + le rasteriseur.
 *  4. Fallback bundled OFL (Liberation/Courier Prime) — couvre les polices
 *     arbitraires non-base-14 via pickBundledFamily, avec de vrais TTF
 *     (meilleures métriques que Standard-14 pour une substitution non-exacte).
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

  // Stratégie 3.6 : famille base-14 standard → RÉFÉRENCE la police standard
  // (/Type1 nu, zéro FontFile) au lieu d'embarquer un substitut. ~50× plus léger
  // (≈1 Ko vs ≈57 Ko) et rendu nativement par Adobe + le rasteriseur moteur.
  // Réservé aux 5 familles standard ; les polices arbitraires gardent le bundled
  // OFL ci-dessous. Bytes vides : la lib 0.63+ détecte la base-14 par le NOM et
  // ignore les bytes ; sur une lib antérieure embedFont retourne 0 → fallback sûr.
  const base14 = base14NameFor(
    originalFont ?? fontFamily,
    element.style.fontWeight,
    element.style.fontStyle,
  );
  if (base14) {
    const base14Key = `${handle.id}::base14::${base14}`;
    const cachedBase14 = embeddedFontCache.get(base14Key);
    if (cachedBase14 !== undefined) return cachedBase14;
    const obj = doc.embedFont(base14, new Uint8Array(0));
    if (obj !== 0) {
      embeddedFontCache.set(base14Key, obj);
      engineLogger.info('Police base-14 référencée (zéro FontFile)', {
        requested: originalFont ?? fontFamily,
        base14,
        documentId: handle.id,
      });
      return obj;
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

  // Sub/superscript: the unified model carries `verticalAlign` per text box
  // (e.g. footnote refs from a DOCX import), so we bake the whole run at a
  // reduced size with a shifted baseline (CSS-like: ~0.583x size, raised ~1/3 em
  // for superscript, lowered ~1/6 em for subscript). PDF user space is bottom-up
  // so +y raises the baseline.
  const baseSize = element.style.fontSize;
  const vAlign = element.style.verticalAlign;
  const renderSize = vAlign === "baseline" ? baseSize : baseSize * 0.583;
  const baselineShift =
    vAlign === "superscript"
      ? baseSize * 0.33
      : vAlign === "subscript"
        ? -baseSize * 0.16
        : 0;

  // Baseline anchor: the engine draws from the text baseline at (x, y), so we
  // place the baseline one fontSize below the box top — the same offset the old
  // pdf-lib path used (drawText y = top - fontSize) — plus the vertical-align
  // shift. Underline/strikethrough are baked by the engine itself (the rule
  // follows the text rotation and is sized from the run's real glyph advances).
  handle._doc.addText(
    pageNumber,
    pdfRect.x,
    pdfRect.y + pdfRect.height - baseSize + baselineShift,
    renderSize,
    element.content,
    fontObj,
    color,
    element.style.opacity,
    element.transform.rotation,
    {
      underline: element.style.underline,
      strikethrough: element.style.strikethrough,
    },
  );

  markDirty(handle._doc);
}
