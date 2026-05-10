import type { CachedReference, DeleteResult, LinkExtractionResult, PromoteResult } from './cache';
import type { FetchLinkResult, FetchLinksFromRefResult } from './fetch-links';
import type { AcquisitionOutcome } from './references/acquire';

/**
 * Output format names used by both surfaces. Each surface maps its CLI flags
 * or MCP arguments down to one of these. The renderer does not branch on
 * surface — surface-specific idioms (e.g. `--refetch` vs `refetch: true`) are
 * handled here based on the chosen format.
 */
export type OutputFormat = 'text' | 'pretty' | 'json' | 'path' | 'cli-summary';

interface FetchRenderInput {
  outcome: AcquisitionOutcome;
  url: string;
  query?: string;
  format: OutputFormat;
}

/**
 * Render the result of `acquireReference` to a string. CLI prints this to
 * stdout; MCP wraps it as `{content: [{type:'text', text}]}`. For `json`,
 * the returned string is already JSON.stringified.
 */
export function renderFetchOutcome({ outcome, url, query, format }: FetchRenderInput): string {
  if (!outcome.ok) {
    return renderFetchFailure(outcome, format);
  }

  if (outcome.source === 'cached') {
    return renderCachedOutcome(outcome.refId, outcome.filepath, format);
  }

  return renderFetchedOutcome(outcome, url, query, format);
}

function renderFetchFailure(outcome: Extract<AcquisitionOutcome, { ok: false }>, format: OutputFormat): string {
  if (format === 'json') {
    if (outcome.stage === 'save') {
      return JSON.stringify({ success: false, error: outcome.error }, null, 2);
    }
    return JSON.stringify(
      {
        success: false,
        error: outcome.error,
        suggestion: outcome.suggestion,
        quality: outcome.quality,
      },
      null,
      2
    );
  }

  if (outcome.stage === 'save') {
    return `Error: Save failed: ${outcome.error}`;
  }

  let text = `Error: ${outcome.error}`;
  if (outcome.suggestion) text += `\nSuggestion: ${outcome.suggestion}`;
  if (outcome.quality) text += `\nQuality: ${outcome.quality.score}/100`;
  return text;
}

function renderCachedOutcome(refId: string, filepath: string, format: OutputFormat): string {
  if (format === 'path') return filepath;
  if (format === 'cli-summary') return `${refId}|${filepath}`;

  if (format === 'json') {
    return JSON.stringify(
      {
        success: true,
        alreadyExists: true,
        refId,
        filepath,
        message: 'URL already fetched. Use refetch: true to update.',
      },
      null,
      2
    );
  }

  if (format === 'pretty') {
    return `📦 Already cached: ${refId}\n   File: ${filepath}\n\n💡 Use --refetch to update`;
  }

  return `Already cached: ${refId}\nFilepath: ${filepath}\n\nUse refetch: true to update.`;
}

function renderFetchedOutcome(
  outcome: Extract<AcquisitionOutcome, { ok: true; source: 'fetched' }>,
  url: string,
  query: string | undefined,
  format: OutputFormat
): string {
  if (format === 'path') return outcome.filepath;
  if (format === 'cli-summary') return `${outcome.refId}|${outcome.filepath}`;

  if (format === 'json') {
    return JSON.stringify(
      {
        success: true,
        refId: outcome.refId,
        title: outcome.title,
        byline: outcome.byline,
        siteName: outcome.siteName,
        excerpt: outcome.excerpt,
        url,
        filepath: outcome.filepath,
        size: outcome.markdownLength,
        tokens: Math.round(outcome.markdownLength / 4),
        quality: outcome.quality.score,
        usedPlaywright: outcome.usedPlaywright,
        playwrightReason: outcome.playwrightReason,
        query,
      },
      null,
      2
    );
  }

  const tokenEstimate = Math.round(outcome.markdownLength / 4);
  const trimmedExcerpt = outcome.excerpt
    ? `${outcome.excerpt.slice(0, 150)}${outcome.excerpt.length > 150 ? '...' : ''}`
    : undefined;

  if (format === 'pretty') {
    let text = `✅ Cached: ${outcome.refId}\n\n`;
    text += `**Title**: ${outcome.title}\n`;
    if (outcome.byline) text += `**Author**: ${outcome.byline}\n`;
    if (outcome.siteName) text += `**Source**: ${outcome.siteName}\n`;
    if (trimmedExcerpt) text += `**Summary**: ${trimmedExcerpt}\n`;
    text += `\n**Saved to**: ${outcome.filepath}\n`;
    text += `**Size**: ${outcome.markdownLength} chars (~${tokenEstimate} tokens)\n`;
    text += `**Quality**: ${outcome.quality.score}/100`;
    if (outcome.usedPlaywright) text += `\n**Playwright**: Yes (${outcome.playwrightReason})`;
    text += `\n\n💡 To promote to docs: arcfetch promote ${outcome.refId}`;
    return text;
  }

  // text (default — used by CLI plain output and MCP summary)
  let text = `Cached: ${outcome.refId}\n`;
  text += `Title: ${outcome.title}\n`;
  if (outcome.byline) text += `Author: ${outcome.byline}\n`;
  if (outcome.siteName) text += `Source: ${outcome.siteName}\n`;
  if (trimmedExcerpt) text += `Summary: ${trimmedExcerpt}\n`;
  text += `Filepath: ${outcome.filepath}\n`;
  text += `Size: ${outcome.markdownLength} chars (~${tokenEstimate} tokens)\n`;
  text += `Quality: ${outcome.quality.score}/100`;
  if (outcome.usedPlaywright) text += `\nPlaywright: Yes (${outcome.playwrightReason})`;
  return text;
}

/**
 * Render `listCached` results.
 */
export function renderListResult(references: CachedReference[], tempDir: string, format: OutputFormat): string {
  if (format === 'json') {
    return JSON.stringify(references, null, 2);
  }

  if (references.length === 0) {
    return `No cached references in ${tempDir}/`;
  }

  const isPretty = format === 'pretty';
  const heading = isPretty
    ? `📚 Cached references (${references.length}):\n`
    : `Cached references (${references.length}):\n`;

  const lines: string[] = [heading];
  for (const ref of references) {
    const titleSnippet = `${ref.title.slice(0, 50)}${ref.title.length > 50 ? '...' : ''}`;
    const urlSnippet = `${ref.url.slice(0, 60)}${ref.url.length > 60 ? '...' : ''}`;
    const sizeKb = Math.round(ref.size / 1024);

    lines.push(`${ref.refId} | ${titleSnippet}`);
    if (isPretty) {
      lines.push(`   📅 ${ref.fetchedDate} | 📄 ${sizeKb}KB`);
      lines.push(`   🔗 ${urlSnippet}`);
    } else {
      lines.push(`  Date: ${ref.fetchedDate} | Size: ${sizeKb}KB`);
      lines.push(`  URL: ${urlSnippet}`);
    }
    lines.push('');
  }

  if (isPretty) {
    lines.push('💡 To promote: arcfetch promote <ref-id>');
    lines.push('💡 To delete: arcfetch delete <ref-id>');
    return lines.join('\n');
  }

  return lines.join('\n').trimEnd();
}

/**
 * Render `promoteReference` result.
 */
export function renderPromoteResult(refId: string, result: PromoteResult, format: OutputFormat): string {
  if (format === 'json') {
    return JSON.stringify(result, null, 2);
  }

  if (!result.success) {
    return `Error: ${result.error}`;
  }

  if (format === 'pretty') {
    return `✅ Promoted ${refId}\n   From: ${result.fromPath}\n   To:   ${result.toPath}`;
  }

  return `Promoted: ${refId}\nFrom: ${result.fromPath}\nTo: ${result.toPath}`;
}

/**
 * Render `deleteCached` result.
 */
export function renderDeleteResult(refId: string, result: DeleteResult, format: OutputFormat): string {
  if (format === 'json') {
    return JSON.stringify(result, null, 2);
  }

  if (!result.success) {
    return `Error: ${result.error}`;
  }

  if (format === 'pretty') {
    return `✅ Deleted ${refId}\n   File: ${result.filepath}`;
  }

  return `Deleted: ${refId}\nFile: ${result.filepath}`;
}

/**
 * Render `extractLinksFromCached` result.
 */
export function renderLinksResult(refId: string, result: LinkExtractionResult, format: OutputFormat): string {
  if (format === 'json') {
    if (result.error) {
      return JSON.stringify({ success: false, error: result.error }, null, 2);
    }
    return JSON.stringify(
      {
        success: true,
        sourceRef: result.sourceRef,
        count: result.count,
        links: result.links,
      },
      null,
      2
    );
  }

  if (result.error) {
    return `Error: ${result.error}`;
  }

  if (result.count === 0) {
    return format === 'pretty' ? `🔗 No links found in ${refId}` : `No links found in ${refId}`;
  }

  const isPretty = format === 'pretty';
  const lines: string[] = [];
  lines.push(isPretty ? `🔗 Found ${result.count} links in ${refId}:\n` : `Found ${result.count} links in ${refId}:\n`);

  for (const link of result.links) {
    if (isPretty) {
      lines.push(`  ${link.text}`);
      lines.push(`    → ${link.href}`);
    } else {
      lines.push(`${link.text} | ${link.href}`);
    }
  }

  if (isPretty) {
    lines.push(`\n💡 To fetch all: arcfetch fetch-links ${refId}`);
  }

  return lines.join('\n').trimEnd();
}

/**
 * Render a single per-link progress event.
 */
export function renderLinkProgressLine(result: FetchLinkResult, format: OutputFormat): string {
  if (format === 'pretty') {
    if (result.status === 'new') return `✓ ${result.refId} (new)`;
    if (result.status === 'cached') return `○ ${result.refId} (already cached)`;
    return `✗ ${result.url.slice(0, 50)}... (${result.error})`;
  }

  if (result.status === 'new') return `new: ${result.refId}`;
  if (result.status === 'cached') return `cached: ${result.refId}`;
  return `failed: ${result.url} - ${result.error}`;
}

/**
 * Render the final summary of `fetchLinksFromRef`.
 */
export function renderFetchLinksResult(refId: string, result: FetchLinksFromRefResult, format: OutputFormat): string {
  if (format === 'json') {
    if (result.error) {
      return JSON.stringify({ success: false, error: result.error }, null, 2);
    }
    if (result.results.length === 0) {
      return JSON.stringify({ success: true, message: 'No links to fetch', results: [] }, null, 2);
    }
    return JSON.stringify(
      {
        success: true,
        sourceRef: refId,
        summary: result.summary,
        results: result.results,
      },
      null,
      2
    );
  }

  if (result.error) {
    return `Error: ${result.error}`;
  }

  if (result.results.length === 0) {
    return `No links found in ${refId}`;
  }

  const lines: string[] = [];
  lines.push(`Fetched links from ${refId}:\n`);
  for (const r of result.results) {
    lines.push(renderLinkProgressLine(r, format));
  }
  lines.push('');
  lines.push(`Summary: ${result.summary.new} new, ${result.summary.cached} cached, ${result.summary.failed} failed`);
  return lines.join('\n');
}
