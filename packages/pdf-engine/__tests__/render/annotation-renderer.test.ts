import { describe, it, expect, vi } from 'vitest';
import { loadFixture, SIMPLE_PDF, MULTI_PAGE_PDF } from '../helpers';
import { openDocument, saveDocument } from '../../src/engine/document-handle';
import { addAnnotation } from '../../src/render/annotation-renderer';
import { PDFPageOutOfRangeError } from '../../src/errors';
import type { AnnotationElement } from '@giga-pdf/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBuffer(fixture: string): Buffer {
  return Buffer.from(loadFixture(fixture));
}

function makeAnnotationElement(overrides: Partial<AnnotationElement> = {}): AnnotationElement {
  return {
    elementId: 'ann-1',
    type: 'annotation',
    annotationType: 'highlight',
    content: '',
    bounds: { x: 50, y: 100, width: 200, height: 20 },
    transform: { rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 },
    layerId: null,
    locked: false,
    visible: true,
    style: { color: '#FFFF00', opacity: 1 },
    linkDestination: null,
    popup: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// highlight
// ---------------------------------------------------------------------------

describe('addAnnotation — highlight', () => {
  it('draws a semi-transparent rectangle and saves without throwing', async () => {
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    const element = makeAnnotationElement({ annotationType: 'highlight' });

    await expect(addAnnotation(handle, 1, element)).resolves.toBeUndefined();

    const saved = await saveDocument(handle);
    expect(saved).toBeInstanceOf(Buffer);
    expect(saved.length).toBeGreaterThan(0);
  });

  it('marks document dirty after adding highlight', async () => {
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    expect(handle.isDirty).toBe(false);

    await addAnnotation(handle, 1, makeAnnotationElement({ annotationType: 'highlight' }));
    expect(handle.isDirty).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// underline
// ---------------------------------------------------------------------------

describe('addAnnotation — underline', () => {
  it('draws a line at the bottom of the bounds without throwing', async () => {
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    const element = makeAnnotationElement({ annotationType: 'underline', style: { color: '#0000FF', opacity: 1 } });

    await expect(addAnnotation(handle, 1, element)).resolves.toBeUndefined();

    const saved = await saveDocument(handle);
    expect(saved.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// strikethrough / strikeout
// ---------------------------------------------------------------------------

describe('addAnnotation — strikethrough', () => {
  it('draws a horizontal line at mid-height without throwing', async () => {
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    const element = makeAnnotationElement({ annotationType: 'strikethrough' });

    await expect(addAnnotation(handle, 1, element)).resolves.toBeUndefined();
  });

  it('strikeout variant also draws without throwing', async () => {
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    const element = makeAnnotationElement({ annotationType: 'strikeout' });

    await expect(addAnnotation(handle, 1, element)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// squiggly
// ---------------------------------------------------------------------------

describe('addAnnotation — squiggly', () => {
  it('draws a dashed line without throwing', async () => {
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    const element = makeAnnotationElement({ annotationType: 'squiggly' });

    await expect(addAnnotation(handle, 1, element)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// note / comment
// ---------------------------------------------------------------------------

describe('addAnnotation — note/comment', () => {
  it('draws a yellow rectangle for note type', async () => {
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    const element = makeAnnotationElement({ annotationType: 'note' });

    await expect(addAnnotation(handle, 1, element)).resolves.toBeUndefined();
  });

  it('draws a yellow rectangle for comment type', async () => {
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    const element = makeAnnotationElement({ annotationType: 'comment' });

    await expect(addAnnotation(handle, 1, element)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// freetext
// ---------------------------------------------------------------------------

describe('addAnnotation — freetext', () => {
  it('embeds Helvetica font and draws text without throwing', async () => {
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    const element = makeAnnotationElement({
      annotationType: 'freetext',
      content: 'Free text note',
    });

    await expect(addAnnotation(handle, 1, element)).resolves.toBeUndefined();

    const saved = await saveDocument(handle);
    expect(saved.length).toBeGreaterThan(0);
  });

  it('renders freetext with custom color', async () => {
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    const element = makeAnnotationElement({
      annotationType: 'freetext',
      content: 'Red note',
      style: { color: '#FF0000', opacity: 0.8 },
    });

    await expect(addAnnotation(handle, 1, element)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// stamp
// ---------------------------------------------------------------------------

describe('addAnnotation — stamp', () => {
  it('embeds HelveticaBold and draws stamp text without throwing', async () => {
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    const element = makeAnnotationElement({
      annotationType: 'stamp',
      content: 'APPROVED',
      bounds: { x: 50, y: 50, width: 200, height: 80 },
    });

    await expect(addAnnotation(handle, 1, element)).resolves.toBeUndefined();
  });

  it('uses "STAMP" as default content when content is empty', async () => {
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    const element = makeAnnotationElement({ annotationType: 'stamp', content: '' });

    await expect(addAnnotation(handle, 1, element)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// line / arrow
// ---------------------------------------------------------------------------

describe('addAnnotation — line / arrow', () => {
  it('adds a plain line annotation without throwing', async () => {
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    const element = makeAnnotationElement({
      annotationType: 'line',
      style: { color: '#000000', opacity: 1, strokeWidth: 1.5 },
    });

    await expect(addAnnotation(handle, 1, element)).resolves.toBeUndefined();

    const saved = await saveDocument(handle);
    expect(saved.length).toBeGreaterThan(0);
    expect(handle._doc.annotations(1).some((a) => a.subtype === 'Line')).toBe(true);
  });

  it('adds an arrow annotation from explicit endpoints with an /LE OpenArrow ending', async () => {
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    const element = makeAnnotationElement({
      annotationType: 'arrow',
      linePoints: { x1: 60, y1: 80, x2: 220, y2: 160 },
      style: { color: '#FF0000', opacity: 1, strokeWidth: 2 },
    });

    await expect(addAnnotation(handle, 1, element)).resolves.toBeUndefined();

    const saved = await saveDocument(handle);
    // The arrowhead is recorded as /LE [/None /OpenArrow] (gigapdf-lib >= 0.52.5).
    expect(saved.toString('latin1')).toContain('OpenArrow');
    expect(handle._doc.annotations(1).some((a) => a.subtype === 'Line')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// rotation — markup must follow /Rotate (regression)
// ---------------------------------------------------------------------------

describe('addAnnotation — rotated pages', () => {
  it('threads the page rotation into the PDF coordinate conversion', async () => {
    const flat = await openDocument(makeBuffer(SIMPLE_PDF));
    const rotated = await openDocument(makeBuffer(SIMPLE_PDF));
    const { width, height } = flat._doc.pageInfo(1);
    // The regression is only observable when width != height (portrait/landscape).
    expect(width).not.toBe(height);

    rotated._doc.rotatePage(1, 90);
    expect(rotated._doc.pageInfo(1).rotation).toBe(90);

    // Spy on the rect handed to the engine — this is exactly the converted
    // placement, independent of how the engine reports annotations back.
    const flatSpy = vi.spyOn(flat._doc, 'addTextNote');
    const rotSpy = vi.spyOn(rotated._doc, 'addTextNote');

    const element = makeAnnotationElement({
      annotationType: 'note',
      bounds: { x: 40, y: 30, width: 24, height: 24 },
    });
    await addAnnotation(flat, 1, element);
    await addAnnotation(rotated, 1, element);

    // addTextNote(page, rect, rgb, meta, icon, open) — rect is arg index 1.
    const flatRect = flatSpy.mock.calls[0]![1] as [number, number, number, number];
    const rotRect = rotSpy.mock.calls[0]![1] as [number, number, number, number];

    // Before the fix, rotation was ignored and both rects were identical. With
    // the rotation-aware conversion the effective page height (= page width on
    // /Rotate 90) shifts the Y placement: flat uses 792, rotated uses 612.
    expect(Math.abs(rotRect[1] - flatRect[1])).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// link — URL
// ---------------------------------------------------------------------------

describe('addAnnotation — link with URL', () => {
  it('adds a URI link annotation to page annotations dict without throwing', async () => {
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    const element = makeAnnotationElement({
      annotationType: 'link',
      linkDestination: {
        type: 'external',
        url: 'https://example.com',
        pageNumber: null,
        position: null,
      },
    });

    await expect(addAnnotation(handle, 1, element)).resolves.toBeUndefined();

    const saved = await saveDocument(handle);
    expect(saved.length).toBeGreaterThan(0);
  });

  it('adds an internal page link annotation without throwing', async () => {
    // multi-page.pdf has multiple pages so an internal link to page 2 is valid
    const handle = await openDocument(makeBuffer(MULTI_PAGE_PDF));
    const element = makeAnnotationElement({
      annotationType: 'link',
      linkDestination: {
        type: 'internal',
        url: null,
        pageNumber: 2,
        position: null,
      },
    });

    await expect(addAnnotation(handle, 1, element)).resolves.toBeUndefined();
  });

  it('does nothing when linkDestination is null', async () => {
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    const element = makeAnnotationElement({
      annotationType: 'link',
      linkDestination: null,
    });

    // Should complete without error and still mark dirty
    await expect(addAnnotation(handle, 1, element)).resolves.toBeUndefined();
    expect(handle.isDirty).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Out-of-range page
// ---------------------------------------------------------------------------

describe('addAnnotation — page validation', () => {
  it('throws PDFPageOutOfRangeError for page 0', async () => {
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    const element = makeAnnotationElement();

    await expect(addAnnotation(handle, 0, element)).rejects.toThrow(PDFPageOutOfRangeError);
  });

  it('throws PDFPageOutOfRangeError for page beyond page count', async () => {
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    const outOfRange = handle.pageCount + 1;

    await expect(addAnnotation(handle, outOfRange, makeAnnotationElement())).rejects.toThrow(
      PDFPageOutOfRangeError,
    );
  });
});
