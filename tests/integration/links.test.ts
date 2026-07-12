import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '../../src/config/defaults';
import type { ArcfetchConfig } from '../../src/config/schema';
import { extractLinksFromCached } from '../../src/core/cache';

const TEST_TEMP_DIR = '.test-links-temp';
const TEST_DOCS_DIR = '.test-links-docs';

function getTestConfig(): ArcfetchConfig {
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

    createTestFile(
      'article-with-links.md',
      `---
title: "Article with Links"
source_url: "https://example.com/article"
fetched_date: 2025-12-28
type: web
status: temporary
---

# Article with Links

Check out [Google](https://google.com) and [GitHub](https://github.com).
Also visit [MDN](https://developer.mozilla.org) for docs.
`
    );

    const result = extractLinksFromCached(config, 'article-with-links');

    expect(result.error).toBeUndefined();
    expect(result.count).toBe(3);
    expect(result.links[0]).toEqual({ text: 'Google', href: 'https://google.com' });
    expect(result.links[1]).toEqual({ text: 'GitHub', href: 'https://github.com' });
    expect(result.links[2]).toEqual({ text: 'MDN', href: 'https://developer.mozilla.org' });
  });

  test('ignores non-http schemes but resolves relative links against the source URL', () => {
    const config = getTestConfig();

    createTestFile(
      'mixed-links.md',
      `---
title: "Mixed Links"
source_url: "https://example.com/mixed"
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
`
    );

    const result = extractLinksFromCached(config, 'mixed-links');

    // mailto/ftp/anchor are still ignored; the relative ./file.md now resolves
    // against the source URL.
    expect(result.count).toBe(2);
    expect(result.links).toEqual([
      { text: 'Local', href: 'https://example.com/file.md' },
      { text: 'Valid', href: 'https://valid.com' },
    ]);
  });

  test('deduplicates links by URL', () => {
    const config = getTestConfig();

    createTestFile(
      'dupe-links.md',
      `---
title: "Duplicate Links"
source_url: "https://example.com/dupes"
fetched_date: 2025-12-28
type: web
status: temporary
---

# Duplicate Links

[First](https://example.com/page)
[Second](https://example.com/page)
[Third](https://example.com/page)
`
    );

    const result = extractLinksFromCached(config, 'dupe-links');

    expect(result.count).toBe(1);
    expect(result.links[0].text).toBe('First');
  });

  test('returns empty array for content without links', () => {
    const config = getTestConfig();

    createTestFile(
      'no-links.md',
      `---
title: "No Links"
source_url: "https://example.com/nolinks"
fetched_date: 2025-12-28
type: web
status: temporary
---

# No Links

Just plain text without any links at all.
`
    );

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

    createTestFile(
      'complex-links.md',
      `---
title: "Complex Links"
source_url: "https://example.com/complex"
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
`
    );

    const result = extractLinksFromCached(config, 'complex-links');

    expect(result.count).toBe(5);
    expect(result.links.map((l) => l.href)).toEqual([
      'https://example.com/a',
      'https://example.com/b',
      'https://example.com/c',
      'https://example.com/d',
      'https://example.com/e',
    ]);
  });

  test('extracts links from http URLs as well as https', () => {
    const config = getTestConfig();

    createTestFile(
      'http-links.md',
      `---
title: "HTTP Links"
source_url: "https://example.com/http"
fetched_date: 2025-12-28
type: web
status: temporary
---

# HTTP Links

[HTTPS Link](https://secure.example.com)
[HTTP Link](http://insecure.example.com)
`
    );

    const result = extractLinksFromCached(config, 'http-links');

    expect(result.count).toBe(2);
    expect(result.links[0].href).toBe('https://secure.example.com');
    expect(result.links[1].href).toBe('http://insecure.example.com');
  });

  test('extracts angle autolinks and bare urls alongside explicit links', () => {
    const config = getTestConfig();

    createTestFile(
      'autolink-article.md',
      `---
title: "Autolink Article"
source_url: "https://example.com/auto"
fetched_date: 2025-12-28
type: web
status: temporary
---

# Autolink Article

Read the [docs](https://example.com/docs) then visit
<https://example.com/angle> or just https://example.com/bare.
`
    );

    const result = extractLinksFromCached(config, 'autolink-article');

    expect(result.error).toBeUndefined();
    expect(result.count).toBe(3);
    expect(result.links).toEqual([
      { text: 'docs', href: 'https://example.com/docs' },
      { text: 'https://example.com/angle', href: 'https://example.com/angle' },
      { text: 'https://example.com/bare', href: 'https://example.com/bare' },
    ]);
  });

  test('preserves link text exactly as written', () => {
    const config = getTestConfig();

    createTestFile(
      'text-preservation.md',
      `---
title: "Text Preservation"
source_url: "https://example.com/text"
fetched_date: 2025-12-28
type: web
status: temporary
---

# Text Preservation

[UPPERCASE TEXT](https://example.com/a)
[lowercase text](https://example.com/b)
[MiXeD CaSe](https://example.com/c)
`
    );

    const result = extractLinksFromCached(config, 'text-preservation');

    expect(result.links[0].text).toBe('UPPERCASE TEXT');
    expect(result.links[1].text).toBe('lowercase text');
    expect(result.links[2].text).toBe('MiXeD CaSe');
  });

  test('resolves reference-style links through the cached-reference path', () => {
    const config = getTestConfig();

    createTestFile(
      'reference-links.md',
      `---
title: "Reference Links"
source_url: "https://example.com/refs"
fetched_date: 2025-12-28
type: web
status: temporary
---

# Reference Links

[docs]: https://example.com/docs
[image]: https://example.com/image.png

See [the docs][docs], [docs][], and [docs].
An inline [real](https://example.com/real) link too.
![pic][image]
`
    );

    const result = extractLinksFromCached(config, 'reference-links');

    expect(result.error).toBeUndefined();
    // First-occurrence order, reference + inline, dedup by href, image ignored,
    // definition URL not harvested as a separate bare link.
    expect(result.links).toEqual([
      { text: 'the docs', href: 'https://example.com/docs' },
      { text: 'real', href: 'https://example.com/real' },
    ]);
  });

  test('resolves relative links against the cached reference source URL', () => {
    const config = getTestConfig();

    createTestFile(
      'relative-links.md',
      `---
title: "Relative Links"
source_url: "https://example.com/blog/post"
fetched_date: 2026-07-11
type: web
status: temporary
---

# Relative Links

See [next](/next) and [related](./related) and [parent](../up).
A query [link](?page=2) and protocol-relative [cdn](//cdn.example.com/x).
An [absolute](https://other.com/a) and a duplicate [dupe](/next).
`
    );

    const result = extractLinksFromCached(config, 'relative-links');

    expect(result.error).toBeUndefined();
    expect(result.links).toEqual([
      { text: 'next', href: 'https://example.com/next' },
      { text: 'related', href: 'https://example.com/blog/related' },
      { text: 'parent', href: 'https://example.com/up' },
      { text: 'link', href: 'https://example.com/blog/post?page=2' },
      { text: 'cdn', href: 'https://cdn.example.com/x' },
      { text: 'absolute', href: 'https://other.com/a' },
    ]);
    // The duplicate [dupe](/next) collapses onto the first [next](/next).
    expect(result.count).toBe(6);
  });

  test('does not resolve relative links when the source URL is malformed', () => {
    const config = getTestConfig();

    createTestFile(
      'malformed-source.md',
      `---
title: "Malformed Source"
source_url: "not-a-valid-url"
fetched_date: 2026-07-11
type: web
status: temporary
---

# Malformed Source

[next](/next) and [absolute](https://keep.com/a)
`
    );

    const result = extractLinksFromCached(config, 'malformed-source');

    expect(result.error).toBeUndefined();
    // Malformed base disables resolution: relative link dropped, absolute kept.
    expect(result.links).toEqual([{ text: 'absolute', href: 'https://keep.com/a' }]);
  });
});
