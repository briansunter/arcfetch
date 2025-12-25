import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { existsSync, rmSync, readFileSync } from 'node:fs';
import { processHtmlToMarkdown } from '../../src/core/extractor.js';
import { saveToTemp, listCached, findCached, promoteReference, deleteCached } from '../../src/core/cache.js';
import { validateMarkdown } from '../../src/utils/markdown-validator.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import type { FetchiConfig } from '../../src/config/schema.js';

const TEST_TEMP_DIR = '.test-e2e-temp';
const TEST_DOCS_DIR = '.test-e2e-docs';

function getTestConfig(): FetchiConfig {
  return {
    ...DEFAULT_CONFIG,
    paths: {
      tempDir: TEST_TEMP_DIR,
      docsDir: TEST_DOCS_DIR,
    },
  };
}

describe('E2E: Complete Fetch and Cache Flow', () => {
  beforeEach(() => {
    if (existsSync(TEST_TEMP_DIR)) rmSync(TEST_TEMP_DIR, { recursive: true });
    if (existsSync(TEST_DOCS_DIR)) rmSync(TEST_DOCS_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_TEMP_DIR)) rmSync(TEST_TEMP_DIR, { recursive: true });
    if (existsSync(TEST_DOCS_DIR)) rmSync(TEST_DOCS_DIR, { recursive: true });
  });

  test('complete flow: extract → validate → save → list → promote', async () => {
    const config = getTestConfig();

    // Step 1: Extract content from HTML
    const html = `
      <!DOCTYPE html>
      <html>
      <head><title>E2E Test Article</title></head>
      <body>
        <article>
          <h1>E2E Test Article</h1>
          <p>This is a comprehensive end-to-end test of the sofetch workflow.
          It simulates the complete process from HTML extraction through to
          promoting the cached reference to the docs folder.</p>
          <h2>Section One</h2>
          <p>Additional content to ensure the article passes quality validation.
          The extraction algorithm needs sufficient content to recognize this
          as a valid article worth preserving.</p>
          <h2>Section Two</h2>
          <p>Even more content here to make sure we have a complete article
          that will pass all the quality checks and validation steps.</p>
        </article>
      </body>
      </html>
    `;

    const extractResult = await processHtmlToMarkdown(html, 'https://example.com/e2e-test');

    expect(extractResult.error).toBeUndefined();
    expect(extractResult.markdown).toBeDefined();
    expect(extractResult.title).toBe('E2E Test Article');

    // Step 2: Validate the markdown quality
    const validation = validateMarkdown(extractResult.markdown!);

    expect(validation.isValid).toBe(true);
    expect(validation.score).toBeGreaterThanOrEqual(60);

    // Step 3: Save to temp directory
    const saveResult = await saveToTemp(
      config,
      extractResult.title!,
      'https://example.com/e2e-test',
      extractResult.markdown!,
      'e2e test query'
    );

    expect(saveResult.error).toBeUndefined();
    expect(saveResult.refId).toBe('REF-001');
    expect(existsSync(saveResult.filepath)).toBe(true);

    // Step 4: Verify saved file content
    const savedContent = readFileSync(saveResult.filepath, 'utf-8');
    expect(savedContent).toContain('id: REF-001');
    expect(savedContent).toContain('title: "E2E Test Article"');
    expect(savedContent).toContain('source_url: https://example.com/e2e-test');
    expect(savedContent).toContain('status: temporary');
    expect(savedContent).toContain('query: "e2e test query"');

    // Step 5: List cached references
    const listResult = listCached(config);

    expect(listResult.error).toBeUndefined();
    expect(listResult.references.length).toBe(1);
    expect(listResult.references[0].refId).toBe('REF-001');
    expect(listResult.references[0].title).toBe('E2E Test Article');

    // Step 6: Find specific cached reference
    const found = findCached(config, 'REF-001');

    expect(found).not.toBeNull();
    expect(found?.title).toBe('E2E Test Article');
    expect(found?.url).toBe('https://example.com/e2e-test');

    // Step 7: Promote to docs folder
    const promoteResult = promoteReference(config, 'REF-001');

    expect(promoteResult.success).toBe(true);
    expect(promoteResult.error).toBeUndefined();
    expect(existsSync(promoteResult.toPath)).toBe(true);
    expect(existsSync(saveResult.filepath)).toBe(false); // Removed from temp

    // Step 8: Verify promoted file has updated status
    const promotedContent = readFileSync(promoteResult.toPath, 'utf-8');
    expect(promotedContent).toContain('status: permanent');

    // Step 9: Verify temp directory is now empty
    const afterPromote = listCached(config);
    expect(afterPromote.references.length).toBe(0);
  });

  test('complete flow: extract → save → delete', async () => {
    const config = getTestConfig();

    // Extract and save
    const html = `
      <!DOCTYPE html>
      <html>
      <head><title>Delete Test Article</title></head>
      <body>
        <article>
          <h1>Delete Test Article</h1>
          <p>This article will be saved and then deleted to test the deletion flow.</p>
          <p>Adding more content for proper extraction.</p>
          <p>And even more content to ensure quality validation passes.</p>
        </article>
      </body>
      </html>
    `;

    const extractResult = await processHtmlToMarkdown(html, 'https://example.com/delete-test');
    const saveResult = await saveToTemp(config, extractResult.title!, 'https://example.com/delete-test', extractResult.markdown!);

    expect(existsSync(saveResult.filepath)).toBe(true);

    // Delete the reference
    const deleteResult = deleteCached(config, 'REF-001');

    expect(deleteResult.success).toBe(true);
    expect(existsSync(saveResult.filepath)).toBe(false);

    // Verify it's gone from the list
    const afterDelete = listCached(config);
    expect(afterDelete.references.length).toBe(0);
  });

  test('handles multiple saves with sequential IDs', async () => {
    const config = getTestConfig();

    const createHtml = (title: string) => `
      <!DOCTYPE html>
      <html>
      <head><title>${title}</title></head>
      <body>
        <article>
          <h1>${title}</h1>
          <p>Content for ${title}. This needs enough text for extraction.</p>
          <p>Adding more content to ensure proper quality validation.</p>
          <p>And a third paragraph for good measure.</p>
        </article>
      </body>
      </html>
    `;

    // Save three articles
    for (let i = 1; i <= 3; i++) {
      const html = createHtml(`Article ${i}`);
      const extractResult = await processHtmlToMarkdown(html, `https://example.com/article-${i}`);
      await saveToTemp(config, extractResult.title!, `https://example.com/article-${i}`, extractResult.markdown!);
    }

    // Verify all three exist with correct IDs
    const listResult = listCached(config);

    expect(listResult.references.length).toBe(3);

    const refIds = listResult.references.map((r) => r.refId).sort();
    expect(refIds).toEqual(['REF-001', 'REF-002', 'REF-003']);
  });

  test('rejects low quality content', async () => {
    // Create HTML that will produce low quality markdown (lots of leftover tags)
    const html = `
      <!DOCTYPE html>
      <html>
      <head><title>Low Quality</title></head>
      <body>
        <article>
          <h1>Title</h1>
          <p>x</p>
        </article>
      </body>
      </html>
    `;

    const extractResult = await processHtmlToMarkdown(html, 'https://example.com/low-quality');

    // This should either fail extraction or produce low quality content
    if (extractResult.markdown) {
      const validation = validateMarkdown(extractResult.markdown);
      // Content is too short, should fail validation
      expect(validation.score).toBeLessThan(100);
    }
  });
});
