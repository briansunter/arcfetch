export interface ExtractedLink {
  text: string;
  href: string;
}

// Trailing prose punctuation stripped from a bare URL. Closing delimiters
// (')' and ']') are handled separately via balance checks so balanced
// parentheses and brackets inside a URL are preserved.
const BARE_URL_TRAILING_PUNCTUATION = new Set(['.', ',', ';', ':', '!', '?', "'", '"']);

function isAlphanumeric(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z0-9]/.test(char);
}

function isAbsoluteHttpUrl(href: string): boolean {
  try {
    const parsedUrl = new URL(href);
    return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:';
  } catch {
    return false;
  }
}

// Parses the optional base URL once. Only a valid absolute http/https URL enables
// relative-link resolution; an omitted, malformed, or non-HTTP base leaves the
// parser absolute-http(s)-only (its historical behavior).
function parseBaseUrl(base: string | undefined): URL | null {
  if (!base) {
    return null;
  }
  try {
    const parsed = new URL(base);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed : null;
  } catch {
    return null;
  }
}

// Resolves a link destination to an http/https href, or null when it must be
// dropped. An already-absolute http/https destination is returned verbatim (never
// rewritten), preserving existing absolute hrefs. With a base, a relative
// destination is resolved via `new URL(href, base)` and only an http/https result
// is accepted; fragment-only links and malformed or non-HTTP destinations are
// rejected. Without a base, only absolute http/https destinations survive. Bare
// prose URLs and angle autolinks reach here only as already-absolute http/https
// values, so they stay absolute-only.
function resolveHref(href: string, base: URL | null): string | null {
  if (isAbsoluteHttpUrl(href)) {
    return href;
  }
  if (base === null) {
    return null;
  }
  // Fragment-only destinations (#section) are never crawled, even with a base.
  if (href.trim().startsWith('#')) {
    return null;
  }
  try {
    const resolved = new URL(href, base);
    return resolved.protocol === 'http:' || resolved.protocol === 'https:' ? resolved.href : null;
  } catch {
    return null;
  }
}

// Canonical HTTP(S) identity used ONLY for deduplication. Mirrors cacheUrlIdentity
// (src/core/cache.ts): parse with the WHATWG URL parser, drop the fragment, and
// return the canonical string. The parser normalizes host case, default ports
// (:80/:443), and an empty path to "/", so equivalent spellings collapse to one
// identity; it leaves query ordering, path case, and distinct paths intact, so
// those remain distinct. Non-HTTP(S) and unparseable values fall back to the
// raw string.
//
// This is deliberately separate from the emitted href. The output keeps the first
// occurrence's href exactly as resolveHref produced it (verbatim for an absolute
// destination, resolved-with-base for a relative one) and is never rewritten to
// this canonical form — the identity exists solely to decide whether a later link
// is a duplicate of one already emitted.
function httpUrlIdentity(href: string): string {
  try {
    const parsed = new URL(href);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return href;
    }
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return href;
  }
}

export function extractLinksFromMarkdown(content: string, base?: string): ExtractedLink[] {
  const baseUrl = parseBaseUrl(base);
  const links: ExtractedLink[] = [];
  // Dedup key, kept separate from the emitted href. The key is the canonical
  // HTTP(S) identity (httpUrlIdentity), so equivalent spellings — host case,
  // default ports, trailing slash, fragment — collapse while the first
  // occurrence's resolved href is preserved verbatim in the output.
  const seen = new Set<string>();

  // Emits a link only for an http/https href we have not already seen, preserving
  // first-occurrence order across all link forms. An already-absolute http/https
  // destination is kept verbatim; with a base, a relative destination is resolved
  // against it. Deduplication runs on the canonical identity (httpUrlIdentity),
  // not the emitted href, so an absolute link and an equivalent relative link —
  // or two equivalent absolute spellings — collapse to a single first-occurrence
  // entry whose href is never rewritten.
  const emit = (text: string, href: string): void => {
    const resolved = resolveHref(href, baseUrl);
    if (resolved === null) {
      return;
    }
    const identity = httpUrlIdentity(resolved);
    if (seen.has(identity)) {
      return;
    }
    seen.add(identity);
    links.push({ text, href: resolved });
  };

  // Collect link reference definitions ([label]: dest) up front so references
  // resolve regardless of where they appear relative to the definition, and so
  // definition destinations are never harvested as bare links.
  const { definitions, definitionLineEnds } = collectDefinitions(content);

  let index = 0;
  while (index < content.length) {
    // At line starts: skip fenced code blocks, then skip whole reference-
    // definition lines (their destination belongs to the definition, not prose).
    if (index === 0 || content[index - 1] === '\n') {
      const afterFence = skipFencedCodeBlock(content, index);
      if (afterFence !== index) {
        index = afterFence;
        continue;
      }
      const definitionEnd = definitionLineEnds.get(index);
      if (definitionEnd !== undefined) {
        index = definitionEnd;
        continue;
      }
    }

    const char = content[index];

    // Inline code spans — skip entirely.
    if (char === '`') {
      index = skipInlineCode(content, index);
      continue;
    }

    // Images in any form — ![alt](dest), ![alt][label], ![alt][], ![alt] —
    // consume the whole span and emit nothing so alt text and destinations are
    // never scanned for bare URLs.
    if (char === '!' && content[index + 1] === '[') {
      index = consumeImageSpan(content, index + 1);
      continue;
    }

    // Markdown links: [text](dest) inline, or [text][label] / [label][] /
    // [label] reference links. Emit only a resolved http/https destination and
    // skip the link text so bare URLs inside it are not harvested.
    if (char === '[') {
      const link = tryParseLink(content, index, definitions);
      if (link) {
        emit(link.text, link.href);
        index = link.endIndex + 1;
        continue;
      }
      index++;
      continue;
    }

    // GFM-style angle autolinks: <https://example.com/path>
    if (char === '<') {
      const autolink = parseAngleAutolink(content, index);
      if (autolink) {
        emit(autolink.href, autolink.href);
        index = autolink.endIndex + 1;
        continue;
      }
      index++;
      continue;
    }

    // Bare URLs in prose: https://example.com/path (also http://)
    if (
      (content.startsWith('https://', index) || content.startsWith('http://', index)) &&
      !isAlphanumeric(content[index - 1])
    ) {
      const bare = parseBareUrl(content, index);
      if (bare) {
        emit(bare.href, bare.href);
        index = bare.endIndex;
        continue;
      }
    }

    index++;
  }

  return links;
}

// Parses a bracket span starting at `openIndex` (the `[`) as an inline link
// ([text](dest)) or a reference link ([text][label], [text][]/[label][], [label]).
// Returns the link text, resolved destination, and last consumed index, or null
// when the brackets do not form a link (caller falls through to char-by-char).
function tryParseLink(
  content: string,
  openIndex: number,
  definitions: Map<string, string>
): { text: string; href: string; endIndex: number } | null {
  const closeTextIndex = findClosingBracket(content, openIndex);
  if (closeTextIndex === -1) {
    return null;
  }
  const text = content.slice(openIndex + 1, closeTextIndex);
  const after = closeTextIndex + 1;

  // Inline link: [text](dest)
  if (content[after] === '(') {
    const destination = parseMarkdownLinkDestination(content, closeTextIndex + 2);
    if (destination) {
      return { text, href: destination.href, endIndex: destination.endIndex };
    }
    return null;
  }

  // Reference link: full [text][label], collapsed [label][], shortcut [label].
  const reference = tryResolveReference(content, text, closeTextIndex, definitions);
  if (reference) {
    return { text, href: reference.href, endIndex: reference.endIndex };
  }
  return null;
}

// Resolves a reference link given the first bracket's text and the index of its
// closing `]`. Handles full ([text][label]), collapsed ([text][]), and shortcut
// ([text]) forms. Returns the resolved destination and last consumed index, or
// null when no matching definition exists.
function tryResolveReference(
  content: string,
  text: string,
  closeTextIndex: number,
  definitions: Map<string, string>
): { href: string; endIndex: number } | null {
  const after = closeTextIndex + 1;

  if (content[after] === '[') {
    const closeLabelIndex = findClosingBracket(content, after);
    if (closeLabelIndex === -1) {
      return null;
    }
    const labelText = content.slice(after + 1, closeLabelIndex);
    // Collapsed reference ([text][]) looks up the text itself as the label.
    const lookupLabel = labelText.length > 0 ? labelText : text;
    const href = definitions.get(normalizeLabel(lookupLabel));
    if (href === undefined) {
      return null;
    }
    return { href, endIndex: closeLabelIndex };
  }

  // Shortcut reference ([text]).
  const href = definitions.get(normalizeLabel(text));
  if (href === undefined) {
    return null;
  }
  return { href, endIndex: closeTextIndex };
}

// Consumes an image span starting at `bracketIndex` (the `[` after `!`) in any
// form — inline, full/collapsed reference, or shortcut reference — and returns
// the index just past it. Images never emit links. When the brackets don't form
// a recognizable image, returns `bracketIndex` so only the `!` is dropped and
// the `[` is retried by the caller.
function consumeImageSpan(content: string, bracketIndex: number): number {
  const closeTextIndex = findClosingBracket(content, bracketIndex);
  if (closeTextIndex === -1) {
    return bracketIndex;
  }
  const after = closeTextIndex + 1;

  if (content[after] === '(') {
    const destination = parseMarkdownLinkDestination(content, closeTextIndex + 2);
    return destination ? destination.endIndex + 1 : bracketIndex;
  }

  if (content[after] === '[') {
    const closeLabelIndex = findClosingBracket(content, after);
    return closeLabelIndex === -1 ? bracketIndex : closeLabelIndex + 1;
  }

  // Shortcut image: ![alt]
  return closeTextIndex + 1;
}

interface ReferenceDefinitions {
  // Normalized label -> destination href.
  definitions: Map<string, string>;
  // Line-start index -> index just past the definition line, for the main scan.
  definitionLineEnds: Map<number, number>;
}

// First pass: collect link reference definitions so references can resolve
// anywhere in the document, and record whole definition lines to skip during the
// main scan (a definition destination is not a bare link).
function collectDefinitions(content: string): ReferenceDefinitions {
  const definitions = new Map<string, string>();
  const definitionLineEnds = new Map<number, number>();

  let index = 0;
  while (index < content.length) {
    // Definitions and fenced code are both line-oriented; mirror the main scan.
    const afterFence = skipFencedCodeBlock(content, index);
    if (afterFence !== index) {
      index = afterFence;
      continue;
    }

    const definition = tryParseDefinition(content, index);
    if (definition) {
      const normalized = normalizeLabel(definition.label);
      // First definition of a label wins (CommonMark).
      if (normalized.length > 0 && !definitions.has(normalized)) {
        definitions.set(normalized, definition.href);
      }
      definitionLineEnds.set(index, definition.lineEnd);
      index = definition.lineEnd;
      continue;
    }

    const nextLine = content.indexOf('\n', index);
    index = nextLine === -1 ? content.length : nextLine + 1;
  }

  return { definitions, definitionLineEnds };
}

// Attempts to parse a link reference definition beginning at `lineStart`.
// Returns the label, destination href, and the index just past the definition
// line, or null when the line is not a valid definition.
function tryParseDefinition(
  content: string,
  lineStart: number
): { label: string; href: string; lineEnd: number } | null {
  let index = lineStart;
  // Up to three spaces of indentation (CommonMark); four is an indented code block.
  let indent = 0;
  while (indent < 3 && content[index] === ' ') {
    index++;
    indent++;
  }
  if (content[index] !== '[') {
    return null;
  }

  const closeLabelIndex = findClosingBracket(content, index);
  if (closeLabelIndex === -1 || content[closeLabelIndex + 1] !== ':') {
    return null;
  }
  const label = content.slice(index + 1, closeLabelIndex);
  // A label must contain at least one non-whitespace character.
  if (label.trim().length === 0) {
    return null;
  }

  index = closeLabelIndex + 2; // past ']:'
  while (content[index] === ' ' || content[index] === '\t') {
    index++;
  }

  const destination = parseDefinitionDestination(content, index);
  if (!destination) {
    return null;
  }
  index = destination.end;

  // Optional title (same line only); any trailing non-whitespace invalidates.
  while (content[index] === ' ' || content[index] === '\t') {
    index++;
  }
  if (content[index] !== '\n' && index !== content.length) {
    const titleEnd = parseDefinitionTitle(content, index);
    if (titleEnd === null) {
      return null;
    }
    index = titleEnd;
    while (content[index] === ' ' || content[index] === '\t') {
      index++;
    }
    if (content[index] !== '\n' && index !== content.length) {
      return null;
    }
  }

  const newlineIndex = content.indexOf('\n', index);
  const lineEnd = newlineIndex === -1 ? content.length : newlineIndex + 1;
  return { label, href: destination.href, lineEnd };
}

// Parses a link destination (angle-bracket or bare) starting at `start`. Returns
// the destination href and the index just past it, or null when invalid.
function parseDefinitionDestination(content: string, start: number): { href: string; end: number } | null {
  if (content[start] === '<') {
    const closeAngle = content.indexOf('>', start + 1);
    if (closeAngle === -1) {
      return null;
    }
    const inner = content.slice(start + 1, closeAngle);
    // Angle destinations contain no whitespace or unescaped angle brackets.
    if (inner.length === 0 || /\s/.test(inner) || inner.includes('<')) {
      return null;
    }
    return { href: inner, end: closeAngle + 1 };
  }

  let end = start;
  let depth = 0;
  while (end < content.length) {
    const char = content[end];
    if (char === '\\') {
      end += 2;
      continue;
    }
    if (/\s/.test(char)) {
      break;
    }
    if (char === '(') {
      depth++;
    } else if (char === ')') {
      if (depth === 0) {
        break;
      }
      depth--;
    }
    end++;
  }

  // Empty destination or unbalanced parentheses are invalid.
  if (end === start || depth !== 0) {
    return null;
  }
  return { href: content.slice(start, end), end };
}

// Parses an optional link title ("...", '...', or (...) with no line break)
// starting at `start`. Returns the index just past the closing delimiter, or
// null when no valid title is present.
function parseDefinitionTitle(content: string, start: number): number | null {
  const opener = content[start];
  if (opener !== '"' && opener !== "'" && opener !== '(') {
    return null;
  }
  const closer = opener === '(' ? ')' : opener;
  let index = start + 1;
  while (index < content.length) {
    const char = content[index];
    if (char === '\\') {
      index += 2;
      continue;
    }
    if (char === closer) {
      return index + 1;
    }
    if (char === '\n') {
      return null;
    }
    index++;
  }
  return null;
}

// Normalizes a reference label for matching: trim, collapse internal whitespace
// (including line endings) to single spaces, and case-fold — per CommonMark.
function normalizeLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase();
}

function parseAngleAutolink(content: string, openIndex: number): { href: string; endIndex: number } | null {
  const closeAngleIndex = content.indexOf('>', openIndex + 1);
  if (closeAngleIndex === -1) {
    return null;
  }
  const inner = content.slice(openIndex + 1, closeAngleIndex).trim();
  if (!inner || /\s/.test(inner) || !isAbsoluteHttpUrl(inner)) {
    return null;
  }
  return { href: inner, endIndex: closeAngleIndex };
}

function parseBareUrl(content: string, startIndex: number): { href: string; endIndex: number } | null {
  // Capture the whitespace-delimited token. '<' also terminates the run so a
  // bare URL immediately preceding an angle autolink is not fused with it.
  let end = startIndex;
  while (end < content.length) {
    const char = content[end];
    if (/\s/.test(char) || char === '<') {
      break;
    }
    end++;
  }
  const raw = content.slice(startIndex, end);
  const trimmed = trimTrailingPunctuation(raw);
  if (!trimmed || !isAbsoluteHttpUrl(trimmed)) {
    return null;
  }
  return { href: trimmed, endIndex: end };
}

function trimTrailingPunctuation(raw: string): string {
  let end = raw.length;
  while (end > 0) {
    const char = raw[end - 1];
    if (BARE_URL_TRAILING_PUNCTUATION.has(char)) {
      end--;
      continue;
    }
    // Strip a closing delimiter only when it has no matching opener in the
    // remaining run, so balanced parentheses/brackets are preserved.
    if (char === ')' && countChar(raw, ')', end) > countChar(raw, '(', end)) {
      end--;
      continue;
    }
    if (char === ']' && countChar(raw, ']', end) > countChar(raw, '[', end)) {
      end--;
      continue;
    }
    break;
  }
  return raw.slice(0, end);
}

function countChar(value: string, ch: string, end: number): number {
  let count = 0;
  for (let i = 0; i < end; i++) {
    if (value[i] === ch) {
      count++;
    }
  }
  return count;
}

function skipFencedCodeBlock(content: string, lineStart: number): number {
  // Peek past up to 3 leading spaces (CommonMark fenced-code indent limit).
  let p = lineStart;
  let indent = 0;
  while (indent < 3 && content[p] === ' ') {
    p++;
    indent++;
  }
  const fenceChar = content[p];
  if (fenceChar !== '`' && fenceChar !== '~') {
    return lineStart;
  }
  let q = p;
  while (content[q] === fenceChar) {
    q++;
  }
  const fenceLength = q - p;
  if (fenceLength < 3) {
    return lineStart;
  }

  // Skip the opener line (including its info string), then scan for a closing
  // fence: a line whose first non-space chars are the same fence char repeated
  // at least fenceLength times, with only whitespace after.
  let index = content.indexOf('\n', q);
  if (index === -1) {
    return content.length;
  }
  index++;
  while (index < content.length) {
    let c = index;
    let cIndent = 0;
    while (cIndent < 3 && content[c] === ' ') {
      c++;
      cIndent++;
    }
    if (content[c] === fenceChar) {
      let d = c;
      while (content[d] === fenceChar) {
        d++;
      }
      if (d - c >= fenceLength) {
        let rest = d;
        while (rest < content.length && (content[rest] === ' ' || content[rest] === '\t')) {
          rest++;
        }
        if (rest === content.length || content[rest] === '\n') {
          const nextLine = content.indexOf('\n', rest);
          return nextLine === -1 ? content.length : nextLine + 1;
        }
      }
    }
    const nextLine = content.indexOf('\n', index);
    if (nextLine === -1) {
      return content.length;
    }
    index = nextLine + 1;
  }
  return content.length;
}

function skipInlineCode(content: string, startIndex: number): number {
  let openLength = 0;
  while (content[startIndex + openLength] === '`') {
    openLength++;
  }
  // Find the next maximal backtick run of equal length to close the span.
  let i = startIndex + openLength;
  while (i < content.length) {
    if (content[i] === '`') {
      let closeLength = 0;
      while (content[i + closeLength] === '`') {
        closeLength++;
      }
      if (closeLength === openLength) {
        return i + closeLength;
      }
      i += closeLength;
    } else {
      i++;
    }
  }
  // No matching closer — treat the opening run as literal text.
  return startIndex + openLength;
}

function findClosingBracket(content: string, openIndex: number): number {
  for (let index = openIndex + 1; index < content.length; index++) {
    if (content[index] === '\\') {
      index++;
      continue;
    }
    if (content[index] === ']') {
      return index;
    }
  }
  return -1;
}

function parseMarkdownLinkDestination(content: string, startIndex: number): { href: string; endIndex: number } | null {
  let index = startIndex;
  while (/\s/.test(content[index] ?? '')) {
    index++;
  }

  let href = '';

  if (content[index] === '<') {
    const closeAngleIndex = content.indexOf('>', index + 1);
    if (closeAngleIndex === -1) {
      return null;
    }
    href = content.slice(index + 1, closeAngleIndex).trim();
    index = closeAngleIndex + 1;
  } else {
    const destinationStart = index;
    let depth = 0;

    for (; index < content.length; index++) {
      const char = content[index];
      if (char === '\\') {
        index++;
        continue;
      }
      if (char === '(') {
        depth++;
        continue;
      }
      if (char === ')') {
        if (depth === 0) {
          break;
        }
        depth--;
        continue;
      }
      if (/\s/.test(char) && depth === 0) {
        break;
      }
    }

    href = content.slice(destinationStart, index).trim();
  }

  while (/\s/.test(content[index] ?? '')) {
    index++;
  }

  if (content[index] !== ')') {
    const closeParenIndex = content.indexOf(')', index);
    if (closeParenIndex === -1) {
      return null;
    }
    index = closeParenIndex;
  }

  if (!href) {
    return null;
  }

  return { href, endIndex: index };
}
