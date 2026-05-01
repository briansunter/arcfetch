import type { PlaywrightConfig } from '../../config/schema';
import { getErrorMessage } from '../../utils/error';
import { assertSafePublicUrl } from '../../utils/url-safety';
import { LocalBrowserManager } from './local';
import type { BrowserManager, FetchWithBrowserResult } from './types';

let currentManager: BrowserManager | null = null;
let activeContexts = 0;

export async function getBrowserManager(config: PlaywrightConfig): Promise<BrowserManager> {
  if (currentManager) {
    return currentManager;
  }

  // Only local mode is supported
  currentManager = new LocalBrowserManager(config);
  return currentManager;
}

/** Common desktop viewport sizes to rotate through for fingerprint diversity */
const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1536, height: 864 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 1280, height: 720 },
];

const TIMEZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles'];

const LOCALES = ['en-US', 'en-US', 'en-US', 'en-GB'];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Hard timeout for the entire browser fetch operation (browser launch + navigation + content extraction) */
const BROWSER_FETCH_TIMEOUT = 45_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

const browserRequestSafetyCache = new Map<string, Promise<boolean>>();

async function isSafeBrowserRequestUrl(url: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (['about:', 'blob:', 'data:'].includes(parsed.protocol)) {
    return true;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }

  const cacheKey = parsed.origin;
  const cached = browserRequestSafetyCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const safetyPromise = assertSafePublicUrl(parsed.toString()).then((result) => result.safe);
  browserRequestSafetyCache.set(cacheKey, safetyPromise);
  return safetyPromise;
}

export async function fetchWithBrowser(
  url: string,
  config: PlaywrightConfig,
  verbose = false
): Promise<FetchWithBrowserResult> {
  activeContexts++;

  try {
    return await withTimeout(
      doFetchWithBrowser(url, config, verbose),
      BROWSER_FETCH_TIMEOUT,
      `Playwright fetch ${url}`
    );
  } catch (error) {
    const message = getErrorMessage(error);
    return { html: '', error: message };
  } finally {
    activeContexts--;
  }
}

async function doFetchWithBrowser(
  url: string,
  config: PlaywrightConfig,
  verbose: boolean
): Promise<FetchWithBrowserResult> {
  const manager = await getBrowserManager(config);
  const browser = await manager.getBrowser();

  const viewport = pick(VIEWPORTS);
  const locale = pick(LOCALES);
  const timezone = pick(TIMEZONES);

  const context = await browser.newContext({
    viewport,
    locale,
    timezoneId: timezone,
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    // Realistic browser headers
    extraHTTPHeaders: {
      'Accept-Language': `${locale},en;q=0.9`,
      'Accept-Encoding': 'gzip, deflate, br',
      'Sec-CH-UA': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
      'Sec-CH-UA-Mobile': '?0',
      'Sec-CH-UA-Platform': '"macOS"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1',
    },
    // Pretend we have granted permissions a real user would have
    permissions: ['geolocation'],
    deviceScaleFactor: 2,
    isMobile: false,
    hasTouch: false,
    javaScriptEnabled: true,
  });

  const page = await context.newPage();

  try {
    await page.route('**/*', async (route) => {
      if (await isSafeBrowserRequestUrl(route.request().url())) {
        await route.continue();
        return;
      }

      await route.abort('blockedbyclient');
    });

    // Override navigator properties that leak headless signals
    await page.addInitScript(`
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
      Object.defineProperty(navigator, 'plugins', {
        get: () => [
          { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
          { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
          { name: 'Native Client', filename: 'internal-nacl-plugin' },
        ],
      });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
      Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0 });
      if (typeof Notification !== 'undefined') {
        Object.defineProperty(Notification, 'permission', { get: () => 'default' });
      }
      window.chrome = window.chrome || {};
      window.chrome.runtime = window.chrome.runtime || {};
    `);

    if (verbose) {
      console.error(
        `🎭 Playwright: Navigating to ${url} (${viewport.width}x${viewport.height}, ${locale}, ${timezone})`
      );
    }

    // Small random delay to avoid machine-like timing patterns
    await page.waitForTimeout(200 + Math.floor(Math.random() * 300));

    await page.goto(url, {
      waitUntil: config.waitStrategy,
      timeout: config.timeout,
    });

    // Wait a bit after load for lazy-loaded content / hydration
    await page.waitForTimeout(500 + Math.floor(Math.random() * 500));

    const html = await page.content();

    if (verbose) {
      console.error(`🎭 Playwright: Got ${html.length} chars of HTML`);
    }

    return { html };
  } catch (error) {
    const message = getErrorMessage(error);
    return { html: '', error: message };
  } finally {
    await page.close().catch((e) => {
      console.error('Warning: Failed to close page:', getErrorMessage(e));
    });
    await context.close().catch((e) => {
      console.error('Warning: Failed to close context:', getErrorMessage(e));
    });
  }
}

export async function closeBrowser(): Promise<void> {
  if (!currentManager) return;

  // Don't close if other contexts are still active
  if (activeContexts > 0) {
    return;
  }

  try {
    await withTimeout(currentManager.closeBrowser(), 5_000, 'closeBrowser');
  } catch (e) {
    console.error('Warning: Failed to close browser:', getErrorMessage(e));
  }
  currentManager = null;
}
