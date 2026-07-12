import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
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

      // The refetch atomically replaced the body at that path: new content is
      // present and the old body is gone.
      const content = readFileSync(result2.filepath, 'utf-8');
      expect(content).toContain('new content');
      expect(content).not.toContain('old content');
      // Refetch keeps the reference in the temp tier (no status flip).
      expect(content).toContain('status: temporary');
      expect(content).not.toContain('status: permanent');
      // No refetch staging temp was leaked alongside the finished .md.
      const tempEntries = readdirSync(TEST_DIR);
      expect(tempEntries.every((f) => f.endsWith('.md'))).toBe(true);
      expect(tempEntries.some((f) => /\.refetch-.*\.tmp$/.test(f))).toBe(false);
    });

    test('concurrent saves with same title but different URLs produce distinct files', async () => {
      const config = getTestConfig();

      // Two different URLs that both produce the same slug ("same-title").
      // Run them concurrently to exercise the atomic-exclusive-create path.
      const [result1, result2] = await Promise.all([
        saveToTemp(config, 'Same Title', 'https://a.com/page', 'content for a'),
        saveToTemp(config, 'Same Title', 'https://b.com/page', 'content for b'),
      ]);

      // Both saves must succeed without errors.
      expect(result1.error).toBeUndefined();
      expect(result2.error).toBeUndefined();

      // The two refIds must be distinct.
      expect(result1.refId).not.toBe(result2.refId);

      // Both files must exist on disk.
      expect(existsSync(result1.filepath)).toBe(true);
      expect(existsSync(result2.filepath)).toBe(true);

      // The filepaths must be distinct.
      expect(result1.filepath).not.toBe(result2.filepath);

      // Neither file's content was lost — each URL is present in its own file.
      const content1 = readFileSync(result1.filepath, 'utf-8');
      const content2 = readFileSync(result2.filepath, 'utf-8');

      // One file has a.com, the other has b.com — neither clobbered the other.
      const urls = [content1, content2].map((c) => {
        const m = c.match(/source_url:\s*"([^"]+)"/);
        return m ? m[1] : '';
      });
      expect(urls).toContain('https://a.com/page');
      expect(urls).toContain('https://b.com/page');
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

  describe('canonical URL identity (duplicate detection)', () => {
    test('equivalent spellings collapse to one Reference (alreadyExists, one file)', async () => {
      const config = getTestConfig();

      const first = await saveToTemp(config, 'Article', 'https://example.com/article', 'body one');

      // Fragments are never sent to servers; host case and default ports are
      // canonicalised by the same WHATWG parser the fetch layer uses. Each of
      // these is the same resource and must hit the existing Reference rather
      // than create a duplicate.
      const variants = [
        'https://example.com/article#section',
        'HTTPS://EXAMPLE.COM/article',
        'https://example.com:443/article',
        'https://example.com/article#',
      ];
      for (const variant of variants) {
        const dup = await saveToTemp(config, 'Different Title', variant, 'body two');
        expect(dup.alreadyExists).toBe(true);
        expect(dup.refId).toBe(first.refId);
        expect(dup.filepath).toBe(first.filepath);
      }

      // Only the original file exists — no duplicates were created.
      const entries = readdirSync(TEST_DIR).filter((f) => f.endsWith('.md'));
      expect(entries.length).toBe(1);
      expect(existsSync(first.filepath)).toBe(true);

      // The stored source_url is the original spelling, untouched by the
      // equivalent-spelling probes, and the original body is intact (no refetch).
      const content = readFileSync(first.filepath, 'utf-8');
      expect(content).toContain('source_url: "https://example.com/article"');
      expect(content).toContain('body one');
    });

    test('a refetch through an equivalent spelling updates the body but keeps the stored source_url', async () => {
      const config = getTestConfig();

      const first = await saveToTemp(config, 'Original', 'https://example.com/article', 'old body');

      // Refetch via a fragment variant of the same resource.
      const refetched = await saveToTemp(
        config,
        'Updated',
        'https://example.com/article#section',
        'new body',
        undefined,
        true
      );

      expect(refetched.alreadyExists).toBeUndefined();
      expect(refetched.refId).toBe(first.refId);
      expect(refetched.filepath).toBe(first.filepath);

      const content = readFileSync(refetched.filepath, 'utf-8');
      // Body was updated...
      expect(content).toContain('new body');
      expect(content).not.toContain('old body');
      // ...but the stored source_url is still the original spelling, NOT the
      // fragment variant the refetch caller used.
      expect(content).toContain('source_url: "https://example.com/article"');
      expect(content).not.toContain('#section');

      // Only one file on disk.
      expect(readdirSync(TEST_DIR).filter((f) => f.endsWith('.md')).length).toBe(1);
    });

    test('findByUrl locates a Reference via an equivalent spelling', async () => {
      const config = getTestConfig();
      await saveToTemp(config, 'Article', 'https://example.com/article', 'body');

      const byFragment = findByUrl(config, 'https://example.com/article#intro');
      expect(byFragment).not.toBeNull();
      expect(byFragment?.refId).toBe('article');

      const byCase = findByUrl(config, 'HTTPS://EXAMPLE.COM/article');
      expect(byCase).not.toBeNull();
      expect(byCase?.refId).toBe('article');

      const byDefaultPort = findByUrl(config, 'https://example.com:443/article');
      expect(byDefaultPort).not.toBeNull();
      expect(byDefaultPort?.refId).toBe('article');
    });

    test('spellings the WHATWG parser preserves stay distinct (query order, path case)', async () => {
      const config = getTestConfig();

      const a = await saveToTemp(config, 'Same Title', 'https://example.com/p?x=1&y=2', 'a');
      const b = await saveToTemp(config, 'Same Title', 'https://example.com/p?y=2&x=1', 'b');
      const c = await saveToTemp(config, 'Same Title', 'https://example.com/Article', 'c');

      // None collapse: query order and path case are not canonicalised, so each
      // is a distinct resource and gets its own Reference.
      expect(a.alreadyExists).toBeUndefined();
      expect(b.alreadyExists).toBeUndefined();
      expect(c.alreadyExists).toBeUndefined();
      expect(new Set([a.filepath, b.filepath, c.filepath]).size).toBe(3);
      expect(readdirSync(TEST_DIR).filter((f) => f.endsWith('.md')).length).toBe(3);
    });

    test('an exact-URL refetch still works (no regression from identity comparison)', async () => {
      const config = getTestConfig();
      const first = await saveToTemp(config, 'Original', 'https://example.com/article', 'old body');
      const refetched = await saveToTemp(config, 'Updated', 'https://example.com/article', 'new body', undefined, true);
      expect(refetched.refId).toBe(first.refId);
      expect(refetched.filepath).toBe(first.filepath);
      expect(readFileSync(refetched.filepath, 'utf-8')).toContain('new body');
    });

    test('non-HTTP URLs keep raw-string identity (fragments do not collapse them)', async () => {
      const config = getTestConfig();

      // Canonical identity is HTTP-only. A direct cache caller may store
      // non-HTTP metadata (ftp:, file:, ...); those keep raw-string identity,
      // so two spellings that differ only by fragment stay distinct References
      // instead of collapsing the way equivalent HTTP spellings do.
      const first = await saveToTemp(config, 'FTP One', 'ftp://example.com/dir/file#frag1', 'body one');
      const second = await saveToTemp(config, 'FTP Two', 'ftp://example.com/dir/file#frag2', 'body two');

      expect(first.error).toBeUndefined();
      expect(second.error).toBeUndefined();
      // Neither recognises the other as a duplicate.
      expect(first.alreadyExists).toBeUndefined();
      expect(second.alreadyExists).toBeUndefined();
      expect(second.refId).not.toBe(first.refId);
      expect(second.filepath).not.toBe(first.filepath);

      // Two distinct files on disk — no collapse.
      expect(readdirSync(TEST_DIR).filter((f) => f.endsWith('.md')).length).toBe(2);

      // findByUrl matches only on the exact raw spelling: the fragment is part
      // of the identity, never stripped for non-HTTP URLs.
      expect(findByUrl(config, 'ftp://example.com/dir/file#frag1')?.refId).toBe(first.refId);
      expect(findByUrl(config, 'ftp://example.com/dir/file#frag2')?.refId).toBe(second.refId);
      // A fragment-less probe of the same path finds neither — direct evidence
      // that non-HTTP identity is raw (no canonicalisation at all).
      expect(findByUrl(config, 'ftp://example.com/dir/file')).toBeNull();
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

    test('promoted destination holds complete content with status: permanent', async () => {
      const config = getTestConfig();
      const body = '# Big Article\n\npara one\n\npara two\n\n- a\n- b\n- c';
      await saveToTemp(config, 'Big Article', 'https://example.com', body);

      const result = promoteReference(config, 'big-article');

      expect(result.success).toBe(true);
      const content = readFileSync(result.toPath, 'utf-8');
      // Full body present — nothing truncated by the staging/link dance.
      expect(content).toContain('# Big Article');
      expect(content).toContain('para one');
      expect(content).toContain('para two');
      expect(content).toContain('- a\n- b\n- c');
      // Status flipped from temporary to permanent.
      expect(content).toContain('status: permanent');
      expect(content).not.toContain('status: temporary');
      // Source removed from temp.
      expect(existsSync(join(TEST_DIR, 'big-article.md'))).toBe(false);
    });

    test('advances -2/-3 suffix past multiple existing docs files without overwriting', async () => {
      const config = getTestConfig();
      mkdirSync(TEST_DOCS, { recursive: true });
      writeFileSync(join(TEST_DOCS, 'multi.md'), 'first', 'utf-8');
      writeFileSync(join(TEST_DOCS, 'multi-2.md'), 'second', 'utf-8');
      await saveToTemp(config, 'Multi', 'https://example.com', 'incoming');

      const result = promoteReference(config, 'multi');

      expect(result.success).toBe(true);
      expect(result.toPath.endsWith('multi-3.md')).toBe(true);
      expect(readFileSync(join(TEST_DOCS, 'multi.md'), 'utf-8')).toBe('first');
      expect(readFileSync(join(TEST_DOCS, 'multi-2.md'), 'utf-8')).toBe('second');
      expect(readFileSync(result.toPath, 'utf-8')).toContain('status: permanent');
    });

    test('leaves no staging file behind after a successful promote', async () => {
      const config = getTestConfig();
      await saveToTemp(config, 'Staging Article', 'https://example.com', 'content');

      const result = promoteReference(config, 'staging-article');

      expect(result.success).toBe(true);
      const docsEntries = readdirSync(TEST_DOCS);
      // Every docs entry is a finished .md reference — no leftover staging temp.
      expect(docsEntries.every((f) => f.endsWith('.md'))).toBe(true);
      expect(docsEntries.some((f) => /\.promote-.*\.tmp$/.test(f))).toBe(false);
    });

    test('leaves no staging file behind after a collision (suffix) promote', async () => {
      const config = getTestConfig();
      mkdirSync(TEST_DOCS, { recursive: true });
      writeFileSync(join(TEST_DOCS, 'staging-article.md'), 'pre-existing', 'utf-8');
      await saveToTemp(config, 'Staging Article', 'https://example.com', 'incoming');

      const result = promoteReference(config, 'staging-article');

      expect(result.success).toBe(true);
      expect(result.toPath.endsWith('staging-article-2.md')).toBe(true);
      expect(readFileSync(join(TEST_DOCS, 'staging-article.md'), 'utf-8')).toBe('pre-existing');
      const docsEntries = readdirSync(TEST_DOCS);
      expect(docsEntries.every((f) => f.endsWith('.md'))).toBe(true);
      expect(docsEntries.some((f) => /\.promote-.*\.tmp$/.test(f))).toBe(false);
    });

    test('leaves no staging file behind on the missing-reference failure path', () => {
      const config = getTestConfig();
      // Failure returns before any staging file is created.
      const result = promoteReference(config, 'missing-ref');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
      if (existsSync(TEST_DOCS)) {
        const docsEntries = readdirSync(TEST_DOCS);
        expect(docsEntries.some((f) => /\.promote-.*\.tmp$/.test(f))).toBe(false);
      }
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

    test('ignores non-http links but resolves relative links against the source URL', async () => {
      const config = getTestConfig();
      const content = `# Article

[Section](#section-1)
[Email](mailto:test@example.com)
[File](./local-file.md)
[Real Link](https://real.com)`;

      await saveToTemp(config, 'Mixed Links', 'https://example.com', content);

      const result = extractLinksFromCached(config, 'mixed-links');

      expect(result.links).toEqual([
        { text: 'File', href: 'https://example.com/local-file.md' },
        { text: 'Real Link', href: 'https://real.com' },
      ]);
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

  describe('warm index refresh (mutation-aware)', () => {
    // A reference returned by findByUrl/findCached is the live element of the
    // in-memory index. After a self-mutation that keeps the index warm, the next
    // read returns the SAME object reference (the index was updated in place);
    // a full rebuild would return a fresh object. The `toBe` identity checks
    // below therefore lock in "the warm index was reused, not re-read from disk".

    test('a new save updates the warm index in place without a full re-read', async () => {
      const config = getTestConfig();
      await saveToTemp(config, 'Alpha', 'https://a.example', 'body a');
      const a1 = findByUrl(config, 'https://a.example');
      expect(a1).not.toBeNull();

      await saveToTemp(config, 'Beta', 'https://b.example', 'body b');

      // Same object reference => the warm index was reused, not rebuilt.
      expect(findByUrl(config, 'https://a.example')).toBe(a1);
      const beta = findByUrl(config, 'https://b.example');
      expect(beta).not.toBeNull();
      expect(beta?.title).toBe('Beta');
      expect(beta?.url).toBe('https://b.example');
    });

    test('many saves accumulate correctly in the warm index', async () => {
      const config = getTestConfig();
      await saveToTemp(config, 'First', 'https://1.example', 'b1');
      const first = findByUrl(config, 'https://1.example'); // warm the index

      for (let i = 2; i <= 6; i++) {
        await saveToTemp(config, `Title ${i}`, `https://${i}.example`, `body ${i}`);
      }

      // Every accumulated save is visible, and the first entry kept its identity.
      for (let i = 1; i <= 6; i++) {
        const found = findByUrl(config, `https://${i}.example`);
        expect(found).not.toBeNull();
        expect(found?.title).toBe(i === 1 ? 'First' : `Title ${i}`);
      }
      expect(findByUrl(config, 'https://1.example')).toBe(first);
    });

    test('refetch updates the existing entry in place, preserving refId/url/filepath', async () => {
      const config = getTestConfig();
      await saveToTemp(config, 'Old Title', 'https://refetch.example', 'old body', 'old query');
      const before = findByUrl(config, 'https://refetch.example');
      expect(before).not.toBeNull();
      expect(before?.title).toBe('Old Title');
      expect(before?.query).toBe('old query');

      const result = await saveToTemp(
        config,
        'New Title',
        'https://refetch.example',
        'new body that is longer',
        'new query',
        true
      );

      // refId/filepath are preserved across a refetch.
      expect(result.refId).toBe(before!.refId);
      expect(result.filepath).toBe(before!.filepath);

      const after = findByUrl(config, 'https://refetch.example');
      // Same object reference => the warm entry was updated in place, not rebuilt.
      expect(after).toBe(before);
      expect(after?.title).toBe('New Title');
      expect(after?.query).toBe('new query');
      expect(after?.url).toBe('https://refetch.example');
      // The warmed size matches a fresh disk read.
      const fresh = listCached(config).references.find((r) => r.refId === after!.refId);
      expect(fresh).toBeDefined();
      expect(after?.size).toBe(fresh!.size);

      // Disk was actually rewritten (not just the in-memory entry).
      const disk = readFileSync(result.filepath, 'utf-8');
      expect(disk).toContain('New Title');
      expect(disk).not.toContain('Old Title');
    });

    test('delete removes the entry from the warm index in place', async () => {
      const config = getTestConfig();
      await saveToTemp(config, 'Alpha', 'https://a.example', 'body a');
      await saveToTemp(config, 'Beta', 'https://b.example', 'body b');
      const a1 = findByUrl(config, 'https://a.example'); // warm with both
      expect(findByUrl(config, 'https://b.example')).not.toBeNull();

      const result = deleteCached(config, 'beta');
      expect(result.success).toBe(true);

      expect(findByUrl(config, 'https://b.example')).toBeNull();
      // Alpha is still served from the same warm index (no rebuild).
      expect(findByUrl(config, 'https://a.example')).toBe(a1);
    });

    test('promote removes the temp entry from the warm index in place', async () => {
      const config = getTestConfig();
      await saveToTemp(config, 'Alpha', 'https://a.example', 'body a');
      await saveToTemp(config, 'Beta', 'https://b.example', 'body b');
      const a1 = findByUrl(config, 'https://a.example'); // warm with both
      expect(findByUrl(config, 'https://b.example')).not.toBeNull();

      const result = promoteReference(config, 'beta');
      expect(result.success).toBe(true);

      // Promoted ref is gone from the temp-tier index...
      expect(findByUrl(config, 'https://b.example')).toBeNull();
      expect(findCached(config, 'beta')).toBeNull();
      // ...while the untouched ref keeps its identity (warm, not rebuilt).
      expect(findByUrl(config, 'https://a.example')).toBe(a1);
    });

    test('a mixed save/refetch/delete/promote sequence stays consistent', async () => {
      const config = getTestConfig();
      await saveToTemp(config, 'Alpha', 'https://a.example', 'body a');
      await saveToTemp(config, 'Beta', 'https://b.example', 'body b');
      await saveToTemp(config, 'Gamma', 'https://c.example', 'body c');
      findByUrl(config, 'https://a.example'); // warm

      // refetch Beta
      await saveToTemp(config, 'Beta Updated', 'https://b.example', 'body b v2', undefined, true);
      expect(findByUrl(config, 'https://b.example')?.title).toBe('Beta Updated');

      // delete Gamma
      deleteCached(config, 'gamma');
      expect(findByUrl(config, 'https://c.example')).toBeNull();

      // promote Alpha out of the temp tier
      promoteReference(config, 'alpha');
      expect(findByUrl(config, 'https://a.example')).toBeNull();

      // Only the refetched Beta remains in the temp index.
      expect(findByUrl(config, 'https://b.example')?.title).toBe('Beta Updated');
      expect(listCached(config).references.length).toBe(1);
    });

    test('warm index still detects an externally added file', async () => {
      const config = getTestConfig();
      await saveToTemp(config, 'Alpha', 'https://a.example', 'body a');
      findByUrl(config, 'https://a.example'); // warm

      // An external process adds a reference the cache never observed.
      writeFileSync(
        join(TEST_DIR, 'external.md'),
        '---\ntitle: "External"\nsource_url: "https://external.example"\nfetched_date: 2026-07-11\ntype: web\nstatus: temporary\n---\n\nexternal body\n',
        'utf-8'
      );

      const found = findByUrl(config, 'https://external.example');
      expect(found).not.toBeNull();
      expect(found?.title).toBe('External');
    });

    test('warm index still detects an externally deleted file', async () => {
      const config = getTestConfig();
      const saved = await saveToTemp(config, 'Alpha', 'https://a.example', 'body a');
      findByUrl(config, 'https://a.example'); // warm

      unlinkSync(saved.filepath);

      expect(findByUrl(config, 'https://a.example')).toBeNull();
    });

    test('warm index still detects an externally modified file (size change)', async () => {
      const config = getTestConfig();
      const saved = await saveToTemp(config, 'Original Title', 'https://a.example', 'body a');
      findByUrl(config, 'https://a.example'); // warm, title 'Original Title'

      // External rewrite with a different title AND size => signature changes.
      writeFileSync(
        saved.filepath,
        '---\ntitle: "Hacked Title"\nsource_url: "https://a.example"\nfetched_date: 2026-07-11\ntype: web\nstatus: temporary\n---\n\ncompletely different and longer body content\n',
        'utf-8'
      );

      expect(findByUrl(config, 'https://a.example')?.title).toBe('Hacked Title');
    });

    test('whole-directory removal invalidates the warm index (no ghost resurrection)', async () => {
      const config = getTestConfig();
      await saveToTemp(config, 'Alpha', 'https://a.example', 'body a');
      await saveToTemp(config, 'Beta', 'https://b.example', 'body b');
      findByUrl(config, 'https://a.example'); // warm with both
      expect(findByUrl(config, 'https://b.example')).not.toBeNull();

      // External wipe of the entire temp tier.
      rmSync(TEST_DIR, { recursive: true });

      // Reads reflect the empty directory...
      expect(findByUrl(config, 'https://a.example')).toBeNull();
      expect(findByUrl(config, 'https://b.example')).toBeNull();

      // ...and a fresh save must not resurrect the wiped refs as ghosts.
      await saveToTemp(config, 'Gamma', 'https://c.example', 'body c');
      expect(findByUrl(config, 'https://a.example')).toBeNull();
      expect(findByUrl(config, 'https://b.example')).toBeNull();
      const gamma = findByUrl(config, 'https://c.example');
      expect(gamma).not.toBeNull();
      expect(gamma?.title).toBe('Gamma');
    });
  });
});
