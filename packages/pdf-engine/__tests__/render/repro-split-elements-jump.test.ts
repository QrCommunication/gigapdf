/**
 * REPRO — Split must produce self-contained chunks ("elements jump between pages")
 *
 * When `splitAt` cuts a document, every chunk must be a self-contained PDF:
 *   - a cross-page GoTo link whose target leaves the chunk must be neutralised
 *     (the annotation may stay, but it must NOT carry a dangling page reference);
 *   - an AcroForm field stays registered on the chunk that keeps its widget page;
 *   - page dimensions (MediaBox) survive verbatim.
 *
 * This is the APP-level wiring test (does `splitAt` invoke the engine correctly).
 * The byte-level pruning itself — cross-page links, AcroForm widgets, named
 * `/Dests`, outline dests — is pinned in the engine's own Rust test
 * `extract_pages_yields_self_contained_chunks`. The previous version of this
 * file walked pdf-lib's low-level object model to inspect `/Annots`, `/A` and the
 * catalog `/Dests`; it is now built and inspected entirely through the native
 * engine (no pdf-lib). The named-`/Dests` sub-case has no native create/read API
 * and is covered by the Rust test, so it is intentionally not re-asserted here.
 */

import { describe, it, expect } from 'vitest';
import { getEngine } from '../../src/wasm';
import { openDocument, saveDocument, closeDocument } from '../../src/engine/document-handle';
import { addFormField } from '../../src/render/form-renderer';
import { getFormFields } from '../../src/forms/reader';
import { splitAt } from '../../src/merge-split/split';
import type { FormFieldElement } from '@giga-pdf/types';

// ---------------------------------------------------------------------------
// Builders — native engine (no pdf-lib)
// ---------------------------------------------------------------------------

/** A 6-page Letter PDF; page 1 carries a GoTo link to page 5. */
async function buildSixPagePdfWithCrossPageLink(): Promise<Buffer> {
  const giga = await getEngine();
  const doc = giga.open(giga.txtToPdf('page'));
  doc.resizePage(1, 612, 792);
  for (let i = 2; i <= 6; i++) doc.addPage(612, 792, i - 1);
  // GoTo link on page 1 → page 5 (rect in PDF user space, origin bottom-left).
  doc.addGotoLink(1, 50, 590, 300, 615, 5);
  const bytes = doc.save();
  doc.close();
  return Buffer.from(bytes);
}

/** A 4-page Letter PDF with a single text form field on page 2. */
async function buildFourPagePdfWithFormFieldOnPage2(): Promise<Buffer> {
  const giga = await getEngine();
  const base = giga.open(giga.txtToPdf('page'));
  base.resizePage(1, 612, 792);
  for (let i = 2; i <= 4; i++) base.addPage(612, 792, i - 1);
  const baseBytes = Buffer.from(base.save());
  base.close();

  const handle = await openDocument(baseBytes);
  addFormField(handle, 2, makeTextField('signature_on_page2'));
  const out = await saveDocument(handle, {});
  closeDocument(handle);
  return out;
}

/** A 6-page PDF with alternating page heights (792 / 612). */
async function buildPdfWithKnownPageDimensions(): Promise<Buffer> {
  const giga = await getEngine();
  const heights = [792, 612, 792, 612, 792, 612];
  const doc = giga.open(giga.txtToPdf('page'));
  doc.resizePage(1, 612, heights[0]!);
  for (let i = 1; i < heights.length; i++) {
    doc.addPage(612, heights[i]!, i); // insert after page i → sequential
  }
  const bytes = doc.save();
  doc.close();
  return Buffer.from(bytes);
}

function makeTextField(name: string): FormFieldElement {
  return {
    elementId: `f_${name}`,
    type: 'form_field',
    bounds: { x: 100, y: 400, width: 200, height: 30 },
    transform: { rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 },
    layerId: null,
    locked: false,
    visible: true,
    fieldType: 'text',
    fieldName: name,
    value: 'Sign here',
    defaultValue: '',
    options: null,
    properties: {
      required: false,
      readOnly: false,
      maxLength: null,
      multiline: false,
      password: false,
      comb: false,
    },
    style: {
      fontFamily: 'Arial',
      fontSize: 12,
      textColor: '#000000',
      backgroundColor: '#ffffff',
      borderColor: '#cccccc',
      borderWidth: 1,
    },
    format: { type: 'none', pattern: null },
  };
}

// ---------------------------------------------------------------------------
// Native inspection helpers
// ---------------------------------------------------------------------------

async function pageCount(buf: Buffer): Promise<number> {
  const h = await openDocument(new Uint8Array(buf));
  const n = h.pageCount;
  closeDocument(h);
  return n;
}

async function pageLinks(buf: Buffer, page: number) {
  const h = await openDocument(new Uint8Array(buf));
  const links = h._doc.links(page);
  closeDocument(h);
  return links;
}

async function formFieldCount(buf: Buffer): Promise<number> {
  return (await getFormFields(buf)).length;
}

async function pageDims(buf: Buffer, page: number): Promise<{ width: number; height: number }> {
  const h = await openDocument(new Uint8Array(buf));
  const info = h._doc.pageInfo(page);
  closeDocument(h);
  return { width: info.width, height: info.height };
}

// ---------------------------------------------------------------------------

describe('REPRO bug split — elements jump between pages (native engine)', () => {
  describe('H1 — page counts after splitAt([3])', () => {
    it('splitAt([3]) on a 6-page doc yields 3 + 3 pages', async () => {
      const buf = await buildSixPagePdfWithCrossPageLink();
      const [chunkA, chunkB] = await splitAt(buf, [3]);
      expect(await pageCount(chunkA!)).toBe(3);
      expect(await pageCount(chunkB!)).toBe(3);
    });
  });

  describe('H2 — cross-page GoTo link is neutralised in the chunk that loses its target', () => {
    it('source page 1 navigates to page 5; chunk A keeps no link targeting outside it', async () => {
      const buf = await buildSixPagePdfWithCrossPageLink();

      // Sanity: the source really has a navigable page-link to page 5.
      const srcLinks = await pageLinks(buf, 1);
      expect(srcLinks.some((l) => l.kind === 'page' && l.page === 5)).toBe(true);

      // splitAt([3]) → chunk A = pages 1-3 (the link's target page 5 is gone).
      const [chunkA] = await splitAt(buf, [3]);

      // No surviving navigable page-link may point outside chunk A's [1..3].
      const aLinks = await pageLinks(chunkA!, 1);
      const danglingOrCross = aLinks.filter(
        (l) => l.kind === 'page' && (l.page === undefined || l.page < 1 || l.page > 3),
      );
      expect(danglingOrCross).toEqual([]);

      // And chunk A is still a structurally valid 3-page PDF.
      expect(await pageCount(chunkA!)).toBe(3);
    });
  });

  describe('H3 — AcroForm field stays with the chunk that keeps its widget page', () => {
    it('field on page 2 survives in chunk A after splitAt([2]); chunk B has none', async () => {
      const buf = await buildFourPagePdfWithFormFieldOnPage2();
      expect(await formFieldCount(buf)).toBe(1);

      const [chunkA, chunkB] = await splitAt(buf, [2]);
      expect(await formFieldCount(chunkA!)).toBe(1); // pages 1-2 keep the field
      expect(await formFieldCount(chunkB!)).toBe(0); // pages 3-4 never had it
    });
  });

  describe('H4 — page dimensions are preserved verbatim after split', () => {
    it('alternating heights survive splitAt([3])', async () => {
      const buf = await buildPdfWithKnownPageDimensions();
      const [chunkA, chunkB] = await splitAt(buf, [3]);

      // chunk A: pages 1-3 → heights 792, 612, 792
      expect((await pageDims(chunkA!, 1)).height).toBe(792);
      expect((await pageDims(chunkA!, 2)).height).toBe(612);
      expect((await pageDims(chunkA!, 3)).height).toBe(792);

      // chunk B: pages 4-6 → heights 612, 792, 612
      expect((await pageDims(chunkB!, 1)).height).toBe(612);
      expect((await pageDims(chunkB!, 2)).height).toBe(792);
      expect((await pageDims(chunkB!, 3)).height).toBe(612);

      // Width (612) is preserved on every chunk-A page.
      for (let p = 1; p <= 3; p++) {
        expect((await pageDims(chunkA!, p)).width).toBe(612);
      }
    });
  });
});
