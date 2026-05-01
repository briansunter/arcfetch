import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { getErrorMessage } from '../utils/error';
import { cleanMarkdownComplete } from '../utils/markdown-cleaner';

export interface ExtractionResult {
  markdown?: string;
  title?: string;
  byline?: string;
  excerpt?: string;
  siteName?: string;
  error?: string;
}

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '*',
  strongDelimiter: '**',
  hr: '---',
});

turndown.use(gfm);

turndown.addRule('removeComments', {
  filter: (node) => (node as { nodeType: number }).nodeType === 8,
  replacement: () => '',
});

function sanitizeMarkdown(markdown: string): string {
  // Remove javascript: URLs in markdown links
  let sanitized = markdown.replace(/\[([^\]]*)\]\(javascript:[^)]*\)/gi, '$1');
  // Remove data: URLs that could contain scripts
  sanitized = sanitized.replace(/\[([^\]]*)\]\(data:[^)]*\)/gi, '$1');
  // Remove vbscript: URLs
  sanitized = sanitized.replace(/\[([^\]]*)\]\(vbscript:[^)]*\)/gi, '$1');
  // Strip any remaining script tags
  sanitized = sanitized.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  // Remove event handler attributes in any remaining HTML
  sanitized = sanitized.replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '');
  return sanitized;
}

function sanitizeMetadataLine(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

export async function processHtmlToMarkdown(html: string, url: string, verbose = false): Promise<ExtractionResult> {
  try {
    if (verbose) {
      console.error(`📝 Processing HTML (${html.length} chars)`);
    }

    const { document } = parseHTML(html, { url });

    const reader = new Readability(document, {
      debug: false,
      maxElemsToParse: 0,
      nbTopCandidates: 5,
      charThreshold: 500,
      keepClasses: false,
    });

    const article = reader.parse();

    if (!article) {
      return {
        error: 'Could not extract article content. Page may not contain article-like content.',
      };
    }

    const content = article.content ?? '';

    if (verbose) {
      console.error(`📝 Extracted: "${article.title}" (${content.length} chars)`);
    }

    let markdown = turndown.turndown(content);
    markdown = sanitizeMarkdown(markdown);
    markdown = cleanMarkdownComplete(markdown);

    const title = sanitizeMetadataLine(article.title ?? 'Untitled');
    let header = `# ${title}\n\n`;
    if (article.byline) header += `**By:** ${sanitizeMetadataLine(article.byline)}\n\n`;
    if (article.siteName) header += `**Source:** ${sanitizeMetadataLine(article.siteName)}\n\n`;
    if (article.excerpt) header += `**Summary:** ${sanitizeMetadataLine(article.excerpt)}\n\n`;
    header += `**URL:** ${sanitizeMetadataLine(url)}\n\n---\n\n`;

    return {
      markdown: header + markdown,
      title,
      byline: article.byline ?? undefined,
      excerpt: article.excerpt ?? undefined,
      siteName: article.siteName ?? undefined,
    };
  } catch (error) {
    const message = getErrorMessage(error);
    return { error: message };
  }
}
