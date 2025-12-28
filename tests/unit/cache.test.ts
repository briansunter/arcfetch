import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { rmSync, existsSync } from "node:fs";
import {
  saveToTemp,
  listCached,
  findCached,
  findByUrl,
  promoteReference,
  deleteCached,
  extractLinksFromCached
} from "../../src/core/cache";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";
import type { FetchiConfig } from "../../src/config/schema.js";

const TEST_DIR = ".test-cache";
const TEST_DOCS = ".test-docs";

function getTestConfig(): FetchiConfig {
  return {
    ...DEFAULT_CONFIG,
    paths: {
      tempDir: TEST_DIR,
      docsDir: TEST_DOCS,
    },
  };
}

describe("cache operations", () => {
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

  describe("saveToTemp", () => {
    test("saves content with frontmatter", async () => {
      const config = getTestConfig();
      const result = await saveToTemp(
        config,
        "Test Article",
        "https://example.com",
        "# Content\n\nBody text",
        "test query"
      );

      expect(result.error).toBeUndefined();
      expect(result.refId).toBe("test-article");
      expect(existsSync(result.filepath)).toBe(true);
    });

    test("uses slug-based filenames", async () => {
      const config = getTestConfig();

      const result1 = await saveToTemp(config, "Article One", "https://a.com", "content");
      const result2 = await saveToTemp(config, "Article Two", "https://b.com", "content");

      expect(result1.refId).toBe("article-one");
      expect(result2.refId).toBe("article-two");
    });

    test("returns existing reference if URL already cached", async () => {
      const config = getTestConfig();

      const result1 = await saveToTemp(config, "Original Title", "https://example.com", "content");
      const result2 = await saveToTemp(config, "Different Title", "https://example.com", "new content");

      expect(result2.alreadyExists).toBe(true);
      expect(result2.filepath).toBe(result1.filepath);
    });

    test("refetch updates existing file", async () => {
      const config = getTestConfig();

      const result1 = await saveToTemp(config, "Original", "https://example.com", "old content");
      const result2 = await saveToTemp(config, "Updated", "https://example.com", "new content", undefined, true);

      expect(result2.alreadyExists).toBeUndefined();
      expect(result2.filepath).toBe(result1.filepath); // Same path
    });
  });

  describe("listCached", () => {
    test("returns empty array for empty directory", () => {
      const config = getTestConfig();
      const result = listCached(config);
      expect(result.references).toEqual([]);
      expect(result.error).toBeUndefined();
    });

    test("lists saved references", async () => {
      const config = getTestConfig();
      await saveToTemp(config, "Article 1", "https://a.com", "content 1");
      await saveToTemp(config, "Article 2", "https://b.com", "content 2");

      const result = listCached(config);
      expect(result.references.length).toBe(2);
    });
  });

  describe("findCached", () => {
    test("finds existing reference by slug", async () => {
      const config = getTestConfig();
      await saveToTemp(config, "Test Article", "https://example.com", "content");

      const found = findCached(config, "test-article");
      expect(found).not.toBeNull();
      expect(found?.title).toBe("Test Article");
    });

    test("returns null for non-existent reference", () => {
      const config = getTestConfig();
      const found = findCached(config, "non-existent");
      expect(found).toBeNull();
    });
  });

  describe("findByUrl", () => {
    test("finds existing reference by URL", async () => {
      const config = getTestConfig();
      await saveToTemp(config, "Test Article", "https://example.com/page", "content");

      const found = findByUrl(config, "https://example.com/page");
      expect(found).not.toBeNull();
      expect(found?.title).toBe("Test Article");
    });

    test("returns null for non-existent URL", () => {
      const config = getTestConfig();
      const found = findByUrl(config, "https://not-cached.com");
      expect(found).toBeNull();
    });
  });

  describe("promoteReference", () => {
    test("moves file from temp to docs", async () => {
      const config = getTestConfig();
      const saved = await saveToTemp(config, "Test Article", "https://example.com", "content");

      const result = promoteReference(config, "test-article");

      expect(result.success).toBe(true);
      expect(existsSync(saved.filepath)).toBe(false); // Removed from temp
      expect(existsSync(result.toPath)).toBe(true); // Added to docs
    });

    test("fails for non-existent reference", () => {
      const config = getTestConfig();
      const result = promoteReference(config, "non-existent");
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  describe("deleteCached", () => {
    test("deletes existing reference", async () => {
      const config = getTestConfig();
      const saved = await saveToTemp(config, "Test Article", "https://example.com", "content");

      const result = deleteCached(config, "test-article");

      expect(result.success).toBe(true);
      expect(existsSync(saved.filepath)).toBe(false);
    });

    test("fails for non-existent reference", () => {
      const config = getTestConfig();
      const result = deleteCached(config, "non-existent");
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  describe("extractLinksFromCached", () => {
    test("extracts http/https links from markdown", async () => {
      const config = getTestConfig();
      const content = `# Article

Check out [Google](https://google.com) and [GitHub](https://github.com).

Also see [Docs](http://docs.example.com) for more info.`;

      await saveToTemp(config, "Link Article", "https://example.com", content);

      const result = extractLinksFromCached(config, "link-article");

      expect(result.error).toBeUndefined();
      expect(result.count).toBe(3);
      expect(result.links).toEqual([
        { text: "Google", href: "https://google.com" },
        { text: "GitHub", href: "https://github.com" },
        { text: "Docs", href: "http://docs.example.com" },
      ]);
    });

    test("ignores non-http links", async () => {
      const config = getTestConfig();
      const content = `# Article

[Section](#section-1)
[Email](mailto:test@example.com)
[File](./local-file.md)
[Real Link](https://real.com)`;

      await saveToTemp(config, "Mixed Links", "https://example.com", content);

      const result = extractLinksFromCached(config, "mixed-links");

      expect(result.count).toBe(1);
      expect(result.links[0].href).toBe("https://real.com");
    });

    test("deduplicates links by href", async () => {
      const config = getTestConfig();
      const content = `# Article

[First mention](https://example.com/page)
[Second mention](https://example.com/page)
[Different text](https://example.com/page)`;

      await saveToTemp(config, "Dupe Links", "https://example.com", content);

      const result = extractLinksFromCached(config, "dupe-links");

      expect(result.count).toBe(1);
      expect(result.links[0].text).toBe("First mention"); // Keeps first occurrence
    });

    test("returns empty array for content without links", async () => {
      const config = getTestConfig();
      const content = `# Article

Just plain text without any links.`;

      await saveToTemp(config, "No Links", "https://example.com", content);

      const result = extractLinksFromCached(config, "no-links");

      expect(result.count).toBe(0);
      expect(result.links).toEqual([]);
    });

    test("returns error for non-existent reference", () => {
      const config = getTestConfig();
      const result = extractLinksFromCached(config, "non-existent");

      expect(result.error).toContain("not found");
      expect(result.count).toBe(0);
    });
  });
});
