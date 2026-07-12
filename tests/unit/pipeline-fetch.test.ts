import { afterEach, describe, expect, test } from 'bun:test';
import { DEFAULT_CONFIG } from '../../src/config/defaults';
import { __simpleFetchForTesting, fetchUrl } from '../../src/core/pipeline';

const originalFetch = globalThis.fetch;

function mockFetch(response: Response): typeof fetch {
  return (() => Promise.resolve(response)) as unknown as typeof fetch;
}

// あいうえお in Shift_JIS (verified against TextDecoder).
const SHIFT_JIS_AOIUEO = Uint8Array.of(0x82, 0xa0, 0x82, 0xa2, 0x82, 0xa4, 0x82, 0xa6, 0x82, 0xa8);

const asciiEncoder = new TextEncoder();

/** Build a high-quality Shift_JIS HTML article from alternating ASCII/Japanese segments. */
function buildShiftJisArticle(): Uint8Array {
  const parts: (string | Uint8Array)[] = [
    '<!DOCTYPE html><html lang="ja"><head><meta charset="Shift_JIS"><title>',
    SHIFT_JIS_AOIUEO,
    ' Article About Character Encoding</title></head><body><article>',
    '<h1>',
    SHIFT_JIS_AOIUEO,
    ' Article Heading</h1>',
    '<p>This article explains how character encoding affects web content extraction. When a page is ',
    'served as Shift_JIS, the response bytes must be decoded using the declared character set before any ',
    'readability processing takes place. ',
    SHIFT_JIS_AOIUEO,
    ' appears here as inline Japanese hiragana text within the first paragraph. Without correct decoding ',
    'these characters would become replacement symbols and the saved reference would contain mojibake ',
    'instead of the original text that the author published.</p>',
    '<p>The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs. How vexingly ',
    'quick daft zebras jump. Sphinx of black quartz, judge my vow. These pangrams are included to provide ',
    'substantive prose so the quality validator recognizes this as a real article rather than boilerplate, ',
    'a login wall, or a short stub that would trigger a Playwright fallback.</p>',
    '<p>Character encoding declarations can appear in the HTTP Content-Type header or in an HTML meta tag. ',
    'The detector checks the byte order mark first, then the header, then the meta tag, and finally falls ',
    'back to UTF-8. This layered approach mirrors the standard algorithm used by web browsers for encoding ',
    'sniffing across legacy and modern documents.</p>',
    '<p>Once the correct encoding is selected, the decoded string is passed to the Readability extractor ',
    'and converted to markdown. The resulting reference preserves the original Japanese characters such as ',
    SHIFT_JIS_AOIUEO,
    ' and ensures the title and body remain readable for human and machine curators alike across the ',
    'entire downstream pipeline.</p>',
    '</article></body></html>',
  ];

  const segments = parts.map((part) => (typeof part === 'string' ? asciiEncoder.encode(part) : part));
  const total = segments.reduce((sum, segment) => sum + segment.byteLength, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const segment of segments) {
    bytes.set(segment, offset);
    offset += segment.byteLength;
  }
  return bytes;
}

describe('fetchUrl network safety', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('does not fall back to Playwright for redirects to private addresses', async () => {
    globalThis.fetch = mockFetch(
      new Response('', {
        status: 302,
        headers: {
          location: 'http://127.0.0.1/admin',
        },
      })
    );

    const result = await fetchUrl('https://8.8.8.8/article', DEFAULT_CONFIG);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('private/internal');
      expect(result.usedPlaywright).toBeUndefined();
    }
  });

  test('does not fall back to Playwright for unsupported content types', async () => {
    globalThis.fetch = mockFetch(
      new Response('PNG', {
        status: 200,
        headers: {
          'content-type': 'image/png',
        },
      })
    );

    const result = await fetchUrl('https://8.8.8.8/image.png', DEFAULT_CONFIG);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('Unsupported content type');
      expect(result.usedPlaywright).toBeUndefined();
    }
  });
});

describe('fetchUrl charset handling', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('decodes a Shift_JIS page using the HTTP charset instead of producing mojibake', async () => {
    globalThis.fetch = mockFetch(
      new Response(buildShiftJisArticle(), {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=Shift_JIS',
        },
      })
    );

    const result = await fetchUrl('https://8.8.8.8/japanese-article', DEFAULT_CONFIG);

    expect(result.success).toBe(true);
    if (result.success) {
      // Real Japanese text survives; no replacement-character garbage.
      expect(result.title).toContain('あいうえお');
      expect(result.markdown).toContain('あいうえお');
      expect(result.title).not.toContain('�');
      expect(result.markdown).not.toContain('�');
      // High enough quality that Playwright was never needed.
      expect(result.quality.score).toBeGreaterThanOrEqual(85);
      expect(result.usedPlaywright).toBeUndefined();
    }
  });
});

describe('simpleFetch HTTP status routing', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('marks 404 Not Found as non-retryable', async () => {
    globalThis.fetch = mockFetch(new Response('Not Found', { status: 404, statusText: 'Not Found' }));

    const result = await __simpleFetchForTesting('https://8.8.8.8/missing');

    expect(result.html).toBe('');
    expect(result.error).toContain('HTTP 404');
    expect(result.retryable).toBe(false);
  });

  test('marks 410 Gone as non-retryable', async () => {
    globalThis.fetch = mockFetch(new Response('Gone', { status: 410, statusText: 'Gone' }));

    const result = await __simpleFetchForTesting('https://8.8.8.8/gone');

    expect(result.html).toBe('');
    expect(result.error).toContain('HTTP 410');
    expect(result.retryable).toBe(false);
  });

  test('keeps 403 Forbidden retryable', async () => {
    globalThis.fetch = mockFetch(new Response('Forbidden', { status: 403, statusText: 'Forbidden' }));

    const result = await __simpleFetchForTesting('https://8.8.8.8/blocked');

    expect(result.error).toContain('HTTP 403');
    expect(result.retryable).toBe(true);
  });

  test('keeps 500 Internal Server Error retryable', async () => {
    globalThis.fetch = mockFetch(
      new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' })
    );

    const result = await __simpleFetchForTesting('https://8.8.8.8/oops');

    expect(result.error).toContain('HTTP 500');
    expect(result.retryable).toBe(true);
  });
});

describe('fetchUrl definitive HTTP errors', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('returns a 404 directly without invoking Playwright', async () => {
    globalThis.fetch = mockFetch(new Response('Not Found', { status: 404, statusText: 'Not Found' }));

    const result = await fetchUrl('https://8.8.8.8/missing', DEFAULT_CONFIG);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('HTTP 404');
      expect(result.usedPlaywright).toBeUndefined();
    }
  });

  test('returns a 410 directly without invoking Playwright', async () => {
    globalThis.fetch = mockFetch(new Response('Gone', { status: 410, statusText: 'Gone' }));

    const result = await fetchUrl('https://8.8.8.8/gone', DEFAULT_CONFIG);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain('HTTP 410');
      expect(result.usedPlaywright).toBeUndefined();
    }
  });
});

/**
 * Build a Response-like object whose `body.cancel()` records whether it was
 * called, so body-discarding early-return paths can be observed without a real
 * network stream. Only the properties `simpleFetch` touches on the discarded
 * paths (status, statusText, ok, headers, body.cancel) are implemented.
 */
function discardableResponse(init: { status: number; statusText?: string; headers?: Record<string, string> }): {
  response: Response;
  tracker: { cancelled: boolean };
} {
  const tracker = { cancelled: false };
  const response = {
    status: init.status,
    statusText: init.statusText ?? '',
    ok: init.status >= 200 && init.status < 300,
    headers: new Headers(init.headers ?? {}),
    body: {
      cancel: () => {
        tracker.cancelled = true;
        return Promise.resolve();
      },
    },
  } as unknown as Response;
  return { response, tracker };
}

describe('simpleFetch discards response bodies on early-return paths', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('cancels the body of a discarded non-OK response', async () => {
    const { response, tracker } = discardableResponse({ status: 404, statusText: 'Not Found' });
    globalThis.fetch = mockFetch(response);

    const result = await __simpleFetchForTesting('https://8.8.8.8/missing');

    expect(result.error).toContain('HTTP 404');
    expect(tracker.cancelled).toBe(true);
  });

  test('cancels the body when a redirect has no Location header', async () => {
    const { response, tracker } = discardableResponse({ status: 302, statusText: 'Found' });
    globalThis.fetch = mockFetch(response);

    const result = await __simpleFetchForTesting('https://8.8.8.8/redirect');

    expect(result.error).toContain('redirect without Location header');
    expect(tracker.cancelled).toBe(true);
  });

  test('a malformed redirect Location is non-retryable, cancels the body, and does not recurse', async () => {
    // `http://[` is a structurally malformed Location (unclosed IPv6 literal)
    // that the WHATWG URL parser rejects — unlike a bare space, which it would
    // percent-encode. This deterministically reproduces the throw in `new URL`.
    const { response, tracker } = discardableResponse({
      status: 302,
      statusText: 'Found',
      headers: { location: 'http://[' },
    });

    // Track fetch invocations so we can assert the malformed path is terminal
    // and does not recurse into another `simpleFetch` (which would call fetch
    // a second time).
    let fetchCalls = 0;
    globalThis.fetch = (() => {
      fetchCalls++;
      return Promise.resolve(response);
    }) as unknown as typeof fetch;

    const result = await __simpleFetchForTesting('https://8.8.8.8/redirect');

    expect(result.error).toContain('HTTP 302');
    expect(result.error).toContain('not a valid URL');
    expect(result.error).toContain('http://[');
    expect(result.retryable).toBe(false);
    expect(tracker.cancelled).toBe(true);
    expect(fetchCalls).toBe(1);
  });

  test('cancels the body when Content-Length advertises an oversized HTML response', async () => {
    // readTextWithLimit rejects on the Content-Length header before ever
    // reading the body, so the response stream would otherwise be left
    // unread. A header value just over the 10 MiB cap reproduces this without
    // allocating a real oversized body.
    const oversized = (10 * 1024 * 1024 + 1).toString();
    const { response, tracker } = discardableResponse({
      status: 200,
      statusText: 'OK',
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-length': oversized,
      },
    });
    globalThis.fetch = mockFetch(response);

    const result = await __simpleFetchForTesting('https://8.8.8.8/huge');

    expect(result.html).toBe('');
    expect(result.error).toContain('Response too large');
    expect(result.error).toContain(oversized);
    expect(result.retryable).toBe(false);
    expect(tracker.cancelled).toBe(true);
  });
});

describe('simpleFetch shares one timeout across redirect hops', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('reuses a single AbortSignal for the whole redirect chain and makes only the intended requests', async () => {
    const startUrl = 'https://8.8.8.8/start';
    const finalUrl = 'https://8.8.8.8/article';

    const requestedUrls: string[] = [];
    const capturedSignals: AbortSignal[] = [];

    globalThis.fetch = ((input: URL | string, init?: RequestInit) => {
      requestedUrls.push(input.toString());
      capturedSignals.push(init?.signal as AbortSignal);

      if (requestedUrls.length === 1) {
        // First hop: a valid manual redirect to a public URL.
        return Promise.resolve(new Response('', { status: 302, statusText: 'Found', headers: { location: finalUrl } }));
      }
      // Terminal hop: a small HTML article body.
      return Promise.resolve(
        new Response('<!DOCTYPE html><html><body><article><p>Final article body.</p></article></body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html; charset=utf-8' },
        })
      );
    }) as unknown as typeof fetch;

    const result = await __simpleFetchForTesting(startUrl);

    // The terminal response body was read and returned; no error path taken.
    expect(result.error).toBeUndefined();
    expect(result.html).toContain('Final article body.');

    // Exactly two fetches: the initial request plus one redirect target — no
    // extra hops, no retry. (This seam never reaches Playwright.)
    expect(requestedUrls).toEqual([startUrl, finalUrl]);

    // The same signal object was passed to both requests, proving a single 30s
    // budget spans the whole chain rather than a fresh timeout per hop.
    expect(capturedSignals).toHaveLength(2);
    expect(capturedSignals[0]).toBeInstanceOf(AbortSignal);
    expect(capturedSignals[0]).toBe(capturedSignals[1]);
  });
});
