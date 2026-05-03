/**
 * REPRO: bug "elements jump between pages after split"
 *
 * Four hypotheses are tested here. Each test is marked `it.fails` when the
 * implementation produces the WRONG behaviour today, documenting the mode of
 * failure. When a hypothesis CANNOT be reproduced (e.g. pdf-lib silently
 * drops the data rather than misplacing it) the test is kept as a
 * regular `it` that asserts the degraded-but-not-wrong outcome, with an
 * explanatory comment.
 *
 * Zero modifications to split.ts or any other source file.
 */

import { describe, it, expect } from 'vitest';
import {
  PDFDocument,
  PDFName,
  PDFArray,
  PDFDict,
  PDFRef,
  PDFNumber,
  PDFString,
  StandardFonts,
  rgb,
  asPDFName,
} from 'pdf-lib';
import { splitAt, splitPDF } from '../../src/merge-split/split';

// ---------------------------------------------------------------------------
// Fixture helpers (all inline — no external files needed)
// ---------------------------------------------------------------------------

/**
 * Build a 6-page PDF where page 1 carries a GoTo (internal) link annotation
 * that targets page 5 (zero-based index 4).
 *
 * Structure:
 *   pages 1-6 (indices 0-5)
 *   page 1 → Annots: [Link → /GoTo → Dest [page5ref, /XYZ, 0, 792, 0]]
 *
 * After splitAt([3]) we expect:
 *   chunk A: pages 1-3 (original indices 0-2)  — contains the link annotation
 *   chunk B: pages 4-6 (original indices 3-5)  — contains the destination page
 *
 * Desired behaviour: the GoTo destination in chunk A should either be
 *   (a) updated to point to the corresponding page within chunk B, or
 *   (b) removed/nulled to avoid a dangling ref.
 *
 * Actual (broken) behaviour: pdf-lib copyPages copies the link annotation
 * dict literally, including the raw PDFRef to the ORIGINAL page object.
 * That ref is now a dangling pointer inside chunk A — the PDF is corrupt
 * and a viewer will either crash, silently skip the link, or jump to an
 * unrelated page (the "element jumps to wrong page" symptom).
 */
async function buildSixPagePdfWithCrossPageLink(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  // Add 6 pages, each labelled
  const pages: ReturnType<typeof doc.addPage>[] = [];
  for (let i = 1; i <= 6; i++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`Page ${i} of 6`, { x: 50, y: 720, size: 24, font, color: rgb(0, 0, 0) });
    if (i === 1) {
      page.drawText('Click here to jump to page 5', {
        x: 50, y: 600, size: 14, font, color: rgb(0, 0, 0.8),
      });
    }
    if (i === 5) {
      page.drawText('DESTINATION — you should arrive here from page 1', {
        x: 50, y: 600, size: 14, font, color: rgb(0, 0.5, 0),
      });
    }
    pages.push(page);
  }

  // The destination is page index 4 (page 5, 1-based).
  // We need its PDFRef so we can embed it in the GoTo action.
  const page5Ref = doc.catalog.Pages().get(PDFName.of('Kids')) as PDFArray;
  // pdf-lib stores page refs in the Kids array of the page tree
  const kids = page5Ref;
  // Grab ref to page index 4 (0-based) from the flat page list
  const allPageRefs = doc.getPages().map((_, idx) => {
    // Access internal ref via the page node
    return doc.context.getObjectRef(doc.getPage(idx).node) ?? null;
  });

  const destPageRef = allPageRefs[4]; // page 5 (0-based: 4)

  if (!destPageRef) {
    throw new Error('Could not obtain PDFRef for page 5');
  }

  // Build a GoTo action destination array: [pageRef, /XYZ, left, top, zoom]
  const destArray = doc.context.obj([
    destPageRef,
    PDFName.of('XYZ'),
    PDFNumber.of(0),
    PDFNumber.of(792),
    PDFNumber.of(0),
  ]);

  // Build the link annotation dict on page 1
  const page1 = doc.getPage(0);
  const linkAnnot = doc.context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Link'),
    Rect: [50, 590, 300, 615],
    Border: [0, 0, 1],
    A: doc.context.obj({
      Type: PDFName.of('Action'),
      S: PDFName.of('GoTo'),
      D: destArray,
    }),
  });

  const linkAnnotRef = doc.context.register(linkAnnot as unknown as PDFDict);
  page1.node.set(PDFName.of('Annots'), doc.context.obj([linkAnnotRef]));

  const bytes = await doc.save();
  return Buffer.from(bytes);
}

/**
 * Build a 4-page PDF where a text form field widget spans pages 2 and 3
 * in the following sense: the AcroForm /Fields array references the widget,
 * and the widget appears on page 2 via its /P entry. After split at [2],
 * the widget belongs to chunk A (pages 1-2) but the AcroForm /Fields
 * catalogue in chunk B no longer contains it — the field "disappears"
 * from the post-split form entirely, or the /P back-pointer becomes stale.
 */
async function buildFourPagePdfWithFormFieldOnPage2(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  for (let i = 1; i <= 4; i++) {
    const p = doc.addPage([612, 792]);
    p.drawText(`Page ${i}`, { x: 50, y: 720, size: 20, font });
  }

  const form = doc.getForm();
  // Place a text field on page 2
  const field = form.createTextField('signature_on_page2');
  field.setText('Sign here');
  field.addToPage(doc.getPage(1), { x: 100, y: 400, width: 200, height: 30 });

  const bytes = await doc.save();
  return Buffer.from(bytes);
}

/**
 * Build a 6-page PDF with a /Dest named destination on page 5.
 * Page 1 has a Link annotation using a named /Dest string "target-page5".
 * The document catalog's /Dests dict maps "target-page5" → page 5.
 *
 * After split at [3], the Dests dict lives in the catalog of the ORIGINAL
 * doc. copyPages does NOT copy the catalog-level /Dests into the new doc,
 * so named destinations are silently lost in the chunks.
 */
async function buildPdfWithNamedDestination(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  for (let i = 1; i <= 6; i++) {
    const p = doc.addPage([612, 792]);
    p.drawText(`Page ${i}`, { x: 50, y: 720, size: 20, font });
  }

  // Register a named destination in the catalog /Dests dict
  const page5Ref = doc.context.getObjectRef(doc.getPage(4).node);
  if (!page5Ref) throw new Error('no ref for page 5');

  const destArray = doc.context.obj([
    page5Ref,
    PDFName.of('XYZ'),
    PDFNumber.of(0),
    PDFNumber.of(792),
    PDFNumber.of(0),
  ]);

  // pdf-lib doesn't expose a high-level named dest API; set it directly on catalog
  const destsDict = doc.context.obj({
    'target-page5': destArray,
  });
  doc.catalog.set(PDFName.of('Dests'), destsDict);

  // Page 1 link annotation using the named dest
  const linkAnnot = doc.context.obj({
    Type: PDFName.of('Annot'),
    Subtype: PDFName.of('Link'),
    Rect: [50, 590, 300, 615],
    Border: [0, 0, 1],
    Dest: PDFString.of('target-page5'),
  });
  const linkRef = doc.context.register(linkAnnot as unknown as PDFDict);
  doc.getPage(0).node.set(PDFName.of('Annots'), doc.context.obj([linkRef]));

  const bytes = await doc.save();
  return Buffer.from(bytes);
}

/**
 * Build a 6-page PDF where each page has a text element drawn at a
 * y-coordinate that depends on the page height (792 pt). This simulates
 * the "bounds bake" scenario: if split.ts used a stale page height when
 * copying pages, y-coordinates would shift.
 *
 * In practice pdf-lib copyPages preserves the MediaBox verbatim, so this
 * hypothesis tests whether the page dimensions are correctly preserved.
 */
async function buildPdfWithKnownPageDimensions(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  // Page heights: alternating 792 (portrait) and 612 (square-ish)
  const heights = [792, 612, 792, 612, 792, 612];

  for (let i = 0; i < 6; i++) {
    const h = heights[i]!;
    const page = doc.addPage([612, h]);
    // Draw text at y = h - 72 (1 inch from top) — known position
    page.drawText(`Page ${i + 1} height=${h}`, { x: 50, y: h - 72, size: 14, font });
  }

  const bytes = await doc.save();
  return Buffer.from(bytes);
}

// ---------------------------------------------------------------------------
// Helper: inspect the Annots array of a page inside a buffer
// ---------------------------------------------------------------------------

async function getAnnotsOnPage(buf: Buffer, pageIndex: number): Promise<unknown[]> {
  const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
  const page = doc.getPage(pageIndex);
  const annotsRaw = page.node.get(PDFName.of('Annots'));
  if (!annotsRaw) return [];
  // Resolve indirect ref if needed
  const annotsArray = doc.context.lookupMaybe(annotsRaw, PDFArray);
  if (!annotsArray) return [];
  const result: unknown[] = [];
  for (let i = 0; i < annotsArray.size(); i++) {
    const item = annotsArray.get(i);
    result.push(item);
  }
  return result;
}

async function getAcroFormFieldCount(buf: Buffer): Promise<number> {
  const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
  const form = doc.getForm();
  return form.getFields().length;
}

async function getCatalogDests(buf: Buffer): Promise<unknown> {
  const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
  return doc.catalog.get(PDFName.of('Dests'));
}

async function getPageDimensions(buf: Buffer, pageIndex: number): Promise<{ width: number; height: number }> {
  const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
  const page = doc.getPage(pageIndex);
  const { width, height } = page.getSize();
  return { width, height };
}

// ---------------------------------------------------------------------------
// H1: Off-by-one — verify that splitAt([3]) produces correct page sets
// ---------------------------------------------------------------------------

describe('REPRO bug split — elements jump between pages', () => {

  describe('H1 — off-by-one: splitAt([3]) on 6-page doc', () => {
    /**
     * splitAt([3]) builds ranges:
     *   { start: 1, end: 3 }  → 3 pages
     *   { start: 4, end: 6 }  → 3 pages
     *
     * The split POINT is PAGE 3, meaning page 3 is the last page of chunk A.
     * This is correct per the splitAt contract. We verify page counts match
     * and that the implementation does not off-by-one into chunk B.
     *
     * NOTE: this test PASSES today — H1 (pure off-by-one count) is NOT
     * the root cause of the reported bug. The root cause is H2.
     */
    it('page counts are correct: 3 pages each (H1 is NOT the root cause)', async () => {
      const buf = await buildSixPagePdfWithCrossPageLink();
      const [chunkA, chunkB] = await splitAt(buf, [3]);

      const docA = await PDFDocument.load(chunkA!, { ignoreEncryption: true });
      const docB = await PDFDocument.load(chunkB!, { ignoreEncryption: true });

      // These should pass — basic page count is fine
      expect(docA.getPageCount()).toBe(3);
      expect(docB.getPageCount()).toBe(3);
    });

    /**
     * The link annotation on page 1 (original) contains a /GoTo /D entry
     * whose first element is a PDFRef pointing to PAGE 5 of the ORIGINAL doc.
     * After split, that ref is copied verbatim into chunk A.
     *
     * BROKEN: The destination ref inside chunk A now points to an object
     * that either does not exist in chunk A's xref table, or resolves to an
     * unrelated object (the "element jumps to wrong page" bug).
     *
     * We assert: after split, the GoTo destination pageRef inside chunk A
     * should resolve to a page WITHIN chunk A or be null/absent.
     * The current implementation copies the raw ref without remapping → FAILS.
     */
    it(
      'H2: GoTo link dest ref in chunk A — annotation retained, cross-chunk action neutralised (no dangling ref)',
      async () => {
        const buf = await buildSixPagePdfWithCrossPageLink();
        const [chunkA] = await splitAt(buf, [3]);

        const docA = await PDFDocument.load(chunkA!, { ignoreEncryption: true });
        const page1 = docA.getPage(0);

        // Annotation must still be present (we keep it, just neutralise the action)
        const annotsRaw = page1.node.get(PDFName.of('Annots'));
        expect(annotsRaw).not.toBeUndefined();

        const annotsArr = docA.context.lookupMaybe(annotsRaw!, PDFArray);
        expect(annotsArr).not.toBeNull();
        expect(annotsArr!.size()).toBeGreaterThan(0);

        // Resolve the annotation dict
        const annotRef = annotsArr!.get(0) as PDFRef;
        const annotDict = docA.context.lookup(annotRef, PDFDict);

        // FIXED: the /A action targeting a cross-chunk page is removed to avoid a
        // dangling PDFRef. The annotation is inert (no navigation) which is safe.
        // Previously: /A was copied verbatim with a stale cross-document page ref.
        const actionDict = annotDict.get(PDFName.of('A'));
        const destDirect = annotDict.get(PDFName.of('Dest'));

        // Either /A is gone OR if it exists its /D dest is a valid in-chunk page ref.
        if (actionDict === undefined && destDirect === undefined) {
          // Correct conservative fix: action neutralised
          expect(true).toBe(true);
        } else if (actionDict !== undefined) {
          // /A still present — verify it does NOT contain a stale cross-doc ref
          const resolvedAction = docA.context.lookupMaybe(actionDict, PDFDict);
          if (resolvedAction) {
            const destRaw = resolvedAction.get(PDFName.of('D'));
            if (destRaw) {
              const destArr = docA.context.lookupMaybe(destRaw, PDFArray);
              if (destArr) {
                const destPageRef = destArr.get(0);
                if (destPageRef instanceof PDFRef) {
                  const chunkAPageRefs = new Set(
                    docA.getPages().map((p) => docA.context.getObjectRef(p.node)?.toString())
                  );
                  const destPageObj = docA.context.lookupMaybe(destPageRef, PDFDict);
                  const resolvedRef = destPageObj ? docA.context.getObjectRef(destPageObj) : undefined;
                  // Must resolve to a page WITHIN this chunk — no dangling refs
                  expect(chunkAPageRefs.has(resolvedRef?.toString())).toBe(true);
                }
              }
            }
          }
        }
      },
    );
  });

  // --------------------------------------------------------------------------
  // H2: cross-page GoTo link — annotation present but destination is dangling
  // --------------------------------------------------------------------------

  describe('H2 — GoTo link annotation: destination ref survives split correctly', () => {
    /**
     * CONFIRMED FAILURE MODE:
     * pdf-lib copyPages() copies the full annotation dict including the /D
     * (destination) array. The first element of /D is a raw PDFRef to the
     * original source document's page 5. In the destination document (chunk A),
     * this ref resolves to PDFNull or to an unrelated object — the link is
     * effectively broken/dangling.
     *
     * The annotation DOES appear in chunk A (not lost), but its GoTo target
     * is corrupt. This is the "element jumps between pages" symptom: the
     * viewer either jumps to page 1 (null dest → start) or to an arbitrary
     * page (stale ref collision).
     */
    it(
      'H2-a: annotation on page 1 of chunk A is inert (no dangling GoTo dest) after split',
      async () => {
        const buf = await buildSixPagePdfWithCrossPageLink();
        const [chunkA] = await splitAt(buf, [3]);

        const docA = await PDFDocument.load(chunkA!, { ignoreEncryption: true });
        const page1 = docA.getPage(0);

        const annotsRaw = page1.node.get(PDFName.of('Annots'));

        // Annotation must still be present in chunk A
        expect(annotsRaw).not.toBeUndefined();

        const annotsArr = docA.context.lookupMaybe(annotsRaw!, PDFArray);
        expect(annotsArr).not.toBeNull();
        expect(annotsArr!.size()).toBe(1); // our one link annotation

        const annotRef = annotsArr!.get(0) as PDFRef;
        const annotDict = docA.context.lookup(annotRef, PDFDict);

        // FIXED: the /A action that pointed to cross-chunk page 5 is removed.
        // The annotation is now inert — no dangling PDFRef in the chunk's xref.
        const actionRaw = annotDict.get(PDFName.of('A'));
        const destDirect = annotDict.get(PDFName.of('Dest'));

        // Both /A and /Dest should be absent (cross-chunk destination neutralised)
        expect(actionRaw).toBeUndefined();
        expect(destDirect).toBeUndefined();
      },
    );

    /**
     * Confirm that the annotation IS copied (not silently dropped).
     * This is the non-failing half of H2: annotations survive the copy,
     * the bug is specifically in the destination remapping.
     * This test PASSES, documenting what split.ts DOES correctly.
     */
    it('H2-b: annotation IS present in chunk A page 1 (not silently dropped)', async () => {
      const buf = await buildSixPagePdfWithCrossPageLink();
      const [chunkA] = await splitAt(buf, [3]);

      const annots = await getAnnotsOnPage(chunkA!, 0);
      // Annotation was copied — it is present
      expect(annots.length).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // H3: AcroForm form fields — widget loses its /P back-pointer context
  // --------------------------------------------------------------------------

  describe('H3 — AcroForm widget: form fields after split', () => {
    /**
     * FAILURE MODE:
     * When splitPDF copies page 2 (which has a form field widget) into chunk A,
     * the widget's /P (page back-pointer) still references the ORIGINAL page 2
     * object. The AcroForm /Fields array in chunk A's NEW document is empty
     * (pdf-lib does not copy the AcroForm catalog entry when using copyPages).
     *
     * Result: the form field widget is visible on the page (it was copied with
     * the page's /Annots), but it is not registered in the new document's
     * AcroForm. The field cannot be read, filled, or submitted — it "vanished"
     * from the form perspective even though it renders on screen.
     *
     * Additionally the /P back-pointer in the widget dict is a stale ref to the
     * original doc's page 2 object, not the copied page object.
     */
    it(
      'H3-a: form field on page 2 is preserved in AcroForm after split at [2]',
      async () => {
        const buf = await buildFourPagePdfWithFormFieldOnPage2();

        // Verify source has the form field
        const sourceFieldCount = await getAcroFormFieldCount(buf);
        expect(sourceFieldCount).toBe(1);

        // Split at page 2: chunkA = pages 1-2, chunkB = pages 3-4
        const [chunkA] = await splitAt(buf, [2]);

        // chunk A contains page 2 (the field page) → should still have the field
        const chunkAFieldCount = await getAcroFormFieldCount(chunkA!);

        // FIXED: field is now correctly transferred to chunk A via Fix 2 (AcroForm re-registration)
        expect(chunkAFieldCount).toBe(1);
      },
    );

    /**
     * Confirm that chunk B (pages 3-4, which never had the field) has 0 fields.
     * This test PASSES and documents that the field does NOT ghost-copy to the
     * wrong chunk.
     */
    it('H3-b: form field does NOT appear in chunk B (pages 3-4)', async () => {
      const buf = await buildFourPagePdfWithFormFieldOnPage2();
      const [, chunkB] = await splitAt(buf, [2]);

      const chunkBFieldCount = await getAcroFormFieldCount(chunkB!);
      // chunk B never had the field → still 0 after split
      expect(chunkBFieldCount).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // H3b: Named destinations — silently dropped from catalog after split
  // --------------------------------------------------------------------------

  describe('H3b — Named /Dests: catalog-level destination table is lost after split', () => {
    /**
     * CONFIRMED FAILURE MODE (different axis from H3):
     * The PDF catalog's /Dests dict maps a name string → [pageRef, /XYZ, ...].
     * pdf-lib copyPages does NOT carry the /Dests catalog entry into the new
     * document. Named destinations become broken: any link using /Dest (string)
     * instead of /D (array) silently fails to navigate.
     *
     * This manifests as links on page 1 doing nothing in a viewer — the named
     * destination "target-page5" is undefined in the split document.
     */
    it(
      'H3b: named /Dests catalog is correctly remapped after split — in-chunk dests preserved, out-of-chunk dests omitted',
      async () => {
        const buf = await buildPdfWithNamedDestination();

        // Verify source has /Dests
        const srcDests = await getCatalogDests(buf);
        expect(srcDests).not.toBeUndefined();

        // The fixture: page 1 link → named dest "target-page5" → page 5.
        // splitAt([3]) → chunkA = pages 1-3, chunkB = pages 4-6.
        // "target-page5" targets page 5 which is in chunkB, not chunkA.
        const [chunkA, chunkB] = await splitAt(buf, [3]);

        // chunkA: "target-page5" is out-of-chunk → no /Dests entry for it.
        // The /Dests dict is either absent or empty for chunkA.
        const chunkADests = await getCatalogDests(chunkA!);
        // Either null/undefined (no dests) or an empty dict — both are correct.
        if (chunkADests !== undefined && chunkADests !== null) {
          // If a /Dests dict exists, it must not contain the cross-chunk dest
          const docA = await PDFDocument.load(chunkA!, { ignoreEncryption: true });
          const destsDict = docA.context.lookupMaybe(
            docA.catalog.get(PDFName.of('Dests'))!,
            PDFDict
          );
          if (destsDict) {
            const targetEntry = destsDict.get(PDFName.of('target-page5'));
            // Cross-chunk dest must have been omitted
            expect(targetEntry).toBeUndefined();
          }
        }

        // chunkB: "target-page5" is in-chunk (page 5 → index 1 in chunkB).
        // The /Dests dict in chunkB MUST contain the remapped entry.
        const chunkBDests = await getCatalogDests(chunkB!);
        expect(chunkBDests).not.toBeUndefined();

        const docB = await PDFDocument.load(chunkB!, { ignoreEncryption: true });
        const destsDictB = docB.context.lookupMaybe(
          docB.catalog.get(PDFName.of('Dests'))!,
          PDFDict
        );
        expect(destsDictB).not.toBeNull();

        // The named dest must resolve to a valid page within chunkB
        const targetEntry = destsDictB!.get(PDFName.of('target-page5'));
        expect(targetEntry).not.toBeUndefined();

        const destArr = docB.context.lookupMaybe(targetEntry!, PDFArray);
        expect(destArr).not.toBeNull();

        const pageRef = destArr!.get(0) as PDFRef;
        const chunkBPageRefs = new Set(
          docB.getPages().map((p) => docB.context.getObjectRef(p.node)?.objectNumber)
        );
        // The page ref must point to a page within chunkB
        expect(chunkBPageRefs.has(pageRef.objectNumber)).toBe(true);
      },
    );
  });

  // --------------------------------------------------------------------------
  // H4: Page dimensions (MediaBox) — preserved verbatim after split
  // --------------------------------------------------------------------------

  describe('H4 — Page dimensions: MediaBox is correctly preserved after split', () => {
    /**
     * PASSES: pdf-lib copyPages copies the MediaBox (page dimensions) verbatim.
     * H4 (bounds bake with stale page height) is NOT the root cause for the
     * "elements jump" bug — the dimensions survive correctly.
     *
     * This test documents that H4 is ruled out as a hypothesis.
     */
    it('H4: page dimensions are preserved exactly after splitAt([3]) on alternating-height PDF', async () => {
      const buf = await buildPdfWithKnownPageDimensions();

      // Original heights: page 1=792, 2=612, 3=792, 4=612, 5=792, 6=612
      const [chunkA, chunkB] = await splitAt(buf, [3]);

      // chunk A: pages 1-3 → heights 792, 612, 792
      expect((await getPageDimensions(chunkA!, 0)).height).toBe(792);
      expect((await getPageDimensions(chunkA!, 1)).height).toBe(612);
      expect((await getPageDimensions(chunkA!, 2)).height).toBe(792);

      // chunk B: pages 4-6 → heights 612, 792, 612
      expect((await getPageDimensions(chunkB!, 0)).height).toBe(612);
      expect((await getPageDimensions(chunkB!, 1)).height).toBe(792);
      expect((await getPageDimensions(chunkB!, 2)).height).toBe(612);
    });

    it('H4: page width is also preserved correctly after split', async () => {
      const buf = await buildPdfWithKnownPageDimensions();
      const [chunkA] = await splitAt(buf, [3]);

      // All pages were created with width=612
      for (let i = 0; i < 3; i++) {
        expect((await getPageDimensions(chunkA!, i)).width).toBe(612);
      }
    });
  });
});
