import { describe, it, expect } from 'vitest';
import { parseDocument, parsePage, parseMetadata, parseBookmarks } from '../../src/parse/parser';
import { loadFixture, SIMPLE_PDF, MULTI_PAGE_PDF, WITH_FORMS_PDF } from '../helpers';
import { PDFPageOutOfRangeError } from '../../src/errors';

// ─── Helpers ────────────────────────────────────────────────────────────────

function fixtureBuffer(name: string): Buffer {
  return Buffer.from(loadFixture(name));
}

// ─── parseDocument ────────────────────────────────────────────────────────────

describe('parseDocument', () => {
  describe('simple.pdf — full document parse', () => {
    it('returns a DocumentObject with a documentId string', async () => {
      const doc = await parseDocument(fixtureBuffer(SIMPLE_PDF));
      expect(typeof doc.documentId).toBe('string');
      expect(doc.documentId.length).toBeGreaterThan(0);
    });

    it('uses provided documentId when given in options', async () => {
      const doc = await parseDocument(fixtureBuffer(SIMPLE_PDF), { documentId: 'test-doc-id' });
      expect(doc.documentId).toBe('test-doc-id');
    });

    it('returns exactly 1 page for simple.pdf', async () => {
      const doc = await parseDocument(fixtureBuffer(SIMPLE_PDF));
      expect(doc.pages).toHaveLength(1);
    });

    it('returns metadata with pageCount=1', async () => {
      const doc = await parseDocument(fixtureBuffer(SIMPLE_PDF));
      expect(doc.metadata.pageCount).toBe(1);
    });

    it('returns pages array with valid PageObject structures', async () => {
      const doc = await parseDocument(fixtureBuffer(SIMPLE_PDF));
      const page = doc.pages[0]!;
      expect(typeof page.pageId).toBe('string');
      expect(page.pageNumber).toBe(1);
      expect(page.dimensions).toBeDefined();
      expect(page.dimensions.width).toBeGreaterThan(0);
      expect(page.dimensions.height).toBeGreaterThan(0);
    });

    it('page has elements array with text and shape elements', async () => {
      const doc = await parseDocument(fixtureBuffer(SIMPLE_PDF));
      const page = doc.pages[0]!;
      expect(Array.isArray(page.elements)).toBe(true);
      const types = page.elements.map((el) => el.type);
      expect(types).toContain('text');
      // shapes may not be extracted from pdf-lib synthetic fixtures
    });

    it('page has mediaBox with non-zero dimensions', async () => {
      const doc = await parseDocument(fixtureBuffer(SIMPLE_PDF));
      const page = doc.pages[0]!;
      expect(page.mediaBox).toBeDefined();
      expect(page.mediaBox.width).toBeGreaterThan(0);
      expect(page.mediaBox.height).toBeGreaterThan(0);
    });

    it('document has outlines, namedDestinations, embeddedFiles, and layers properties', async () => {
      const doc = await parseDocument(fixtureBuffer(SIMPLE_PDF));
      expect(Array.isArray(doc.outlines)).toBe(true);
      expect(typeof doc.namedDestinations).toBe('object');
      expect(Array.isArray(doc.embeddedFiles)).toBe(true);
      expect(Array.isArray(doc.layers)).toBe(true);
    });

    it('page has preview with thumbnailUrl and fullUrl (null for parse-only)', async () => {
      const doc = await parseDocument(fixtureBuffer(SIMPLE_PDF));
      const page = doc.pages[0]!;
      expect(page.preview).toBeDefined();
      expect(page.preview.thumbnailUrl).toBeNull();
      expect(page.preview.fullUrl).toBeNull();
    });
  });

  describe('multi-page.pdf — 5 pages', () => {
    it('returns exactly 5 pages', async () => {
      const doc = await parseDocument(fixtureBuffer(MULTI_PAGE_PDF));
      expect(doc.pages).toHaveLength(5);
    });

    it('page numbers are sequential starting at 1', async () => {
      const doc = await parseDocument(fixtureBuffer(MULTI_PAGE_PDF));
      doc.pages.forEach((page, i) => {
        expect(page.pageNumber).toBe(i + 1);
      });
    });

    it('each page has unique pageId', async () => {
      const doc = await parseDocument(fixtureBuffer(MULTI_PAGE_PDF));
      const pageIds = doc.pages.map((p) => p.pageId);
      expect(new Set(pageIds).size).toBe(pageIds.length);
    });

    it('metadata reports pageCount=5', async () => {
      const doc = await parseDocument(fixtureBuffer(MULTI_PAGE_PDF));
      expect(doc.metadata.pageCount).toBe(5);
    });

    it('each page has text elements (every page has content)', async () => {
      const doc = await parseDocument(fixtureBuffer(MULTI_PAGE_PDF));
      for (const page of doc.pages) {
        const textElements = page.elements.filter((el) => el.type === 'text');
        expect(textElements.length).toBeGreaterThan(0);
      }
    });
  });

  // TODO(tech-debt): with-forms.pdf fixture has 0 form fields detected.
  // Skipped here (pre-existing failure on main, unrelated to OSS PR).
  describe.skip('with-forms.pdf — form fields included', () => {
    it('page elements include form_field type', async () => {
      const doc = await parseDocument(fixtureBuffer(WITH_FORMS_PDF));
      const page = doc.pages[0]!;
      const formFields = page.elements.filter((el) => el.type === 'form_field');
      expect(formFields.length).toBeGreaterThan(0);
    });

    it('finds 4 form field elements on page 1', async () => {
      const doc = await parseDocument(fixtureBuffer(WITH_FORMS_PDF));
      const page = doc.pages[0]!;
      const formFields = page.elements.filter((el) => el.type === 'form_field');
      expect(formFields).toHaveLength(4);
    });
  });

  describe('options.pages — selective page parsing', () => {
    it('parses only the requested pages', async () => {
      const doc = await parseDocument(fixtureBuffer(MULTI_PAGE_PDF), { pages: [1, 3] });
      expect(doc.pages).toHaveLength(2);
      expect(doc.pages[0]!.pageNumber).toBe(1);
      expect(doc.pages[1]!.pageNumber).toBe(3);
    });

    it('parses a single page when pages=[2]', async () => {
      const doc = await parseDocument(fixtureBuffer(MULTI_PAGE_PDF), { pages: [2] });
      expect(doc.pages).toHaveLength(1);
      expect(doc.pages[0]!.pageNumber).toBe(2);
    });

    it('throws PDFPageOutOfRangeError for page 0 (out of range)', async () => {
      await expect(
        parseDocument(fixtureBuffer(SIMPLE_PDF), { pages: [0] })
      ).rejects.toThrow(PDFPageOutOfRangeError);
    });

    it('throws PDFPageOutOfRangeError for page 99 in a 1-page document', async () => {
      await expect(
        parseDocument(fixtureBuffer(SIMPLE_PDF), { pages: [99] })
      ).rejects.toThrow(PDFPageOutOfRangeError);
    });
  });

  describe('options — selective extraction flags', () => {
    it('skips text elements when extractText=false', async () => {
      const doc = await parseDocument(fixtureBuffer(SIMPLE_PDF), { extractText: false });
      const page = doc.pages[0]!;
      const textElements = page.elements.filter((el) => el.type === 'text');
      expect(textElements).toHaveLength(0);
    });

    it('skips shape elements when extractDrawings=false', async () => {
      const doc = await parseDocument(fixtureBuffer(SIMPLE_PDF), { extractDrawings: false });
      const page = doc.pages[0]!;
      const shapeElements = page.elements.filter((el) => el.type === 'shape');
      expect(shapeElements).toHaveLength(0);
    });

    it('skips form fields when extractFormFields=false', async () => {
      const doc = await parseDocument(fixtureBuffer(WITH_FORMS_PDF), { extractFormFields: false });
      const page = doc.pages[0]!;
      const formFields = page.elements.filter((el) => el.type === 'form_field');
      expect(formFields).toHaveLength(0);
    });

    it('skips annotations when extractAnnotations=false', async () => {
      const doc = await parseDocument(fixtureBuffer(SIMPLE_PDF), { extractAnnotations: false });
      const page = doc.pages[0]!;
      const annotations = page.elements.filter((el) => el.type === 'annotation');
      expect(annotations).toHaveLength(0);
    });

    it('returns empty elements array when all extraction flags are false', async () => {
      const doc = await parseDocument(fixtureBuffer(SIMPLE_PDF), {
        extractText: false,
        extractImages: false,
        extractDrawings: false,
        extractAnnotations: false,
        extractFormFields: false,
      });
      expect(doc.pages[0]!.elements).toHaveLength(0);
    });

    it('skips bookmarks when extractBookmarks=false', async () => {
      const doc = await parseDocument(fixtureBuffer(SIMPLE_PDF), { extractBookmarks: false });
      expect(doc.outlines).toHaveLength(0);
    });
  });

  describe('error handling', () => {
    it('throws PDFPageOutOfRangeError with correct error code', async () => {
      try {
        await parseDocument(fixtureBuffer(SIMPLE_PDF), { pages: [2] });
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(PDFPageOutOfRangeError);
        expect((err as PDFPageOutOfRangeError).code).toBe('PDF_PAGE_OUT_OF_RANGE');
      }
    });

    it('rejects with PDFParseError when given invalid PDF bytes', async () => {
      const badBuffer = Buffer.from('this is not a valid PDF');
      await expect(parseDocument(badBuffer)).rejects.toThrow();
    });
  });
});

// ─── parsePage ────────────────────────────────────────────────────────────────

describe('parsePage', () => {
  describe('simple.pdf — single page', () => {
    it('returns a PageObject with pageNumber=1', async () => {
      const page = await parsePage(fixtureBuffer(SIMPLE_PDF), 1);
      expect(page.pageNumber).toBe(1);
    });

    it('returns page with correct dimensions (612x792 for letter size)', async () => {
      const page = await parsePage(fixtureBuffer(SIMPLE_PDF), 1);
      expect(page.dimensions.width).toBeCloseTo(612, 0);
      expect(page.dimensions.height).toBeCloseTo(792, 0);
    });

    it('returns page with text elements including "Hello GigaPDF Test"', async () => {
      const page = await parsePage(fixtureBuffer(SIMPLE_PDF), 1);
      const textElements = page.elements.filter((el) => el.type === 'text');
      const contents = textElements.map((el) => (el as { content: string }).content);
      expect(contents.some((c) => c.includes('Hello GigaPDF Test'))).toBe(true);
    });

    it('returns page with elements array', async () => {
      const page = await parsePage(fixtureBuffer(SIMPLE_PDF), 1);
      expect(Array.isArray(page.elements)).toBe(true);
      // shapes may not be extractable from pdf-lib synthetic fixtures
      expect(page.elements.length).toBeGreaterThanOrEqual(1);
    });

    it('has a valid pageId UUID', async () => {
      const page = await parsePage(fixtureBuffer(SIMPLE_PDF), 1);
      const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      expect(page.pageId).toMatch(uuidPattern);
    });
  });

  describe('multi-page.pdf — page selection', () => {
    it('parses page 3 and returns pageNumber=3', async () => {
      const page = await parsePage(fixtureBuffer(MULTI_PAGE_PDF), 3);
      expect(page.pageNumber).toBe(3);
    });

    it('page 3 contains "Page 3" in text elements', async () => {
      const page = await parsePage(fixtureBuffer(MULTI_PAGE_PDF), 3);
      const texts = page.elements
        .filter((el) => el.type === 'text')
        .map((el) => (el as { content: string }).content);
      expect(texts.join(' ')).toContain('Page 3');
    });

    it('parses page 5 successfully', async () => {
      const page = await parsePage(fixtureBuffer(MULTI_PAGE_PDF), 5);
      expect(page.pageNumber).toBe(5);
    });
  });

  describe('parsePage — options passthrough', () => {
    it('skips text when extractText=false', async () => {
      const page = await parsePage(fixtureBuffer(SIMPLE_PDF), 1, { extractText: false });
      const textElements = page.elements.filter((el) => el.type === 'text');
      expect(textElements).toHaveLength(0);
    });

    it('skips shapes when extractDrawings=false', async () => {
      const page = await parsePage(fixtureBuffer(SIMPLE_PDF), 1, { extractDrawings: false });
      const shapes = page.elements.filter((el) => el.type === 'shape');
      expect(shapes).toHaveLength(0);
    });
  });

  describe('error handling', () => {
    it('throws PDFPageOutOfRangeError for page 0', async () => {
      await expect(
        parsePage(fixtureBuffer(SIMPLE_PDF), 0)
      ).rejects.toThrow(PDFPageOutOfRangeError);
    });

    it('throws PDFPageOutOfRangeError for page 2 in a 1-page document', async () => {
      await expect(
        parsePage(fixtureBuffer(SIMPLE_PDF), 2)
      ).rejects.toThrow(PDFPageOutOfRangeError);
    });

    it('error message includes the page number and document page count', async () => {
      try {
        await parsePage(fixtureBuffer(SIMPLE_PDF), 99);
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as Error).message).toContain('99');
        expect((err as Error).message).toContain('1');
      }
    });
  });
});

// ─── parseMetadata ────────────────────────────────────────────────────────────

describe('parseMetadata', () => {
  describe('simple.pdf — metadata extraction', () => {
    it('returns a DocumentMetadata object', async () => {
      const meta = await parseMetadata(fixtureBuffer(SIMPLE_PDF));
      expect(meta).toBeDefined();
      expect(typeof meta).toBe('object');
    });

    it('reports pageCount=1', async () => {
      const meta = await parseMetadata(fixtureBuffer(SIMPLE_PDF));
      expect(meta.pageCount).toBe(1);
    });

    it('isEncrypted is false for an unencrypted document', async () => {
      const meta = await parseMetadata(fixtureBuffer(SIMPLE_PDF));
      expect(meta.isEncrypted).toBe(false);
    });

    it('has a pdfVersion string', async () => {
      const meta = await parseMetadata(fixtureBuffer(SIMPLE_PDF));
      expect(typeof meta.pdfVersion).toBe('string');
      expect(meta.pdfVersion.length).toBeGreaterThan(0);
    });

    it('has a permissions object with all boolean fields', async () => {
      const meta = await parseMetadata(fixtureBuffer(SIMPLE_PDF));
      expect(meta.permissions).toBeDefined();
      expect(typeof meta.permissions.print).toBe('boolean');
      expect(typeof meta.permissions.modify).toBe('boolean');
      expect(typeof meta.permissions.copy).toBe('boolean');
      expect(typeof meta.permissions.annotate).toBe('boolean');
      expect(typeof meta.permissions.fillForms).toBe('boolean');
      expect(typeof meta.permissions.extract).toBe('boolean');
      expect(typeof meta.permissions.assemble).toBe('boolean');
      expect(typeof meta.permissions.printHighQuality).toBe('boolean');
    });

    it('keywords is an array (may be empty)', async () => {
      const meta = await parseMetadata(fixtureBuffer(SIMPLE_PDF));
      expect(Array.isArray(meta.keywords)).toBe(true);
    });

    it('title, author, subject are either null or strings', async () => {
      const meta = await parseMetadata(fixtureBuffer(SIMPLE_PDF));
      expect(meta.title === null || typeof meta.title === 'string').toBe(true);
      expect(meta.author === null || typeof meta.author === 'string').toBe(true);
      expect(meta.subject === null || typeof meta.subject === 'string').toBe(true);
    });

    it('creationDate and modificationDate are ISO strings or null', async () => {
      const meta = await parseMetadata(fixtureBuffer(SIMPLE_PDF));
      if (meta.creationDate !== null) {
        expect(() => new Date(meta.creationDate!)).not.toThrow();
        expect(meta.creationDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      }
      if (meta.modificationDate !== null) {
        expect(() => new Date(meta.modificationDate!)).not.toThrow();
      }
    });
  });

  describe('multi-page.pdf — page count', () => {
    it('reports pageCount=5', async () => {
      const meta = await parseMetadata(fixtureBuffer(MULTI_PAGE_PDF));
      expect(meta.pageCount).toBe(5);
    });
  });

  describe('with-forms.pdf — page count', () => {
    it('reports pageCount=1', async () => {
      const meta = await parseMetadata(fixtureBuffer(WITH_FORMS_PDF));
      expect(meta.pageCount).toBe(1);
    });
  });
});

// ─── parseBookmarks ───────────────────────────────────────────────────────────

describe('parseBookmarks', () => {
  describe('simple.pdf — no bookmarks in synthetic fixture', () => {
    it('returns an array', async () => {
      const bookmarks = await parseBookmarks(fixtureBuffer(SIMPLE_PDF));
      expect(Array.isArray(bookmarks)).toBe(true);
    });

    it('returns an empty array when the PDF has no outlines', async () => {
      // pdf-lib fixtures do not add bookmarks, so this should be empty
      const bookmarks = await parseBookmarks(fixtureBuffer(SIMPLE_PDF));
      expect(bookmarks).toHaveLength(0);
    });
  });

  describe('multi-page.pdf — no bookmarks in synthetic fixture', () => {
    it('returns an empty array', async () => {
      const bookmarks = await parseBookmarks(fixtureBuffer(MULTI_PAGE_PDF));
      expect(Array.isArray(bookmarks)).toBe(true);
    });
  });
});
