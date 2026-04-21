import { PDFEngineError } from '../errors';
import { acquireBrowser } from './pool';

export interface ConvertOptions {
  format?: 'A4' | 'Letter' | 'Legal' | 'Tabloid';
  landscape?: boolean;
  margin?:
    | string
    | {
        top?: string;
        right?: string;
        bottom?: string;
        left?: string;
      };
  printBackground?: boolean;
  scale?: number;
  width?: string;
  height?: string;
  waitForNetworkIdle?: boolean;
  timeout?: number;
  customCSS?: string;
  headers?: Record<string, string>;
}

function toPlaywrightPdfOptions(options: ConvertOptions = {}) {
  const margin =
    typeof options.margin === 'string'
      ? {
          top: options.margin,
          right: options.margin,
          bottom: options.margin,
          left: options.margin,
        }
      : (options.margin ?? { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' });

  return {
    format: options.format ?? 'A4',
    landscape: options.landscape ?? false,
    margin,
    printBackground: options.printBackground ?? true,
    scale: options.scale ?? 1,
    ...(options.width ? { width: options.width } : {}),
    ...(options.height ? { height: options.height } : {}),
  };
}

export async function htmlToPDF(html: string, options?: ConvertOptions): Promise<Buffer> {
  const { browser, release } = await acquireBrowser();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.setContent(html, {
      waitUntil: options?.waitForNetworkIdle !== false ? 'networkidle' : 'load',
      timeout: options?.timeout ?? 30000,
    });

    if (options?.customCSS) {
      await page.addStyleTag({ content: options.customCSS });
    }

    const pdfBuffer = await page.pdf(toPlaywrightPdfOptions(options));

    await context.close();
    return Buffer.from(pdfBuffer);
  } finally {
    release();
  }
}

export async function urlToPDF(url: string, options?: ConvertOptions): Promise<Buffer> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new PDFEngineError(
      `Invalid URL protocol: ${parsed.protocol}. Only http and https are allowed.`,
      'PDF_CONVERT_INVALID_URL',
    );
  }

  const { browser, release } = await acquireBrowser();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    if (options?.headers) {
      await page.setExtraHTTPHeaders(options.headers);
    }

    const response = await page.goto(url, {
      waitUntil: options?.waitForNetworkIdle !== false ? 'networkidle' : 'load',
      timeout: options?.timeout ?? 30000,
    });

    if (!response || response.status() >= 400) {
      throw new PDFEngineError(
        `Failed to load URL: ${url} (status ${response?.status() ?? 'unknown'})`,
        'PDF_CONVERT_URL_FAILED',
      );
    }

    if (options?.customCSS) {
      await page.addStyleTag({ content: options.customCSS });
    }

    const pdfBuffer = await page.pdf(toPlaywrightPdfOptions(options));
    await context.close();
    return Buffer.from(pdfBuffer);
  } finally {
    release();
  }
}

export interface UrlToPDFSafeOptions extends ConvertOptions {
  /**
   * Called for every request Playwright is about to make (including redirects).
   * Return true to block the request. Used for SSRF prevention in the route handler.
   */
  shouldBlockRequest?: (requestUrl: string) => boolean;
}

/**
 * Like urlToPDF but accepts a `shouldBlockRequest` callback used to intercept
 * all Playwright network requests — including HTTP redirects — so callers can
 * enforce SSRF prevention at the network level in addition to the pre-flight
 * DNS check.
 *
 * This function is intended for use by route handlers that perform their own
 * URL validation before calling it. The Playwright pool and global config are
 * not modified.
 */
export async function urlToPDFSafe(url: string, options?: UrlToPDFSafeOptions): Promise<Buffer> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new PDFEngineError(
      `Invalid URL protocol: ${parsed.protocol}. Only http and https are allowed.`,
      'PDF_CONVERT_INVALID_URL',
    );
  }

  const { browser, release } = await acquireBrowser();
  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Request interception: block any request (including mid-flight redirects)
    // that the caller's `shouldBlockRequest` predicate identifies as disallowed.
    if (options?.shouldBlockRequest) {
      const blocker = options.shouldBlockRequest;
      await page.route('**/*', (route) => {
        if (blocker(route.request().url())) {
          route.abort('blockedbyclient').catch(() => {});
        } else {
          route.continue().catch(() => {});
        }
      });
    }

    if (options?.headers) {
      await page.setExtraHTTPHeaders(options.headers);
    }

    const response = await page.goto(url, {
      waitUntil: options?.waitForNetworkIdle !== false ? 'networkidle' : 'load',
      timeout: options?.timeout ?? 30000,
    });

    if (!response || response.status() >= 400) {
      throw new PDFEngineError(
        `Failed to load URL: ${url} (status ${response?.status() ?? 'unknown'})`,
        'PDF_CONVERT_URL_FAILED',
      );
    }

    if (options?.customCSS) {
      await page.addStyleTag({ content: options.customCSS });
    }

    const pdfBuffer = await page.pdf(toPlaywrightPdfOptions(options));
    await context.close();
    return Buffer.from(pdfBuffer);
  } finally {
    release();
  }
}
