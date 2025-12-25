import { describe, expect, test } from "bun:test";
import { FetchiConfigSchema } from "../../src/config/schema.js";
import { DEFAULT_CONFIG } from "../../src/config/defaults.js";

describe("FetchiConfigSchema", () => {
  test("validates default config", () => {
    const result = FetchiConfigSchema.safeParse(DEFAULT_CONFIG);
    expect(result.success).toBe(true);
  });

  test("applies defaults for empty object", () => {
    const result = FetchiConfigSchema.parse({});
    expect(result.quality.minScore).toBe(60);
    expect(result.quality.jsRetryThreshold).toBe(85);
    expect(result.paths.tempDir).toBe(".tmp");
    expect(result.paths.docsDir).toBe("docs/ai/references");
    expect(result.playwright.mode).toBe("auto");
  });

  test("allows custom quality thresholds", () => {
    const result = FetchiConfigSchema.parse({
      quality: { minScore: 70, jsRetryThreshold: 90 }
    });
    expect(result.quality.minScore).toBe(70);
    expect(result.quality.jsRetryThreshold).toBe(90);
  });

  test("allows custom paths", () => {
    const result = FetchiConfigSchema.parse({
      paths: { tempDir: "cache", docsDir: "docs/refs" }
    });
    expect(result.paths.tempDir).toBe("cache");
    expect(result.paths.docsDir).toBe("docs/refs");
  });

  test("validates playwright modes", () => {
    expect(FetchiConfigSchema.parse({ playwright: { mode: "auto" } }).playwright.mode).toBe("auto");
    expect(FetchiConfigSchema.parse({ playwright: { mode: "local" } }).playwright.mode).toBe("local");
    expect(FetchiConfigSchema.parse({ playwright: { mode: "docker" } }).playwright.mode).toBe("docker");
  });

  test("rejects invalid playwright mode", () => {
    const result = FetchiConfigSchema.safeParse({ playwright: { mode: "invalid" } });
    expect(result.success).toBe(false);
  });

  test("rejects quality score out of range", () => {
    const result = FetchiConfigSchema.safeParse({ quality: { minScore: 150 } });
    expect(result.success).toBe(false);
  });
});
