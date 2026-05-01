import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { existsSync, rmSync } from 'node:fs';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import type { ArcfetchConfig } from '../../src/config/schema.js';
import { saveToTemp } from '../../src/core/cache';
import { fetchLinksFromRef } from '../../src/core/fetch-links';
import type { FetchResult } from '../../src/core/pipeline';

const mockFetchUrl = mock(
  (_url: string, _config?: unknown, _verbose?: boolean): Promise<FetchResult> =>
    Promise.resolve({
      success: true as const,
      markdown: '# Fetched Content',
      title: 'Fetched Page',
      quality: { score: 90, issues: [], isValid: true, warnings: [] },
    })
);

const mockCloseBrowser = mock(() => Promise.resolve());

const TEST_DIR = '.test-fetch-links-cache';
const TEST_DOCS = '.test-fetch-links-docs';

function getTestConfig(): ArcfetchConfig {
  return {
    ...DEFAULT_CONFIG,
    paths: {
      tempDir: TEST_DIR,
      docsDir: TEST_DOCS,
    },
  };
}

/**
 * Helper: create a cached reference using the real saveToTemp function,
 * which properly invalidates the in-memory cache index.
 */
async function createCachedRef(config: ArcfetchConfig, title: string, url: string, body: string): Promise<string> {
  const result = await saveToTemp(config, title, url, body);
  if (result.error) {
    throw new Error(`Failed to create cached ref: ${result.error}`);
  }
  return result.refId;
}

describe('fetchLinksFromRef', () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    if (existsSync(TEST_DOCS)) rmSync(TEST_DOCS, { recursive: true });
    mockFetchUrl.mockReset();
    mockCloseBrowser.mockReset();

    // Default: fetchUrl succeeds
    mockFetchUrl.mockImplementation(
      (_url: string, _config?: unknown, _verbose?: boolean): Promise<FetchResult> =>
        Promise.resolve({
          success: true as const,
          markdown: '# Fetched Content',
          title: 'Fetched Page',
          quality: { score: 90, issues: [], isValid: true, warnings: [] },
        })
    );
    mockCloseBrowser.mockImplementation(() => Promise.resolve());
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    if (existsSync(TEST_DOCS)) rmSync(TEST_DOCS, { recursive: true });
  });

  // ---- 1. Basic functionality ----
  describe('basic functionality', () => {
    test('fetches and saves all links from a cached reference', async () => {
      const config = getTestConfig();
      const refId = await createCachedRef(
        config,
        'Source Article',
        'https://source.com',
        `# Article

Check [Link A](https://a.com) and [Link B](https://b.com) and [Link C](https://c.com).`
      );

      const result = await fetchLinksFromRef(config, refId, {
        fetchUrl: mockFetchUrl,
        closeBrowser: mockCloseBrowser,
      });

      expect(result.error).toBeUndefined();
      expect(result.results.length).toBe(3);
      expect(result.summary.new).toBe(3);
      expect(result.summary.cached).toBe(0);
      expect(result.summary.failed).toBe(0);

      // fetchUrl should have been called once per link
      expect(mockFetchUrl).toHaveBeenCalledTimes(3);
      // closeBrowser should have been called once at the end
      expect(mockCloseBrowser).toHaveBeenCalledTimes(1);
    });

    test('each result contains the url and a refId', async () => {
      const config = getTestConfig();
      const refId = await createCachedRef(config, 'Source', 'https://source.com', '[Only Link](https://only.com)');

      const result = await fetchLinksFromRef(config, refId, {
        fetchUrl: mockFetchUrl,
        closeBrowser: mockCloseBrowser,
      });

      expect(result.results[0].url).toBe('https://only.com');
      expect(result.results[0].status).toBe('new');
      expect(result.results[0].refId).toBeDefined();
    });
  });

  // ---- 2. Concurrency batching ----
  describe('concurrency batching', () => {
    test('processes 7 URLs in batches of 3+3+1', async () => {
      const config = getTestConfig();
      const links = Array.from({ length: 7 }, (_, i) => `[Link ${i}](https://example.com/page${i})`);
      const refId = await createCachedRef(config, 'Batch Source', 'https://source.com', links.join('\n'));

      // Track call count to verify all 7 are fetched
      let callCount = 0;

      mockFetchUrl.mockImplementation((_url: string) => {
        callCount++;
        return Promise.resolve({
          success: true as const,
          markdown: '# Content',
          title: `Page ${callCount}`,
          quality: { score: 90, issues: [], isValid: true, warnings: [] },
        });
      });

      const result = await fetchLinksFromRef(config, refId, {
        fetchUrl: mockFetchUrl,
        closeBrowser: mockCloseBrowser,
      });

      expect(result.results.length).toBe(7);
      expect(mockFetchUrl).toHaveBeenCalledTimes(7);
      expect(result.summary.new).toBe(7);
    });
  });

  // ---- 3. Mixed results ----
  describe('mixed results', () => {
    test('correctly counts new, cached, and failed results', async () => {
      const config = getTestConfig();

      // Pre-cache the target URL first so it returns alreadyExists
      await createCachedRef(config, 'Cached Page', 'https://cached.com', '# Already cached');

      // Then create the source with links
      const refId = await createCachedRef(
        config,
        'Mixed Source',
        'https://source.com',
        `[Success](https://success.com)
[Fail](https://fail.com)
[Cached](https://cached.com)`
      );

      mockFetchUrl.mockImplementation((url: string) => {
        if (url === 'https://fail.com') {
          return Promise.resolve({
            success: false as const,
            error: 'Network error',
          });
        }
        return Promise.resolve({
          success: true as const,
          markdown: '# Content',
          title: 'Page',
          quality: { score: 90, issues: [], isValid: true, warnings: [] },
        });
      });

      const result = await fetchLinksFromRef(config, refId, {
        fetchUrl: mockFetchUrl,
        closeBrowser: mockCloseBrowser,
      });

      expect(result.results.length).toBe(3);
      expect(result.summary.failed).toBe(1);

      // The success URL should be 'new'
      const successResult = result.results.find((r) => r.url === 'https://success.com');
      expect(successResult?.status).toBe('new');

      // The fail URL should be 'failed'
      const failResult = result.results.find((r) => r.url === 'https://fail.com');
      expect(failResult?.status).toBe('failed');
      expect(failResult?.error).toBe('Network error');

      // The cached URL should be 'cached' (already exists in temp dir)
      const cachedResult = result.results.find((r) => r.url === 'https://cached.com');
      expect(cachedResult?.status).toBe('cached');
    });
  });

  // ---- 4. Error handling ----
  describe('error handling', () => {
    test('returns status=failed with error message when fetchUrl fails', async () => {
      const config = getTestConfig();
      const refId = await createCachedRef(config, 'Error Source', 'https://source.com', '[Bad Link](https://bad.com)');

      mockFetchUrl.mockImplementation(() =>
        Promise.resolve({
          success: false as const,
          error: 'HTTP 500: Internal Server Error',
        })
      );

      const result = await fetchLinksFromRef(config, refId, {
        fetchUrl: mockFetchUrl,
        closeBrowser: mockCloseBrowser,
      });

      expect(result.results.length).toBe(1);
      expect(result.results[0].status).toBe('failed');
      expect(result.results[0].error).toBe('HTTP 500: Internal Server Error');
      expect(result.summary.failed).toBe(1);
    });

    test('catches thrown exceptions and returns status=failed', async () => {
      const config = getTestConfig();
      const refId = await createCachedRef(config, 'Throw Source', 'https://source.com', '[Boom](https://boom.com)');

      mockFetchUrl.mockImplementation(() => {
        throw new Error('Unexpected crash');
      });

      const result = await fetchLinksFromRef(config, refId, {
        fetchUrl: mockFetchUrl,
        closeBrowser: mockCloseBrowser,
      });

      expect(result.results.length).toBe(1);
      expect(result.results[0].status).toBe('failed');
      expect(result.results[0].error).toBe('Unexpected crash');
    });

    test('returns error when source reference does not exist', async () => {
      const config = getTestConfig();

      const result = await fetchLinksFromRef(config, 'non-existent-ref', {
        fetchUrl: mockFetchUrl,
        closeBrowser: mockCloseBrowser,
      });

      expect(result.error).toBeDefined();
      expect(result.error).toContain('not found');
      expect(result.results).toEqual([]);
      expect(result.summary).toEqual({ new: 0, cached: 0, failed: 0 });
    });
  });

  // ---- 5. Already cached ----
  describe('already cached', () => {
    test('returns status=cached when saveToTemp reports alreadyExists', async () => {
      const config = getTestConfig();

      // Pre-cache the target URL first
      await createCachedRef(config, 'Existing Page', 'https://existing.com', '# Already here');

      // Create the source that links to the pre-cached URL
      const refId = await createCachedRef(config, 'Has Link', 'https://source.com', '[Existing](https://existing.com)');

      mockFetchUrl.mockImplementation(() =>
        Promise.resolve({
          success: true as const,
          markdown: '# Content',
          title: 'Existing Page',
          quality: { score: 90, issues: [], isValid: true, warnings: [] },
        })
      );

      const result = await fetchLinksFromRef(config, refId, {
        fetchUrl: mockFetchUrl,
        closeBrowser: mockCloseBrowser,
      });

      expect(result.results.length).toBe(1);
      expect(result.results[0].status).toBe('cached');
      expect(result.results[0].refId).toBeDefined();
      expect(result.summary.cached).toBe(1);
      expect(result.summary.new).toBe(0);
    });
  });

  // ---- 6. Progress callback ----
  describe('progress callback', () => {
    test('onProgress is called for each result with correct data', async () => {
      const config = getTestConfig();
      const refId = await createCachedRef(
        config,
        'Progress Source',
        'https://source.com',
        `[A](https://a.com)
[B](https://b.com)
[C](https://c.com)
[D](https://d.com)`
      );

      const progressResults: Array<{ url: string; status: string }> = [];
      const onProgress = mock((result: { url: string; status: string }) => {
        progressResults.push(result);
      });

      const result = await fetchLinksFromRef(config, refId, {
        fetchUrl: mockFetchUrl,
        closeBrowser: mockCloseBrowser,
        onProgress,
      });

      // onProgress should have been called once per URL
      expect(onProgress).toHaveBeenCalledTimes(4);
      expect(progressResults.length).toBe(4);

      // Each progress result should have the correct url and status
      for (const pr of progressResults) {
        expect(pr.url).toBeDefined();
        expect(['new', 'cached', 'failed']).toContain(pr.status);
      }

      // The final results should match what was reported via progress
      const progressUrls = progressResults.map((r) => r.url).sort();
      const resultUrls = result.results.map((r) => r.url).sort();
      expect(progressUrls).toEqual(resultUrls);
    });

    test('onProgress is not called when not provided', async () => {
      const config = getTestConfig();
      const refId = await createCachedRef(config, 'No Progress', 'https://source.com', '[Link](https://link.com)');

      // Should not throw when onProgress is not provided
      const result = await fetchLinksFromRef(config, refId, {
        fetchUrl: mockFetchUrl,
        closeBrowser: mockCloseBrowser,
      });

      expect(result.results.length).toBe(1);
    });

    test('closeBrowser is called when onProgress throws', async () => {
      const config = getTestConfig();
      const refId = await createCachedRef(config, 'Progress Throws', 'https://source.com', '[Link](https://link.com)');

      await expect(
        fetchLinksFromRef(config, refId, {
          fetchUrl: mockFetchUrl,
          closeBrowser: mockCloseBrowser,
          onProgress: () => {
            throw new Error('progress callback failed');
          },
        })
      ).rejects.toThrow('progress callback failed');

      expect(mockCloseBrowser).toHaveBeenCalledTimes(1);
    });
  });

  // ---- 7. closeBrowser cleanup ----
  describe('closeBrowser cleanup', () => {
    test('closeBrowser is called after all fetches complete', async () => {
      const config = getTestConfig();
      const refId = await createCachedRef(config, 'Cleanup Source', 'https://source.com', '[Link](https://link.com)');

      const result = await fetchLinksFromRef(config, refId, {
        fetchUrl: mockFetchUrl,
        closeBrowser: mockCloseBrowser,
      });

      expect(mockCloseBrowser).toHaveBeenCalledTimes(1);
      expect(result.results.length).toBe(1);
    });

    test('closeBrowser is called even when all fetches fail', async () => {
      const config = getTestConfig();
      const refId = await createCachedRef(config, 'All Fail', 'https://source.com', '[Bad](https://bad.com)');

      mockFetchUrl.mockImplementation(() =>
        Promise.resolve({
          success: false as const,
          error: 'Failed',
        })
      );

      const result = await fetchLinksFromRef(config, refId, {
        fetchUrl: mockFetchUrl,
        closeBrowser: mockCloseBrowser,
      });

      expect(mockCloseBrowser).toHaveBeenCalledTimes(1);
      expect(result.summary.failed).toBe(1);
    });

    test('closeBrowser is not called when reference has no links', async () => {
      const config = getTestConfig();
      const refId = await createCachedRef(
        config,
        'No Links',
        'https://source.com',
        'Just plain text, no links at all.'
      );

      const result = await fetchLinksFromRef(config, refId, {
        fetchUrl: mockFetchUrl,
        closeBrowser: mockCloseBrowser,
      });

      // closeBrowser should NOT be called when there are zero links (early return)
      expect(mockCloseBrowser).toHaveBeenCalledTimes(0);
      expect(result.results).toEqual([]);
    });
  });

  // ---- 8. Empty links ----
  describe('empty links', () => {
    test('returns empty results when cached reference has no links', async () => {
      const config = getTestConfig();
      const refId = await createCachedRef(
        config,
        'Empty Article',
        'https://source.com',
        '# Article\n\nNo links here, just text.'
      );

      const result = await fetchLinksFromRef(config, refId, {
        fetchUrl: mockFetchUrl,
        closeBrowser: mockCloseBrowser,
      });

      expect(result.results).toEqual([]);
      expect(result.summary).toEqual({ new: 0, cached: 0, failed: 0 });
      expect(result.error).toBeUndefined();
      // fetchUrl should not have been called
      expect(mockFetchUrl).toHaveBeenCalledTimes(0);
    });

    test('returns error and empty results for non-existent reference', async () => {
      const config = getTestConfig();

      const result = await fetchLinksFromRef(config, 'does-not-exist', {
        fetchUrl: mockFetchUrl,
        closeBrowser: mockCloseBrowser,
      });

      expect(result.error).toBeDefined();
      expect(result.results).toEqual([]);
      expect(result.summary).toEqual({ new: 0, cached: 0, failed: 0 });
    });
  });

  // ---- 9. MAX_LINKS exceeded ----
  describe('MAX_LINKS exceeded', () => {
    test('returns error when more than 200 links are present', async () => {
      const config = getTestConfig();
      // Generate 201 unique links
      const links = Array.from({ length: 201 }, (_, i) => `[Link ${i}](https://example.com/page/${i})`);
      const refId = await createCachedRef(config, 'Too Many Links', 'https://source.com', links.join('\n'));

      const result = await fetchLinksFromRef(config, refId, {
        fetchUrl: mockFetchUrl,
        closeBrowser: mockCloseBrowser,
      });

      expect(result.error).toBeDefined();
      expect(result.error).toContain('Too many links');
      expect(result.error).toContain('201');
      expect(result.error).toContain('200');
      expect(result.results).toEqual([]);
      expect(result.summary.failed).toBe(201);
      // fetchUrl should NOT have been called
      expect(mockFetchUrl).toHaveBeenCalledTimes(0);
      // closeBrowser SHOULD still be called for cleanup
      expect(mockCloseBrowser).toHaveBeenCalledTimes(1);
    });

    test('allows exactly 200 links', async () => {
      const config = getTestConfig();
      const links = Array.from({ length: 200 }, (_, i) => `[Link ${i}](https://example.com/p/${i})`);
      const refId = await createCachedRef(config, 'Max Links', 'https://source.com', links.join('\n'));

      const result = await fetchLinksFromRef(config, refId, {
        fetchUrl: mockFetchUrl,
        closeBrowser: mockCloseBrowser,
      });

      // Should NOT return the MAX_LINKS error
      expect(result.error).toBeUndefined();
      expect(result.results.length).toBe(200);
      expect(mockFetchUrl).toHaveBeenCalledTimes(200);
    });
  });
});
