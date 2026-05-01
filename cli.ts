#!/usr/bin/env bun

import { serveMcp } from './index';
import { loadConfig } from './src/config/index';
import {
  deleteCached,
  extractLinksFromCached,
  findByUrl,
  listCached,
  promoteReference,
  saveToTemp,
} from './src/core/cache';
import { type FetchLinkResult, fetchLinksFromRef } from './src/core/fetch-links';
import { closeBrowser, type FetchResult, fetchUrl } from './src/core/pipeline';
import { getErrorMessage } from './src/utils/error';
import { getVersion } from './src/utils/version';

// ============================================================================
// HELP
// ============================================================================

function showHelp(): void {
  console.log(`
Arcfetch v${getVersion()} - Fetch URLs and cache as clean markdown

USAGE:
    arcfetch <command> [options]

COMMANDS:
    fetch <url>         Fetch URL and save to temp folder
    list                List all cached references
    links <ref-id>      List all links from a cached reference
    fetch-links <ref-id> Fetch all links from a cached reference
    promote <ref-id>    Move reference from temp to docs folder
    delete <ref-id>     Delete a cached reference
    config              Show current configuration
    mcp                 Start MCP server (for Claude Code integration)
    help                Show this help message

OPTIONS:
    -q, --query <text>        Search query (saved as metadata)
    -o, --output <format>     Output format (default: text)
                              - text: Plain text (LLM-friendly)
                              - json: Structured JSON
                              - path: Just the filepath
                              - summary: slug|filepath
    --pretty                  Human-friendly output with emojis
    --refetch                 Re-fetch and update even if URL already cached
    -v, --verbose             Show detailed output
    --min-quality <n>         Minimum quality score 0-100 (default: 60)
    --temp-dir <path>         Temp folder (default: .tmp/arcfetch)
    --docs-dir <path>         Docs folder (default: docs/ai/references)
    --wait-strategy <mode>    Playwright wait strategy: networkidle, domcontentloaded, load
    --force-playwright        Skip simple fetch and use Playwright directly

EXAMPLES:
    # Fetch a URL (plain output for LLMs)
    arcfetch fetch https://example.com/article

    # Fetch and get just the filepath
    arcfetch fetch https://example.com -o path

    # Fetch with human-friendly output
    arcfetch fetch https://example.com --pretty

    # Fetch with JSON output
    arcfetch fetch https://example.com -o json

    # List cached references
    arcfetch list

    # Promote to docs folder
    arcfetch promote how-to-build-react

    # List links from a cached reference
    arcfetch links my-article

    # Fetch all links from a reference
    arcfetch fetch-links my-article --pretty

ENVIRONMENT VARIABLES:
    ARCFETCH_MIN_SCORE          Minimum quality score
    ARCFETCH_JS_RETRY_THRESHOLD JavaScript retry threshold
    ARCFETCH_TEMP_DIR           Temp directory
    ARCFETCH_DOCS_DIR           Docs directory

    Legacy SOFETCH_* names are still supported.

CONFIG FILE:
    Place arcfetch.config.json in project root for persistent settings.
`);
}

// ============================================================================
// FETCH COMMAND
// ============================================================================

interface FetchOptions {
  url: string;
  query?: string;
  output: 'text' | 'json' | 'summary' | 'path';
  verbose: boolean;
  pretty: boolean;
  refetch: boolean;
  minQuality?: number;
  tempDir?: string;
  docsDir?: string;
  waitStrategy?: 'networkidle' | 'domcontentloaded' | 'load';
  forcePlaywright?: boolean;
}

function outputAlreadyCached(
  refId: string,
  filepath: string,
  output: 'text' | 'json' | 'summary' | 'path',
  pretty: boolean
): void {
  if (output === 'json') {
    console.log(
      JSON.stringify(
        {
          success: true,
          alreadyExists: true,
          refId,
          filepath,
          message: 'URL already fetched. Use --refetch to update.',
        },
        null,
        2
      )
    );
  } else if (output === 'path') {
    console.log(filepath);
  } else if (output === 'summary') {
    console.log(`${refId}|${filepath}`);
  } else if (pretty) {
    console.log(`📦 Already cached: ${refId}`);
    console.log(`   File: ${filepath}`);
    console.log(`\n💡 Use --refetch to update`);
  } else {
    console.log(`Already cached: ${refId}`);
    console.log(`Filepath: ${filepath}`);
    console.log(`Use --refetch to update`);
  }
}

async function commandFetch(options: FetchOptions): Promise<void> {
  const config = loadConfig({
    minQuality: options.minQuality,
    tempDir: options.tempDir,
    docsDir: options.docsDir,
    waitStrategy: options.waitStrategy,
  });

  if (options.verbose) {
    console.error('🔧 Config:', JSON.stringify(config, null, 2));
  }

  if (!options.refetch) {
    const cached = findByUrl(config, options.url);
    if (cached) {
      outputAlreadyCached(cached.refId, cached.filepath, options.output, options.pretty);
      return;
    }
  }

  // Fetch URL
  let result: FetchResult;
  try {
    result = await fetchUrl(options.url, config, options.verbose, options.forcePlaywright);
  } finally {
    // Close browser if it was used
    await closeBrowser();
  }

  if (!result.success) {
    if (options.output === 'json') {
      console.log(
        JSON.stringify(
          {
            success: false,
            error: result.error,
            suggestion: result.suggestion,
            quality: result.quality,
          },
          null,
          2
        )
      );
    } else {
      console.error(`Error: ${result.error}`);
      if (result.suggestion) {
        console.error(`Suggestion: ${result.suggestion}`);
      }
      if (result.quality) {
        console.error(`Quality: ${result.quality.score}/100`);
      }
    }
    process.exit(1);
  }

  // Save to temp
  const saveResult = await saveToTemp(
    config,
    result.title,
    options.url,
    result.markdown,
    options.query,
    options.refetch
  );

  // Small delay to ensure file is flushed to disk (Bun-specific issue)
  await new Promise((resolve) => setTimeout(resolve, 100));

  if (saveResult.error) {
    if (options.output === 'json') {
      console.log(JSON.stringify({ success: false, error: saveResult.error }, null, 2));
    } else {
      console.error(`Error: Save failed: ${saveResult.error}`);
    }
    process.exit(1);
  }

  // Handle already exists case
  if (saveResult.alreadyExists) {
    outputAlreadyCached(saveResult.refId, saveResult.filepath, options.output, options.pretty);
    return;
  }

  // Output result
  if (options.output === 'json') {
    console.log(
      JSON.stringify(
        {
          success: true,
          refId: saveResult.refId,
          title: result.title,
          byline: result.byline,
          siteName: result.siteName,
          excerpt: result.excerpt,
          url: options.url,
          filepath: saveResult.filepath,
          size: result.markdown.length,
          tokens: Math.round(result.markdown.length / 4),
          quality: result.quality.score,
          usedPlaywright: result.usedPlaywright,
          playwrightReason: result.playwrightReason,
          query: options.query,
        },
        null,
        2
      )
    );
  } else if (options.output === 'summary') {
    console.log(`${saveResult.refId}|${saveResult.filepath}`);
  } else if (options.output === 'path') {
    console.log(saveResult.filepath);
  } else if (options.pretty) {
    // Pretty output with emojis (human-friendly)
    console.log(`✅ Cached: ${saveResult.refId}\n`);
    console.log(`**Title**: ${result.title}`);
    if (result.byline) console.log(`**Author**: ${result.byline}`);
    if (result.siteName) console.log(`**Source**: ${result.siteName}`);
    if (result.excerpt) {
      const excerpt = result.excerpt.slice(0, 150);
      console.log(`**Summary**: ${excerpt}${result.excerpt.length > 150 ? '...' : ''}`);
    }
    console.log(`\n**Saved to**: ${saveResult.filepath}`);
    console.log(`**Size**: ${result.markdown.length} chars (~${Math.round(result.markdown.length / 4)} tokens)`);
    console.log(`**Quality**: ${result.quality.score}/100`);
    if (result.usedPlaywright) {
      console.log(`**Playwright**: Yes (${result.playwrightReason})`);
    }
    console.log(`\n💡 To promote to docs: arcfetch promote ${saveResult.refId}`);
  } else {
    // Plain output (LLM-friendly, default)
    console.log(`Cached: ${saveResult.refId}`);
    console.log(`Title: ${result.title}`);
    if (result.byline) console.log(`Author: ${result.byline}`);
    if (result.siteName) console.log(`Source: ${result.siteName}`);
    if (result.excerpt) {
      const excerpt = result.excerpt.slice(0, 150);
      console.log(`Summary: ${excerpt}${result.excerpt.length > 150 ? '...' : ''}`);
    }
    console.log(`Filepath: ${saveResult.filepath}`);
    console.log(`Size: ${result.markdown.length} chars (~${Math.round(result.markdown.length / 4)} tokens)`);
    console.log(`Quality: ${result.quality.score}/100`);
    if (result.usedPlaywright) {
      console.log(`Playwright: Yes (${result.playwrightReason})`);
    }
  }
}

// ============================================================================
// LIST COMMAND
// ============================================================================

async function commandList(
  output: 'text' | 'json',
  pretty: boolean,
  options: Pick<ParsedOptions, 'tempDir'>
): Promise<void> {
  const config = loadConfig({ tempDir: options.tempDir });
  const result = listCached(config);

  if (result.error) {
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }

  if (output === 'json') {
    console.log(JSON.stringify(result.references, null, 2));
    return;
  }

  if (result.references.length === 0) {
    console.log(`No cached references in ${config.paths.tempDir}/`);
    return;
  }

  if (pretty) {
    console.log(`📚 Cached references (${result.references.length}):\n`);
    for (const ref of result.references) {
      console.log(`${ref.refId} | ${ref.title.slice(0, 50)}${ref.title.length > 50 ? '...' : ''}`);
      console.log(`   📅 ${ref.fetchedDate} | 📄 ${Math.round(ref.size / 1024)}KB`);
      console.log(`   🔗 ${ref.url.slice(0, 60)}${ref.url.length > 60 ? '...' : ''}`);
      console.log('');
    }
    console.log(`💡 To promote: arcfetch promote <ref-id>`);
    console.log(`💡 To delete: arcfetch delete <ref-id>`);
  } else {
    console.log(`Cached references (${result.references.length}):\n`);
    for (const ref of result.references) {
      console.log(`${ref.refId} | ${ref.title.slice(0, 50)}${ref.title.length > 50 ? '...' : ''}`);
      console.log(`  Date: ${ref.fetchedDate} | Size: ${Math.round(ref.size / 1024)}KB`);
      console.log(`  URL: ${ref.url.slice(0, 60)}${ref.url.length > 60 ? '...' : ''}`);
      console.log('');
    }
  }
}

// ============================================================================
// PROMOTE COMMAND
// ============================================================================

async function commandPromote(
  refId: string,
  output: 'text' | 'json',
  pretty: boolean,
  options: Pick<ParsedOptions, 'tempDir' | 'docsDir'>
): Promise<void> {
  const config = loadConfig({ tempDir: options.tempDir, docsDir: options.docsDir });
  const result = promoteReference(config, refId);

  if (output === 'json') {
    console.log(JSON.stringify(result, null, 2));
    if (!result.success) process.exit(1);
    return;
  }

  if (!result.success) {
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }

  if (pretty) {
    console.log(`✅ Promoted ${refId}`);
    console.log(`   From: ${result.fromPath}`);
    console.log(`   To:   ${result.toPath}`);
  } else {
    console.log(`Promoted: ${refId}`);
    console.log(`From: ${result.fromPath}`);
    console.log(`To: ${result.toPath}`);
  }
}

// ============================================================================
// DELETE COMMAND
// ============================================================================

async function commandDelete(
  refId: string,
  output: 'text' | 'json',
  pretty: boolean,
  options: Pick<ParsedOptions, 'tempDir'>
): Promise<void> {
  const config = loadConfig({ tempDir: options.tempDir });
  const result = deleteCached(config, refId);

  if (output === 'json') {
    console.log(JSON.stringify(result, null, 2));
    if (!result.success) process.exit(1);
    return;
  }

  if (!result.success) {
    console.error(`Error: ${result.error}`);
    process.exit(1);
  }

  if (pretty) {
    console.log(`✅ Deleted ${refId}`);
    console.log(`   File: ${result.filepath}`);
  } else {
    console.log(`Deleted: ${refId}`);
    console.log(`File: ${result.filepath}`);
  }
}

// ============================================================================
// CONFIG COMMAND
// ============================================================================

async function commandConfig(
  options: Pick<ParsedOptions, 'tempDir' | 'docsDir' | 'minQuality' | 'waitStrategy'>
): Promise<void> {
  const config = loadConfig({
    minQuality: options.minQuality,
    tempDir: options.tempDir,
    docsDir: options.docsDir,
    waitStrategy: options.waitStrategy,
  });
  console.log('Current configuration:\n');
  console.log(JSON.stringify(config, null, 2));
}

// ============================================================================
// LINKS COMMAND
// ============================================================================

async function commandLinks(
  refId: string,
  output: 'text' | 'json',
  pretty: boolean,
  options: Pick<ParsedOptions, 'tempDir'>
): Promise<void> {
  const config = loadConfig({ tempDir: options.tempDir });
  const result = extractLinksFromCached(config, refId);

  if (result.error) {
    if (output === 'json') {
      console.log(JSON.stringify({ success: false, error: result.error }, null, 2));
    } else {
      console.error(`Error: ${result.error}`);
    }
    process.exit(1);
  }

  if (output === 'json') {
    console.log(
      JSON.stringify(
        {
          success: true,
          sourceRef: result.sourceRef,
          count: result.count,
          links: result.links,
        },
        null,
        2
      )
    );
    return;
  }

  if (result.count === 0) {
    if (pretty) {
      console.log(`🔗 No links found in ${refId}`);
    } else {
      console.log(`No links found in ${refId}`);
    }
    return;
  }

  if (pretty) {
    console.log(`🔗 Found ${result.count} links in ${refId}:\n`);
    for (const link of result.links) {
      console.log(`  ${link.text}`);
      console.log(`    → ${link.href}`);
    }
    console.log(`\n💡 To fetch all: arcfetch fetch-links ${refId}`);
  } else {
    console.log(`Found ${result.count} links in ${refId}:\n`);
    for (const link of result.links) {
      console.log(`${link.text} | ${link.href}`);
    }
  }
}

// ============================================================================
// FETCH-LINKS COMMAND
// ============================================================================

async function commandFetchLinks(
  refId: string,
  output: 'text' | 'json',
  pretty: boolean,
  verbose: boolean,
  refetch: boolean,
  options: Pick<ParsedOptions, 'tempDir' | 'docsDir'>
): Promise<void> {
  const config = loadConfig({ tempDir: options.tempDir, docsDir: options.docsDir });

  const printProgress =
    output !== 'json'
      ? (r: FetchLinkResult) => {
          if (pretty) {
            if (r.status === 'new') {
              console.log(`\u2713 ${r.refId} (new)`);
            } else if (r.status === 'cached') {
              console.log(`\u25CB ${r.refId} (already cached)`);
            } else {
              console.log(`\u2717 ${r.url.slice(0, 50)}... (${r.error})`);
            }
          } else {
            if (r.status === 'new') {
              console.log(`new: ${r.refId}`);
            } else if (r.status === 'cached') {
              console.log(`cached: ${r.refId}`);
            } else {
              console.log(`failed: ${r.url} - ${r.error}`);
            }
          }
        }
      : undefined;

  const { results, summary, error } = await fetchLinksFromRef(config, refId, {
    refetch,
    verbose,
    onProgress: printProgress,
  });

  if (error) {
    if (output === 'json') {
      console.log(JSON.stringify({ success: false, error }, null, 2));
    } else {
      console.error(`Error: ${error}`);
    }
    process.exit(1);
  }

  if (results.length === 0) {
    if (output === 'json') {
      console.log(JSON.stringify({ success: true, message: 'No links to fetch', results: [] }, null, 2));
    } else if (pretty) {
      console.log(`No links found in ${refId}`);
    } else {
      console.log(`No links found in ${refId}`);
    }
    return;
  }

  if (output === 'json') {
    console.log(
      JSON.stringify(
        {
          success: true,
          sourceRef: refId,
          summary,
          results,
        },
        null,
        2
      )
    );
  } else {
    console.log('');
    if (pretty) {
      console.log(`Summary: ${summary.new} new, ${summary.cached} cached, ${summary.failed} failed`);
    } else {
      console.log(`Summary: ${summary.new} new, ${summary.cached} cached, ${summary.failed} failed`);
    }
  }
}

// ============================================================================
// ARGUMENT PARSING
// ============================================================================

export interface ParsedOptions {
  output: 'text' | 'json' | 'summary' | 'path';
  verbose: boolean;
  pretty: boolean;
  refetch: boolean;
  query?: string;
  minQuality?: number;
  tempDir?: string;
  docsDir?: string;
  waitStrategy?: 'networkidle' | 'domcontentloaded' | 'load';
  forcePlaywright?: boolean;
}

export function parseArgs(): { command: string; args: string[]; options: ParsedOptions } {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    return { command: 'help', args: [], options: { output: 'text', verbose: false, pretty: false, refetch: false } };
  }

  const requiresValue = (flag: string, value: string | undefined): string => {
    if (!value || value.startsWith('--')) {
      console.error(`Error: ${flag} requires a value`);
      process.exit(1);
    }
    return value;
  };

  const command = args[0];
  const options: ParsedOptions = {
    output: 'text',
    verbose: false,
    pretty: false,
    refetch: false,
  };
  const positionalArgs: string[] = [];

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    if (arg === '-q' || arg === '--query') {
      options.query = requiresValue(arg, next);
      i++;
    } else if (arg === '-o' || arg === '--output') {
      const val = requiresValue(arg, next);
      if (['text', 'json', 'summary', 'path'].includes(val)) {
        options.output = val as 'text' | 'json' | 'summary' | 'path';
      } else {
        console.error(`Warning: Invalid output format '${val}'. Valid options: text, json, summary, path`);
      }
      i++;
    } else if (arg === '-v' || arg === '--verbose') {
      options.verbose = true;
    } else if (arg === '--pretty') {
      options.pretty = true;
    } else if (arg === '--min-quality') {
      const raw = requiresValue(arg, next);
      const val = Number(raw);
      if (!Number.isInteger(val)) {
        console.error('Error: --min-quality must be an integer');
        process.exit(1);
      }
      options.minQuality = val;
      i++;
    } else if (arg === '--temp-dir') {
      options.tempDir = requiresValue(arg, next);
      i++;
    } else if (arg === '--docs-dir') {
      options.docsDir = requiresValue(arg, next);
      i++;
    } else if (arg === '--wait-strategy') {
      const val = requiresValue(arg, next);
      if (['networkidle', 'domcontentloaded', 'load'].includes(val)) {
        options.waitStrategy = val as 'networkidle' | 'domcontentloaded' | 'load';
      } else {
        console.error(`Warning: Invalid wait strategy '${val}'. Valid options: networkidle, domcontentloaded, load`);
      }
      i++;
    } else if (arg === '--force-playwright') {
      options.forcePlaywright = true;
    } else if (arg === '--refetch') {
      options.refetch = true;
    } else if (arg === '-h' || arg === '--help') {
      return { command: 'help', args: [], options: { output: 'text', verbose: false, pretty: false, refetch: false } };
    } else if (!arg.startsWith('-')) {
      positionalArgs.push(arg);
    }
  }

  return { command, args: positionalArgs, options };
}

// ============================================================================
// MAIN
// ============================================================================

async function main(): Promise<void> {
  const cleanup = async () => {
    await closeBrowser();
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  const { command, args, options } = parseArgs();

  try {
    switch (command) {
      case 'fetch':
        if (args.length === 0) {
          console.error('Error: URL required. Usage: arcfetch fetch <url>');
          process.exit(1);
        }
        await commandFetch({
          url: args[0],
          query: options.query,
          output: options.output,
          verbose: options.verbose,
          pretty: options.pretty,
          refetch: options.refetch,
          minQuality: options.minQuality,
          tempDir: options.tempDir,
          docsDir: options.docsDir,
          waitStrategy: options.waitStrategy,
          forcePlaywright: options.forcePlaywright,
        });
        break;

      case 'list':
        await commandList(options.output === 'json' ? 'json' : 'text', options.pretty, {
          tempDir: options.tempDir,
        });
        break;

      case 'promote':
        if (args.length === 0) {
          console.error('Error: Reference ID required. Usage: arcfetch promote <ref-id>');
          process.exit(1);
        }
        await commandPromote(args[0], options.output === 'json' ? 'json' : 'text', options.pretty, {
          tempDir: options.tempDir,
          docsDir: options.docsDir,
        });
        break;

      case 'delete':
        if (args.length === 0) {
          console.error('Error: Reference ID required. Usage: arcfetch delete <ref-id>');
          process.exit(1);
        }
        await commandDelete(args[0], options.output === 'json' ? 'json' : 'text', options.pretty, {
          tempDir: options.tempDir,
        });
        break;

      case 'config':
        await commandConfig({
          minQuality: options.minQuality,
          tempDir: options.tempDir,
          docsDir: options.docsDir,
          waitStrategy: options.waitStrategy,
        });
        break;

      case 'mcp':
        await serveMcp();
        break;

      case 'links':
        if (args.length === 0) {
          console.error('Error: Reference ID required. Usage: arcfetch links <ref-id>');
          process.exit(1);
        }
        await commandLinks(args[0], options.output === 'json' ? 'json' : 'text', options.pretty, {
          tempDir: options.tempDir,
        });
        break;

      case 'fetch-links':
        if (args.length === 0) {
          console.error('Error: Reference ID required. Usage: arcfetch fetch-links <ref-id>');
          process.exit(1);
        }
        await commandFetchLinks(
          args[0],
          options.output === 'json' ? 'json' : 'text',
          options.pretty,
          options.verbose,
          options.refetch,
          {
            tempDir: options.tempDir,
            docsDir: options.docsDir,
          }
        );
        break;

      default:
        showHelp();
        break;
    }
  } catch (error) {
    console.error('Error:', getErrorMessage(error));
    process.exit(1);
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error('Unexpected error:', getErrorMessage(err));
    process.exit(1);
  });
}
