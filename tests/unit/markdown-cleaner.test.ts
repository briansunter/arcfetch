#!/usr/bin/env bun
import { describe, expect, test } from "bun:test";
import { cleanMarkdown, advancedClean, cleanMarkdownComplete } from "../../src/utils/markdown-cleaner.js";

describe("cleanMarkdown", () => {
  test("removes excessive newlines", () => {
    const input = "Line 1\n\n\n\nLine 2\n\n\n\n\nLine 3";
    const expected = "Line 1\n\nLine 2\n\nLine 3";
    expect(cleanMarkdown(input)).toBe(expected);
  });

  test("removes trailing whitespace from lines", () => {
    const input = "Line 1   \nLine 2\t\t\nLine 3  ";
    const expected = "Line 1\nLine 2\nLine 3";
    expect(cleanMarkdown(input)).toBe(expected);
  });

  test("fixes spacing around headers", () => {
    const input = "Text before\n# Header\nText after";
    const result = cleanMarkdown(input);
    expect(result).toContain("\n\n# Header\n\n");
  });

  test("fixes spacing before lists", () => {
    const input = "Text before\n- List item";
    const result = cleanMarkdown(input);
    expect(result).toContain("\n\n- List item");
  });

  test("removes HTML comments", () => {
    const input = "Text before<!-- comment -->text after";
    const expected = "Text before text after";
    expect(cleanMarkdown(input)).toBe(expected);
  });

  test("fixes code block spacing", () => {
    const input = "Text before\n```\ncode\n```\ntext after";
    const result = cleanMarkdown(input);
    expect(result).toContain("\n\n```\n\ncode\n\n```\n\n");
  });

  test("normalizes line endings", () => {
    const input = "Line 1\r\nLine 2\r\nLine 3";
    const expected = "Line 1\nLine 2\nLine 3";
    expect(cleanMarkdown(input)).toBe(expected);
  });
});

describe("advancedClean", () => {
  test("removes empty links", () => {
    const input = "This is a [link]() to nowhere";
    const expected = "This is a link to nowhere";
    expect(advancedClean(input)).toBe(expected);
  });

  test("removes empty bold markers", () => {
    const input = "Text with **** empty bold";
    const expected = "Text with empty bold";
    expect(advancedClean(input)).toBe(expected);
  });

  test("removes zero-width characters", () => {
    const input = "Text\u200Bwith\u200Czero\u200Dwidth\uFEFFchars";
    const expected = "Textwithzerowidthchars";
    expect(advancedClean(input)).toBe(expected);
  });

  test("normalizes fancy quotes", () => {
    const input = "\u201CHello\u201D and \u2018world\u2019";
    const result = advancedClean(input);
    expect(result).not.toContain("\u201C");
    expect(result).not.toContain("\u201D");
    expect(result).not.toContain("\u2018");
    expect(result).not.toContain("\u2019");
  });

  test("normalizes dashes", () => {
    const input = "en–dash and em—dash";
    const expected = "en-dash and em-dash";
    expect(advancedClean(input)).toBe(expected);
  });

  test("removes multiple spaces", () => {
    const input = "Text  with   multiple    spaces";
    const expected = "Text with multiple spaces";
    expect(advancedClean(input)).toBe(expected);
  });
});

describe("cleanMarkdownComplete", () => {
  test("applies full pipeline", () => {
    const input = "Text before<!-- comment -->\n\n# Header\n\nParagraph with \"fancy quotes\" and en-dash.\n\n- List item 1\n- List item 2\n\nText with  multiple   spaces.\n\n```js\ncode\n```\n\nEnd text.";

    const result = cleanMarkdownComplete(input);

    expect(result).not.toContain("<!-- comment -->");
    expect(result).not.toContain("  multiple   spaces");
    expect(result).toContain("# Header");
    expect(result).toContain("- List item");
    expect(result).toContain("```js");
  });

  test("handles real-world messy HTML-to-markdown", () => {
    const input = "# Article Title\n\n**Author:** John Doe\n\n\n\nThis is a paragraph with  extra   spaces.\n\n<!-- Navigation menu -->\n<div>Skip to content</div>\n\n## Section 1\n\nText with \"fancy quotes\" and—dashes.\n\n- Item 1\n- Item 2\n\n```javascript\nconst x = 1;\n```\n\nEnd of article.";

    const result = cleanMarkdownComplete(input);

    expect(result.length).toBeLessThan(input.length);
    expect(result).not.toContain("<!-- Navigation");
    expect(result).not.toContain("<div>");
    expect(result).not.toContain("\n\n\n\n");
    expect(result).toContain("# Article Title");
    expect(result).toContain("## Section 1");
    expect(result).toContain("- Item 1");
  });

  test("token reduction: normalizes formatting", () => {
    const messyMarkdown = "# Article Title\n\n\nThe actual article content is here.  It has  some   spacing issues.\n\n\"Fancy quotes\" and em—dashes too.\n\n\nRelated Articles:\n- [Article 1]()\n- [Article 2]()";

    const clean = cleanMarkdownComplete(messyMarkdown);

    expect(clean).not.toContain("\n\n\n");
    expect(clean).not.toContain("  some   spacing");
    expect(clean).not.toContain("\u201C");
    expect(clean).not.toContain("\u2014");
    expect(clean).toContain("# Article Title");
    expect(clean).toContain("actual article content");
    expect(clean).not.toContain("[Article 1]()");
  });
});

describe("edge cases", () => {
  test("handles empty string", () => {
    const result = cleanMarkdownComplete("");
    expect(result).toBe("");
  });

  test("handles string with only whitespace", () => {
    const result = cleanMarkdownComplete("   \n\n  \t\t  \n\n  ");
    expect(result.trim()).toBe("");
  });

  test("handles markdown without issues", () => {
    const input = "# Clean Markdown\n\nThis is already clean.";
    const result = cleanMarkdownComplete(input);
    expect(result).toContain("# Clean Markdown");
    expect(result).toContain("This is already clean.");
  });

  test("preserves inline code", () => {
    const input = "Use `const` instead of `var` in JavaScript.";
    const result = cleanMarkdownComplete(input);
    expect(result).toContain("`const`");
    expect(result).toContain("`var`");
  });

  test("preserves tables", () => {
    const input = "| Header 1 | Header 2 |\n| -------- | -------- |\n| Cell 1   | Cell 2   |";

    const result = cleanMarkdownComplete(input);
    expect(result).toContain("Header 1");
    expect(result).toContain("Cell 1");
  });

  test("preserves images", () => {
    const input = "![Alt text](https://example.com/image.jpg)";
    const result = cleanMarkdownComplete(input);
    expect(result).toContain("![Alt text]");
    expect(result).toContain("(https://example.com/image.jpg)");
  });
});
