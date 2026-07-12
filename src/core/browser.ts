import type { Browser, BrowserContext, Page } from 'playwright';
import { chromium } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import type { PlaywrightConfig } from '../config/schema';
import { getErrorMessage } from '../utils/error';
import { MAX_HTML_BYTES } from '../utils/limits';
import { assertSafePublicUrl } from '../utils/url-safety';

/**
 * Browser-driven fetch stage of the two-stage pipeline (see ADR-0001).
 *
 * This module owns the singleton Chromium instance used as the JS-rendering
 * fallback when a Reference's simple-fetch Page scores below the quality
 * threshold. ADR-0003 makes the policy explicit: arcfetch is local-only —
 * there is no abstraction here for a remote browser provider, and adding one
 * would be a deliberate rewrite, not a slot-in.
 */

chromium.use(stealth());

let browserInstance: Browser | null = null;
let activeContexts = 0;

/**
 * In-flight launch memo. While a cold singleton is being launched, concurrent
 * callers (see fetchLinksFromRef's batch concurrency) await this promise
 * instead of racing into a second `chromium.launch`. Cleared on settle so a
 * failed launch can be retried by a later caller.
 */
let browserLaunchPromise: Promise<Browser> | null = null;

type ChromiumLaunchOptions = { headless: boolean; timeout: number; args: string[] };

/**
 * Indirection over `chromium.launch`. Production uses the real launcher; tests
 * swap it via {@link __setLauncherForTesting} to inject a fake browser without
 * spawning Chromium. This is a narrow test seam, not a provider abstraction
 * (ADR-0003): the singleton Chromium stays a file-scoped variable.
 */
let launchChromium: (options: ChromiumLaunchOptions) => Promise<Browser> = (options) => chromium.launch(options);

/**
 * @internal Test-only: inject a fake Chromium launcher and reset the singleton
 * state (browser, in-flight launch, active-context counter). Pass `null` to
 * restore the real launcher. Does not spawn Chromium.
 */
export function __setLauncherForTesting(launcher: ((options: ChromiumLaunchOptions) => Promise<Browser>) | null): void {
  browserInstance = null;
  browserLaunchPromise = null;
  activeContexts = 0;
  launchChromium = launcher ?? ((options) => chromium.launch(options));
}

export interface FetchWithBrowserResult {
  html: string;
  error?: string;
}

export interface FetchWithBrowserOptions {
  verbose?: boolean;
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

/**
 * Active hard-timeout value used by {@link fetchWithBrowser}. Defaults to the
 * production {@link BROWSER_FETCH_TIMEOUT}; {@link __setFetchTimeoutForTesting}
 * narrows it so timeout-lifecycle tests resolve in milliseconds instead of
 * waiting 45s. The production constant is never changed.
 */
let browserFetchTimeoutMs = BROWSER_FETCH_TIMEOUT;

/**
 * @internal Test-only: override the {@link fetchWithBrowser} hard timeout so
 * timeout-lifecycle behavior can be exercised without waiting 45s. Pass `null`
 * to restore the production {@link BROWSER_FETCH_TIMEOUT}. Narrow test seam —
 * does not alter the production constant.
 */
export function __setFetchTimeoutForTesting(ms: number | null): void {
  browserFetchTimeoutMs = ms ?? BROWSER_FETCH_TIMEOUT;
}

/**
 * Active rendered-HTML byte-limit used by {@link doFetchWithBrowser}. Defaults
 * to the production {@link MAX_HTML_BYTES} — the single cap shared with the
 * simple-fetch stage (see src/utils/limits.ts), so a JS-rendered page cannot
 * bypass it and feed an oversized document into Readability/Turndown.
 * {@link __setMaxHtmlBytesForTesting} narrows it so the oversized-page guard can
 * be exercised with kilobytes instead of allocating >10 MiB strings. The
 * production constant is never changed.
 */
let maxBrowserHtmlBytes = MAX_HTML_BYTES;

/**
 * @internal Test-only: override the rendered-HTML byte limit so the
 * oversized-page guard can be exercised without allocating >10 MiB strings (and
 * so its byte-accurate multibyte behavior can be probed precisely). Pass `null`
 * to restore the production {@link MAX_HTML_BYTES}. Narrow test seam — does not
 * alter the production constant.
 */
export function __setMaxHtmlBytesForTesting(bytes: number | null): void {
  maxBrowserHtmlBytes = bytes ?? MAX_HTML_BYTES;
}

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

type OriginSafetyCheck = (url: string) => Promise<boolean>;

/**
 * Default per-origin safety check. Delegates to {@link assertSafePublicUrl}
 * (ADR-0002) — the authoritative SSRF defense that rejects private/loopback/
 * CGNAT/multicast hosts both literally and after DNS resolution.
 */
const defaultOriginSafetyCheck: OriginSafetyCheck = (url) => assertSafePublicUrl(url).then((result) => result.safe);

/**
 * @internal Test-only seam (mirrors {@link __setLauncherForTesting}): swap the
 * per-origin safety check for a fake so the request-safety cache can be
 * exercised without DNS. Pass `null` to restore the default. This is a narrow
 * test seam, not a browser-provider abstraction (ADR-0003).
 */
let originSafetyCheck: OriginSafetyCheck = defaultOriginSafetyCheck;

/**
 * @internal Test-only: restore the default per-origin safety check. See
 * {@link __setOriginSafetyCheckForTesting}.
 */
export function __setOriginSafetyCheckForTesting(check: OriginSafetyCheck | null): void {
  originSafetyCheck = check ?? defaultOriginSafetyCheck;
}

/**
 * Check whether a request URL is safe to let the browser fetch. `about:`,
 * `blob:`, and `data:` are allowlisted; every non-http(s) protocol is rejected.
 * For http(s) origins the decision is memoized in `cache`, which is scoped to a
 * single browser fetch by the caller — see {@link doFetchWithBrowser}.
 */
async function isSafeBrowserRequestUrl(url: string, cache: Map<string, Promise<boolean>>): Promise<boolean> {
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

  // Dedup within THIS fetch only: same-origin requests share the in-flight
  // (and resolved) promise so the DNS-backed check runs at most once per origin.
  const cacheKey = parsed.origin;
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const safetyPromise = originSafetyCheck(parsed.toString());
  cache.set(cacheKey, safetyPromise);
  return safetyPromise;
}

/**
 * Lazily launch the singleton Chromium instance. On a cold singleton the first
 * caller stores the launch promise in {@link browserLaunchPromise}; concurrent
 * callers await that same promise so `chromium.launch` runs at most once. The
 * browser stays alive across Acquire calls and is torn down by
 * {@link closeBrowser} after the Reference lifecycle completes.
 */
async function getBrowser(config: PlaywrightConfig): Promise<Browser> {
  if (browserInstance) {
    return browserInstance;
  }
  if (browserLaunchPromise) {
    return browserLaunchPromise;
  }
  browserLaunchPromise = launchSingleton(config);
  return browserLaunchPromise;
}

async function launchSingleton(config: PlaywrightConfig): Promise<Browser> {
  try {
    const browser = await launchChromium({
      headless: true,
      timeout: config.timeout,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-infobars',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-dev-shm-usage',
      ],
    });
    browserInstance = browser;
    return browser;
  } catch (error) {
    browserInstance = null;
    const message = getErrorMessage(error);
    if (message.includes('Executable') || message.includes('browserType.launch')) {
      throw new Error('Playwright browsers are not installed. Run: npx playwright install chromium');
    }
    throw error;
  } finally {
    // Clear the memo on settle: a later caller takes the fast path on success,
    // or can retry the launch on failure.
    browserLaunchPromise = null;
  }
}

export async function fetchWithBrowser(
  url: string,
  config: PlaywrightConfig,
  options: FetchWithBrowserOptions = {}
): Promise<FetchWithBrowserResult> {
  activeContexts++;

  // Start the inner operation exactly once. withTimeout rejects on a hard
  // timeout WITHOUT cancelling the inner operation, so a timed-out
  // doFetchWithBrowser keeps holding its page/context after this function
  // returns. We therefore decrement activeContexts only when the inner promise
  // truly settles (onInnerSettled) — never in an outer finally — so
  // closeBrowser's "is anything in use?" gate stays accurate for as long as a
  // timed-out operation still holds resources.
  const innerPromise = doFetchWithBrowser(url, config, options.verbose ?? false);

  let innerSettled = false;
  let timedOut = false;

  // Release this fetch's active-context count only when the inner operation
  // resolves or rejects — the point at which its page/context is actually
  // released, which may be well after this function has returned a timeout
  // error. A timed-out operation's caller already returned and will not run a
  // lifecycle close: if it is the last active context when it settles, the
  // singleton is now idle and unowned, so trigger closeBrowser so it is not
  // leaked. If another fetch is active, closeBrowser guards on activeContexts
  // > 0 (no-op) and that fetch's caller keeps owning cleanup.
  const onInnerSettled = (): void => {
    innerSettled = true;
    activeContexts--;
    if (timedOut && activeContexts === 0) {
      void closeBrowser();
    }
  };

  // Attach the settle handler to the SAME innerPromise (doFetchWithBrowser
  // starts once). The trailing .catch prevents an unhandled rejection if
  // onInnerSettled ever throws (it does not today, but keep it airtight).
  innerPromise.then(onInnerSettled, onInnerSettled).catch(() => {});

  try {
    return await withTimeout(innerPromise, browserFetchTimeoutMs, `Playwright fetch ${url}`);
  } catch (error) {
    // innerSettled === true means the inner operation already settled and
    // released in onInnerSettled — this error is its own, not a hard timeout.
    // Only a still-pending inner operation (innerSettled === false) means the
    // hard timeout fired; mark it so the eventual settle can clean up, and keep
    // it counted (activeContexts stays > 0) until then.
    if (!innerSettled) {
      timedOut = true;
    }
    const message = getErrorMessage(error);
    return { html: '', error: message };
  }
}

async function doFetchWithBrowser(
  url: string,
  config: PlaywrightConfig,
  verbose: boolean
): Promise<FetchWithBrowserResult> {
  const browser = await getBrowser(config);

  const viewport = pick(VIEWPORTS);
  const locale = pick(LOCALES);
  const timezone = pick(TIMEZONES);

  // Create the context and page lazily inside the try so a setup rejection
  // (newContext or newPage) still reaches the finally and closes whatever was
  // already created. Before this, a rejected newPage leaked the context it had
  // just opened, since both creations sat outside the try/finally.
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  // Per-fetch request-safety memo. Scoped to THIS fetch so a later fetch never
  // inherits a stale origin→safe decision (which would widen the DNS-rebinding
  // window) and so the map cannot grow across a long-running MCP server's
  // lifetime. Best-effort cache scoping only: this does NOT pin the resolved IP
  // or otherwise close the DNS-rebinding gap — assertSafePublicUrl (ADR-0002)
  // remains the authoritative per-origin check. Within one fetch, repeated
  // same-origin requests still share the in-flight/result promise.
  const requestSafetyCache = new Map<string, Promise<boolean>>();

  try {
    context = await browser.newContext({
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

    page = await context.newPage();

    await page.route('**/*', async (route) => {
      if (await isSafeBrowserRequestUrl(route.request().url(), requestSafetyCache)) {
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

    // Reject an oversized rendered page before it reaches Readability/Turndown,
    // enforcing the shared MAX_HTML_BYTES cap (src/utils/limits.ts). Byte-accurate
    // via Buffer.byteLength (UTF-8) so multibyte content is bounded by its true
    // encoded size rather than its UTF-16 length, and without materializing the
    // encoded bytes. The early return stays inside the try so the finally still
    // releases this page/context.
    if (Buffer.byteLength(html, 'utf8') > maxBrowserHtmlBytes) {
      return { html: '', error: `Response too large (over ${maxBrowserHtmlBytes} bytes)` };
    }

    if (verbose) {
      console.error(`🎭 Playwright: Got ${html.length} chars of HTML`);
    }

    return { html };
  } catch (error) {
    const message = getErrorMessage(error);
    return { html: '', error: message };
  } finally {
    // Close only what was created. A newPage rejection must still close the
    // context it opened; a newContext rejection closes nothing. Cleanup never
    // throws — failures are logged — matching the prior no-throw behavior.
    if (page) {
      await page.close().catch((e) => {
        console.error('Warning: Failed to close page:', getErrorMessage(e));
      });
    }
    if (context) {
      await context.close().catch((e) => {
        console.error('Warning: Failed to close context:', getErrorMessage(e));
      });
    }
  }
}

async function closeBrowserInstance(browser: Browser): Promise<void> {
  try {
    await withTimeout(browser.close(), 5_000, 'closeBrowser');
  } catch (e) {
    console.error('Warning: Failed to close browser:', getErrorMessage(e));
  }
}

/**
 * Tear down the singleton browser. Called from acquireReference's `finally`
 * and from SIGINT/SIGTERM handlers in index.ts / cli.ts. Safe to call when no
 * browser was ever launched (no-op) or while other contexts are still active
 * (skips the close). When a launch is in flight, awaits it so a freshly-launched
 * browser is never left unowned: closes it if still idle, or hands it off if a
 * caller became active while waiting. The stored reference is cleared before
 * the close is awaited so a later caller never receives a browser being torn
 * down.
 */
export async function closeBrowser(): Promise<void> {
  // Never close while contexts are still in use.
  if (activeContexts > 0) {
    return;
  }

  // Idle browser present: capture and clear the reference BEFORE awaiting
  // close, so a later caller never receives a browser that is tearing down.
  const browser = browserInstance;
  browserInstance = null;

  if (browser) {
    await closeBrowserInstance(browser);
    return;
  }

  // No browser yet, but a launch is in flight (e.g. a caller's launch outlived
  // its fetch timeout). Wait for it so we never leave a freshly-launched browser
  // unowned, then close it if still idle or hand it off if a caller became
  // active while we waited.
  const launching = browserLaunchPromise;
  if (launching) {
    try {
      const launched = await launching;
      if (activeContexts > 0) {
        // A new caller became active while we waited — leave the browser open.
        browserInstance = launched;
        return;
      }
      // Still idle. Claim only if another concurrent close hasn't already.
      if (browserInstance === launched) {
        browserInstance = null;
        await closeBrowserInstance(launched);
      }
    } catch {
      // Launch failed; launchSingleton already cleared the memo. Nothing to close.
    }
  }
}
