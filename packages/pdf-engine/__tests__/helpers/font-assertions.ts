/**
 * Utilitaires d'assertion pour les tests de polices embarquées et de round-trip PDF.
 *
 * Ces helpers utilisent pdfjs-dist v4 pour inspecter les métadonnées de polices
 * dans un PDF après save, sans dépendre de l'API publique du pdf-engine
 * (qui est précisément ce qu'on teste).
 *
 * API pdfjs v4 utilisée :
 *  - page.getTextContent() → items[].fontName (identifiant interne "g_d0_f1")
 *  - page.commonObjs.get(fontId) → { name, type, data? }
 */
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/types/src/display/api';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

// Configurer le worker pdfjs si pas déjà fait (le vitest-setup.ts le fait aussi, mais
// ce fichier peut être utilisé indépendamment)
const _require = createRequire(import.meta.url);
const pdfjsDistDir = resolve(_require.resolve('pdfjs-dist/package.json'), '..');
const workerPath = resolve(pdfjsDistDir, 'legacy/build/pdf.worker.mjs');
if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FontInfo {
  /** Identifiant interne pdfjs (ex: "g_d0_f1") */
  id: string;
  /** Nom interne PDF (peut contenir le préfixe de sous-ensemble, ex: "DejaVuSans-8450") */
  name: string;
  /** Famille normalisée (sans suffixe numérique ni préfixe de sous-ensemble) */
  family: string;
  /** La police est-elle standard PDF Type1 (Helvetica, Times, Courier, Symbol, ZapfDingbats) ? */
  isStandard: boolean;
  /** Est-ce un sous-ensemble (présence du préfixe 6 chars majuscules + "+" ou suffixe numérique) ? */
  isSubset: boolean;
  /** La police est-elle embarquée (bytes TTF/OTF présents dans le PDF) ? */
  isEmbedded: boolean;
}

export interface TextRunInfo {
  /** Contenu textuel */
  content: string;
  /** Nom de la police telle que rapportée par pdfjs (interne, ex: "g_d0_f1") */
  fontId: string;
  /** Nom résolu de la police (ex: "DejaVuSans-8450") */
  fontName: string;
  /** Position X en espace PDF */
  x: number;
  /** Position Y en espace PDF */
  y: number;
  /** Hauteur */
  height: number;
}

// ---------------------------------------------------------------------------
// Constantes — polices standard PDF Type1 (14 polices de base)
// ---------------------------------------------------------------------------

const STANDARD_PDF_FONT_NAMES = new Set([
  'helvetica',
  'helveticabold',
  'helveticaoblique',
  'helveticaboldoblique',
  'times-roman',
  'times',
  'timesbold',
  'timesitalic',
  'timesbolditalic',
  'courier',
  'courierbold',
  'courieroblique',
  'courierboldoblique',
  'symbol',
  'zapfdingbats',
]);

// ---------------------------------------------------------------------------
// Helpers internes
// ---------------------------------------------------------------------------

function normalizeForStandardCheck(name: string): string {
  return name.toLowerCase().replace(/[\s\-_]/g, '');
}

/**
 * Détermine si un nom de police PDF est une police standard.
 * Les polices standard n'ont pas besoin d'être embarquées.
 */
function isStandardPdfFont(pdfName: string): boolean {
  const norm = normalizeForStandardCheck(pdfName);
  return STANDARD_PDF_FONT_NAMES.has(norm);
}

/**
 * Extrait la famille de base d'un nom de police PDF.
 * "DejaVuSans-8450" → "DejaVuSans"
 * "ABCDEF+Calibri" → "Calibri"
 * "Helvetica" → "Helvetica"
 */
function extractFontFamily(pdfName: string): string {
  // Supprimer le préfixe de sous-ensemble ABCDEF+
  let name = pdfName.replace(/^[A-Z]{6}\+/, '');
  // Supprimer les suffixes numériques courts (ex: "-8450", "_1234")
  name = name.replace(/[-_]\d{3,6}$/, '');
  return name;
}

/**
 * Détermine si la police est un sous-ensemble embarqué.
 * Les sous-ensembles ont un préfixe "ABCDEF+" ou un suffixe numérique.
 */
function detectSubset(pdfName: string): boolean {
  return /^[A-Z]{6}\+/.test(pdfName) || /[-_]\d{3,6}$/.test(pdfName);
}

/**
 * Charge un PDF et retourne le proxy pdfjs.
 * Le buffer est copié pour éviter les problèmes d'ArrayBuffer détaché.
 */
async function loadPdfJsDoc(pdfBytes: Uint8Array | Buffer): Promise<PDFDocumentProxy> {
  // Copier les bytes pour éviter "Cannot perform Construct on a detached ArrayBuffer"
  // qui survient quand le Buffer original est collecté par le GC
  const copied = new Uint8Array(
    pdfBytes instanceof Buffer
      ? pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength)
      : pdfBytes.buffer.slice(pdfBytes.byteOffset, pdfBytes.byteOffset + pdfBytes.byteLength),
  );

  const loadingTask = pdfjsLib.getDocument({
    data: copied,
    useSystemFonts: false,
    // Éviter l'avertissement "standardFontDataUrl" qui pollue les logs de test
    disableFontFace: true,
  });

  return loadingTask.promise;
}

// ---------------------------------------------------------------------------
// extractFontsFromPdf
// ---------------------------------------------------------------------------

/**
 * Extrait les métadonnées de toutes les polices référencées dans un PDF.
 *
 * Utilise pdfjs-dist v4 : getTextContent() pour collecter les fontId internes,
 * puis page.commonObjs.get(fontId) pour obtenir les métadonnées.
 *
 * Une police est considérée "embarquée non-standard" si :
 *  - son nom n'est pas dans la liste des 14 polices standard PDF
 *  - elle est présente dans le PDF (détectée via commonObjs)
 */
export async function extractFontsFromPdf(pdfBytes: Uint8Array | Buffer): Promise<FontInfo[]> {
  const pdfDoc: PDFDocumentProxy = await loadPdfJsDoc(pdfBytes);
  const fontMap = new Map<string, FontInfo>();

  const pageCount = pdfDoc.numPages;
  for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
    const page: PDFPageProxy = await pdfDoc.getPage(pageNum);

    // Récupérer le contenu textuel — les items ont un champ fontName (identifiant interne)
    const textContent = await page.getTextContent();

    // Collecter les fontId uniques utilisés sur cette page
    const fontIds = new Set<string>();
    for (const item of textContent.items) {
      const fontId = (item as { fontName?: string }).fontName;
      if (fontId && !fontMap.has(fontId)) {
        fontIds.add(fontId);
      }
    }

    // Force le rendu pour peupler commonObjs (nécessaire pour accéder aux métadonnées)
    await page.getOperatorList();

    // Résoudre chaque fontId via commonObjs
    for (const fontId of fontIds) {
      try {
        const fontObj = await page.commonObjs.get(fontId);
        if (!fontObj) continue;

        const pdfName: string = fontObj.name ?? fontId;
        const family = extractFontFamily(pdfName);
        const isStandard = isStandardPdfFont(pdfName) || isStandardPdfFont(family);
        const isSubset = detectSubset(pdfName);

        // Une police non-standard dans le PDF est considérée "embarquée"
        // (les polices standard Type1 ne sont jamais embarquées physiquement)
        const isEmbedded = !isStandard;

        fontMap.set(fontId, {
          id: fontId,
          name: pdfName,
          family,
          isStandard,
          isSubset,
          isEmbedded,
        });
      } catch {
        // Objet non disponible — ignorer silencieusement
      }
    }
  }

  await pdfDoc.destroy();
  return Array.from(fontMap.values());
}

// ---------------------------------------------------------------------------
// extractTextRunsFromPage
// ---------------------------------------------------------------------------

/**
 * Extrait les runs de texte d'une page PDF avec le nom de police associé.
 * Utilise pdfjs-dist v4 getTextContent.
 */
export async function extractTextRunsFromPage(
  pdfBytes: Uint8Array | Buffer,
  pageNumber: number,
): Promise<TextRunInfo[]> {
  const pdfDoc: PDFDocumentProxy = await loadPdfJsDoc(pdfBytes);

  if (pageNumber < 1 || pageNumber > pdfDoc.numPages) {
    await pdfDoc.destroy();
    throw new RangeError(`Page ${pageNumber} hors limites (doc: ${pdfDoc.numPages} pages)`);
  }

  const page = await pdfDoc.getPage(pageNumber);

  // Peupler commonObjs pour avoir accès aux noms de polices réels
  await page.getOperatorList();

  const textContent = await page.getTextContent();

  // Résoudre les fontName (fontId internes "g_d0_f1") en noms réels
  const fontIdToName = new Map<string, string>();
  const fontIds = new Set(
    textContent.items
      .map((i) => (i as { fontName?: string }).fontName)
      .filter((id): id is string => !!id),
  );

  for (const fontId of fontIds) {
    try {
      const fontObj = await page.commonObjs.get(fontId);
      if (fontObj?.name) {
        fontIdToName.set(fontId, fontObj.name as string);
      }
    } catch {
      // Ignorer silencieusement
    }
  }

  const runs: TextRunInfo[] = textContent.items
    .filter((item): item is (typeof textContent.items)[number] & { str: string } => 'str' in item)
    .map((item) => {
      const fontId = (item as { fontName?: string }).fontName ?? '';
      const transform = (item as { transform?: number[] }).transform ?? [];
      return {
        content: (item as { str: string }).str,
        fontId,
        fontName: fontIdToName.get(fontId) ?? fontId,
        x: transform[4] ?? 0,
        y: transform[5] ?? 0,
        height: (item as { height?: number }).height ?? 0,
      };
    });

  await pdfDoc.destroy();
  return runs;
}

// ---------------------------------------------------------------------------
// assertRoundTripFidelity
// ---------------------------------------------------------------------------

export interface RoundTripFidelityOptions {
  /** Noms de polices (partiels, insensible à la casse) qui doivent survivre au round-trip */
  checkFontFamilies?: string[];
  /** Textes (partiels) qui doivent être présents dans le PDF */
  checkTexts?: string[];
  /** Ratio max taille sauvegardée / taille originale (défaut 3.0) */
  maxSizeRatio?: number;
  /** Le PDF sauvegardé doit être ré-ouvrable sans erreur */
  mustReopenClean?: boolean;
}

/**
 * Assertion composite pour les tests de round-trip.
 * Vérifie le header PDF, la taille, la présence de polices et de textes.
 */
export async function assertRoundTripFidelity(
  originalBytes: Buffer,
  savedBytes: Buffer,
  options: RoundTripFidelityOptions = {},
): Promise<void> {
  const {
    checkFontFamilies = [],
    checkTexts = [],
    maxSizeRatio = 3.0,
    mustReopenClean = true,
  } = options;

  const { expect } = await import('vitest');

  // 1. Header PDF valide
  expect(savedBytes.slice(0, 5).toString('ascii')).toBe('%PDF-');

  // 2. Taille raisonnable
  const ratio = savedBytes.length / originalBytes.length;
  expect(ratio).toBeLessThan(maxSizeRatio);

  // 3. Le PDF peut être ré-ouvert par pdfjs sans exception
  if (mustReopenClean) {
    const reopenedDoc = await loadPdfJsDoc(savedBytes);
    expect(reopenedDoc.numPages).toBeGreaterThan(0);
    await reopenedDoc.destroy();
  }

  // 4. Polices préservées
  if (checkFontFamilies.length > 0) {
    const fonts = await extractFontsFromPdf(savedBytes);
    for (const expectedFamily of checkFontFamilies) {
      const found = fonts.some(
        (f) =>
          f.family.toLowerCase().includes(expectedFamily.toLowerCase()) ||
          f.name.toLowerCase().includes(expectedFamily.toLowerCase()),
      );
      expect(found, `Police "${expectedFamily}" absente du PDF sauvegardé`).toBe(true);
    }
  }

  // 5. Textes présents (inspection via extractTextRunsFromPage page 1)
  if (checkTexts.length > 0) {
    const runs = await extractTextRunsFromPage(savedBytes, 1);
    const fullText = runs.map((r) => r.content).join(' ');
    for (const expectedText of checkTexts) {
      expect(
        fullText.includes(expectedText),
        `Texte "${expectedText}" absent de la page 1 du PDF sauvegardé`,
      ).toBe(true);
    }
  }
}
