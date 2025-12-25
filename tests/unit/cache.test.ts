import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { 
  getNextRefId, 
  saveToTemp, 
  listCached, 
  findCached,
  promoteReference,
  deleteCached 
} from "../../src/core/cache.js";
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

  describe("getNextRefId", () => {
    test("returns REF-001 for empty directory", () => {
      expect(getNextRefId(TEST_DIR)).toBe("REF-001");
    });

    test("returns REF-001 for non-existent directory", () => {
      expect(getNextRefId("/non/existent/path")).toBe("REF-001");
    });

    test("increments ID based on existing files", () => {
      mkdirSync(TEST_DIR, { recursive: true });
      writeFileSync(join(TEST_DIR, "REF-001-test.md"), "content");
      writeFileSync(join(TEST_DIR, "REF-002-test.md"), "content");
      expect(getNextRefId(TEST_DIR)).toBe("REF-003");
    });
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
      expect(result.refId).toBe("REF-001");
      expect(existsSync(result.filepath)).toBe(true);
    });

    test("generates sequential IDs", async () => {
      const config = getTestConfig();
      
      const result1 = await saveToTemp(config, "Article 1", "https://a.com", "content");
      const result2 = await saveToTemp(config, "Article 2", "https://b.com", "content");
      
      expect(result1.refId).toBe("REF-001");
      expect(result2.refId).toBe("REF-002");
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
      expect(result.references[0].refId).toBe("REF-002"); // Newest first
      expect(result.references[1].refId).toBe("REF-001");
    });
  });

  describe("findCached", () => {
    test("finds existing reference", async () => {
      const config = getTestConfig();
      await saveToTemp(config, "Test Article", "https://example.com", "content");

      const found = findCached(config, "REF-001");
      expect(found).not.toBeNull();
      expect(found?.title).toBe("Test Article");
    });

    test("returns null for non-existent reference", () => {
      const config = getTestConfig();
      const found = findCached(config, "REF-999");
      expect(found).toBeNull();
    });
  });

  describe("promoteReference", () => {
    test("moves file from temp to docs", async () => {
      const config = getTestConfig();
      const saved = await saveToTemp(config, "Test Article", "https://example.com", "content");

      const result = promoteReference(config, "REF-001");
      
      expect(result.success).toBe(true);
      expect(existsSync(saved.filepath)).toBe(false); // Removed from temp
      expect(existsSync(result.toPath)).toBe(true); // Added to docs
    });

    test("fails for non-existent reference", () => {
      const config = getTestConfig();
      const result = promoteReference(config, "REF-999");
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  describe("deleteCached", () => {
    test("deletes existing reference", async () => {
      const config = getTestConfig();
      const saved = await saveToTemp(config, "Test Article", "https://example.com", "content");

      const result = deleteCached(config, "REF-001");
      
      expect(result.success).toBe(true);
      expect(existsSync(saved.filepath)).toBe(false);
    });

    test("fails for non-existent reference", () => {
      const config = getTestConfig();
      const result = deleteCached(config, "REF-999");
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });
});
