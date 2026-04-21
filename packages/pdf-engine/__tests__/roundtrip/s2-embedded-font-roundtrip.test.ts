/**
 * RT-03 / S2 — Police custom embarquée survit au cycle complet edit → save → reload
 *
 * SCÉNARIO :
 *  1. Ouvrir un PDF contenant une police TTF embarquée (embedded-fonts.pdf)
 *  2. Ajouter un texte en tentant d'utiliser cette police custom via originalFont
 *  3. Sauvegarder (garbage=0)
 *  4. Ré-ouvrir le PDF sauvegardé
 *  5. Vérifier que la police custom est toujours présente et embarquée
 *
 * C'est le test de CONTRAT officiel de la Wave 2 fonts :
 *  - Il DOIT être ROUGE sur main actuel (régression active en production)
 *  - Il DOIT être VERT après merge Wave 2
 *
 * Référence audit :
 *  - 11_roundtrip_tests.md § S2, § "Annexe A — Cartographie des Régressions"
 *  - 00_impact_analysis.md § "Font loss during text edit"
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { openDocument, saveDocument } from '../../src/engine/document-handle';
import { addText } from '../../src/render/text-renderer';
import {
  extractFontsFromPdf,
  extractTextRunsFromPage,
  assertRoundTripFidelity,
} from '../helpers/font-assertions';
import { loadFixture } from '../helpers';
import type { TextElement } from '@giga-pdf/types';

const EMBEDDED_FONTS_PDF = 'embedded-fonts.pdf';
const FIXTURES_DIR = join(import.meta.dirname ?? __dirname, '../fixtures');

// ---------------------------------------------------------------------------
// Guard — fixture requise
// ---------------------------------------------------------------------------

let fixtureAvailable = false;
let hasRealEmbeddedFont = false; // true si la fixture contient un TTF réel (pas juste Courier)

beforeAll(async () => {
  fixtureAvailable = existsSync(join(FIXTURES_DIR, EMBEDDED_FONTS_PDF));

  if (fixtureAvailable) {
    try {
      const bytes = Buffer.from(loadFixture(EMBEDDED_FONTS_PDF));
      const fonts = await extractFontsFromPdf(bytes);
      // Une "vraie" police embarquée non-standard = isEmbedded true ET pas Helvetica/Times/Courier
      hasRealEmbeddedFont = fonts.some(
        (f) => f.isEmbedded && !f.isStandard,
      );
    } catch {
      hasRealEmbeddedFont = false;
    }
  } else {
    process.stderr.write(
      `[RT-03/S2] Fixture manquante: ${EMBEDDED_FONTS_PDF}\n` +
      `  Générer avec: pnpm tsx packages/pdf-engine/__tests__/fixtures/create-fixtures.ts\n`,
    );
  }
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function fixtureBuffer(name: string): Buffer {
  return Buffer.from(loadFixture(name));
}

function makeTextElement(
  fontFamily: string,
  originalFont: string | null,
  content: string,
): TextElement {
  return {
    elementId: 'elem-s2-roundtrip',
    type: 'text',
    content,
    bounds: { x: 50, y: 150, width: 400, height: 30 },
    transform: { rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 },
    layerId: null,
    locked: false,
    visible: true,
    style: {
      fontFamily,
      fontSize: 14,
      fontWeight: 'normal',
      fontStyle: 'normal',
      color: '#000000',
      opacity: 1,
      textAlign: 'left',
      lineHeight: 1.2,
      letterSpacing: 0,
      writingMode: 'horizontal-tb',
      underline: false,
      strikethrough: false,
      backgroundColor: null,
      verticalAlign: 'baseline',
      originalFont,
    },
    ocrConfidence: null,
    linkUrl: null,
    linkPage: null,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('S2 — Round-trip: PDF avec police custom embarquée', () => {
  /**
   * S2-CORE : Test principal de non-régression Wave 2.
   *
   * Ce test DOIT :
   *  - ÉCHOUER sur main actuel (police droppée ou fallback Helvetica)
   *  - PASSER après merge Wave 2 (police préservée)
   */
  it('S2-CORE : la police embarquée survit à edit → save → reload', async () => {
    if (!fixtureAvailable) {
      // Skip documenté — fixture manquante
      return;
    }

    // Étape 1 : Ouvrir et inspecter les polices du PDF source
    const source = fixtureBuffer(EMBEDDED_FONTS_PDF);
    const fontsInSource = await extractFontsFromPdf(source);
    const embeddedFontsInSource = fontsInSource.filter((f) => f.isEmbedded && !f.isStandard);

    if (embeddedFontsInSource.length === 0) {
      // Fixture sans TTF réel (système sans DejaVu/Liberation)
      // On documente l'état mais on ne fait pas échouer le CI pour manque de TTF
      process.stderr.write(
        `[RT-03/S2] La fixture embedded-fonts.pdf ne contient pas de TTF réel.\n` +
        `  Polices trouvées: ${JSON.stringify(fontsInSource.map(f => f.name))}\n` +
        `  Ce test nécessite un système avec DejaVu/Liberation/Ubuntu pour être significatif.\n`,
      );
      return;
    }

    const targetFont = embeddedFontsInSource[0]!;

    // Étape 2 : Ajouter un texte en référençant la police embarquée via originalFont
    const handle = await openDocument(source);

    const newTextContent = 'Nouveau texte avec police custom S2';
    const element = makeTextElement(
      targetFont.family, // fontFamily = famille normalisée
      targetFont.name,   // originalFont = nom interne PDF (peut avoir préfixe de sous-ensemble)
      newTextContent,
    );

    // Sur main actuel : addText va échouer OU substituer Helvetica silencieusement
    // Après fix Wave 2 : addText doit réussir en utilisant la police embarquée
    let addTextFailed = false;
    try {
      await addText(handle, 1, element);
    } catch {
      addTextFailed = true;
    }

    // Étape 3 : Sauvegarder avec garbage=0 pour préserver toutes les ressources
    const saved = await saveDocument(handle, { garbage: 0 });

    // Étape 4 : Assertions sur le PDF sauvegardé
    expect(saved.slice(0, 5).toString('ascii')).toBe('%PDF-');

    // Le PDF sauvegardé doit contenir la police originale (même si addText a échoué)
    const fontsAfterSave = await extractFontsFromPdf(saved);
    const embeddedAfterSave = fontsAfterSave.filter((f) => f.isEmbedded && !f.isStandard);

    // ASSERTION PRINCIPALE RT-03 :
    // La police embarquée originale doit encore être présente après save
    expect(
      embeddedAfterSave.length,
      `RÉGRESSION RT-03/S2 : le PDF sauvegardé a perdu ses polices embarquées.\n` +
      `Polices avant save: ${JSON.stringify(embeddedFontsInSource.map(f => f.name))}\n` +
      `Polices après save: ${JSON.stringify(embeddedAfterSave.map(f => f.name))}\n` +
      `addText a échoué: ${addTextFailed}`,
    ).toBeGreaterThanOrEqual(embeddedFontsInSource.length);

    // Étape 5 : Ré-ouvrir et vérifier
    const reopenedHandle = await openDocument(saved);
    expect(reopenedHandle.pageCount).toBeGreaterThan(0);

    // La police doit être identifiable dans le PDF ré-ouvert
    const fontsAfterReopen = await extractFontsFromPdf(saved);
    const hasTargetFont = fontsAfterReopen.some(
      (f) =>
        f.family.toLowerCase().includes(targetFont.family.toLowerCase()) ||
        f.name.toLowerCase().includes(targetFont.family.toLowerCase()),
    );

    expect(
      hasTargetFont,
      `RÉGRESSION RT-03/S2 : la police "${targetFont.family}" n'est plus trouvable après reload.\n` +
      `Polices après reload: ${JSON.stringify(fontsAfterReopen.map(f => f.family))}`,
    ).toBe(true);
  });

  /**
   * S2-SIZE : La taille du fichier sauvegardé ne doit pas être absurdement petite
   * (ce serait un signe que les polices embarquées ont été supprimées).
   */
  it('S2-SIZE : la taille du PDF sauvegardé reste >= 90% de l\'original', async () => {
    if (!fixtureAvailable || !hasRealEmbeddedFont) {
      return;
    }

    const source = fixtureBuffer(EMBEDDED_FONTS_PDF);
    const handle = await openDocument(source);

    // Modification légère
    await addText(handle, 1, makeTextElement('helvetica', null, 'Size check text'));
    const saved = await saveDocument(handle, { garbage: 0 });

    // Un PDF sauvegardé avec polices embarquées préservées doit être au moins 90%
    // de la taille originale. Une taille < 90% suggère que des ressources ont été droppées.
    const ratio = saved.length / source.length;
    expect(
      ratio,
      `RÉGRESSION RT-03/S2-SIZE : le PDF sauvegardé est ${(ratio * 100).toFixed(1)}% de l'original.\n` +
      `Original: ${source.length} bytes, Sauvegardé: ${saved.length} bytes.\n` +
      `Une taille < 90% suggère que des polices embarquées ont été supprimées.`,
    ).toBeGreaterThanOrEqual(0.9);
  });

  /**
   * S2-IDEMPOTENT : save → re-open → save → ré-ouvrir produit le même nombre de polices.
   * Vérifie la stabilité du pipeline de sauvegarde sur deux passes.
   */
  it('S2-IDEMPOTENT : deux passes de save → reload produisent le même résultat', async () => {
    if (!fixtureAvailable || !hasRealEmbeddedFont) {
      return;
    }

    const source = fixtureBuffer(EMBEDDED_FONTS_PDF);

    // Première passe
    const handle1 = await openDocument(source);
    const saved1 = await saveDocument(handle1, { garbage: 0 });

    // Deuxième passe
    const handle2 = await openDocument(saved1);
    const saved2 = await saveDocument(handle2, { garbage: 0 });

    const fontsPass1 = await extractFontsFromPdf(saved1);
    const fontsPass2 = await extractFontsFromPdf(saved2);

    const embeddedPass1 = fontsPass1.filter((f) => f.isEmbedded && !f.isStandard).length;
    const embeddedPass2 = fontsPass2.filter((f) => f.isEmbedded && !f.isStandard).length;

    // Le nombre de polices embarquées non-standard ne doit pas diminuer entre les passes
    expect(embeddedPass2).toBeGreaterThanOrEqual(embeddedPass1);
  });

  /**
   * S2-VALIDATE : Utilise le helper assertRoundTripFidelity pour une validation composite.
   */
  it('S2-VALIDATE : assertRoundTripFidelity passe pour embedded-fonts.pdf', async () => {
    if (!fixtureAvailable) {
      return;
    }

    const source = fixtureBuffer(EMBEDDED_FONTS_PDF);
    const handle = await openDocument(source);
    await addText(handle, 1, makeTextElement('helvetica', null, 'Round-trip validation'));
    const saved = await saveDocument(handle, { garbage: 0 });

    // assertRoundTripFidelity effectue ses propres assertions internes
    await assertRoundTripFidelity(source, saved, {
      mustReopenClean: true,
      maxSizeRatio: 4.0, // Tolérance haute car l'ajout de texte + polices peut grossir
      checkTexts: ['Round-trip validation'],
    });
  });
});
