import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { existsSync, rmSync } from 'node:fs';
import { DEFAULT_CONFIG } from '../../src/config/defaults';
import type { ArcfetchConfig } from '../../src/config/schema';
import { saveToTemp } from '../../src/core/cache';
import type { FetchResult } from '../../src/core/pipeline';
import { acquireReference } from '../../src/core/references/acquire';

const TEST_DIR = '.test-acquire-cache';
const TEST_DOCS = '.test-acquire-docs';

function getTestConfig(): ArcfetchConfig {
  return {
    ...DEFAULT_CONFIG,
    paths: { tempDir: TEST_DIR, docsDir: TEST_DOCS },
  };
}

const mockFetchUrl = mock(
  (_url: string, _config?: unknown, _verbose?: boolean, _force?: boolean): Promise<FetchResult> =>
    Promise.resolve({
      success: true as const,
      markdown: '# Fetched Content',
      title: 'Fetched Page',
      quality: { score: 90, issues: [], isValid: true, warnings: [] },
    })
);

const mockCloseBrowser = mock(() => Promise.resolve());

describe('acquireReference', () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    if (existsSync(TEST_DOCS)) rmSync(TEST_DOCS, { recursive: true });
    mockFetchUrl.mockReset();
    mockCloseBrowser.mockReset();
    mockFetchUrl.mockImplementation(() =>
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

  test('returns cached when URL is already in the store', async () => {
    const config = getTestConfig();
    await saveToTemp(config, 'Existing', 'https://existing.com', '# Body');

    const outcome = await acquireReference('https://existing.com', config, {
      fetchUrl: mockFetchUrl,
      closeBrowser: mockCloseBrowser,
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.source).toBe('cached');
      expect(outcome.refId).toBe('existing');
    }
    expect(mockFetchUrl).toHaveBeenCalledTimes(0);
    expect(mockCloseBrowser).toHaveBeenCalledTimes(0);
  });

  test('cache miss → fetched, save, returns metadata', async () => {
    const config = getTestConfig();

    const outcome = await acquireReference('https://example.com/article', config, {
      fetchUrl: mockFetchUrl,
      closeBrowser: mockCloseBrowser,
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.source).toBe('fetched');
      if (outcome.source === 'fetched') {
        expect(outcome.title).toBe('Fetched Page');
        expect(outcome.quality.score).toBe(90);
        expect(outcome.markdownLength).toBe('# Fetched Content'.length);
      }
    }
    expect(mockFetchUrl).toHaveBeenCalledTimes(1);
    expect(mockCloseBrowser).toHaveBeenCalledTimes(1);
  });

  test('refetch=true bypasses cache lookup but still calls fetch', async () => {
    const config = getTestConfig();
    await saveToTemp(config, 'Existing', 'https://existing.com', '# Old body');

    const outcome = await acquireReference('https://existing.com', config, {
      refetch: true,
      fetchUrl: mockFetchUrl,
      closeBrowser: mockCloseBrowser,
    });

    expect(outcome.ok).toBe(true);
    expect(mockFetchUrl).toHaveBeenCalledTimes(1);
  });

  test('fetch failure returns ok=false stage=fetch with error details', async () => {
    const config = getTestConfig();
    mockFetchUrl.mockImplementation(() =>
      Promise.resolve({
        success: false as const,
        error: 'HTTP 500',
        suggestion: 'Try again later',
      })
    );

    const outcome = await acquireReference('https://failing.com', config, {
      fetchUrl: mockFetchUrl,
      closeBrowser: mockCloseBrowser,
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok && outcome.stage === 'fetch') {
      expect(outcome.error).toBe('HTTP 500');
      expect(outcome.suggestion).toBe('Try again later');
    } else {
      throw new Error('expected fetch-stage failure');
    }
    expect(mockCloseBrowser).toHaveBeenCalledTimes(1);
  });

  test('closeBrowser is called even when fetch throws', async () => {
    const config = getTestConfig();
    mockFetchUrl.mockImplementation(() => {
      throw new Error('boom');
    });

    await expect(
      acquireReference('https://kaboom.com', config, {
        fetchUrl: mockFetchUrl,
        closeBrowser: mockCloseBrowser,
      })
    ).rejects.toThrow('boom');

    expect(mockCloseBrowser).toHaveBeenCalledTimes(1);
  });
});
