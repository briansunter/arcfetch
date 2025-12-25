import { describe, expect, test } from "bun:test";
import { processHtmlToMarkdown } from "../../src/core/extractor.js";

describe("processHtmlToMarkdown", () => {
  test("extracts article from simple HTML", async () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head><title>Test Article</title></head>
        <body>
          <article>
            <h1>Test Article</h1>
            <p>This is the article content with enough text to pass the threshold.</p>
            <p>More content here to make it substantial enough for extraction.</p>
            <p>And even more content to ensure we have a proper article.</p>
          </article>
        </body>
      </html>
    `;

    const result = await processHtmlToMarkdown(html, "https://example.com", false);
    
    expect(result.error).toBeUndefined();
    expect(result.title).toBe("Test Article");
    expect(result.markdown).toContain("# Test Article");
    expect(result.markdown).toContain("article content");
  });

  test("returns error for non-article HTML", async () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head><title>Login</title></head>
        <body>
          <form>
            <input type="text" name="username">
            <input type="password" name="password">
            <button>Login</button>
          </form>
        </body>
      </html>
    `;

    const result = await processHtmlToMarkdown(html, "https://example.com", false);
    
    expect(result.error).toBeDefined();
    expect(result.error).toContain("Could not extract");
  });

  test("includes URL in markdown header", async () => {
    const html = `
      <!DOCTYPE html>
      <html>
        <head><title>Test</title></head>
        <body>
          <article>
            <h1>Test</h1>
            <p>Content that is long enough to be extracted properly by readability.</p>
            <p>More paragraphs to make this a substantial article for testing.</p>
          </article>
        </body>
      </html>
    `;

    const result = await processHtmlToMarkdown(html, "https://example.com/article", false);
    
    expect(result.markdown).toContain("https://example.com/article");
  });
});
