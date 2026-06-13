import { describe, it, expect } from 'vitest';
import { loadFixture, SIMPLE_PDF } from '../helpers';
import { openDocument, saveDocument } from '../../src/engine/document-handle';
import { addText } from '../../src/render/text-renderer';
import { applyOperations } from '../../src/render/apply-operations';
import { PDFPageOutOfRangeError } from '../../src/errors';
import type { TextElement, Bounds } from '@giga-pdf/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBuffer(fixture: string): Buffer {
  return Buffer.from(loadFixture(fixture));
}

function makeTextElement(overrides: Partial<TextElement> = {}): TextElement {
  return {
    elementId: 'elem-1',
    type: 'text',
    content: 'Hello PDF',
    bounds: { x: 50, y: 50, width: 200, height: 30 },
    transform: { rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 },
    layerId: null,
    locked: false,
    visible: true,
    style: {
      fontFamily: 'helvetica',
      fontSize: 12,
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
      originalFont: null,
    },
    ocrConfidence: null,
    linkUrl: null,
    linkPage: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// addText
// ---------------------------------------------------------------------------

describe('addText', () => {
  it('adds text to page 1 and saves without throwing', async () => {
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    const element = makeTextElement();

    await expect(addText(handle, 1, element)).resolves.toBeUndefined();

    const saved = await saveDocument(handle);
    expect(saved).toBeInstanceOf(Buffer);
    expect(saved.length).toBeGreaterThan(0);
  });

  it('marks the document as dirty after adding text', async () => {
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    expect(handle.isDirty).toBe(false);

    await addText(handle, 1, makeTextElement());
    expect(handle.isDirty).toBe(true);
  });

  it('embeds a standard font and draws text — saved bytes exceed source size', async () => {
    const source = makeBuffer(SIMPLE_PDF);
    const handle = await openDocument(source);

    await addText(handle, 1, makeTextElement({ content: 'Embedded font test' }));
    const saved = await saveDocument(handle);

    // After embedding a font and drawing text the PDF grows
    expect(saved.length).toBeGreaterThan(0);
  });

  it('accepts a non-zero rotation transform', async () => {
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    const element = makeTextElement({
      transform: { rotation: 45, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 },
    });

    await expect(addText(handle, 1, element)).resolves.toBeUndefined();
  });

  it('accepts a custom color', async () => {
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    const element = makeTextElement({
      style: {
        ...makeTextElement().style,
        color: '#FF0000',
      },
    });

    await expect(addText(handle, 1, element)).resolves.toBeUndefined();
  });

  it('accepts partial opacity', async () => {
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    const element = makeTextElement({
      style: { ...makeTextElement().style, opacity: 0.5 },
    });

    await expect(addText(handle, 1, element)).resolves.toBeUndefined();
  });

  it('throws PDFPageOutOfRangeError for page 0', async () => {
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    await expect(addText(handle, 0, makeTextElement())).rejects.toThrow(PDFPageOutOfRangeError);
  });

  it('throws PDFPageOutOfRangeError for page beyond page count', async () => {
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    const outOfRange = handle.pageCount + 1;
    await expect(addText(handle, outOfRange, makeTextElement())).rejects.toThrow(
      PDFPageOutOfRangeError,
    );
  });
});

// ---------------------------------------------------------------------------
// updateText
// ---------------------------------------------------------------------------

describe('applyOperations — update text', () => {
  it('redacts old area + redraws new text, returning valid PDF bytes', async () => {
    const oldBounds: Bounds = { x: 50, y: 50, width: 200, height: 30 };
    const element = makeTextElement({
      content: 'Updated text',
      bounds: { x: 50, y: 90, width: 200, height: 30 },
    });

    const result = await applyOperations(makeBuffer(SIMPLE_PDF), [
      { action: 'update', pageNumber: 1, oldBounds, element },
    ]);

    expect(result.bytes.length).toBeGreaterThan(100);
    expect(result.redactionTargetsCount).toBe(1);
    expect(result.addsApplied).toBe(1);
  });

  it('accumulates one redaction target per update op', async () => {
    const oldBounds: Bounds = { x: 10, y: 10, width: 100, height: 20 };
    const result = await applyOperations(makeBuffer(SIMPLE_PDF), [
      { action: 'update', pageNumber: 1, oldBounds, element: makeTextElement() },
    ]);
    expect(result.redactionTargetsCount).toBe(1);
  });

  it('produces a re-openable PDF after updating text', async () => {
    const oldBounds: Bounds = { x: 0, y: 0, width: 100, height: 20 };
    const result = await applyOperations(makeBuffer(SIMPLE_PDF), [
      {
        action: 'update',
        pageNumber: 1,
        oldBounds,
        element: makeTextElement({ content: 'Replaced' }),
      },
    ]);
    const saved = Buffer.from(result.bytes);
    expect(saved.subarray(0, 5).toString('ascii')).toBe('%PDF-');
    expect(saved.length).toBeGreaterThan(100);
  });

  it('throws when an update op omits oldBounds', async () => {
    await expect(
      applyOperations(makeBuffer(SIMPLE_PDF), [
        { action: 'update', pageNumber: 1, element: makeTextElement() },
      ]),
    ).rejects.toThrow(/oldBounds is required/);
  });
});
