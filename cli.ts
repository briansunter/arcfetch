#!/usr/bin/env bun

import { serveMcp } from './index';
import { loadConfig } from './src/config/index';
import { deleteCached, extractLinksFromCached, listCached, promoteReference } from './src/core/cache';
import { type FetchLinkResult, fetchLinksFromRef } from './src/core/fetch-links';
import { closeBrowser } from './src/core/pipeline';
import { acquireReference } from './src/core/references/acquire';
import {
  type OutputFormat,
  renderDeleteResult,
  renderFetchLinksResult,
  renderFetchOutcome,
  renderLinkProgressLine,
  renderLinksResult,
  renderListResult,
  renderPromoteResult,
} from './src/core/render';
import { getErrorMessage } from './src/utils/error';
import { getVersion } from './src/utils/version';

function cliFormat(output: 'text' | 'json' | 'summary' | 'path', pretty: boolean): OutputFormat {
  if (output === 'json') return 'json';
  if (output === 'path') return 'path';
  if (output === 'summary') return 'cli-summary';
  return pretty ? 'pretty' : 'text';
}

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

  let outcome: Awaited<ReturnType<typeof acquireReference>>;
  try {
    outcome = await acquireReference(options.url, config, {
      query: options.query,
      refetch: options.refetch,
      verbose: options.verbose,
      forcePlaywright: options.forcePlaywright,
    });
  } finally {
    await closeBrowser();
  }

  const format = cliFormat(options.output, options.pretty);
  const rendered = renderFetchOutcome({ outcome, url: options.url, query: options.query, format });

  if (!outcome.ok) {
    if (format === 'json') {
      console.log(rendered);
    } else {
      console.error(rendered);
    }
    process.exit(1);
  }

  console.log(rendered);
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

  const format: OutputFormat = output === 'json' ? 'json' : pretty ? 'pretty' : 'text';
  console.log(renderListResult(result.references, config.paths.tempDir, format));
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
  const format: OutputFormat = output === 'json' ? 'json' : pretty ? 'pretty' : 'text';
  const rendered = renderPromoteResult(refId, result, format);

  if (!result.success) {
    if (format === 'json') console.log(rendered);
    else console.error(rendered);
    process.exit(1);
  }
  console.log(rendered);
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
  const format: OutputFormat = output === 'json' ? 'json' : pretty ? 'pretty' : 'text';
  const rendered = renderDeleteResult(refId, result, format);

  if (!result.success) {
    if (format === 'json') console.log(rendered);
    else console.error(rendered);
    process.exit(1);
  }
  console.log(rendered);
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
  const format: OutputFormat = output === 'json' ? 'json' : pretty ? 'pretty' : 'text';
  const rendered = renderLinksResult(refId, result, format);

  if (result.error) {
    if (format === 'json') console.log(rendered);
    else console.error(rendered);
    process.exit(1);
  }
  console.log(rendered);
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
  const format: OutputFormat = output === 'json' ? 'json' : pretty ? 'pretty' : 'text';

  const onProgress =
    format === 'json' ? undefined : (r: FetchLinkResult) => console.log(renderLinkProgressLine(r, format));

  const result = await fetchLinksFromRef(config, refId, { refetch, verbose, onProgress });

  if (result.error) {
    const rendered = renderFetchLinksResult(refId, result, format);
    if (format === 'json') console.log(rendered);
    else console.error(rendered);
    process.exit(1);
  }

  if (format === 'json') {
    console.log(renderFetchLinksResult(refId, result, format));
    return;
  }

  if (result.results.length === 0) {
    console.log(`No links found in ${refId}`);
    return;
  }

  // Per-link lines were already streamed via onProgress; print the trailing summary.
  console.log('');
  console.log(`Summary: ${result.summary.new} new, ${result.summary.cached} cached, ${result.summary.failed} failed`);
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
