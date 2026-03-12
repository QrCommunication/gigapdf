import { chromium, type Browser } from 'playwright';

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
      const browser = await chromium.launch({
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
    browser = await chromium.launch({
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

export async function destroyPlaywrightPool(): Promise<void> {
  const closePromises = browsers.map(b => b.close().catch(() => {}));
  await Promise.all(closePromises);
  browsers = [];
  inUse.clear();
  initialized = false;
  initPromise = null;
}
