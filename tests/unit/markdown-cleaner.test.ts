#!/usr/bin/env bun
import { describe, expect, test } from 'bun:test';
import { cleanMarkdownComplete } from '../../src/utils/markdown-cleaner.js';

describe('cleanMarkdownComplete: whitespace and newlines', () => {
  test('collapses excessive newlines to at most a blank line', () => {
    const result = cleanMarkdownComplete('Line 1\n\n\n\nLine 2\n\n\n\n\nLine 3');
    expect(result).not.toContain('\n\n\n');
    expect(result).toContain('Line 1');
    expect(result).toContain('Line 2');
    expect(result).toContain('Line 3');
  });

  test('strips trailing whitespace from lines', () => {
    const result = cleanMarkdownComplete('Line 1   \nLine 2\t\t\nLine 3  ');
    expect(result).not.toMatch(/Line 1[ \t]+\n/);
    expect(result).not.toMatch(/Line 2[ \t]+\n/);
    expect(result).not.toMatch(/Line 3[ \t]+\n?$/m);
  });

  test('inserts a blank line before headers', () => {
    const result = cleanMarkdownComplete('Text before\n# Header\nText after');
    expect(result).toContain('\n\n# Header');
  });

  test('inserts a blank line before lists', () => {
    const result = cleanMarkdownComplete('Text before\n- List item');
    expect(result).toContain('\n\n- List item');
  });

  test('removes HTML comments', () => {
    const result = cleanMarkdownComplete('Text before<!-- comment -->text after');
    expect(result).not.toContain('<!--');
    expect(result).toContain('Text before');
    expect(result).toContain('text after');
  });

  test('inserts blank lines around fenced code blocks', () => {
    const result = cleanMarkdownComplete('Text before\n```\ncode\n```\ntext after');
    expect(result).toContain('\n\n```');
    expect(result).toContain('```\n\n');
  });

  test('normalizes Windows line endings', () => {
    const result = cleanMarkdownComplete('Line 1\r\nLine 2\r\nLine 3');
    expect(result).not.toContain('\r');
    expect(result).toContain('Line 1\nLine 2\nLine 3');
  });
});

describe('cleanMarkdownComplete: link and emphasis cleanup', () => {
  test('strips empty link wrappers, keeping the text', () => {
    const result = cleanMarkdownComplete('This is a [link]() to nowhere');
    expect(result).toContain('This is a link to nowhere');
    expect(result).not.toContain('[link]()');
  });

  test('removes empty bold markers', () => {
    const result = cleanMarkdownComplete('Text with **** empty bold');
    expect(result).toContain('empty bold');
    expect(result).not.toContain('****');
  });
});

describe('cleanMarkdownComplete: character normalization', () => {
  test('removes zero-width characters', () => {
    const result = cleanMarkdownComplete('Text​with‌zero‍width﻿chars');
    expect(result).toContain('Textwithzerowidthchars');
    expect(result).not.toMatch(/[​-‍﻿]/);
  });

  test('normalizes fancy quotes to ASCII', () => {
    const result = cleanMarkdownComplete('“Hello” and ‘world’');
    expect(result).not.toContain('“');
    expect(result).not.toContain('”');
    expect(result).not.toContain('‘');
    expect(result).not.toContain('’');
  });

  test('normalizes en/em dashes to ASCII hyphens', () => {
    const result = cleanMarkdownComplete('en–dash and em—dash');
    expect(result).not.toContain('–');
    expect(result).not.toContain('—');
    expect(result).toContain('en-dash');
    expect(result).toContain('em-dash');
  });

  test('collapses runs of multiple spaces', () => {
    const result = cleanMarkdownComplete('Text  with   multiple    spaces');
    expect(result).toContain('Text with multiple spaces');
    expect(result).not.toMatch(/ {2,}/);
  });
});

describe('cleanMarkdownComplete: full pipeline', () => {
  test('applies all transformations together', () => {
    const input =
      'Text before<!-- comment -->\n\n# Header\n\nParagraph with "fancy quotes" and en-dash.\n\n- List item 1\n- List item 2\n\nText with  multiple   spaces.\n\n```js\ncode\n```\n\nEnd text.';

    const result = cleanMarkdownComplete(input);

    expect(result).not.toContain('<!-- comment -->');
    expect(result).not.toContain('  multiple   spaces');
    expect(result).toContain('# Header');
    expect(result).toContain('- List item');
    expect(result).toContain('```js');
  });

  test('handles real-world messy HTML-to-markdown', () => {
    const input =
      '# Article Title\n\n**Author:** John Doe\n\n\n\nThis is a paragraph with  extra   spaces.\n\n<!-- Navigation menu -->\n<div>Skip to content</div>\n\n## Section 1\n\nText with "fancy quotes" and—dashes.\n\n- Item 1\n- Item 2\n\n```javascript\nconst x = 1;\n```\n\nEnd of article.';

    const result = cleanMarkdownComplete(input);

    expect(result.length).toBeLessThan(input.length);
    expect(result).not.toContain('<!-- Navigation');
    expect(result).not.toContain('<div>');
    expect(result).not.toContain('\n\n\n\n');
    expect(result).toContain('# Article Title');
    expect(result).toContain('## Section 1');
    expect(result).toContain('- Item 1');
  });

  test('removes empty link wrappers in messy real-world input', () => {
    const messyMarkdown =
      '# Article Title\n\n\nThe actual article content is here.  It has  some   spacing issues.\n\n"Fancy quotes" and em—dashes too.\n\n\nRelated Articles:\n- [Article 1]()\n- [Article 2]()';

    const clean = cleanMarkdownComplete(messyMarkdown);

    expect(clean).not.toContain('\n\n\n');
    expect(clean).not.toContain('  some   spacing');
    expect(clean).not.toContain('“');
    expect(clean).not.toContain('—');
    expect(clean).toContain('# Article Title');
    expect(clean).toContain('actual article content');
    expect(clean).not.toContain('[Article 1]()');
  });
});

describe('cleanMarkdownComplete: code protection', () => {
  test('preserves fenced C code with angle-bracket includes and pointer syntax byte-for-byte', () => {
    const input =
      'Before\n\n```c\n#include <stdio.h>\n\nint main() {\n  int *ptr = NULL;\n  return 0;\n}\n```\n\nAfter';
    const result = cleanMarkdownComplete(input);
    expect(result).toContain('#include <stdio.h>');
    expect(result).toContain('int *ptr = NULL;');
    expect(result).toContain('```c\n');
  });

  test('preserves inline code with angle brackets (Array<string>)', () => {
    const input = 'Use `Array<string>` as the type.';
    const result = cleanMarkdownComplete(input);
    expect(result).toContain('`Array<string>`');
  });

  test('preserves inline code with double underscores (__init__)', () => {
    const input = 'Call `__init__` to initialize.';
    const result = cleanMarkdownComplete(input);
    expect(result).toContain('`__init__`');
  });

  test('preserves fenced code block content that contains double-underscores and angle brackets', () => {
    const input = '```python\ndef __init__(self, items: List[str]) -> None:\n    self.__items = items\n```';
    const result = cleanMarkdownComplete(input);
    expect(result).toContain('def __init__');
    expect(result).toContain('List[str]');
    expect(result).toContain('self.__items');
  });

  test('still removes stray HTML tags in prose (regression guard)', () => {
    const input = 'Text before\n\n<div>Skip to content</div>\n\nText after';
    const result = cleanMarkdownComplete(input);
    expect(result).not.toContain('<div>');
    expect(result).not.toContain('</div>');
    expect(result).toContain('Text before');
    expect(result).toContain('Text after');
  });
});

describe('cleanMarkdownComplete: edge cases', () => {
  test('returns empty string unchanged', () => {
    const result = cleanMarkdownComplete('');
    expect(result).toBe('');
  });

  test('handles whitespace-only input', () => {
    const result = cleanMarkdownComplete('   \n\n  \t\t  \n\n  ');
    expect(result.trim()).toBe('');
  });

  test('passes through already-clean markdown', () => {
    const input = '# Clean Markdown\n\nThis is already clean.';
    const result = cleanMarkdownComplete(input);
    expect(result).toContain('# Clean Markdown');
    expect(result).toContain('This is already clean.');
  });

  test('preserves inline code', () => {
    const input = 'Use `const` instead of `var` in JavaScript.';
    const result = cleanMarkdownComplete(input);
    expect(result).toContain('`const`');
    expect(result).toContain('`var`');
  });

  test('preserves tables', () => {
    const input = '| Header 1 | Header 2 |\n| -------- | -------- |\n| Cell 1   | Cell 2   |';
    const result = cleanMarkdownComplete(input);
    expect(result).toContain('Header 1');
    expect(result).toContain('Cell 1');
  });

  test('preserves images', () => {
    const input = '![Alt text](https://example.com/image.jpg)';
    const result = cleanMarkdownComplete(input);
    expect(result).toContain('![Alt text]');
    expect(result).toContain('(https://example.com/image.jpg)');
  });
});
