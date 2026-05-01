import { afterEach, describe, expect, test } from 'bun:test';
import { DEFAULT_CONFIG } from '../../src/config/defaults';
import { fetchUrl } from '../../src/core/pipeline';

const originalFetch = globalThis.fetch;

function mockFetch(response: Response): typeof fetch {
  return (() => Promise.resolve(response)) as unknown as typeof fetch;
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
