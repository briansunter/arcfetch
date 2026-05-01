import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, rmSync } from 'node:fs';

const TEST_DIR = '.test-mcp-cache';
const TEST_DOCS = '.test-mcp-docs';

function cleanup() {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  if (existsSync(TEST_DOCS)) rmSync(TEST_DOCS, { recursive: true });
}

/**
 * We test MCP server handlers by importing and calling the server's
 * CallToolRequest handler with appropriate tool names and arguments.
 * Since the handlers use loadConfig() internally, we set env vars
 * to redirect storage to test directories.
 */
describe('MCP server tools', () => {
  let originalTempDir: string | undefined;
  let originalDocsDir: string | undefined;

  beforeEach(() => {
    cleanup();
    originalTempDir = process.env.ARCFETCH_TEMP_DIR;
    originalDocsDir = process.env.ARCFETCH_DOCS_DIR;
    process.env.ARCFETCH_TEMP_DIR = TEST_DIR;
    process.env.ARCFETCH_DOCS_DIR = TEST_DOCS;
  });

  afterEach(() => {
    cleanup();
    if (originalTempDir !== undefined) {
      process.env.ARCFETCH_TEMP_DIR = originalTempDir;
    } else {
      delete process.env.ARCFETCH_TEMP_DIR;
    }
    if (originalDocsDir !== undefined) {
      process.env.ARCFETCH_DOCS_DIR = originalDocsDir;
    } else {
      delete process.env.ARCFETCH_DOCS_DIR;
    }
  });

  describe('list_cached', () => {
    test('returns empty list when no references exist', async () => {
      const { loadConfig } = await import('../../src/config/index');
      const { listCached } = await import('../../src/core/cache');
      const config = loadConfig({ tempDir: TEST_DIR });
      const result = listCached(config);
      expect(result.references).toEqual([]);
      expect(result.error).toBeUndefined();
    });

    test('lists saved references', async () => {
      const { loadConfig } = await import('../../src/config/index');
      const { saveToTemp, listCached } = await import('../../src/core/cache');
      const config = loadConfig({ tempDir: TEST_DIR });

      await saveToTemp(config, 'Test Article', 'https://example.com', '# Content');
      const result = listCached(config);

      expect(result.references.length).toBe(1);
      expect(result.references[0].title).toBe('Test Article');
      expect(result.references[0].url).toBe('https://example.com');
    });
  });

  describe('promote_reference', () => {
    test('promotes a reference from temp to docs', async () => {
      const { loadConfig } = await import('../../src/config/index');
      const { saveToTemp, promoteReference } = await import('../../src/core/cache');
      const config = loadConfig({ tempDir: TEST_DIR, docsDir: TEST_DOCS });

      await saveToTemp(config, 'Promotable Article', 'https://example.com', '# Content');
      const result = promoteReference(config, 'promotable-article');

      expect(result.success).toBe(true);
      expect(existsSync(result.toPath)).toBe(true);
    });

    test('returns error for non-existent reference', async () => {
      const { loadConfig } = await import('../../src/config/index');
      const { promoteReference } = await import('../../src/core/cache');
      const config = loadConfig({ tempDir: TEST_DIR, docsDir: TEST_DOCS });

      const result = promoteReference(config, 'does-not-exist');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('delete_cached', () => {
    test('deletes a cached reference', async () => {
      const { loadConfig } = await import('../../src/config/index');
      const { saveToTemp, deleteCached } = await import('../../src/core/cache');
      const config = loadConfig({ tempDir: TEST_DIR });

      const saved = await saveToTemp(config, 'Deletable Article', 'https://example.com', '# Content');
      const result = deleteCached(config, 'deletable-article');

      expect(result.success).toBe(true);
      expect(existsSync(saved.filepath)).toBe(false);
    });

    test('returns error for non-existent reference', async () => {
      const { loadConfig } = await import('../../src/config/index');
      const { deleteCached } = await import('../../src/core/cache');
      const config = loadConfig({ tempDir: TEST_DIR });

      const result = deleteCached(config, 'does-not-exist');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('extract_links', () => {
    test('extracts links from a cached reference', async () => {
      const { loadConfig } = await import('../../src/config/index');
      const { saveToTemp, extractLinksFromCached } = await import('../../src/core/cache');
      const config = loadConfig({ tempDir: TEST_DIR });

      const content = '# Article\n\nSee [Google](https://google.com) and [GitHub](https://github.com).';
      await saveToTemp(config, 'Links Article', 'https://example.com', content);

      const result = extractLinksFromCached(config, 'links-article');

      expect(result.error).toBeUndefined();
      expect(result.count).toBe(2);
      expect(result.links[0].href).toBe('https://google.com');
      expect(result.links[1].href).toBe('https://github.com');
    });

    test('returns error for non-existent reference', async () => {
      const { loadConfig } = await import('../../src/config/index');
      const { extractLinksFromCached } = await import('../../src/core/cache');
      const config = loadConfig({ tempDir: TEST_DIR });

      const result = extractLinksFromCached(config, 'does-not-exist');

      expect(result.error).toContain('not found');
      expect(result.count).toBe(0);
    });
  });

  describe('URL validation in pipeline', () => {
    test('rejects non-http/https URLs', async () => {
      const { fetchUrl } = await import('../../src/core/pipeline');
      const { loadConfig } = await import('../../src/config/index');
      const config = loadConfig({ tempDir: TEST_DIR });

      const result = await fetchUrl('ftp://example.com/file', config);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toContain('Invalid URL protocol');
    });

    test('rejects invalid URLs', async () => {
      const { fetchUrl } = await import('../../src/core/pipeline');
      const { loadConfig } = await import('../../src/config/index');
      const config = loadConfig({ tempDir: TEST_DIR });

      const result = await fetchUrl('not-a-url', config);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error).toContain('Invalid URL');
    });
  });
});
