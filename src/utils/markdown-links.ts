export interface ExtractedLink {
  text: string;
  href: string;
}

export function extractLinksFromMarkdown(content: string): ExtractedLink[] {
  const links: ExtractedLink[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < content.length; index++) {
    if (content[index] !== '[' || content[index - 1] === '!') {
      continue;
    }

    const closeTextIndex = findClosingBracket(content, index);
    if (closeTextIndex === -1 || content[closeTextIndex + 1] !== '(') {
      continue;
    }

    const parsedLink = parseMarkdownLinkDestination(content, closeTextIndex + 2);
    if (!parsedLink) {
      continue;
    }

    const text = content.slice(index + 1, closeTextIndex);
    const href = parsedLink.href;

    try {
      const parsedUrl = new URL(href);
      if ((parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') && !seen.has(href)) {
        seen.add(href);
        links.push({ text, href });
      }
    } catch {
      // Ignore invalid, relative, anchor, mailto, and other non-URL destinations.
    }

    index = parsedLink.endIndex;
  }

  return links;
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
