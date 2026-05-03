import type { Bounds } from '@giga-pdf/types';

/**
 * Convertit des coordonnées web (origine top-left, Y vers le bas) en
 * coordonnées PDF (origine bottom-left, Y vers le haut).
 *
 * Convention `bounds.y` (NON-NÉGOCIABLE)
 * ========================================
 * `bounds.y` est le bord TOP de l'élément en espace web (Y-down).
 * Après conversion, `pdfRect.y` est le bord BOTTOM de la boite en espace
 * PDF (Y-up) : `pdfRect.y = effectivePageHeight - y - height`.
 *
 * Tous les renderers (text, image, shape) reçoivent `bounds.y` avec
 * cette convention et appellent `webToPdf` pour obtenir `pdfRect`.
 *
 * Gestion de la rotation (`/Rotate`)
 * ====================================
 * Sur une page avec `/Rotate=90` ou `/Rotate=270`, les dimensions
 * affichées sont inversées : la hauteur d'affichage effective est égale à
 * la **largeur** de la MediaBox (et vice-versa). `page.getHeight()` de
 * pdf-lib retourne toujours la hauteur brute de la MediaBox, ignorant le
 * flag `/Rotate`. En passant `pageWidth` et `rotation`, cette fonction
 * corrige automatiquement la hauteur effective avant de calculer la
 * position Y PDF.
 *
 * - rotation=0 ou absent : hauteur effective = `pageHeight` (comportement
 *   identique à l'ancienne signature, rétrocompatible à 100 %).
 * - rotation=90 ou rotation=270 : hauteur effective = `pageWidth`
 *   (les dimensions sont échangées après rotation du viewer).
 * - rotation=180 : hauteur effective = `pageHeight` (pas d'échange),
 *   MAIS l'axe Y est inversé : l'origine visuelle est en haut-droite.
 *   On mappe `y_web` sur `y_pdf = y` (depuis le bas de la MediaBox) pour
 *   que l'élément atterrisse à la bonne position dans le document affiché.
 *
 * @param x         Coordonnée X du bord gauche de l'élément (web, pixels)
 * @param y         Coordonnée Y du bord TOP de l'élément (web, pixels)
 * @param width     Largeur de l'élément
 * @param height    Hauteur de l'élément
 * @param pageHeight Hauteur brute de la MediaBox (`page.getHeight()`)
 * @param pageWidth  Largeur brute de la MediaBox (`page.getWidth()`).
 *                   Requis uniquement quand `rotation` est 90 ou 270.
 * @param rotation  Angle de rotation de la page en degrés (0 | 90 | 180 | 270).
 *                  Récupéré via `page.getRotation().angle`.
 */
export function webToPdf(
  x: number,
  y: number,
  width: number,
  height: number,
  pageHeight: number,
  pageWidth?: number,
  rotation?: 0 | 90 | 180 | 270,
): { x: number; y: number; width: number; height: number } {
  const rot = rotation ?? 0;

  if (rot === 90 || rot === 270) {
    // Sur une page /Rotate=90 ou /Rotate=270, la hauteur d'affichage
    // effective est la LARGEUR de la MediaBox.
    const effectiveH = pageWidth ?? pageHeight;
    return {
      x,
      y: effectiveH - y - height,
      width,
      height,
    };
  }

  if (rot === 180) {
    // Sur une page /Rotate=180, les dimensions ne s'échangent pas, mais
    // l'axe Y est inversé : ce qui est affiché en haut correspond à y≈0
    // dans la MediaBox. Un élément à y_web=100 doit se retrouver à
    // y_pdf=100 depuis le bas de la MediaBox (l'origine après 180°).
    return {
      x: pageHeight - x - width, // X est aussi inversé sur 180°
      y,
      width,
      height,
    };
  }

  // rotation=0 (ou absent) : comportement original, rétrocompatible.
  return {
    x,
    y: pageHeight - y - height,
    width,
    height,
  };
}

/**
 * Marqueur de capacité lisible au runtime par les tests et les callers.
 * La valeur `true` indique que `webToPdf` accepte les paramètres `pageWidth`
 * et `rotation` et corrige la hauteur effective pour les pages `/Rotate`.
 */
(webToPdf as unknown as Record<string, unknown>)._supportsRotation = true;

/**
 * Convert PDF coordinates (bottom-left origin, Y up) to web coordinates (top-left origin, Y down).
 */
export function pdfToWeb(
  x: number,
  y: number,
  width: number,
  height: number,
  pageHeight: number,
): Bounds {
  return {
    x,
    y: pageHeight - y - height,
    width,
    height,
  };
}

/**
 * Scale a rectangle by a given factor.
 */
export function scaleRect(
  bounds: Bounds,
  scale: number,
): Bounds {
  return {
    x: bounds.x * scale,
    y: bounds.y * scale,
    width: bounds.width * scale,
    height: bounds.height * scale,
  };
}
