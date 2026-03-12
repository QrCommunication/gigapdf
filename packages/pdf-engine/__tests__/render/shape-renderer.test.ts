import { describe, it, expect } from 'vitest';
import { loadFixture, SIMPLE_PDF } from '../helpers';
import { openDocument, saveDocument } from '../../src/engine/document-handle';
import { addShape } from '../../src/render/shape-renderer';
import { PDFPageOutOfRangeError } from '../../src/errors';
import type { ShapeElement } from '@giga-pdf/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBuffer(fixture: string): Buffer {
  return Buffer.from(loadFixture(fixture));
}

function makeShapeElement(overrides: Partial<ShapeElement> = {}): ShapeElement {
  return {
    elementId: 'shape-1',
    type: 'shape',
    shapeType: 'rectangle',
    bounds: { x: 50, y: 50, width: 100, height: 60 },
    transform: { rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 },
    layerId: null,
    locked: false,
    visible: true,
    geometry: {
      points: [],
      pathData: null,
      cornerRadius: 0,
    },
    style: {
      fillColor: '#FF0000',
      fillOpacity: 1,
      strokeColor: '#000000',
      strokeWidth: 1,
      strokeOpacity: 1,
      strokeDashArray: [],
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// rectangle
// ---------------------------------------------------------------------------

describe('addShape — rectangle', () => {
  it('draws a rectangle with fill and border without throwing', () => {
    return openDocument(makeBuffer(SIMPLE_PDF)).then(async (handle) => {
      const element = makeShapeElement({ shapeType: 'rectangle' });

      expect(() => addShape(handle, 1, element)).not.toThrow();

      const saved = await saveDocument(handle);
      expect(saved).toBeInstanceOf(Buffer);
      expect(saved.length).toBeGreaterThan(0);
    });
  });

  it('marks document dirty after drawing a rectangle', async () => {
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    expect(handle.isDirty).toBe(false);

    addShape(handle, 1, makeShapeElement({ shapeType: 'rectangle' }));
    expect(handle.isDirty).toBe(true);
  });

  it('draws rectangle with no fill (fillColor null)', async () => {
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    const element = makeShapeElement({
      shapeType: 'rectangle',
      style: { ...makeShapeElement().style, fillColor: null },
    });

    expect(() => addShape(handle, 1, element)).not.toThrow();
  });

  it('draws rectangle with no border (strokeColor null)', async () => {
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    const element = makeShapeElement({
      shapeType: 'rectangle',
      style: { ...makeShapeElement().style, strokeColor: null },
    });

    expect(() => addShape(handle, 1, element)).not.toThrow();
  });

  it('draws rectangle with dashed stroke', async () => {
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    const element = makeShapeElement({
      shapeType: 'rectangle',
      style: { ...makeShapeElement().style, strokeDashArray: [4, 2] },
    });

    expect(() => addShape(handle, 1, element)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// ellipse / circle
// ---------------------------------------------------------------------------

describe('addShape — ellipse', () => {
  it('draws an ellipse without throwing', async () => {
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    const element = makeShapeElement({ shapeType: 'ellipse' });

    expect(() => addShape(handle, 1, element)).not.toThrow();
    const saved = await saveDocument(handle);
    expect(saved.length).toBeGreaterThan(0);
  });

  it('draws a circle shape type without throwing', async () => {
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    const element = makeShapeElement({ shapeType: 'circle' });

    expect(() => addShape(handle, 1, element)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// line / arrow
// ---------------------------------------------------------------------------

describe('addShape — line', () => {
  it('draws a line between two explicit points', async () => {
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    const element = makeShapeElement({
      shapeType: 'line',
      geometry: {
        points: [
          { x: 10, y: 10 },
          { x: 200, y: 200 },
        ],
        pathData: null,
        cornerRadius: 0,
      },
    });

    expect(() => addShape(handle, 1, element)).not.toThrow();
    const saved = await saveDocument(handle);
    expect(saved.length).toBeGreaterThan(0);
  });

  it('draws a line using bounds fallback when points are empty', async () => {
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    const element = makeShapeElement({
      shapeType: 'line',
      geometry: { points: [], pathData: null, cornerRadius: 0 },
    });

    expect(() => addShape(handle, 1, element)).not.toThrow();
  });

  it('draws an arrow shape type without throwing', async () => {
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    const element = makeShapeElement({
      shapeType: 'arrow',
      geometry: {
        points: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
        pathData: null,
        cornerRadius: 0,
      },
    });

    expect(() => addShape(handle, 1, element)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// polygon / triangle / path
// ---------------------------------------------------------------------------

describe('addShape — polygon with pathData', () => {
  it('draws a polygon using SVG pathData string', async () => {
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    const element = makeShapeElement({
      shapeType: 'polygon',
      geometry: {
        points: [],
        pathData: 'M 0 0 L 50 100 L 100 0 Z',
        cornerRadius: 0,
      },
    });

    expect(() => addShape(handle, 1, element)).not.toThrow();
    const saved = await saveDocument(handle);
    expect(saved.length).toBeGreaterThan(0);
  });

  it('draws a triangle using SVG pathData', async () => {
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    const element = makeShapeElement({
      shapeType: 'triangle',
      geometry: {
        points: [],
        pathData: 'M 0 100 L 50 0 L 100 100 Z',
        cornerRadius: 0,
      },
    });

    expect(() => addShape(handle, 1, element)).not.toThrow();
  });

  it('draws a polygon from points array when pathData is null', async () => {
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    const element = makeShapeElement({
      shapeType: 'polygon',
      geometry: {
        points: [{ x: 0, y: 0 }, { x: 50, y: 100 }, { x: 100, y: 0 }],
        pathData: null,
        cornerRadius: 0,
      },
    });

    expect(() => addShape(handle, 1, element)).not.toThrow();
  });

  it('does nothing (no crash) when polygon has no pathData and fewer than 2 points', async () => {
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    const element = makeShapeElement({
      shapeType: 'polygon',
      geometry: {
        points: [{ x: 0, y: 0 }],
        pathData: null,
        cornerRadius: 0,
      },
    });

    expect(() => addShape(handle, 1, element)).not.toThrow();
    // markDirty is still called even for the empty path branch
    expect(handle.isDirty).toBe(true);
  });

  it('draws a path shape type', async () => {
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    const element = makeShapeElement({
      shapeType: 'path',
      geometry: {
        points: [],
        pathData: 'M 10 10 Q 50 0 90 10',
        cornerRadius: 0,
      },
    });

    expect(() => addShape(handle, 1, element)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Out-of-range page
// ---------------------------------------------------------------------------

describe('addShape — page validation', () => {
  it('throws PDFPageOutOfRangeError for page 0', async () => {
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    expect(() => addShape(handle, 0, makeShapeElement())).toThrow(PDFPageOutOfRangeError);
  });

  it('throws PDFPageOutOfRangeError for page beyond page count', async () => {
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    const outOfRange = handle.pageCount + 1;
    expect(() => addShape(handle, outOfRange, makeShapeElement())).toThrow(PDFPageOutOfRangeError);
  });
});
