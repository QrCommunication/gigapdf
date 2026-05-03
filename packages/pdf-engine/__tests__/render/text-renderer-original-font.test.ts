/**
 * RT-02 — addText/updateText propagent originalFont (régression Helvetica fallback)
 *
 * RÉGRESSION DOCUMENTÉE : Dans text-renderer.ts, la fonction addText() appelle
 * `handle._pdfDoc.embedFont(normalizeFontName(element.style.fontFamily))`.
 * normalizeFontName retourne juste la chaîne en minuscules — si fontFamily est
 * "Calibri" (non-standard), pdf-lib lève une erreur ou utilise Helvetica en
 * fallback silencieux. Le champ `style.originalFont` est IGNORÉ.
 *
 * Ce test vérifie :
 *  1. Qu'une police custom dans originalFont n'est pas silencieusement remplacée
 *     par Helvetica dans le PDF résultant.
 *  2. Que le fallback sur Helvetica est UNIQUEMENT acceptable si originalFont
 *     est null (police standard explicitement choisie).
 *
 * STATUS ATTENDU :
 *  - main actuel    : ROUGE (originalFont ignoré, fallback Helvetica systématique)
 *  - après fix Wave 2 : VERT (originalFont propagé ou erreur explicite levée)
 *
 * Référence audit : 11_roundtrip_tests.md § RT-02
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadFixture, SIMPLE_PDF } from '../helpers';
import { openDocument, saveDocument } from '../../src/engine/document-handle';
import { addText, updateText } from '../../src/render/text-renderer';
import { extractTextRunsFromPage, extractFontsFromPdf } from '../helpers/font-assertions';
import type { TextElement, Bounds } from '@giga-pdf/types';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function fixtureBuffer(name: string): Buffer {
  return Buffer.from(loadFixture(name));
}

function makeTextElementWithFont(
  fontFamily: string,
  originalFont: string | null,
  content = 'Test content',
): TextElement {
  return {
    elementId: 'elem-font-test',
    type: 'text',
    content,
    bounds: { x: 50, y: 100, width: 300, height: 30 },
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
// Suite 1 — Comportement avec police standard (Helvetica)
// Ces tests DOIVENT passer sur main actuel ET après fix Wave 2.
// ---------------------------------------------------------------------------

describe('addText — police standard (comportement de référence, toujours vert)', () => {
  it('ajoute du texte Helvetica sans erreur et produit un PDF valide', async () => {
    const handle = await openDocument(fixtureBuffer(SIMPLE_PDF));
    const element = makeTextElementWithFont('helvetica', null, 'Hello Helvetica');

    await expect(addText(handle, 1, element)).resolves.toBeUndefined();

    const saved = await saveDocument(handle);
    expect(saved.slice(0, 5).toString('ascii')).toBe('%PDF-');
  });

  it('police standard Courier acceptée sans erreur', async () => {
    const handle = await openDocument(fixtureBuffer(SIMPLE_PDF));
    const element = makeTextElementWithFont('courier', null, 'Courier text');

    await expect(addText(handle, 1, element)).resolves.toBeUndefined();
  });

  it('police standard Times acceptée sans erreur', async () => {
    const handle = await openDocument(fixtureBuffer(SIMPLE_PDF));
    const element = makeTextElementWithFont('times', null, 'Times text');

    await expect(addText(handle, 1, element)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Suite 2 — Comportement avec police non-standard et originalFont null
// Ces tests exposent la RÉGRESSION : police non-standard sans originalFont
// doit soit lever une erreur explicite, soit utiliser un fallback documenté.
// Sur main actuel : silently falls back to Helvetica (régression silencieuse).
// Après fix Wave 2 : comportement explicite (erreur OU fallback avec log).
// ---------------------------------------------------------------------------

describe('addText — police non-standard sans originalFont (régression RT-02)', () => {
  /**
   * RÉGRESSION : addText avec fontFamily="Calibri" et originalFont=null
   * doit soit :
   *   A) lever une erreur explicite (préféré)
   *   B) utiliser Helvetica en fallback ET émettre un warning
   *
   * Sur main actuel : silently embeds StandardFonts.Helvetica sans avertissement.
   *
   * Ce test ÉCHOUE sur main actuel car il n'y a ni erreur ni warning.
   * Il PASSE après fix Wave 2 (comportement explicite implémenté).
   */
  it('fontFamily="Calibri" sans originalFont : comportement explicite attendu (pas de fallback silencieux)', async () => {
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const handle = await openDocument(fixtureBuffer(SIMPLE_PDF));
    const element = makeTextElementWithFont('Calibri', null, 'Calibri text without originalFont');

    let threwExplicitError = false;
    try {
      await addText(handle, 1, element);
    } catch {
      // Une erreur explicite est acceptable — elle signale que la police est inconnue
      threwExplicitError = true;
    }

    // After Wave 4 the fallback is no longer "silent Helvetica". resolveFont
    // logs an info-level "Police custom remplacée par bundled OFL" and embeds
    // a Liberation Sans / Serif / Mono / CourierPrime TTF so the bake gets
    // a real metric-compatible font. Acceptable signals: any console.* call,
    // or an explicit throw.
    const anyLogCalled =
      consoleWarnSpy.mock.calls.length > 0 ||
      consoleErrorSpy.mock.calls.length > 0 ||
      consoleLogSpy.mock.calls.length > 0;
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();

    expect(
      threwExplicitError || anyLogCalled,
      'RÉGRESSION RT-02 : police non-standard sans originalFont acceptée silencieusement ' +
      '(ni erreur, ni info, ni warning). Le fallback doit toujours émettre un signal traçable.',
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Suite 3 — Comportement avec originalFont présent
// Ces tests vérifient la PROPAGATION du champ originalFont.
// Sur main actuel : originalFont est ignoré → ROUGE.
// Après fix Wave 2 : originalFont est utilisé pour retrouver la police embarquée → VERT.
// ---------------------------------------------------------------------------

describe('addText — originalFont propagation (RÉGRESSION PRINCIPALE RT-02)', () => {
  /**
   * Ce test est le test de NON-RÉGRESSION officiel pour la propagation de originalFont.
   *
   * Scénario : on ajoute un texte avec fontFamily="Calibri" et originalFont="ABCDEF+Calibri".
   * Le renderer doit :
   *   1. Reconnaître que "Calibri" n'est pas une StandardFont
   *   2. Utiliser originalFont pour identifier la police embarquée dans le PDF source
   *   3. Ne PAS substituer Helvetica
   *
   * Sur main actuel : embedFont(normalizeFontName("Calibri")) → erreur ou Helvetica silencieux.
   * Après fix Wave 2 : la police est récupérée via originalFont et embedded depuis le PDF source.
   */
  it('originalFont="ABCDEF+Calibri" : le texte ajouté ne doit pas utiliser Helvetica dans le PDF', async () => {
    const source = fixtureBuffer(SIMPLE_PDF);
    const handle = await openDocument(source);

    const element = makeTextElementWithFont('Calibri', 'ABCDEF+Calibri', 'Calibri with originalFont');

    // Sur main actuel, addText peut :
    //   - lever une erreur (pdf-lib ne connaît pas "calibri" comme StandardFont)
    //   - ou substituer Helvetica silencieusement
    // Après fix Wave 2 : addText doit réussir sans erreur et utiliser la police correcte

    let addTextError: Error | null = null;
    try {
      await addText(handle, 1, element);
    } catch (err) {
      addTextError = err instanceof Error ? err : new Error(String(err));
    }

    if (addTextError) {
      // Sur main actuel, addText peut échouer car "calibri" n'est pas une StandardFont connue
      // C'est aussi une régression (devrait fallback proprement ou utiliser originalFont)
      //
      // Ce test ÉCHOUE sur main actuel avec cette assertion
      expect(
        addTextError,
        `RÉGRESSION RT-02 : addText a levé une erreur pour originalFont="ABCDEF+Calibri".\n` +
        `Erreur: ${addTextError.message}\n` +
        `Après fix Wave 2, addText doit réussir en utilisant la police embarquée via originalFont.`,
      ).toBeNull();
      return;
    }

    // Si addText a réussi, vérifier que le PDF ne contient pas UNIQUEMENT Helvetica
    const saved = await saveDocument(handle);
    const fonts = await extractFontsFromPdf(saved);

    // Le PDF source (simple.pdf) ne contient que Helvetica.
    // Après ajout d'un texte avec originalFont="ABCDEF+Calibri", le PDF sauvegardé
    // devrait contenir SOIT une police Calibri, SOIT une erreur explicite.
    //
    // Sur main actuel : seul Helvetica est présent (fallback silencieux) → ROUGE
    // Après fix Wave 2 : Calibri ou équivalent doit être présent → VERT
    const hasOnlyHelvetica = fonts.every(
      (f) => f.family.toLowerCase().includes('helvetica'),
    );

    expect(
      !hasOnlyHelvetica,
      `RÉGRESSION RT-02 : seule Helvetica est présente dans le PDF après addText avec originalFont="ABCDEF+Calibri".\n` +
      `Polices détectées: ${JSON.stringify(fonts.map(f => f.family))}\n` +
      `Le renderer a fait un fallback silencieux sur Helvetica au lieu d'utiliser originalFont.`,
    ).toBe(true);
  });

  /**
   * Vérification que le champ style.originalFont est bien lisible (sanity check du type).
   * Ce test DOIT passer sur main actuel — il ne teste pas le comportement de rendu.
   */
  it('le champ style.originalFont est accessible sur TextElement (sanity check type)', () => {
    const element = makeTextElementWithFont('Calibri', 'ABCDEF+Calibri');
    expect(element.style.originalFont).toBe('ABCDEF+Calibri');
    expect(element.style.fontFamily).toBe('Calibri');
  });
});

// ---------------------------------------------------------------------------
// Suite 4 — updateText propage originalFont (même régression)
// ---------------------------------------------------------------------------

describe('updateText — originalFont propagation', () => {
  /**
   * updateText appelle addText en interne → même régression.
   * Ce test vérifie que la propagation de originalFont fonctionne aussi via updateText.
   */
  it('updateText avec originalFont non-standard doit comportement explicite (pas de fallback silencieux)', async () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const handle = await openDocument(fixtureBuffer(SIMPLE_PDF));
    const oldBounds: Bounds = { x: 50, y: 50, width: 200, height: 30 };
    const element = makeTextElementWithFont('Calibri', 'ABCDEF+Calibri', 'Updated Calibri text');

    let threwExplicitError = false;
    try {
      await updateText(handle, 1, oldBounds, element);
    } catch {
      threwExplicitError = true;
    }

    const warnCalled = consoleSpy.mock.calls.length > 0 || consoleErrorSpy.mock.calls.length > 0;
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();

    // Même comportement attendu que pour addText : erreur OU warning, pas de silence
    expect(
      threwExplicitError || warnCalled,
      'RÉGRESSION RT-02 : updateText avec originalFont non-standard accepté silencieusement.',
    ).toBe(true);
  });
});
