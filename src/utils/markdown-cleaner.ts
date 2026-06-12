/**
 * Markdown Cleaning Utilities
 *
 * Post-processing functions to clean and optimize markdown for LLM context efficiency
 */

/**
 * Mask fenced code blocks and inline code spans with placeholder tokens so that
 * downstream regex passes cannot corrupt code content.
 *
 * Placeholder format:  CODE{n}
 *  is a Unicode private-use character that never appears in normal text or
 * markdown syntax, so none of the existing regexes will touch it.
 *
 * Masking order:
 *   1. Fenced blocks first (``` or ~~~) – prevents fence delimiters from being
 *      matched again by the inline-code pass.
 *   2. Inline code spans second (handles multi-backtick delimiters like `` ` ``).
 */
function maskCode(text: string): { masked: string; tokens: string[] } {
  const tokens: string[] = [];

  const placeholder = (i: number) => `CODE${i}`;

  // 1. Fenced code blocks: ``` or ~~~, optional info string on opening fence.
  //    The regex captures: opening fence chars + optional info + newline + body + closing fence.
  let masked = text.replace(/^(`{3,}|~{3,})(.*)\n([\s\S]*?)^\1\s*$/gm, (_match) => {
    const idx = tokens.length;
    tokens.push(_match);
    return placeholder(idx);
  });

  // 2. Inline code spans: backtick run of 1-N backticks, content, same run to close.
  //    Process longest runs first to correctly handle `` `foo` `` style.
  masked = masked.replace(/(`{2,})([\s\S]*?)\1|`([^`\n]+)`/g, (_match) => {
    const idx = tokens.length;
    tokens.push(_match);
    return placeholder(idx);
  });

  return { masked, tokens };
}

function restoreCode(text: string, tokens: string[]): string {
  let restored = text;
  for (let i = tokens.length - 1; i >= 0; i--) {
    restored = restored.replace(`CODE${i}`, tokens[i]);
  }
  return restored;
}

function cleanMarkdown(markdown: string): string {
  if (!markdown.trim()) {
    return markdown;
  }

  let cleaned = markdown;

  cleaned = cleaned.replace(/\r\n/g, '\n');
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  cleaned = cleaned.replace(/[ \t]+$/gm, '');
  cleaned = cleaned.trim();
  cleaned = cleaned.replace(/([^\n])\n(#{1,6} )/g, '$1\n\n$2');
  cleaned = cleaned.replace(/(#{1,6} .+)\n([^#\n])/g, '$1\n\n$2');
  cleaned = cleaned.replace(/([^\n])\n([-*+] |\d+\. )/g, '$1\n\n$2');
  cleaned = cleaned.replace(/(\*|_) +/g, '$1');
  cleaned = cleaned.replace(/ +(\*|_)/g, '$1');
  cleaned = cleaned.replace(/([^\n])\n```/g, '$1\n\n```');
  cleaned = cleaned.replace(/```\n([^`])/g, '```\n\n$1');
  cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, ' ');
  cleaned = cleaned.replace(/ {2,}/g, ' ');

  return cleaned;
}

function advancedClean(markdown: string): string {
  let cleaned = markdown;

  cleaned = cleaned.replace(/\[([^\]]+)\]\(\)/g, '$1');
  cleaned = cleaned.replace(/<[^>]+>/g, '');
  cleaned = cleaned.replace(/\*\*\*\*/g, '');
  cleaned = cleaned.replace(/(?<!\*)\*\*(?!\*)/g, '');
  cleaned = cleaned.replace(/__/g, '');
  cleaned = cleaned.replace(/!\[\]\(([^)]+)\)/g, '![]($1)');
  cleaned = cleaned.replace(/[\u200B-\u200D\uFEFF]/g, '');
  cleaned = cleaned.replace(/[\u201C\u201D]/g, '"');
  cleaned = cleaned.replace(/[\u2018\u2019]/g, "'");
  cleaned = cleaned.replace(/[\u2013\u2014]/g, '-');

  cleaned = cleaned.replace(/^(?!```)[^\n]*$/gm, (line) => {
    return line.replace(/ {2,}/g, ' ');
  });

  return cleaned;
}

function finalCleanup(markdown: string): string {
  if (!markdown.trim()) {
    return markdown;
  }

  let cleaned = markdown;

  cleaned = cleaned.replace(/^(\s*)[*+] /gm, '$1- ');
  cleaned = cleaned.replace(/_([^_]+)_/g, '*$1*');
  cleaned = cleaned.replace(/^~~~(\w*)\n/gm, '```$1\n');
  cleaned = cleaned.replace(/^~~~$/gm, '```');
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  cleaned = `${cleaned.trim()}\n`;

  return cleaned;
}

export function cleanMarkdownComplete(markdown: string): string {
  if (!markdown.trim()) {
    return markdown;
  }

  // Inject blank lines around fenced-block delimiters BEFORE masking so the
  // structural spacing rules fire on the real fence markers.  These rules only
  // touch the delimiter lines themselves, not the code content inside.
  let preProcessed = markdown;
  preProcessed = preProcessed.replace(/([^\n])\n```/g, '$1\n\n```');
  preProcessed = preProcessed.replace(/```\n([^`])/g, '```\n\n$1');

  const { masked, tokens } = maskCode(preProcessed);

  let cleaned = cleanMarkdown(masked);
  cleaned = advancedClean(cleaned);
  cleaned = finalCleanup(cleaned);

  return restoreCode(cleaned, tokens);
}
