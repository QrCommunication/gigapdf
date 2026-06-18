/**
 * HTML / URL → PDF conversion, on the in-house engine (no headless browser).
 *
 * Every test is hermetic: an injected `fetchImpl` stands in for the network, so
 * font/image resolution and the SSRF guard are exercised without a real fetch.
 * Page geometry is asserted by re-opening the produced PDF and reading
 * `pageInfo`, which proves the format/landscape/explicit-size mapping exactly.
 */
import { describe, it, expect, vi } from 'vitest';
import { htmlToPDF, urlToPDF, urlToPDFSafe } from '../../src/convert/html-to-pdf';
import { getEngine } from '../../src/wasm';
import { PDFEngineError } from '../../src/errors';

function isPdf(buf: Buffer): boolean {
  return buf.subarray(0, 5).toString('latin1') === '%PDF-';
}

/** Re-open a produced PDF and return page 1's {width, height} in points. */
async function firstPageSize(pdf: Buffer): Promise<{ width: number; height: number }> {
  const giga = await getEngine();
  const doc = giga.open(new Uint8Array(pdf));
  try {
    const info = doc.pageInfo(1);
    return { width: info.width, height: info.height };
  } finally {
    doc.close();
  }
}

/** A 1×1 transparent PNG — a real, decodable image payload. */
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

describe('htmlToPDF — in-house engine', () => {
  it('renders a plain HTML string to a valid PDF without any network', async () => {
    const fetchImpl = vi.fn();
    const pdf = await htmlToPDF('<h1>Hello</h1><p>world</p>', { fetchImpl });
    expect(isPdf(pdf)).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled(); // no external resources
  });

  it('maps format to the exact page size', async () => {
    const a4 = await firstPageSize(await htmlToPDF('<p>x</p>', { format: 'A4' }));
    expect(a4.width).toBeCloseTo(595.28, 0);
    expect(a4.height).toBeCloseTo(841.89, 0);

    const letter = await firstPageSize(await htmlToPDF('<p>x</p>', { format: 'Letter' }));
    expect(letter.width).toBeCloseTo(612, 0);
    expect(letter.height).toBeCloseTo(792, 0);
  });

  it('swaps width/height for landscape', async () => {
    const portrait = await firstPageSize(await htmlToPDF('<p>x</p>', { format: 'A4' }));
    const landscape = await firstPageSize(
      await htmlToPDF('<p>x</p>', { format: 'A4', landscape: true }),
    );
    expect(landscape.width).toBeCloseTo(portrait.height, 0);
    expect(landscape.height).toBeCloseTo(portrait.width, 0);
  });

  it('honours explicit width/height (CSS lengths → points) over format', async () => {
    const size = await firstPageSize(
      await htmlToPDF('<p>x</p>', { width: '100mm', height: '200mm' }),
    );
    expect(size.width).toBeCloseTo(283.46, 0); // 100mm
    expect(size.height).toBeCloseTo(566.93, 0); // 200mm
  });

  it('accepts custom CSS without throwing', async () => {
    const pdf = await htmlToPDF('<p class="big">x</p>', {
      customCSS: '.big { font-size: 40px; color: #c00; }',
    });
    expect(isPdf(pdf)).toBe(true);
  });

  it('fetches an external image referenced by the document', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'https://cdn.example.com/logo.png') {
        return new Response(PNG_1x1, { status: 200 });
      }
      return new Response(null, { status: 404 });
    });

    const pdf = await htmlToPDF(
      '<p><img src="https://cdn.example.com/logo.png" width="10" height="10"></p>',
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    expect(isPdf(pdf)).toBe(true);
    const requested = fetchImpl.mock.calls.map((c) => c[0]);
    expect(requested).toContain('https://cdn.example.com/logo.png');
  });

  it('blocks SSRF: never fetches a private/metadata image URL', async () => {
    const fetchImpl = vi.fn(async () => new Response(PNG_1x1, { status: 200 }));
    const pdf = await htmlToPDF(
      '<p><img src="http://169.254.169.254/latest/meta-data/iam"></p>',
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(isPdf(pdf)).toBe(true); // render still succeeds, image omitted
    expect(fetchImpl).not.toHaveBeenCalled(); // blocked before any byte leaves
  });
});

describe('urlToPDF / urlToPDFSafe', () => {
  it('fetches a page and renders it', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response('<h1>From URL</h1>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      }),
    );
    const pdf = await urlToPDF('https://example.com/report', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(isPdf(pdf)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('follows redirects manually, re-checking each hop', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === 'https://example.com/start') {
        return new Response(null, {
          status: 302,
          headers: { location: 'https://example.com/final' },
        });
      }
      return new Response('<p>final</p>', { status: 200 });
    });
    const pdf = await urlToPDF('https://example.com/start', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(isPdf(pdf)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('rejects a non-http(s) protocol', async () => {
    await expect(urlToPDF('file:///etc/passwd')).rejects.toMatchObject({
      code: 'PDF_CONVERT_INVALID_URL',
    });
  });

  it('urlToPDFSafe honours an injected shouldBlockRequest on the page URL', async () => {
    const fetchImpl = vi.fn(async () => new Response('<p>secret</p>', { status: 200 }));
    await expect(
      urlToPDFSafe('https://internal.example.com/', {
        fetchImpl: fetchImpl as unknown as typeof fetch,
        shouldBlockRequest: () => true,
      }),
    ).rejects.toBeInstanceOf(PDFEngineError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
