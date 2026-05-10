import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { saveToTemp } from '../../src/core/cache';
import type { FetchResult } from '../../src/core/pipeline';
import { acquireReference } from '../../src/core/references/acquire';
import { createTestConfig } from '../helpers';

const env = createTestConfig('acquire');

const mockFetchUrl = mock(
  (_url: string, _config?: unknown, _verbose?: boolean, _force?: boolean): Promise<FetchResult> =>
    Promise.resolve({
      success: true as const,
      markdown: '# Fetched Content',
      title: 'Fetched Page',
      quality: { score: 90, issues: [], isValid: true, warnings: [] },
    })
);

describe('acquireReference', () => {
  beforeEach(() => {
    env.cleanup();
    mockFetchUrl.mockReset();
    mockFetchUrl.mockImplementation(() =>
      Promise.resolve({
        success: true as const,
        markdown: '# Fetched Content',
        title: 'Fetched Page',
        quality: { score: 90, issues: [], isValid: true, warnings: [] },
      })
    );
  });

  afterEach(() => {
    env.cleanup();
  });

  test('returns cached when URL is already in the store', async () => {
    const config = env.config;
    await saveToTemp(config, 'Existing', 'https://existing.com', '# Body');

    const outcome = await acquireReference('https://existing.com', config, {
      fetchUrl: mockFetchUrl,
    });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.source).toBe('cached');
      expect(outcome.refId).toBe('existing');
    }
    expect(mockFetchUrl).toHaveBeenCalledTimes(0);
  });

  test('cache miss → fetched, save, returns metadata', async () => {
    const config = env.config;

    const outcome = await acquireReference('https://example.com/article', config, {
      fetchUrl: mockFetchUrl,
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
  });

  test('refetch=true bypasses cache lookup but still calls fetch', async () => {
    const config = env.config;
    await saveToTemp(config, 'Existing', 'https://existing.com', '# Old body');

    const outcome = await acquireReference('https://existing.com', config, {
      refetch: true,
      fetchUrl: mockFetchUrl,
    });

    expect(outcome.ok).toBe(true);
    expect(mockFetchUrl).toHaveBeenCalledTimes(1);
  });

  test('fetch failure returns ok=false stage=fetch with error details', async () => {
    const config = env.config;
    mockFetchUrl.mockImplementation(() =>
      Promise.resolve({
        success: false as const,
        error: 'HTTP 500',
        suggestion: 'Try again later',
      })
    );

    const outcome = await acquireReference('https://failing.com', config, {
      fetchUrl: mockFetchUrl,
    });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok && outcome.stage === 'fetch') {
      expect(outcome.error).toBe('HTTP 500');
      expect(outcome.suggestion).toBe('Try again later');
    } else {
      throw new Error('expected fetch-stage failure');
    }
  });

  test('fetch throw propagates to caller (acquireReference owns no cleanup)', async () => {
    const config = env.config;
    mockFetchUrl.mockImplementation(() => {
      throw new Error('boom');
    });

    await expect(
      acquireReference('https://kaboom.com', config, {
        fetchUrl: mockFetchUrl,
      })
    ).rejects.toThrow('boom');
  });
});
