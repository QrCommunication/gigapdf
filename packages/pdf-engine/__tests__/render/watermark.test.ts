import { describe, it, expect } from 'vitest';
import { loadFixture, SIMPLE_PDF } from '../helpers';
import { addWatermark } from '../../src/render/watermark';

describe('addWatermark', () => {
  it('stamps a center-diagonal watermark and returns a valid PDF', async () => {
    const buffer = Buffer.from(loadFixture(SIMPLE_PDF));
    const result = await addWatermark(buffer, { text: 'CONFIDENTIAL' });

    expect(result.bytes).toBeInstanceOf(Uint8Array);
    expect(result.bytes.length).toBeGreaterThan(0);
    expect(result.pagesStamped).toBeGreaterThanOrEqual(1);
    expect(result.outputBytes).toBe(result.bytes.byteLength);
    // The output is a real PDF.
    expect(new TextDecoder().decode(result.bytes.slice(0, 5))).toBe('%PDF-');
  });

  it('throws when the text is blank', async () => {
    const buffer = Buffer.from(loadFixture(SIMPLE_PDF));
    await expect(addWatermark(buffer, { text: '   ' })).rejects.toThrow();
  });

  it('stamps only the requested pages', async () => {
    const buffer = Buffer.from(loadFixture(SIMPLE_PDF));
    const result = await addWatermark(buffer, {
      text: 'DRAFT',
      pages: [1],
      position: 'top-right',
      opacity: 0.3,
    });
    expect(result.pagesStamped).toBe(1);
  });
});
