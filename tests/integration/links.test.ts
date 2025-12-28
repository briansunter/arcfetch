import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { existsSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { extractLinksFromCached } from '../../src/core/cache';
import { DEFAULT_CONFIG } from '../../src/config/defaults';
import type { FetchiConfig } from '../../src/config/schema';

const TEST_TEMP_DIR = '.test-links-temp';
const TEST_DOCS_DIR = '.test-links-docs';

function getTestConfig(): FetchiConfig {
  return {
    ...DEFAULT_CONFIG,
    paths: {
      tempDir: TEST_TEMP_DIR,
      docsDir: TEST_DOCS_DIR,
    },
  };
}

function createTestFile(filename: string, content: string): void {
  mkdirSync(TEST_TEMP_DIR, { recursive: true });
  writeFileSync(join(TEST_TEMP_DIR, filename), content, 'utf-8');
}

describe('Links extraction integration tests', () => {
  beforeEach(() => {
    if (existsSync(TEST_TEMP_DIR)) rmSync(TEST_TEMP_DIR, { recursive: true });
    if (existsSync(TEST_DOCS_DIR)) rmSync(TEST_DOCS_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_TEMP_DIR)) rmSync(TEST_TEMP_DIR, { recursive: true });
    if (existsSync(TEST_DOCS_DIR)) rmSync(TEST_DOCS_DIR, { recursive: true });
  });

  test('extracts multiple links from cached markdown', () => {
    const config = getTestConfig();

    createTestFile('article-with-links.md', `---
title: "Article with Links"
source_url: https://example.com/article
fetched_date: 2025-12-28
type: web
status: temporary
---

# Article with Links

Check out [Google](https://google.com) and [GitHub](https://github.com).
Also visit [MDN](https://developer.mozilla.org) for docs.
`);

    const result = extractLinksFromCached(config, 'article-with-links');

    expect(result.error).toBeUndefined();
    expect(result.count).toBe(3);
    expect(result.links[0]).toEqual({ text: 'Google', href: 'https://google.com' });
    expect(result.links[1]).toEqual({ text: 'GitHub', href: 'https://github.com' });
    expect(result.links[2]).toEqual({ text: 'MDN', href: 'https://developer.mozilla.org' });
  });

  test('ignores non-http links', () => {
    const config = getTestConfig();

    createTestFile('mixed-links.md', `---
title: "Mixed Links"
source_url: https://example.com/mixed
fetched_date: 2025-12-28
type: web
status: temporary
---

# Mixed Links

- [Anchor](#section)
- [Email](mailto:test@example.com)
- [Local](./file.md)
- [FTP](ftp://server.com)
- [Valid](https://valid.com)
`);

    const result = extractLinksFromCached(config, 'mixed-links');

    expect(result.count).toBe(1);
    expect(result.links[0].href).toBe('https://valid.com');
  });

  test('deduplicates links by URL', () => {
    const config = getTestConfig();

    createTestFile('dupe-links.md', `---
title: "Duplicate Links"
source_url: https://example.com/dupes
fetched_date: 2025-12-28
type: web
status: temporary
---

# Duplicate Links

[First](https://example.com/page)
[Second](https://example.com/page)
[Third](https://example.com/page)
`);

    const result = extractLinksFromCached(config, 'dupe-links');

    expect(result.count).toBe(1);
    expect(result.links[0].text).toBe('First');
  });

  test('returns empty array for content without links', () => {
    const config = getTestConfig();

    createTestFile('no-links.md', `---
title: "No Links"
source_url: https://example.com/nolinks
fetched_date: 2025-12-28
type: web
status: temporary
---

# No Links

Just plain text without any links at all.
`);

    const result = extractLinksFromCached(config, 'no-links');

    expect(result.error).toBeUndefined();
    expect(result.count).toBe(0);
    expect(result.links).toEqual([]);
  });

  test('returns error for non-existent reference', () => {
    const config = getTestConfig();
    mkdirSync(TEST_TEMP_DIR, { recursive: true });

    const result = extractLinksFromCached(config, 'non-existent');

    expect(result.error).toContain('not found');
    expect(result.count).toBe(0);
  });

  test('handles markdown with complex link formats', () => {
    const config = getTestConfig();

    createTestFile('complex-links.md', `---
title: "Complex Links"
source_url: https://example.com/complex
fetched_date: 2025-12-28
type: web
status: temporary
---

# Complex Links

[Link with spaces in text](https://example.com/a)
[Link-with-dashes](https://example.com/b)
[Link_with_underscores](https://example.com/c)
[Link (with parens)](https://example.com/d)
[123 Numbers](https://example.com/e)
`);

    const result = extractLinksFromCached(config, 'complex-links');

    expect(result.count).toBe(5);
    expect(result.links.map(l => l.href)).toEqual([
      'https://example.com/a',
      'https://example.com/b',
      'https://example.com/c',
      'https://example.com/d',
      'https://example.com/e',
    ]);
  });

  test('extracts links from http URLs as well as https', () => {
    const config = getTestConfig();

    createTestFile('http-links.md', `---
title: "HTTP Links"
source_url: https://example.com/http
fetched_date: 2025-12-28
type: web
status: temporary
---

# HTTP Links

[HTTPS Link](https://secure.example.com)
[HTTP Link](http://insecure.example.com)
`);

    const result = extractLinksFromCached(config, 'http-links');

    expect(result.count).toBe(2);
    expect(result.links[0].href).toBe('https://secure.example.com');
    expect(result.links[1].href).toBe('http://insecure.example.com');
  });

  test('preserves link text exactly as written', () => {
    const config = getTestConfig();

    createTestFile('text-preservation.md', `---
title: "Text Preservation"
source_url: https://example.com/text
fetched_date: 2025-12-28
type: web
status: temporary
---

# Text Preservation

[UPPERCASE TEXT](https://example.com/a)
[lowercase text](https://example.com/b)
[MiXeD CaSe](https://example.com/c)
`);

    const result = extractLinksFromCached(config, 'text-preservation');

    expect(result.links[0].text).toBe('UPPERCASE TEXT');
    expect(result.links[1].text).toBe('lowercase text');
    expect(result.links[2].text).toBe('MiXeD CaSe');
  });
});
