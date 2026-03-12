import { describe, it, expect } from 'vitest';
import { loadFixture, SIMPLE_PDF } from '../helpers';
import { openDocument, saveDocument } from '../../src/engine/document-handle';
import { addImage, updateImage } from '../../src/render/image-renderer';
import { PDFPageOutOfRangeError } from '../../src/errors';
import type { ImageElement, Bounds } from '@giga-pdf/types';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/**
 * Minimal 1x1 pixel PNG (white pixel, RGB colour type).
 * Bytes verified against the PNG spec (magic bytes 0x89 0x50 0x4E 0x47 …).
 */
const PNG_1x1 = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10,   // PNG magic
  0, 0, 0, 13, 73, 72, 68, 82,       // IHDR chunk length + type
  0, 0, 0, 1,                         // width: 1
  0, 0, 0, 1,                         // height: 1
  8, 2,                               // bit depth: 8, color type: 2 (RGB)
  0, 0, 0,                            // compression, filter, interlace
  144, 119, 83, 222,                  // IHDR CRC
  0, 0, 0, 12, 73, 68, 65, 84,       // IDAT chunk
  8, 215, 99, 248, 207, 192, 0, 0, 0, 3, 0, 1,
  54, 174, 213, 252,                  // IDAT CRC
  0, 0, 0, 0, 73, 69, 78, 68,        // IEND chunk
  174, 66, 96, 130,                   // IEND CRC
]);

/**
 * Minimal valid JPEG: 1x1 pixel.  First three bytes are always 0xFF 0xD8 0xFF.
 * This is the smallest possible JFIF file that pdf-lib will accept.
 */
const JPEG_1x1 = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0,  // SOI + APP0 marker
  0x00, 0x10,              // APP0 length (16 bytes)
  0x4a, 0x46, 0x49, 0x46, 0x00,  // "JFIF\0"
  0x01, 0x01,              // version 1.1
  0x00,                    // aspect ratio units: 0
  0x00, 0x01,              // X density: 1
  0x00, 0x01,              // Y density: 1
  0x00, 0x00,              // thumbnail size: 0x0
  // SOF0 marker (start of frame)
  0xff, 0xc0, 0x00, 0x0b,  // SOF0 length: 11
  0x08,                    // precision: 8
  0x00, 0x01,              // height: 1
  0x00, 0x01,              // width: 1
  0x01,                    // components: 1 (grayscale)
  0x01, 0x11, 0x00,        // component 1
  // DHT (Huffman table)
  0xff, 0xc4, 0x00, 0x1f,
  0x00, 0x00, 0x01, 0x05, 0x01, 0x01, 0x01, 0x01,
  0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06,
  0x07, 0x08, 0x09, 0x0a, 0x0b,
  // SOS + EOI
  0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0xf8, 0xff, 0xd9,
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBuffer(fixture: string): Buffer {
  return Buffer.from(loadFixture(fixture));
}

function makeImageElement(overrides: Partial<ImageElement> = {}): ImageElement {
  return {
    elementId: 'img-1',
    type: 'image',
    bounds: { x: 50, y: 50, width: 100, height: 100 },
    transform: { rotation: 0, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 },
    layerId: null,
    locked: false,
    visible: true,
    source: {
      type: 'embedded',
      dataUrl: '',
      originalFormat: 'png',
      originalDimensions: { width: 1, height: 1 },
    },
    style: { opacity: 1, blendMode: 'normal' },
    crop: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// addImage — PNG
// ---------------------------------------------------------------------------

describe('addImage (PNG)', () => {
  it('embeds a 1x1 PNG and saves without throwing', async () => {
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    const element = makeImageElement();

    await expect(addImage(handle, 1, element, PNG_1x1)).resolves.toBeUndefined();

    const saved = await saveDocument(handle);
    expect(saved).toBeInstanceOf(Buffer);
    expect(saved.length).toBeGreaterThan(0);
  });

  it('marks the document dirty after embedding PNG', async () => {
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    expect(handle.isDirty).toBe(false);

    await addImage(handle, 1, makeImageElement(), PNG_1x1);
    expect(handle.isDirty).toBe(true);
  });

  it('accepts custom bounds and saves a valid PDF', async () => {
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    const element = makeImageElement({
      bounds: { x: 10, y: 20, width: 300, height: 200 },
    });

    await addImage(handle, 1, element, PNG_1x1);
    const saved = await saveDocument(handle);
    expect(saved.length).toBeGreaterThan(100);
  });

  it('accepts partial opacity', async () => {
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    const element = makeImageElement({ style: { opacity: 0.5, blendMode: 'normal' } });

    await expect(addImage(handle, 1, element, PNG_1x1)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// addImage — JPEG detection
// ---------------------------------------------------------------------------

describe('addImage (JPEG detection)', () => {
  it('detects JPEG from first two bytes 0xFF 0xD8 without throwing', async () => {
    // JPEG detection relies on imageData[0] === 0xff && imageData[1] === 0xd8
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    const element = makeImageElement({
      source: { ...makeImageElement().source, originalFormat: 'jpeg' },
    });

    await expect(addImage(handle, 1, element, JPEG_1x1)).resolves.toBeUndefined();
  });

  it('throws for data that is neither PNG nor JPEG (falls through to embedJpg which rejects)', async () => {
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    const invalid = new Uint8Array([0x00, 0x01, 0x02, 0x03]);

    // detectImageFormat returns null → falls to embedJpg → pdf-lib rejects invalid bytes
    await expect(addImage(handle, 1, makeImageElement(), invalid)).rejects.toThrow();
  });

  it('throws PDFPageOutOfRangeError for page 0', async () => {
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    await expect(addImage(handle, 0, makeImageElement(), PNG_1x1)).rejects.toThrow(
      PDFPageOutOfRangeError,
    );
  });

  it('throws PDFPageOutOfRangeError for page beyond page count', async () => {
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    const outOfRange = handle.pageCount + 1;
    await expect(addImage(handle, outOfRange, makeImageElement(), PNG_1x1)).rejects.toThrow(
      PDFPageOutOfRangeError,
    );
  });
});

// ---------------------------------------------------------------------------
// updateImage
// ---------------------------------------------------------------------------

describe('updateImage', () => {
  it('replaces image at old bounds and draws new image', async () => {
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    const oldBounds: Bounds = { x: 0, y: 0, width: 100, height: 100 };
    const element = makeImageElement({ bounds: { x: 100, y: 100, width: 100, height: 100 } });

    await expect(updateImage(handle, 1, oldBounds, element, PNG_1x1)).resolves.toBeUndefined();

    const saved = await saveDocument(handle);
    expect(saved).toBeInstanceOf(Buffer);
    expect(saved.length).toBeGreaterThan(0);
  });

  it('redacts old area without adding a new image when imageData is omitted', async () => {
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    const oldBounds: Bounds = { x: 50, y: 50, width: 100, height: 100 };

    // No imageData supplied — should only paint the white rectangle
    await expect(updateImage(handle, 1, oldBounds, makeImageElement())).resolves.toBeUndefined();

    // Document is still dirty because markDirty is called
    expect(handle.isDirty).toBe(true);
  });

  it('marks document dirty when imageData is omitted', async () => {
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    const oldBounds: Bounds = { x: 0, y: 0, width: 50, height: 50 };

    await updateImage(handle, 1, oldBounds, makeImageElement());
    expect(handle.isDirty).toBe(true);
  });

  it('saves successfully after replace', async () => {
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    const oldBounds: Bounds = { x: 0, y: 0, width: 50, height: 50 };

    await updateImage(handle, 1, oldBounds, makeImageElement(), PNG_1x1);
    const saved = await saveDocument(handle);
    expect(saved.length).toBeGreaterThan(100);
  });

  it('throws PDFPageOutOfRangeError when page is out of range', async () => {
    const handle = await openDocument(makeBuffer(SIMPLE_PDF));
    const oldBounds: Bounds = { x: 0, y: 0, width: 50, height: 50 };

    await expect(updateImage(handle, 999, oldBounds, makeImageElement(), PNG_1x1)).rejects.toThrow(
      PDFPageOutOfRangeError,
    );
  });
});
