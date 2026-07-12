import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { Browser } from 'playwright';
import type { PlaywrightConfig } from '../../src/config/schema';
import {
  __setFetchTimeoutForTesting,
  __setLauncherForTesting,
  __setMaxHtmlBytesForTesting,
  __setOriginSafetyCheckForTesting,
  closeBrowser,
  fetchWithBrowser,
} from '../../src/core/browser';

const config: PlaywrightConfig = { timeout: 30_000, waitStrategy: 'domcontentloaded' };
const HTML = '<html><body><h1>Hello world</h1></body></html>';

interface FakeBrowser {
  browser: Browser;
  browserClose: ReturnType<typeof mock>;
  pageClose: ReturnType<typeof mock>;
  contextClose: ReturnType<typeof mock>;
}

/**
 * Build a fake Playwright surface (browser → context → page) that returns
 * `html` from `page.content()` and records `browser.close()`. No real Chromium
 * is launched. Only the methods `doFetchWithBrowser` actually calls are stubbed.
 */
function makeFakeBrowser(html: string): FakeBrowser {
  const browserClose = mock(() => Promise.resolve());
  const contextClose = mock(() => Promise.resolve());
  const pageClose = mock(() => Promise.resolve());
  const page = {
    route: mock(() => Promise.resolve()),
    addInitScript: mock(() => Promise.resolve()),
    waitForTimeout: mock(() => Promise.resolve()),
    goto: mock(() => Promise.resolve()),
    content: mock(() => Promise.resolve(html)),
    close: pageClose,
  };
  const context = {
    newPage: mock(() => Promise.resolve(page)),
    close: contextClose,
  };
  const browser = {
    newContext: mock(() => Promise.resolve(context)),
    close: browserClose,
  } as unknown as Browser;
  return { browser, browserClose, pageClose, contextClose };
}

describe('browser singleton', () => {
  afterEach(() => {
    // Restore the real launcher and reset singleton state between tests.
    __setLauncherForTesting(null);
  });

  test('concurrent cold-start fetches launch Chromium once, share it, and close it once', async () => {
    const surface = makeFakeBrowser(HTML);
    const launchMock = mock((): Promise<Browser> => Promise.resolve(surface.browser));
    __setLauncherForTesting(launchMock);

    const results = await Promise.all([
      fetchWithBrowser('https://example.com/a', config),
      fetchWithBrowser('https://example.com/b', config),
      fetchWithBrowser('https://example.com/c', config),
    ]);

    expect(launchMock).toHaveBeenCalledTimes(1);
    // While fetches are in flight the singleton stays open.
    expect(surface.browserClose).not.toHaveBeenCalled();
    for (const result of results) {
      expect(result.html).toBe(HTML);
      expect(result.error).toBeUndefined();
    }

    await closeBrowser();
    expect(surface.browserClose).toHaveBeenCalledTimes(1);
  });

  test('a launch failure is shared across concurrent callers and the memo clears so a retry can launch again', async () => {
    const failLaunch = mock((): Promise<Browser> => Promise.reject(new Error('boom: no chromium')));
    __setLauncherForTesting(failLaunch);

    const [r1, r2] = await Promise.all([
      fetchWithBrowser('https://example.com/a', config),
      fetchWithBrowser('https://example.com/b', config),
    ]);

    // One shared launch attempt, not two.
    expect(failLaunch).toHaveBeenCalledTimes(1);
    expect(r1.html).toBe('');
    expect(r1.error).toContain('boom');
    expect(r2.html).toBe('');
    expect(r2.error).toContain('boom');

    // Memo cleared on failure → a later call can launch again.
    const surface = makeFakeBrowser(HTML);
    const okLaunch = mock((): Promise<Browser> => Promise.resolve(surface.browser));
    __setLauncherForTesting(okLaunch);

    const r3 = await fetchWithBrowser('https://example.com/c', config);
    expect(okLaunch).toHaveBeenCalledTimes(1);
    expect(r3.html).toBe(HTML);
    expect(r3.error).toBeUndefined();

    await closeBrowser();
    expect(surface.browserClose).toHaveBeenCalledTimes(1);
  });

  test('closeBrowser is a no-op while a context is in use, then closes once idle', async () => {
    let resolveNewContext: () => void = () => {};
    let signalNewContext: () => void = () => {};
    const newContextGate = new Promise<void>((resolve) => {
      resolveNewContext = resolve;
    });
    const newContextInvoked = new Promise<void>((resolve) => {
      signalNewContext = resolve;
    });

    const browserClose = mock(() => Promise.resolve());
    const page = {
      route: mock(() => Promise.resolve()),
      addInitScript: mock(() => Promise.resolve()),
      waitForTimeout: mock(() => Promise.resolve()),
      goto: mock(() => Promise.resolve()),
      content: mock(() => Promise.resolve(HTML)),
      close: mock(() => Promise.resolve()),
    };
    const context = {
      newPage: mock(() => Promise.resolve(page)),
      close: mock(() => Promise.resolve()),
    };
    const browser = {
      newContext: mock(() => {
        signalNewContext();
        return newContextGate.then(() => Promise.resolve(context));
      }),
      close: browserClose,
    } as unknown as Browser;

    __setLauncherForTesting(mock((): Promise<Browser> => Promise.resolve(browser)));

    const fetchPromise = fetchWithBrowser('https://example.com/a', config);
    // Wait until the fetch is blocked inside newContext (activeContexts === 1).
    await newContextInvoked;

    await closeBrowser();
    expect(browserClose).not.toHaveBeenCalled();

    resolveNewContext();
    const result = await fetchPromise;
    expect(result.html).toBe(HTML);

    await closeBrowser();
    expect(browserClose).toHaveBeenCalledTimes(1);
  });

  test('closeBrowser is safe to call repeatedly at idle, including concurrently', async () => {
    const surface = makeFakeBrowser(HTML);
    __setLauncherForTesting(mock((): Promise<Browser> => Promise.resolve(surface.browser)));

    await fetchWithBrowser('https://example.com/a', config);

    await closeBrowser();
    expect(surface.browserClose).toHaveBeenCalledTimes(1);

    // Subsequent idle calls are no-ops.
    await closeBrowser();
    await closeBrowser();
    expect(surface.browserClose).toHaveBeenCalledTimes(1);

    // Re-establish and exercise concurrent idle closes.
    const surface2 = makeFakeBrowser(HTML);
    __setLauncherForTesting(mock((): Promise<Browser> => Promise.resolve(surface2.browser)));
    await fetchWithBrowser('https://example.com/b', config);

    await Promise.all([closeBrowser(), closeBrowser(), closeBrowser()]);
    expect(surface2.browserClose).toHaveBeenCalledTimes(1);
  });

  test('closeBrowser during an in-flight launch is a no-op while a context is active and the fetch still completes', async () => {
    let resolveLaunch: () => void = () => {};
    let signalLaunch: () => void = () => {};
    const launchGate = new Promise<void>((resolve) => {
      resolveLaunch = resolve;
    });
    const launchInvoked = new Promise<void>((resolve) => {
      signalLaunch = resolve;
    });

    const surface = makeFakeBrowser(HTML);
    const launchMock = mock((): Promise<Browser> => {
      signalLaunch();
      return launchGate.then(() => Promise.resolve(surface.browser));
    });
    __setLauncherForTesting(launchMock);

    const fetchPromise = fetchWithBrowser('https://example.com/a', config);
    // Launch is in flight and a context is active (activeContexts === 1).
    await launchInvoked;

    await closeBrowser();
    expect(surface.browserClose).not.toHaveBeenCalled();

    resolveLaunch();
    const result = await fetchPromise;
    expect(result.html).toBe(HTML);

    await closeBrowser();
    expect(surface.browserClose).toHaveBeenCalledTimes(1);
    expect(launchMock).toHaveBeenCalledTimes(1);
  });
});

describe('context and page setup cleanup', () => {
  afterEach(() => {
    // Restore the real launcher and reset singleton state between tests.
    __setLauncherForTesting(null);
  });

  test('a rejected newPage still closes the context it opened and leaves the singleton open', async () => {
    const browserClose = mock(() => Promise.resolve());
    const contextClose = mock(() => Promise.resolve());
    const context = {
      newPage: mock(() => Promise.reject(new Error('boom: newPage failed'))),
      close: contextClose,
    };
    const browser = {
      newContext: mock(() => Promise.resolve(context)),
      close: browserClose,
    } as unknown as Browser;
    __setLauncherForTesting(mock((): Promise<Browser> => Promise.resolve(browser)));

    const result = await fetchWithBrowser('https://example.com/page', config);

    // The rejection surfaces as an error result, not a thrown promise.
    expect(result.html).toBe('');
    expect(result.error).toContain('boom: newPage failed');
    // The context opened before the rejection must be closed — the leak fix.
    expect(contextClose).toHaveBeenCalledTimes(1);
    // The singleton browser is owned by closeBrowser, not this fetch.
    expect(browserClose).not.toHaveBeenCalled();

    await closeBrowser();
    expect(browserClose).toHaveBeenCalledTimes(1);
  });

  test('a rejected newContext closes no context and returns an error', async () => {
    const browserClose = mock(() => Promise.resolve());
    const newContext = mock(() => Promise.reject(new Error('boom: newContext failed')));
    const browser = {
      newContext,
      close: browserClose,
    } as unknown as Browser;
    __setLauncherForTesting(mock((): Promise<Browser> => Promise.resolve(browser)));

    const result = await fetchWithBrowser('https://example.com/page', config);

    expect(result.html).toBe('');
    expect(result.error).toContain('boom: newContext failed');
    // newContext rejected before a context existed, so setup is attempted once
    // and there is no context to close — only the singleton remains, untouched
    // until closeBrowser.
    expect(newContext).toHaveBeenCalledTimes(1);
    expect(browserClose).not.toHaveBeenCalled();

    await closeBrowser();
    expect(browserClose).toHaveBeenCalledTimes(1);
  });
});

describe('hard-timeout lifecycle accounting', () => {
  afterEach(() => {
    __setLauncherForTesting(null);
    __setFetchTimeoutForTesting(null);
  });

  test('a timed-out fetch stays counted until the inner operation settles; closeBrowser is a no-op mid-timeout and closes the idle singleton once it releases', async () => {
    // page.goto stays pending until we resolve this gate, so the inner
    // operation holds its page/context well past the hard timeout.
    let resolveGoto: () => void = () => {};
    const gotoGate = new Promise<void>((resolve) => {
      resolveGoto = resolve;
    });

    const browserClose = mock(() => Promise.resolve());
    const contextClose = mock(() => Promise.resolve());
    const pageClose = mock(() => Promise.resolve());
    const page = {
      route: mock(() => Promise.resolve()),
      addInitScript: mock(() => Promise.resolve()),
      waitForTimeout: mock(() => Promise.resolve()),
      goto: mock(() => gotoGate),
      content: mock(() => Promise.resolve(HTML)),
      close: pageClose,
    };
    const context = {
      newPage: mock(() => Promise.resolve(page)),
      close: contextClose,
    };
    const browser = {
      newContext: mock(() => Promise.resolve(context)),
      close: browserClose,
    } as unknown as Browser;
    __setLauncherForTesting(mock((): Promise<Browser> => Promise.resolve(browser)));

    // Narrow the hard timeout to milliseconds so this test does not wait 45s.
    __setFetchTimeoutForTesting(25);

    const fetchPromise = fetchWithBrowser('https://example.com/slow', config);

    // The outer call returns the timeout error promptly.
    const result = await fetchPromise;
    expect(result.html).toBe('');
    expect(result.error).toContain('timed out');

    // The inner operation is still in flight (goto pending), so activeContexts
    // is still 1. closeBrowser must be a no-op — the singleton is not torn down
    // out from under the timed-out operation.
    await closeBrowser();
    expect(browserClose).not.toHaveBeenCalled();
    // Neither page nor context has been released yet.
    expect(pageClose).not.toHaveBeenCalled();
    expect(contextClose).not.toHaveBeenCalled();

    // Release goto: the inner operation settles, its finally closes page and
    // context, the settle handler decrements the count, and — with no other
    // context active — triggers closeBrowser so the idle singleton is not leaked.
    resolveGoto();

    // The settle handler's closeBrowser is fire-and-forget; poll until the
    // singleton is actually torn down. Mock resolutions are immediate, so this
    // resolves within a couple of event-loop turns.
    for (let elapsed = 0; browserClose.mock.calls.length === 0 && elapsed < 500; elapsed += 5) {
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(pageClose).toHaveBeenCalledTimes(1);
    expect(contextClose).toHaveBeenCalledTimes(1);
    expect(browserClose).toHaveBeenCalledTimes(1);
  });
});

interface FakeRoute {
  request: () => { url: () => string };
  continue: ReturnType<typeof mock>;
  abort: ReturnType<typeof mock>;
}

interface FakeBrowserWithRoutes extends FakeBrowser {
  continueMock: ReturnType<typeof mock>;
  abortMock: ReturnType<typeof mock>;
}

/**
 * Like {@link makeFakeBrowser}, but `page.route` captures the handler and
 * invokes it once per URL in `requestUrls` (sequentially, awaiting each) at
 * route-setup time. This is what actually drives the request-safety cache: the
 * handler calls `isSafeBrowserRequestUrl` for each request, exercising the
 * per-fetch memo. `continue`/`abort` are shared mocks so a test can assert
 * allow/block counts. No real Chromium, no network, no DNS.
 */
function makeFakeBrowserWithRouteRequests(html: string, requestUrls: string[]): FakeBrowserWithRoutes {
  const browserClose = mock(() => Promise.resolve());
  const contextClose = mock(() => Promise.resolve());
  const pageClose = mock(() => Promise.resolve());
  const continueMock = mock(() => Promise.resolve());
  const abortMock = mock(() => Promise.resolve());
  const makeRoute = (url: string): FakeRoute => ({
    request: () => ({ url: () => url }),
    continue: continueMock,
    abort: abortMock,
  });
  const page = {
    route: mock(async (_pattern: string, handler: (route: FakeRoute) => Promise<void>) => {
      for (const url of requestUrls) {
        await handler(makeRoute(url));
      }
    }),
    addInitScript: mock(() => Promise.resolve()),
    waitForTimeout: mock(() => Promise.resolve()),
    goto: mock(() => Promise.resolve()),
    content: mock(() => Promise.resolve(html)),
    close: pageClose,
  };
  const context = {
    newPage: mock(() => Promise.resolve(page)),
    close: contextClose,
  };
  const browser = {
    newContext: mock(() => Promise.resolve(context)),
    close: browserClose,
  } as unknown as Browser;
  return { browser, browserClose, continueMock, abortMock, pageClose, contextClose };
}

describe('request-safety cache lifetime', () => {
  afterEach(() => {
    __setLauncherForTesting(null);
    __setOriginSafetyCheckForTesting(null);
  });

  test('repeated same-origin requests within one fetch share a memo (one safety check)', async () => {
    const surface = makeFakeBrowserWithRouteRequests(HTML, [
      'https://example.com/a',
      'https://example.com/b',
      'https://example.com/c',
    ]);
    __setLauncherForTesting(mock((): Promise<Browser> => Promise.resolve(surface.browser)));

    const safetyCheck = mock(() => Promise.resolve(true));
    __setOriginSafetyCheckForTesting(safetyCheck);

    const result = await fetchWithBrowser('https://example.com/page', config);

    expect(result.html).toBe(HTML);
    expect(result.error).toBeUndefined();
    // Same origin across three requests → one DNS-backed safety check, shared.
    expect(safetyCheck).toHaveBeenCalledTimes(1);
    expect(safetyCheck).toHaveBeenCalledWith('https://example.com/a');
    expect(surface.continueMock).toHaveBeenCalledTimes(3);
    expect(surface.abortMock).not.toHaveBeenCalled();

    await closeBrowser();
  });

  test('a later fetch starts with a fresh memo (no inheritance across fetches)', async () => {
    const surface = makeFakeBrowserWithRouteRequests(HTML, ['https://example.com/a']);
    __setLauncherForTesting(mock((): Promise<Browser> => Promise.resolve(surface.browser)));

    const safetyCheck = mock(() => Promise.resolve(true));
    __setOriginSafetyCheckForTesting(safetyCheck);

    await fetchWithBrowser('https://example.com/page', config);
    // closeBrowser between fetches mirrors acquireReference's finally block.
    await closeBrowser();

    await fetchWithBrowser('https://example.com/page', config);

    // Two fetches → two independent safety checks for the same origin. A stale
    // module-global memo would have made this 1.
    expect(safetyCheck).toHaveBeenCalledTimes(2);

    await closeBrowser();
  });

  test('distinct origins within one fetch are checked independently', async () => {
    const surface = makeFakeBrowserWithRouteRequests(HTML, ['https://example.com/a', 'https://other.example.org/x']);
    __setLauncherForTesting(mock((): Promise<Browser> => Promise.resolve(surface.browser)));

    const safetyCheck = mock(() => Promise.resolve(true));
    __setOriginSafetyCheckForTesting(safetyCheck);

    await fetchWithBrowser('https://example.com/page', config);

    expect(safetyCheck).toHaveBeenCalledTimes(2);

    await closeBrowser();
  });

  test('about:, blob:, and data: are allowed without a safety check; non-http(s) is aborted', async () => {
    const surface = makeFakeBrowserWithRouteRequests(HTML, [
      'about:blank',
      'blob:https://example.com/abc',
      'data:text/html,<p>hi</p>',
      'ftp://example.com/file',
    ]);
    __setLauncherForTesting(mock((): Promise<Browser> => Promise.resolve(surface.browser)));

    const safetyCheck = mock(() => Promise.resolve(true));
    __setOriginSafetyCheckForTesting(safetyCheck);

    const result = await fetchWithBrowser('https://example.com/page', config);

    expect(result.html).toBe(HTML);
    // Allowlisted and non-http(s) protocols bypass the safety check entirely.
    expect(safetyCheck).not.toHaveBeenCalled();
    expect(surface.continueMock).toHaveBeenCalledTimes(3);
    expect(surface.abortMock).toHaveBeenCalledTimes(1);

    await closeBrowser();
  });

  test('a blocked origin is aborted and its decision is memoized within the fetch', async () => {
    const surface = makeFakeBrowserWithRouteRequests(HTML, [
      'https://evil.example.org/a',
      'https://evil.example.org/b',
    ]);
    __setLauncherForTesting(mock((): Promise<Browser> => Promise.resolve(surface.browser)));

    const safetyCheck = mock(() => Promise.resolve(false));
    __setOriginSafetyCheckForTesting(safetyCheck);

    await fetchWithBrowser('https://example.com/page', config);

    // One check memoized for both same-origin requests; both aborted.
    expect(safetyCheck).toHaveBeenCalledTimes(1);
    expect(surface.abortMock).toHaveBeenCalledTimes(2);
    expect(surface.continueMock).not.toHaveBeenCalled();

    await closeBrowser();
  });
});

describe('rendered HTML size guard', () => {
  afterEach(() => {
    __setLauncherForTesting(null);
    __setMaxHtmlBytesForTesting(null);
  });

  test('an oversized rendered page is rejected with empty html, a clear error, and page/context cleanup', async () => {
    const surface = makeFakeBrowser('x'.repeat(2048));
    __setLauncherForTesting(mock((): Promise<Browser> => Promise.resolve(surface.browser)));
    // Narrow the limit to kilobytes so the test does not allocate >10 MiB.
    __setMaxHtmlBytesForTesting(1024);

    const result = await fetchWithBrowser('https://example.com/huge', config);

    expect(result.html).toBe('');
    expect(result.error).toBe('Response too large (over 1024 bytes)');
    // The oversized early return still ran the finally: page and context released.
    expect(surface.pageClose).toHaveBeenCalledTimes(1);
    expect(surface.contextClose).toHaveBeenCalledTimes(1);
    // The singleton browser is owned by closeBrowser, not this fetch.
    expect(surface.browserClose).not.toHaveBeenCalled();

    await closeBrowser();
    expect(surface.browserClose).toHaveBeenCalledTimes(1);
  });

  test('a multibyte page under the limit by UTF-16 length but over it by UTF-8 bytes is still rejected', async () => {
    // 'あ' is one UTF-16 code unit but three UTF-8 bytes. Seven of them:
    // length 7 (< 20) but 21 bytes (> 20). A naive `.length` guard would let
    // this through; the byte-accurate guard must reject it.
    const surface = makeFakeBrowser('あ'.repeat(7));
    __setLauncherForTesting(mock((): Promise<Browser> => Promise.resolve(surface.browser)));
    __setMaxHtmlBytesForTesting(20);

    const result = await fetchWithBrowser('https://example.com/multibyte', config);

    expect(result.html).toBe('');
    expect(result.error).toBe('Response too large (over 20 bytes)');
    expect(surface.pageClose).toHaveBeenCalledTimes(1);
    expect(surface.contextClose).toHaveBeenCalledTimes(1);
  });

  test('content exactly at the byte limit is accepted (boundary, no off-by-one)', async () => {
    // bytes === limit is not `>` limit, so equal-sized content must pass through.
    const atLimit = 'x'.repeat(1024);
    const surface = makeFakeBrowser(atLimit);
    __setLauncherForTesting(mock((): Promise<Browser> => Promise.resolve(surface.browser)));
    __setMaxHtmlBytesForTesting(1024);

    const result = await fetchWithBrowser('https://example.com/exact', config);

    expect(result.html).toBe(atLimit);
    expect(result.error).toBeUndefined();

    await closeBrowser();
  });
});
