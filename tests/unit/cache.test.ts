import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import type { ArcfetchConfig } from '../../src/config/schema.js';
import {
  deleteCached,
  extractLinksFromCached,
  findByUrl,
  findCached,
  listCached,
  promoteReference,
  saveToTemp,
} from '../../src/core/cache';

const TEST_DIR = '.test-cache';
const TEST_DOCS = '.test-docs';

function getTestConfig(): ArcfetchConfig {
  return {
    ...DEFAULT_CONFIG,
    paths: {
      tempDir: TEST_DIR,
      docsDir: TEST_DOCS,
    },
  };
}

describe('cache operations', () => {
  beforeEach(() => {
    // Clean up test directories
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    if (existsSync(TEST_DOCS)) rmSync(TEST_DOCS, { recursive: true });
  });

  afterEach(() => {
    // Clean up after tests
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    if (existsSync(TEST_DOCS)) rmSync(TEST_DOCS, { recursive: true });
  });

  describe('saveToTemp', () => {
    test('saves content with frontmatter', async () => {
      const config = getTestConfig();
      const result = await saveToTemp(
        config,
        'Test Article',
        'https://example.com',
        '# Content\n\nBody text',
        'test query'
      );

      expect(result.error).toBeUndefined();
      expect(result.refId).toBe('test-article');
      expect(existsSync(result.filepath)).toBe(true);
    });

    test('uses slug-based filenames', async () => {
      const config = getTestConfig();

      const result1 = await saveToTemp(config, 'Article One', 'https://a.com', 'content');
      const result2 = await saveToTemp(config, 'Article Two', 'https://b.com', 'content');

      expect(result1.refId).toBe('article-one');
      expect(result2.refId).toBe('article-two');
    });

    test('creates unique filenames for different URLs with the same title', async () => {
      const config = getTestConfig();

      const result1 = await saveToTemp(config, 'Same Title', 'https://a.com', 'content a');
      const result2 = await saveToTemp(config, 'Same Title', 'https://b.com', 'content b');

      expect(result1.refId).toBe('same-title');
      expect(result2.refId).toBe('same-title-2');
      expect(result2.filepath).not.toBe(result1.filepath);

      const firstContent = readFileSync(result1.filepath, 'utf-8');
      const secondContent = readFileSync(result2.filepath, 'utf-8');
      expect(firstContent).toContain('content a');
      expect(secondContent).toContain('content b');
    });

    test('returns existing reference if URL already cached', async () => {
      const config = getTestConfig();

      const result1 = await saveToTemp(config, 'Original Title', 'https://example.com', 'content');
      const result2 = await saveToTemp(config, 'Different Title', 'https://example.com', 'new content');

      expect(result2.alreadyExists).toBe(true);
      expect(result2.filepath).toBe(result1.filepath);
    });

    test('refetch updates existing file', async () => {
      const config = getTestConfig();

      const result1 = await saveToTemp(config, 'Original', 'https://example.com', 'old content');
      const result2 = await saveToTemp(config, 'Updated', 'https://example.com', 'new content', undefined, true);

      expect(result2.alreadyExists).toBeUndefined();
      expect(result2.refId).toBe(result1.refId);
      expect(result2.filepath).toBe(result1.filepath); // Same path
    });
  });

  describe('listCached', () => {
    test('returns empty array for empty directory', () => {
      const config = getTestConfig();
      const result = listCached(config);
      expect(result.references).toEqual([]);
      expect(result.error).toBeUndefined();
    });

    test('lists saved references', async () => {
      const config = getTestConfig();
      await saveToTemp(config, 'Article 1', 'https://a.com', 'content 1');
      await saveToTemp(config, 'Article 2', 'https://b.com', 'content 2');

      const result = listCached(config);
      expect(result.references.length).toBe(2);
    });
  });

  describe('findCached', () => {
    test('finds existing reference by slug', async () => {
      const config = getTestConfig();
      await saveToTemp(config, 'Test Article', 'https://example.com', 'content');

      const found = findCached(config, 'test-article');
      expect(found).not.toBeNull();
      expect(found?.title).toBe('Test Article');
    });

    test('returns null for non-existent reference', () => {
      const config = getTestConfig();
      const found = findCached(config, 'non-existent');
      expect(found).toBeNull();
    });
  });

  describe('findByUrl', () => {
    test('finds existing reference by URL', async () => {
      const config = getTestConfig();
      await saveToTemp(config, 'Test Article', 'https://example.com/page', 'content');

      const found = findByUrl(config, 'https://example.com/page');
      expect(found).not.toBeNull();
      expect(found?.title).toBe('Test Article');
    });

    test('returns null for non-existent URL', () => {
      const config = getTestConfig();
      const found = findByUrl(config, 'https://not-cached.com');
      expect(found).toBeNull();
    });
  });

  describe('promoteReference', () => {
    test('moves file from temp to docs', async () => {
      const config = getTestConfig();
      const saved = await saveToTemp(config, 'Test Article', 'https://example.com', 'content');

      const result = promoteReference(config, 'test-article');

      expect(result.success).toBe(true);
      expect(existsSync(saved.filepath)).toBe(false); // Removed from temp
      expect(existsSync(result.toPath)).toBe(true); // Added to docs
    });

    test('fails for non-existent reference', () => {
      const config = getTestConfig();
      const result = promoteReference(config, 'non-existent');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    test('does not overwrite an existing docs file when promoting', async () => {
      const config = getTestConfig();
      mkdirSync(TEST_DOCS, { recursive: true });
      writeFileSync(join(TEST_DOCS, 'test-article.md'), 'existing docs content', 'utf-8');
      await saveToTemp(config, 'Test Article', 'https://example.com', 'new content');

      const result = promoteReference(config, 'test-article');

      expect(result.success).toBe(true);
      expect(result.toPath.endsWith('test-article-2.md')).toBe(true);
      expect(readFileSync(join(TEST_DOCS, 'test-article.md'), 'utf-8')).toBe('existing docs content');
      expect(readFileSync(result.toPath, 'utf-8')).toContain('new content');
    });
  });

  describe('deleteCached', () => {
    test('deletes existing reference', async () => {
      const config = getTestConfig();
      const saved = await saveToTemp(config, 'Test Article', 'https://example.com', 'content');

      const result = deleteCached(config, 'test-article');

      expect(result.success).toBe(true);
      expect(existsSync(saved.filepath)).toBe(false);
    });

    test('fails for non-existent reference', () => {
      const config = getTestConfig();
      const result = deleteCached(config, 'non-existent');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  describe('extractLinksFromCached', () => {
    test('extracts http/https links from markdown', async () => {
      const config = getTestConfig();
      const content = `# Article

Check out [Google](https://google.com) and [GitHub](https://github.com).

Also see [Docs](http://docs.example.com) for more info.`;

      await saveToTemp(config, 'Link Article', 'https://example.com', content);

      const result = extractLinksFromCached(config, 'link-article');

      expect(result.error).toBeUndefined();
      expect(result.count).toBe(3);
      expect(result.links).toEqual([
        { text: 'Google', href: 'https://google.com' },
        { text: 'GitHub', href: 'https://github.com' },
        { text: 'Docs', href: 'http://docs.example.com' },
      ]);
    });

    test('extracts links with titles and parentheses while ignoring images', async () => {
      const config = getTestConfig();
      const content = `# Article

[With title](https://example.com/page "Example")
[With parens](https://example.com/a_(b))
![Image](https://example.com/image.png)
[Angle](<https://example.com/angle?q=(x)>)
`;

      await saveToTemp(config, 'Complex Link Article', 'https://example.com', content);

      const result = extractLinksFromCached(config, 'complex-link-article');

      expect(result.links).toEqual([
        { text: 'With title', href: 'https://example.com/page' },
        { text: 'With parens', href: 'https://example.com/a_(b)' },
        { text: 'Angle', href: 'https://example.com/angle?q=(x)' },
      ]);
    });

    test('ignores non-http links', async () => {
      const config = getTestConfig();
      const content = `# Article

[Section](#section-1)
[Email](mailto:test@example.com)
[File](./local-file.md)
[Real Link](https://real.com)`;

      await saveToTemp(config, 'Mixed Links', 'https://example.com', content);

      const result = extractLinksFromCached(config, 'mixed-links');

      expect(result.count).toBe(1);
      expect(result.links[0].href).toBe('https://real.com');
    });

    test('deduplicates links by href', async () => {
      const config = getTestConfig();
      const content = `# Article

[First mention](https://example.com/page)
[Second mention](https://example.com/page)
[Different text](https://example.com/page)`;

      await saveToTemp(config, 'Dupe Links', 'https://example.com', content);

      const result = extractLinksFromCached(config, 'dupe-links');

      expect(result.count).toBe(1);
      expect(result.links[0].text).toBe('First mention'); // Keeps first occurrence
    });

    test('returns empty array for content without links', async () => {
      const config = getTestConfig();
      const content = `# Article

Just plain text without any links.`;

      await saveToTemp(config, 'No Links', 'https://example.com', content);

      const result = extractLinksFromCached(config, 'no-links');

      expect(result.count).toBe(0);
      expect(result.links).toEqual([]);
    });

    test('returns error for non-existent reference', () => {
      const config = getTestConfig();
      const result = extractLinksFromCached(config, 'non-existent');

      expect(result.error).toContain('not found');
      expect(result.count).toBe(0);
    });
  });

  describe('error paths', () => {
    test('saveToTemp with title that produces empty slug uses fallback ref ID', async () => {
      const config = getTestConfig();
      // Title with only special characters produces empty slug
      const result = await saveToTemp(config, '!!!@@@###', 'https://example.com', '# Content');

      expect(result.error).toBeUndefined();
      expect(result.refId).toBe('untitled');
      expect(result.filepath.endsWith('untitled.md')).toBe(true);
    });

    test('listCached unescapes quoted YAML frontmatter values', () => {
      const config = getTestConfig();
      mkdirSync(TEST_DIR, { recursive: true });

      writeFileSync(
        join(TEST_DIR, 'quoted.md'),
        `---
title: "A \\"Quoted\\" Title"
source_url: "https://example.com/path?x=1"
fetched_date: 2026-02-06
type: web
status: temporary
---

Content`,
        'utf-8'
      );

      const result = listCached(config);
      expect(result.references[0].title).toBe('A "Quoted" Title');
      expect(result.references[0].url).toBe('https://example.com/path?x=1');
    });

    test('saveToTemp sanitizes URLs with newlines to prevent YAML injection', async () => {
      const config = getTestConfig();
      const maliciousUrl = 'https://example.com\nevil_key: evil_value';
      const result = await saveToTemp(config, 'Newline Test', maliciousUrl, '# Content');

      expect(result.error).toBeUndefined();

      // Read the file and verify the newline was stripped
      const content = readFileSync(result.filepath, 'utf-8');
      // The URL should be on a single line with the newline removed
      const lines = content.split('\n');
      const urlLine = lines.find((l: string) => l.startsWith('source_url:'));
      expect(urlLine).toBe('source_url: "https://example.com evil_key: evil_value"');
      // Critically, "evil_key" must NOT appear as a separate YAML key
      const evilLine = lines.find((l: string) => l.startsWith('evil_key:'));
      expect(evilLine).toBeUndefined();
    });

    test('saveToTemp sanitizes URLs with carriage returns', async () => {
      const config = getTestConfig();
      const url = 'https://example.com\rinjected: value';
      const result = await saveToTemp(config, 'CR Test', url, '# Content');

      expect(result.error).toBeUndefined();
      const content = readFileSync(result.filepath, 'utf-8');
      // The \r should be stripped, so "injected: value" is part of the URL line
      const lines = content.split('\n');
      const urlLine = lines.find((l: string) => l.startsWith('source_url:'));
      expect(urlLine).toContain('injected: value');
      // But it should NOT be on its own line as a YAML key
      const injectedLine = lines.find((l: string) => l.startsWith('injected:'));
      expect(injectedLine).toBeUndefined();
    });

    test('listCached handles corrupted frontmatter files', () => {
      const config = getTestConfig();
      mkdirSync(TEST_DIR, { recursive: true });

      // Write a .md file with no valid frontmatter
      writeFileSync(join(TEST_DIR, 'corrupted.md'), 'This is not valid frontmatter content\nJust plain text', 'utf-8');

      const result = listCached(config);
      // The file should be skipped (no frontmatter match)
      expect(result.references.length).toBe(0);
      expect(result.error).toBeUndefined();
    });

    test('listCached handles files with partial frontmatter', () => {
      const config = getTestConfig();
      mkdirSync(TEST_DIR, { recursive: true });

      // Frontmatter with missing fields
      writeFileSync(join(TEST_DIR, 'partial.md'), '---\ntitle: "Partial"\n---\n\nContent', 'utf-8');

      const result = listCached(config);
      expect(result.references.length).toBe(1);
      expect(result.references[0].title).toBe('Partial');
      expect(result.references[0].url).toBe(''); // Missing source_url
    });

    test('promoteReference fails gracefully for non-existent ref', () => {
      const config = getTestConfig();
      const result = promoteReference(config, 'non-existent-ref');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });
});
