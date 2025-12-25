import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { cleanMarkdownComplete } from '../utils/markdown-cleaner.js';

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
  filter: (node) => node.nodeType === 8,
  replacement: () => '',
});

export async function processHtmlToMarkdown(
  html: string,
  url: string,
  verbose = false
): Promise<ExtractionResult> {
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

    if (verbose) {
      console.error(`📝 Extracted: "${article.title}" (${article.content.length} chars)`);
    }

    let markdown = turndown.turndown(article.content);

    markdown = cleanMarkdownComplete(markdown);

    let header = `# ${article.title}\n\n`;
    if (article.byline) header += `**By:** ${article.byline}\n\n`;
    if (article.siteName) header += `**Source:** ${article.siteName}\n\n`;
    if (article.excerpt) header += `**Summary:** ${article.excerpt}\n\n`;
    header += `**URL:** ${url}\n\n---\n\n`;

    return {
      markdown: header + markdown,
      title: article.title,
      byline: article.byline || undefined,
      excerpt: article.excerpt || undefined,
      siteName: article.siteName || undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: message };
  }
}
