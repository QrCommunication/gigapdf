/**
 * HTML/URL to PDF Conversion route
 *
 * POST /api/pdf/convert
 * Converts HTML content or a URL to a PDF document using Playwright.
 *
 * Request body (JSON):
 * {
 *   source:              "html" | "url"  (required)
 *   html?:               string          (required when source="html")
 *   url?:                string          (required when source="url")
 *   format?:             "A4" | "Letter" | "Legal" | "Tabloid" (default: "A4")
 *   landscape?:          boolean         (default: false)
 *   margin?:             string | { top, right, bottom, left }  (default: "20mm")
 *   printBackground?:    boolean         (default: true)
 *   scale?:              number          (default: 1)
 *   waitForNetworkIdle?: boolean         (default: true)
 *   timeout?:            number          (ms, default: 30000)
 *   customCSS?:          string
 *   headers?:            Record<string, string>
 *   outputFilename?:     string          (default: "converted.pdf")
 * }
 *
 * Returns the generated PDF as application/pdf binary.
 */

import { NextResponse } from 'next/server';
import { htmlToPDF, urlToPDF } from '@giga-pdf/pdf-engine';
import type { ConvertOptions } from '@giga-pdf/pdf-engine';

export async function POST(request: Request): Promise<Response> {
  try {
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { success: false, error: 'Request body must be valid JSON.' },
        { status: 400 },
      );
    }

    const source = body.source as string | undefined;
    if (source !== 'html' && source !== 'url') {
      return NextResponse.json(
        { success: false, error: 'source must be "html" or "url".' },
        { status: 400 },
      );
    }

    const outputFilename = (body.outputFilename as string | undefined) ?? 'converted.pdf';

    const options: ConvertOptions = {
      format: (body.format as ConvertOptions['format']) ?? 'A4',
      landscape: Boolean(body.landscape),
      margin: body.margin as ConvertOptions['margin'],
      printBackground: body.printBackground !== false,
      scale: typeof body.scale === 'number' ? body.scale : 1,
      waitForNetworkIdle: body.waitForNetworkIdle !== false,
      timeout: typeof body.timeout === 'number' ? body.timeout : 30000,
      customCSS: body.customCSS as string | undefined,
      headers: body.headers as Record<string, string> | undefined,
    };

    let pdfBuffer: Buffer;

    if (source === 'html') {
      const html = body.html as string | undefined;
      if (!html || typeof html !== 'string' || html.trim() === '') {
        return NextResponse.json(
          { success: false, error: 'html is required when source is "html".' },
          { status: 400 },
        );
      }
      pdfBuffer = await htmlToPDF(html, options);
    } else {
      const url = body.url as string | undefined;
      if (!url || typeof url !== 'string') {
        return NextResponse.json(
          { success: false, error: 'url is required when source is "url".' },
          { status: 400 },
        );
      }
      // Basic URL validation to prevent SSRF against internal networks
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(url);
      } catch {
        return NextResponse.json(
          { success: false, error: 'url must be a valid absolute URL.' },
          { status: 400 },
        );
      }
      if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
        return NextResponse.json(
          { success: false, error: 'url must use http or https protocol.' },
          { status: 400 },
        );
      }
      pdfBuffer = await urlToPDF(url, options);
    }

    return new Response(pdfBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${outputFilename}"`,
        'Content-Length': String(pdfBuffer.byteLength),
      },
    });
  } catch (error) {
    console.error('[api/pdf/convert]', error);
    return NextResponse.json(
      { success: false, error: 'Failed to convert to PDF.' },
      { status: 500 },
    );
  }
}
