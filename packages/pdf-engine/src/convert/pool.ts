import type { Browser, BrowserContext, Page } from 'playwright';

// Lazy-load the Playwright runtime. Importing this module transitively via the
// pdf-engine barrel must NOT eagerly pull Playwright + its browsers.json: the
// preview/render route imports the barrel yet never launches Chromium, and an
// eager import breaks Next.js standalone module tracing (ERR_DLOPEN / missing
// browsers.json). Only HTML/URL→PDF conversion actually launches a browser.
async function getChromium() {
  return (await import('playwright')).chromium;
}

let poolSize = 2;
let browsers: Browser[] = [];
let initialized = false;
let initPromise: Promise<void> | null = null;

export function setPlaywrightPoolSize(size: number): void {
  poolSize = Math.max(1, Math.min(size, 8));
}

async function ensureInitialized(): Promise<void> {
  if (initialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    for (let i = 0; i < poolSize; i++) {
      const browser = await (await getChromium()).launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });
      browsers.push(browser);
    }
    initialized = true;
  })();

  return initPromise;
}

const inUse = new Set<Browser>();

export async function acquireBrowser(): Promise<{ browser: Browser; release: () => void }> {
  await ensureInitialized();

  let browser = browsers.find(b => !inUse.has(b) && b.isConnected());

  if (!browser) {
    await new Promise<void>(resolve => {
      const check = () => {
        browser = browsers.find(b => !inUse.has(b) && b.isConnected());
        if (browser) resolve();
        else setTimeout(check, 50);
      };
      check();
    });
  }

  if (!browser!.isConnected()) {
    const index = browsers.indexOf(browser!);
    browser = await (await getChromium()).launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    browsers[index] = browser;
  }

  inUse.add(browser!);
  const captured = browser!;

  return {
    browser: captured,
    release: () => {
      inUse.delete(captured);
    },
  };
}

// ─── Page Pool (new, optimised for html-to-pdf throughput) ────────────────────
// Each browser keeps a set of pre-warmed BrowserContext + Page pairs.
// Acquiring a page avoids the ~1-2 s cost of newContext() + newPage() per job.

interface PageSlot {
  browser: Browser;
  contexts: BrowserContext[];
  pages: Page[];
  inUse: number; // how many of this slot's pages are currently checked out
}

const pageSlots: PageSlot[] = [];
const maxPagesPerBrowser = 3;

async function ensurePagePool(): Promise<void> {
  await ensureInitialized();

  if (pageSlots.length > 0) return;

  for (const browser of browsers) {
    const slot: PageSlot = {
      browser,
      contexts: [],
      pages: [],
      inUse: 0,
    };
    for (let j = 0; j < maxPagesPerBrowser; j++) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      slot.contexts.push(ctx);
      slot.pages.push(page);
    }
    pageSlots.push(slot);
  }
}

export interface PooledPage {
  page: Page;
  context: BrowserContext;
  browser: Browser;
  release: () => Promise<void>;
}

export async function acquirePage(): Promise<PooledPage> {
  await ensurePagePool();

  let slot = pageSlots.find(s => s.inUse < s.pages.length && s.browser.isConnected());

  if (!slot) {
    await new Promise<void>(resolve => {
      const check = () => {
        slot = pageSlots.find(s => s.inUse < s.pages.length && s.browser.isConnected());
        if (slot) resolve();
        else setTimeout(check, 50);
      };
      check();
    });
  }

  if (!slot!.browser.isConnected()) {
    const deadIndex = pageSlots.findIndex(s => s.browser === slot!.browser);
    const newBrowser = await (await getChromium()).launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    browsers[deadIndex] = newBrowser;

    const newSlot: PageSlot = {
      browser: newBrowser,
      contexts: [],
      pages: [],
      inUse: 0,
    };
    for (let j = 0; j < maxPagesPerBrowser; j++) {
      const ctx = await newBrowser.newContext();
      const page = await ctx.newPage();
      newSlot.contexts.push(ctx);
      newSlot.pages.push(page);
    }
    pageSlots[deadIndex] = newSlot;
    slot = newSlot;
  }

  const capturedSlot = slot!;
  const index = capturedSlot.inUse;
  capturedSlot.inUse++;

  // The slot guarantees pages[index] and contexts[index] exist (we control
  // both the inUse counter and the array length), so the non-null assertions
  // are safe. Capturing into locals also lets release() rebind on failure.
  const capturedContext = capturedSlot.contexts[index]!;
  const capturedPage = capturedSlot.pages[index]!;

  return {
    page: capturedPage,
    context: capturedContext,
    browser: capturedSlot.browser,
    release: async () => {
      try {
        await capturedContext.clearCookies();
        await capturedPage.unroute('**/*').catch(() => {});
        await capturedPage.goto('about:blank');
      } catch {
        // Page or context died — recreate the page so the slot stays usable.
        try {
          const newPage = await capturedContext.newPage();
          await capturedPage.close().catch(() => {});
          capturedSlot.pages[index] = newPage;
        } catch {
          // Context is dead; it will be replaced on next acquire.
        }
      }
      capturedSlot.inUse--;
    },
  };
}

export async function destroyPlaywrightPool(): Promise<void> {
  // Tear down page contexts first, then browsers.
  for (const slot of pageSlots) {
    for (const ctx of slot.contexts) {
      await ctx.close().catch(() => {});
    }
  }
  pageSlots.length = 0;

  const closePromises = browsers.map(b => b.close().catch(() => {}));
  await Promise.all(closePromises);
  browsers = [];
  inUse.clear();
  initialized = false;
  initPromise = null;
}
