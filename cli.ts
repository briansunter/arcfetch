#!/usr/bin/env bun

import { getVersion } from './src/utils/version';
import { loadConfig } from './src/config/index';
import { fetchUrl, closeBrowser } from './src/core/pipeline';
import { saveToTemp, listCached, promoteReference, deleteCached, extractLinksFromCached } from './src/core/cache';
import { serveMcp } from './index';

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
    --temp-dir <path>         Temp folder (default: .tmp)
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
    SOFETCH_MIN_SCORE          Minimum quality score
    SOFETCH_TEMP_DIR           Temp directory
    SOFETCH_DOCS_DIR           Docs directory

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

  // Fetch URL
  const result = await fetchUrl(options.url, config, options.verbose, options.forcePlaywright);

  // Close browser if it was used
  await closeBrowser();

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
  const saveResult = await saveToTemp(config, result.title!, options.url, result.markdown!, options.query, options.refetch);

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
    if (options.output === 'json') {
      console.log(JSON.stringify({
        success: true,
        alreadyExists: true,
        refId: saveResult.refId,
        filepath: saveResult.filepath,
        message: 'URL already fetched. Use --refetch to update.',
      }, null, 2));
    } else if (options.output === 'path') {
      console.log(saveResult.filepath);
    } else if (options.pretty) {
      console.log(`📦 Already cached: ${saveResult.refId}`);
      console.log(`   File: ${saveResult.filepath}`);
      console.log(`\n💡 Use --refetch to update`);
    } else {
      console.log(`Already cached: ${saveResult.refId}`);
      console.log(`Filepath: ${saveResult.filepath}`);
      console.log(`Use --refetch to update`);
    }
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
          size: result.markdown!.length,
          tokens: Math.round(result.markdown!.length / 4),
          quality: result.quality?.score,
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
    console.log(`**Size**: ${result.markdown!.length} chars (~${Math.round(result.markdown!.length / 4)} tokens)`);
    console.log(`**Quality**: ${result.quality?.score}/100`);
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
    console.log(`Size: ${result.markdown!.length} chars (~${Math.round(result.markdown!.length / 4)} tokens)`);
    console.log(`Quality: ${result.quality?.score}/100`);
    if (result.usedPlaywright) {
      console.log(`Playwright: Yes (${result.playwrightReason})`);
    }
  }
}

// ============================================================================
// LIST COMMAND
// ============================================================================

async function commandList(output: 'text' | 'json', pretty: boolean): Promise<void> {
  const config = loadConfig();
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

async function commandPromote(refId: string, output: 'text' | 'json', pretty: boolean): Promise<void> {
  const config = loadConfig();
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

async function commandDelete(refId: string, output: 'text' | 'json', pretty: boolean): Promise<void> {
  const config = loadConfig();
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

async function commandConfig(): Promise<void> {
  const config = loadConfig();
  console.log('Current configuration:\n');
  console.log(JSON.stringify(config, null, 2));
}

// ============================================================================
// LINKS COMMAND
// ============================================================================

async function commandLinks(refId: string, output: 'text' | 'json', pretty: boolean): Promise<void> {
  const config = loadConfig();
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
    console.log(JSON.stringify({
      success: true,
      sourceRef: result.sourceRef,
      count: result.count,
      links: result.links,
    }, null, 2));
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

interface FetchLinksResult {
  url: string;
  status: 'new' | 'cached' | 'failed';
  refId?: string;
  error?: string;
}

async function commandFetchLinks(
  refId: string,
  output: 'text' | 'json',
  pretty: boolean,
  verbose: boolean,
  refetch: boolean
): Promise<void> {
  const config = loadConfig();
  const linksResult = extractLinksFromCached(config, refId);

  if (linksResult.error) {
    if (output === 'json') {
      console.log(JSON.stringify({ success: false, error: linksResult.error }, null, 2));
    } else {
      console.error(`Error: ${linksResult.error}`);
    }
    process.exit(1);
  }

  if (linksResult.count === 0) {
    if (output === 'json') {
      console.log(JSON.stringify({ success: true, message: 'No links to fetch', results: [] }, null, 2));
    } else if (pretty) {
      console.log(`🔗 No links found in ${refId}`);
    } else {
      console.log(`No links found in ${refId}`);
    }
    return;
  }

  if (pretty) {
    console.log(`🔗 Fetching ${linksResult.count} links from ${refId}...\n`);
  } else if (output !== 'json') {
    console.log(`Fetching ${linksResult.count} links from ${refId}...\n`);
  }

  const results: FetchLinksResult[] = [];
  const concurrency = 5;
  const urls = linksResult.links.map(l => l.href);

  // Process in batches of 5
  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const batchPromises = batch.map(async (url): Promise<FetchLinksResult> => {
      try {
        const fetchResult = await fetchUrl(url, config, verbose);

        if (!fetchResult.success) {
          return { url, status: 'failed', error: fetchResult.error };
        }

        const saveResult = await saveToTemp(
          config,
          fetchResult.title!,
          url,
          fetchResult.markdown!,
          undefined,
          refetch
        );

        if (saveResult.error) {
          return { url, status: 'failed', error: saveResult.error };
        }

        if (saveResult.alreadyExists) {
          return { url, status: 'cached', refId: saveResult.refId };
        }

        return { url, status: 'new', refId: saveResult.refId };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { url, status: 'failed', error: message };
      }
    });

    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);

    // Print progress for non-json output
    if (output !== 'json') {
      for (const r of batchResults) {
        if (pretty) {
          if (r.status === 'new') {
            console.log(`✓ ${r.refId} (new)`);
          } else if (r.status === 'cached') {
            console.log(`○ ${r.refId} (already cached)`);
          } else {
            console.log(`✗ ${r.url.slice(0, 50)}... (${r.error})`);
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
    }
  }

  // Close browser after all fetches
  await closeBrowser();

  const newCount = results.filter(r => r.status === 'new').length;
  const cachedCount = results.filter(r => r.status === 'cached').length;
  const failedCount = results.filter(r => r.status === 'failed').length;

  if (output === 'json') {
    console.log(JSON.stringify({
      success: true,
      sourceRef: refId,
      summary: { new: newCount, cached: cachedCount, failed: failedCount },
      results,
    }, null, 2));
  } else {
    console.log('');
    if (pretty) {
      console.log(`📊 Summary: ${newCount} new, ${cachedCount} cached, ${failedCount} failed`);
    } else {
      console.log(`Summary: ${newCount} new, ${cachedCount} cached, ${failedCount} failed`);
    }
  }
}

// ============================================================================
// ARGUMENT PARSING
// ============================================================================

interface ParsedOptions {
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

function parseArgs(): { command: string; args: string[]; options: ParsedOptions } {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    return { command: 'help', args: [], options: { output: 'text', verbose: false, pretty: false, refetch: false } };
  }

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
      options.query = next;
      i++;
    } else if (arg === '-o' || arg === '--output') {
      if (next === 'text' || next === 'json' || next === 'summary' || next === 'path') {
        options.output = next;
      }
      i++;
    } else if (arg === '-v' || arg === '--verbose') {
      options.verbose = true;
    } else if (arg === '--pretty') {
      options.pretty = true;
    } else if (arg === '--min-quality') {
      options.minQuality = parseInt(next, 10);
      i++;
    } else if (arg === '--temp-dir') {
      options.tempDir = next;
      i++;
    } else if (arg === '--docs-dir') {
      options.docsDir = next;
      i++;
    } else if (arg === '--wait-strategy') {
      if (next === 'networkidle' || next === 'domcontentloaded' || next === 'load') {
        options.waitStrategy = next;
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
        await commandList(options.output === 'json' ? 'json' : 'text', options.pretty);
        break;

      case 'promote':
        if (args.length === 0) {
          console.error('Error: Reference ID required. Usage: arcfetch promote <ref-id>');
          process.exit(1);
        }
        await commandPromote(args[0], options.output === 'json' ? 'json' : 'text', options.pretty);
        break;

      case 'delete':
        if (args.length === 0) {
          console.error('Error: Reference ID required. Usage: arcfetch delete <ref-id>');
          process.exit(1);
        }
        await commandDelete(args[0], options.output === 'json' ? 'json' : 'text', options.pretty);
        break;

      case 'config':
        await commandConfig();
        break;

      case 'mcp':
        await serveMcp();
        break;

      case 'links':
        if (args.length === 0) {
          console.error('Error: Reference ID required. Usage: arcfetch links <ref-id>');
          process.exit(1);
        }
        await commandLinks(args[0], options.output === 'json' ? 'json' : 'text', options.pretty);
        break;

      case 'fetch-links':
        if (args.length === 0) {
          console.error('Error: Reference ID required. Usage: arcfetch fetch-links <ref-id>');
          process.exit(1);
        }
        await commandFetchLinks(args[0], options.output === 'json' ? 'json' : 'text', options.pretty, options.verbose, options.refetch);
        break;

      default:
        showHelp();
        break;
    }
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
