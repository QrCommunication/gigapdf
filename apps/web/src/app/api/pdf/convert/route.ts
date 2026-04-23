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
 *   timeout?:            number          (ms, default: 15000, max enforced: 15000)
 *   customCSS?:          string
 *   headers?:            Record<string, string>
 *   outputFilename?:     string          (default: "converted.pdf")
 * }
 *
 * Returns the generated PDF as application/pdf binary.
 *
 * Security:
 *   - SSRF prevention: DNS pre-flight + Playwright request interception
 *   - Private/reserved IP ranges are blocked (RFC 1918, link-local, loopback, …)
 *   - Optional domain allowlist via URL_TO_PDF_DOMAIN_ALLOWLIST env var
 *   - Playwright timeout capped at 15 s to limit resource abuse
 */

import { NextResponse } from 'next/server';
import { htmlToPDF, urlToPDFSafe } from '@giga-pdf/pdf-engine';
import type { ConvertOptions } from '@giga-pdf/pdf-engine';
import {
  validateUrlForPdfConversion,
  shouldBlockPlaywrightRequest,
  SsrfBlockedError,
} from '@/lib/security/url-validation';
import { serverLogger } from '@/lib/server-logger';
import { requireSession } from '@/lib/auth-helpers';
import { sanitizeContentDisposition } from '@/lib/content-disposition';

// Maximum Playwright timeout for URL-to-PDF conversions.
// A generous per-user timeout is fine for HTML (no external fetch), but for
// URL mode we cap tightly to limit the attack surface and resource usage.
const URL_TO_PDF_TIMEOUT_MS = 15_000;

export async function POST(request: Request): Promise<Response> {
  const authResult = await requireSession();
  if (!authResult.ok) return authResult.response;

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
      // -----------------------------------------------------------------------
      // URL → PDF: full SSRF prevention pipeline
      // -----------------------------------------------------------------------
      const url = body.url as string | undefined;
      if (!url || typeof url !== 'string') {
        return NextResponse.json(
          { success: false, error: 'url is required when source is "url".' },
          { status: 400 },
        );
      }

      // Step 1 — Pre-flight: parse, protocol check, allowlist, DNS resolution.
      // Throws SsrfBlockedError for private/blocked targets, Error for bad URLs.
      try {
        await validateUrlForPdfConversion(url);
      } catch (err) {
        if (err instanceof SsrfBlockedError) {
          serverLogger.warn('[SSRF-BLOCKED] Request rejected before Playwright launch', {
            ip: err.blockedIp,
          });
          return NextResponse.json(
            { success: false, error: 'The provided URL is not permitted.' },
            { status: 422 },
          );
        }
        // Bad URL or DNS failure — surface as 400.
        return NextResponse.json(
          {
            success: false,
            error: err instanceof Error ? err.message : 'Invalid URL.',
          },
          { status: 400 },
        );
      }

      // Step 2 — Playwright conversion with:
      //   • Hard timeout cap (15 s)
      //   • Request interception that blocks redirects to private IPs
      const safeOptions = {
        ...options,
        // Cap timeout regardless of what the caller requested.
        timeout: Math.min(
          typeof options.timeout === 'number' ? options.timeout : URL_TO_PDF_TIMEOUT_MS,
          URL_TO_PDF_TIMEOUT_MS,
        ),
        // Block any request (including redirect targets) that resolve to a
        // private/reserved address — defence-in-depth against SSRF via redirects.
        shouldBlockRequest: (requestUrl: string): boolean => {
          const blocked = shouldBlockPlaywrightRequest(requestUrl);
          if (blocked) {
            serverLogger.warn('[SSRF-BLOCKED] Playwright request intercepted', {
              requestUrl,
            });
          }
          return blocked;
        },
      };

      pdfBuffer = await urlToPDFSafe(url, safeOptions);
    }

    return new Response(new Uint8Array(pdfBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': sanitizeContentDisposition(outputFilename),
        'Content-Length': String(pdfBuffer.byteLength),
      },
    });
  } catch (error: unknown) {
    serverLogger.error('[api/pdf/convert] Unhandled error', {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { success: false, error: 'Failed to convert to PDF.' },
      { status: 500 },
    );
  }
}
