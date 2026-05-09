import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { existsSync, rmSync } from 'node:fs';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import type { ArcfetchConfig } from '../../src/config/schema.js';
import { saveToTemp } from '../../src/core/cache';
import { fetchLinksFromRef } from '../../src/core/fetch-links';
import type { AcquisitionOutcome } from '../../src/core/references/acquire';

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

function fetchedOutcome(url: string): AcquisitionOutcome {
  const slug = url.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  return {
    ok: true,
    source: 'fetched',
    refId: slug,
    filepath: `${TEST_DIR}/${slug}.md`,
    title: `Page for ${url}`,
    quality: { score: 90, issues: [], isValid: true, warnings: [] },
    markdownLength: 100,
  };
}

function cachedOutcome(url: string): AcquisitionOutcome {
  const slug = url.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  return {
    ok: true,
    source: 'cached',
    refId: slug,
    filepath: `${TEST_DIR}/${slug}.md`,
  };
}

function failedOutcome(error: string): AcquisitionOutcome {
  return { ok: false, stage: 'fetch', error };
}

const mockAcquire = mock(
  (url: string, _config: ArcfetchConfig, _opts?: unknown): Promise<AcquisitionOutcome> =>
    Promise.resolve(fetchedOutcome(url))
);

const mockCloseBrowser = mock(() => Promise.resolve());

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
    mockAcquire.mockReset();
    mockCloseBrowser.mockReset();

    mockAcquire.mockImplementation((url: string) => Promise.resolve(fetchedOutcome(url)));
    mockCloseBrowser.mockImplementation(() => Promise.resolve());
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    if (existsSync(TEST_DOCS)) rmSync(TEST_DOCS, { recursive: true });
  });

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
        acquireReference: mockAcquire,
        closeBrowser: mockCloseBrowser,
      });

      expect(result.error).toBeUndefined();
      expect(result.results.length).toBe(3);
      expect(result.summary.new).toBe(3);
      expect(result.summary.cached).toBe(0);
      expect(result.summary.failed).toBe(0);

      expect(mockAcquire).toHaveBeenCalledTimes(3);
      expect(mockCloseBrowser).toHaveBeenCalledTimes(1);
    });

    test('each result contains the url and a refId', async () => {
      const config = getTestConfig();
      const refId = await createCachedRef(config, 'Source', 'https://source.com', '[Only Link](https://only.com)');

      const result = await fetchLinksFromRef(config, refId, {
        acquireReference: mockAcquire,
        closeBrowser: mockCloseBrowser,
      });

      expect(result.results[0].url).toBe('https://only.com');
      expect(result.results[0].status).toBe('new');
      expect(result.results[0].refId).toBeDefined();
    });
  });

  describe('concurrency batching', () => {
    test('processes 7 URLs in batches of 3+3+1', async () => {
      const config = getTestConfig();
      const links = Array.from({ length: 7 }, (_, i) => `[Link ${i}](https://example.com/page${i})`);
      const refId = await createCachedRef(config, 'Batch Source', 'https://source.com', links.join('\n'));

      const result = await fetchLinksFromRef(config, refId, {
        acquireReference: mockAcquire,
        closeBrowser: mockCloseBrowser,
      });

      expect(result.results.length).toBe(7);
      expect(mockAcquire).toHaveBeenCalledTimes(7);
      expect(result.summary.new).toBe(7);
    });
  });

  describe('mixed results', () => {
    test('correctly counts new, cached, and failed results', async () => {
      const config = getTestConfig();

      const refId = await createCachedRef(
        config,
        'Mixed Source',
        'https://source.com',
        `[Success](https://success.com)
[Fail](https://fail.com)
[Cached](https://cached.com)`
      );

      mockAcquire.mockImplementation((url: string) => {
        if (url === 'https://fail.com') return Promise.resolve(failedOutcome('Network error'));
        if (url === 'https://cached.com') return Promise.resolve(cachedOutcome(url));
        return Promise.resolve(fetchedOutcome(url));
      });

      const result = await fetchLinksFromRef(config, refId, {
        acquireReference: mockAcquire,
        closeBrowser: mockCloseBrowser,
      });

      expect(result.results.length).toBe(3);
      expect(result.summary.failed).toBe(1);

      const successResult = result.results.find((r) => r.url === 'https://success.com');
      expect(successResult?.status).toBe('new');

      const failResult = result.results.find((r) => r.url === 'https://fail.com');
      expect(failResult?.status).toBe('failed');
      expect(failResult?.error).toBe('Network error');

      const cachedResult = result.results.find((r) => r.url === 'https://cached.com');
      expect(cachedResult?.status).toBe('cached');
    });
  });

  describe('error handling', () => {
    test('returns status=failed with error message when acquire fails', async () => {
      const config = getTestConfig();
      const refId = await createCachedRef(config, 'Error Source', 'https://source.com', '[Bad Link](https://bad.com)');

      mockAcquire.mockImplementation(() => Promise.resolve(failedOutcome('HTTP 500: Internal Server Error')));

      const result = await fetchLinksFromRef(config, refId, {
        acquireReference: mockAcquire,
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

      mockAcquire.mockImplementation(() => {
        throw new Error('Unexpected crash');
      });

      const result = await fetchLinksFromRef(config, refId, {
        acquireReference: mockAcquire,
        closeBrowser: mockCloseBrowser,
      });

      expect(result.results.length).toBe(1);
      expect(result.results[0].status).toBe('failed');
      expect(result.results[0].error).toBe('Unexpected crash');
    });

    test('returns error when source reference does not exist', async () => {
      const config = getTestConfig();

      const result = await fetchLinksFromRef(config, 'non-existent-ref', {
        acquireReference: mockAcquire,
        closeBrowser: mockCloseBrowser,
      });

      expect(result.error).toBeDefined();
      expect(result.error).toContain('not found');
      expect(result.results).toEqual([]);
      expect(result.summary).toEqual({ new: 0, cached: 0, failed: 0 });
    });
  });

  describe('already cached', () => {
    test('returns status=cached when acquire reports source=cached', async () => {
      const config = getTestConfig();

      const refId = await createCachedRef(config, 'Has Link', 'https://source.com', '[Existing](https://existing.com)');

      mockAcquire.mockImplementation((url: string) => Promise.resolve(cachedOutcome(url)));

      const result = await fetchLinksFromRef(config, refId, {
        acquireReference: mockAcquire,
        closeBrowser: mockCloseBrowser,
      });

      expect(result.results.length).toBe(1);
      expect(result.results[0].status).toBe('cached');
      expect(result.results[0].refId).toBeDefined();
      expect(result.summary.cached).toBe(1);
      expect(result.summary.new).toBe(0);
    });
  });

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
        acquireReference: mockAcquire,
        closeBrowser: mockCloseBrowser,
        onProgress,
      });

      expect(onProgress).toHaveBeenCalledTimes(4);
      expect(progressResults.length).toBe(4);

      for (const pr of progressResults) {
        expect(pr.url).toBeDefined();
        expect(['new', 'cached', 'failed']).toContain(pr.status);
      }

      const progressUrls = progressResults.map((r) => r.url).sort();
      const resultUrls = result.results.map((r) => r.url).sort();
      expect(progressUrls).toEqual(resultUrls);
    });

    test('onProgress is not called when not provided', async () => {
      const config = getTestConfig();
      const refId = await createCachedRef(config, 'No Progress', 'https://source.com', '[Link](https://link.com)');

      const result = await fetchLinksFromRef(config, refId, {
        acquireReference: mockAcquire,
        closeBrowser: mockCloseBrowser,
      });

      expect(result.results.length).toBe(1);
    });

    test('closeBrowser is called when onProgress throws', async () => {
      const config = getTestConfig();
      const refId = await createCachedRef(config, 'Progress Throws', 'https://source.com', '[Link](https://link.com)');

      await expect(
        fetchLinksFromRef(config, refId, {
          acquireReference: mockAcquire,
          closeBrowser: mockCloseBrowser,
          onProgress: () => {
            throw new Error('progress callback failed');
          },
        })
      ).rejects.toThrow('progress callback failed');

      expect(mockCloseBrowser).toHaveBeenCalledTimes(1);
    });
  });

  describe('closeBrowser cleanup', () => {
    test('closeBrowser is called after all fetches complete', async () => {
      const config = getTestConfig();
      const refId = await createCachedRef(config, 'Cleanup Source', 'https://source.com', '[Link](https://link.com)');

      const result = await fetchLinksFromRef(config, refId, {
        acquireReference: mockAcquire,
        closeBrowser: mockCloseBrowser,
      });

      expect(mockCloseBrowser).toHaveBeenCalledTimes(1);
      expect(result.results.length).toBe(1);
    });

    test('closeBrowser is called even when all fetches fail', async () => {
      const config = getTestConfig();
      const refId = await createCachedRef(config, 'All Fail', 'https://source.com', '[Bad](https://bad.com)');

      mockAcquire.mockImplementation(() => Promise.resolve(failedOutcome('Failed')));

      const result = await fetchLinksFromRef(config, refId, {
        acquireReference: mockAcquire,
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
        acquireReference: mockAcquire,
        closeBrowser: mockCloseBrowser,
      });

      expect(mockCloseBrowser).toHaveBeenCalledTimes(0);
      expect(result.results).toEqual([]);
    });
  });

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
        acquireReference: mockAcquire,
        closeBrowser: mockCloseBrowser,
      });

      expect(result.results).toEqual([]);
      expect(result.summary).toEqual({ new: 0, cached: 0, failed: 0 });
      expect(result.error).toBeUndefined();
      expect(mockAcquire).toHaveBeenCalledTimes(0);
    });

    test('returns error and empty results for non-existent reference', async () => {
      const config = getTestConfig();

      const result = await fetchLinksFromRef(config, 'does-not-exist', {
        acquireReference: mockAcquire,
        closeBrowser: mockCloseBrowser,
      });

      expect(result.error).toBeDefined();
      expect(result.results).toEqual([]);
      expect(result.summary).toEqual({ new: 0, cached: 0, failed: 0 });
    });
  });

  describe('MAX_LINKS exceeded', () => {
    test('returns error when more than 200 links are present', async () => {
      const config = getTestConfig();
      const links = Array.from({ length: 201 }, (_, i) => `[Link ${i}](https://example.com/page/${i})`);
      const refId = await createCachedRef(config, 'Too Many Links', 'https://source.com', links.join('\n'));

      const result = await fetchLinksFromRef(config, refId, {
        acquireReference: mockAcquire,
        closeBrowser: mockCloseBrowser,
      });

      expect(result.error).toBeDefined();
      expect(result.error).toContain('Too many links');
      expect(result.error).toContain('201');
      expect(result.error).toContain('200');
      expect(result.results).toEqual([]);
      expect(result.summary.failed).toBe(201);
      expect(mockAcquire).toHaveBeenCalledTimes(0);
      expect(mockCloseBrowser).toHaveBeenCalledTimes(1);
    });

    test('allows exactly 200 links', async () => {
      const config = getTestConfig();
      const links = Array.from({ length: 200 }, (_, i) => `[Link ${i}](https://example.com/p/${i})`);
      const refId = await createCachedRef(config, 'Max Links', 'https://source.com', links.join('\n'));

      const result = await fetchLinksFromRef(config, refId, {
        acquireReference: mockAcquire,
        closeBrowser: mockCloseBrowser,
      });

      expect(result.error).toBeUndefined();
      expect(result.results.length).toBe(200);
      expect(mockAcquire).toHaveBeenCalledTimes(200);
    });
  });
});
