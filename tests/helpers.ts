/**
 * Shared test helpers. Three things consolidate here:
 *
 *  1. `createTestConfig(suffix)` — build an ArcfetchConfig with .test-<suffix>
 *     temp/docs directories. Pair with `cleanupTestDirs(config)` in
 *     beforeEach/afterEach.
 *
 *  2. `AcquisitionOutcome` factories — `fetchedOutcome` / `cachedOutcome` /
 *     `failedOutcome` build the discriminated-union shapes for unit tests
 *     that stub `acquireReference`.
 *
 *  3. `createCachedRef` — write a real Reference to disk via saveToTemp so
 *     tests that exercise the cache layer get the proper mtime invalidation.
 */

import { existsSync, rmSync } from 'node:fs';
import { DEFAULT_CONFIG } from '../src/config/defaults';
import type { ArcfetchConfig } from '../src/config/schema';
import { saveToTemp } from '../src/core/cache';
import type { AcquisitionOutcome } from '../src/core/references/acquire';

export interface TestEnvironment {
  config: ArcfetchConfig;
  tempDir: string;
  docsDir: string;
  cleanup: () => void;
}

/**
 * Build an isolated test environment. `suffix` is appended to .test- to
 * keep concurrent test files from clobbering each other.
 */
export function createTestConfig(suffix: string): TestEnvironment {
  const tempDir = `.test-${suffix}-cache`;
  const docsDir = `.test-${suffix}-docs`;
  const config: ArcfetchConfig = {
    ...DEFAULT_CONFIG,
    paths: { tempDir, docsDir },
  };
  const cleanup = () => {
    if (existsSync(tempDir)) rmSync(tempDir, { recursive: true });
    if (existsSync(docsDir)) rmSync(docsDir, { recursive: true });
  };
  return { config, tempDir, docsDir, cleanup };
}

/**
 * Build a fetched-source AcquisitionOutcome for the given URL. The slug is
 * derived deterministically from the URL so collisions across calls are
 * stable.
 */
export function fetchedOutcome(url: string, overrides: Partial<AcquisitionOutcome> = {}): AcquisitionOutcome {
  const slug = url.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  return {
    ok: true,
    source: 'fetched',
    refId: slug,
    filepath: `/tmp/${slug}.md`,
    title: `Page for ${url}`,
    quality: { score: 90, issues: [], isValid: true, warnings: [] },
    markdownLength: 100,
    ...overrides,
  } as AcquisitionOutcome;
}

/** Build a cached-source AcquisitionOutcome. */
export function cachedOutcome(url: string): AcquisitionOutcome {
  const slug = url.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  return {
    ok: true,
    source: 'cached',
    refId: slug,
    filepath: `/tmp/${slug}.md`,
  };
}

/** Build a fetch-stage failure AcquisitionOutcome. */
export function failedOutcome(error: string): AcquisitionOutcome {
  return { ok: false, stage: 'fetch', error };
}

/**
 * Write a real cached Reference using the production save path. Used by
 * tests that exercise the cache index (mtime-based invalidation depends on
 * actual file writes, not in-memory stubs).
 */
export async function createCachedRef(
  config: ArcfetchConfig,
  title: string,
  url: string,
  body: string
): Promise<string> {
  const result = await saveToTemp(config, title, url, body);
  if (result.error) {
    throw new Error(`Failed to create cached ref: ${result.error}`);
  }
  return result.refId;
}
