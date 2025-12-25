#!/usr/bin/env bun

import { z } from 'zod';
import { loadConfig, type CliConfigOverrides } from './src/config/index.js';
import { fetchUrl, closeBrowser } from './src/core/pipeline.js';
import { saveToTemp, listCached, promoteReference, deleteCached } from './src/core/cache.js';

// ============================================================================
// HELP
// ============================================================================

function showHelp(): void {
  console.log(`
📦 Fetchi v3.0 - Fetch URLs and cache as clean markdown

USAGE:
    fetchi <command> [options]

COMMANDS:
    fetch <url>       Fetch URL and save to temp folder
    list              List all cached references
    promote <ref-id>  Move reference from temp to docs folder
    delete <ref-id>   Delete a cached reference
    config            Show current configuration
    help              Show this help message

FETCH OPTIONS:
    -q, --query <text>        Search query (saved as metadata)
    -o, --output <format>     Output: text, json, summary (default: text)
    -v, --verbose             Show detailed output
    --min-quality <n>         Minimum quality score 0-100 (default: 60)
    --temp-dir <path>         Temp folder (default: .tmp)
    --docs-dir <path>         Docs folder (default: docs/ai/references)
    --playwright <mode>       Playwright mode: auto, local, docker

EXAMPLES:
    # Fetch a URL
    fetchi fetch https://example.com/article

    # Fetch with custom quality threshold
    fetchi fetch https://example.com --min-quality 70

    # List cached references
    fetchi list

    # Promote to docs folder
    fetchi promote REF-001

    # Delete a reference
    fetchi delete REF-001

ENVIRONMENT VARIABLES:
    FETCHI_MIN_SCORE          Minimum quality score
    FETCHI_TEMP_DIR           Temp directory
    FETCHI_DOCS_DIR           Docs directory
    FETCHI_PLAYWRIGHT_MODE    Playwright mode (auto/local/docker)

CONFIG FILE:
    Place fetchi.config.json in project root for persistent settings.
`);
}

// ============================================================================
// FETCH COMMAND
// ============================================================================

interface FetchOptions {
  url: string;
  query?: string;
  output: 'text' | 'json' | 'summary';
  verbose: boolean;
  minQuality?: number;
  tempDir?: string;
  docsDir?: string;
  playwrightMode?: 'auto' | 'local' | 'docker';
}

async function commandFetch(options: FetchOptions): Promise<void> {
  const config = loadConfig({
    minQuality: options.minQuality,
    tempDir: options.tempDir,
    docsDir: options.docsDir,
    playwrightMode: options.playwrightMode,
  });

  if (options.verbose) {
    console.error('🔧 Config:', JSON.stringify(config, null, 2));
  }

  // Fetch URL
  const result = await fetchUrl(options.url, config, options.verbose);

  // Close browser if it was used
  await closeBrowser();

  if (!result.success) {
    if (options.output === 'json') {
      console.log(JSON.stringify({
        success: false,
        error: result.error,
        suggestion: result.suggestion,
        quality: result.quality,
      }, null, 2));
    } else {
      console.error(`❌ ${result.error}`);
      if (result.suggestion) {
        console.error(`💡 ${result.suggestion}`);
      }
      if (result.quality) {
        console.error(`📊 Quality: ${result.quality.score}/100`);
      }
    }
    process.exit(1);
  }

  // Save to temp
  const saveResult = await saveToTemp(
    config,
    result.title!,
    options.url,
    result.markdown!,
    options.query
  );

  // Small delay to ensure file is flushed to disk (Bun-specific issue)
  await new Promise(resolve => setTimeout(resolve, 100));

  if (saveResult.error) {
    if (options.output === 'json') {
      console.log(JSON.stringify({ success: false, error: saveResult.error }, null, 2));
    } else {
      console.error(`❌ Save failed: ${saveResult.error}`);
    }
    process.exit(1);
  }

  // Output result
  if (options.output === 'json') {
    console.log(JSON.stringify({
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
    }, null, 2));
  } else if (options.output === 'summary') {
    console.log(`${saveResult.refId}|${saveResult.filepath}`);
  } else {
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
    console.log(`\n💡 To promote to docs: fetchi promote ${saveResult.refId}`);
  }
}

// ============================================================================
// LIST COMMAND
// ============================================================================

async function commandList(output: 'text' | 'json'): Promise<void> {
  const config = loadConfig();
  const result = listCached(config);

  if (result.error) {
    console.error(`❌ ${result.error}`);
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

  console.log(`📚 Cached references (${result.references.length}):\n`);
  
  for (const ref of result.references) {
    console.log(`${ref.refId} | ${ref.title.slice(0, 50)}${ref.title.length > 50 ? '...' : ''}`);
    console.log(`   📅 ${ref.fetchedDate} | 📄 ${Math.round(ref.size / 1024)}KB`);
    console.log(`   🔗 ${ref.url.slice(0, 60)}${ref.url.length > 60 ? '...' : ''}`);
    console.log('');
  }

  console.log(`💡 To promote: fetchi promote <ref-id>`);
  console.log(`💡 To delete: fetchi delete <ref-id>`);
}

// ============================================================================
// PROMOTE COMMAND
// ============================================================================

async function commandPromote(refId: string, output: 'text' | 'json'): Promise<void> {
  const config = loadConfig();
  const result = promoteReference(config, refId);

  if (output === 'json') {
    console.log(JSON.stringify(result, null, 2));
    if (!result.success) process.exit(1);
    return;
  }

  if (!result.success) {
    console.error(`❌ ${result.error}`);
    process.exit(1);
  }

  console.log(`✅ Promoted ${refId}`);
  console.log(`   From: ${result.fromPath}`);
  console.log(`   To:   ${result.toPath}`);
}

// ============================================================================
// DELETE COMMAND
// ============================================================================

async function commandDelete(refId: string, output: 'text' | 'json'): Promise<void> {
  const config = loadConfig();
  const result = deleteCached(config, refId);

  if (output === 'json') {
    console.log(JSON.stringify(result, null, 2));
    if (!result.success) process.exit(1);
    return;
  }

  if (!result.success) {
    console.error(`❌ ${result.error}`);
    process.exit(1);
  }

  console.log(`✅ Deleted ${refId}`);
  console.log(`   File: ${result.filepath}`);
}

// ============================================================================
// CONFIG COMMAND
// ============================================================================

async function commandConfig(): Promise<void> {
  const config = loadConfig();
  console.log('📋 Current configuration:\n');
  console.log(JSON.stringify(config, null, 2));
}

// ============================================================================
// ARGUMENT PARSING
// ============================================================================

function parseArgs(): { command: string; args: string[]; options: Record<string, any> } {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    return { command: 'help', args: [], options: {} };
  }

  const command = args[0];
  const options: Record<string, any> = {
    output: 'text',
    verbose: false,
  };
  const positionalArgs: string[] = [];

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    if (arg === '-q' || arg === '--query') {
      options.query = next;
      i++;
    } else if (arg === '-o' || arg === '--output') {
      options.output = next;
      i++;
    } else if (arg === '-v' || arg === '--verbose') {
      options.verbose = true;
    } else if (arg === '--min-quality') {
      options.minQuality = parseInt(next, 10);
      i++;
    } else if (arg === '--temp-dir') {
      options.tempDir = next;
      i++;
    } else if (arg === '--docs-dir') {
      options.docsDir = next;
      i++;
    } else if (arg === '--playwright') {
      options.playwrightMode = next;
      i++;
    } else if (arg === '-h' || arg === '--help') {
      return { command: 'help', args: [], options: {} };
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
          console.error('❌ URL required. Usage: fetchi fetch <url>');
          process.exit(1);
        }
        await commandFetch({
          url: args[0],
          query: options.query,
          output: options.output,
          verbose: options.verbose,
          minQuality: options.minQuality,
          tempDir: options.tempDir,
          docsDir: options.docsDir,
          playwrightMode: options.playwrightMode,
        });
        break;

      case 'list':
        await commandList(options.output);
        break;

      case 'promote':
        if (args.length === 0) {
          console.error('❌ Reference ID required. Usage: fetchi promote <ref-id>');
          process.exit(1);
        }
        await commandPromote(args[0], options.output);
        break;

      case 'delete':
        if (args.length === 0) {
          console.error('❌ Reference ID required. Usage: fetchi delete <ref-id>');
          process.exit(1);
        }
        await commandDelete(args[0], options.output);
        break;

      case 'config':
        await commandConfig();
        break;

      case 'help':
      default:
        showHelp();
        break;
    }
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('❌ Unexpected error:', err);
  process.exit(1);
});
