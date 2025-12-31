#!/usr/bin/env bun
/**
 * Arcfetch MCP Server
 *
 * Tools:
 * - fetch_url: Fetch URL with automatic JS fallback, save to temp
 * - list_cached: List all cached references
 * - promote_reference: Move from temp to docs folder
 * - delete_cached: Delete a cached reference
 */

import { getVersion } from './src/utils/version';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { loadConfig } from './src/config/index';
import { fetchUrl, closeBrowser } from './src/core/pipeline';
import { saveToTemp, listCached, promoteReference, deleteCached, extractLinksFromCached } from './src/core/cache';

const server = new Server(
  {
    name: 'arcfetch',
    version: getVersion(),
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'fetch_url',
        description: `Fetch URL, extract article content, convert to clean markdown, and save to temp folder.

Features:
- Automatic JavaScript rendering fallback (via Playwright/Docker)
- Quality validation with configurable thresholds
- 90-95% token reduction vs raw HTML

Returns summary with title, author, excerpt. Use Read tool to access full content.`,
        inputSchema: {
          type: 'object',
          properties: {
            url: {
              type: 'string',
              description: 'URL to fetch',
            },
            query: {
              type: 'string',
              description: "Optional: What you're looking for (saved as metadata)",
            },
            minQuality: {
              type: 'number',
              description: 'Optional: Minimum quality score 0-100 (default: 60)',
            },
            tempDir: {
              type: 'string',
              description: 'Optional: Temp folder path (default: .tmp)',
            },
            outputFormat: {
              type: 'string',
              description: 'Output format: summary (default), path (filepath only), json (structured data)',
              enum: ['summary', 'path', 'json'],
            },
            refetch: {
              type: 'boolean',
              description: 'Force re-fetch and update even if URL already cached (default: false)',
            },
          },
          required: ['url'],
        },
      },
      {
        name: 'list_cached',
        description:
          'List all cached references in the temp folder. Shows ref ID, title, date, size, and URL for each.',
        inputSchema: {
          type: 'object',
          properties: {
            tempDir: {
              type: 'string',
              description: 'Optional: Temp folder path (default: .tmp)',
            },
          },
        },
      },
      {
        name: 'promote_reference',
        description:
          "Move a cached reference from temp folder to permanent docs folder. Updates status from 'temporary' to 'permanent'.",
        inputSchema: {
          type: 'object',
          properties: {
            refId: {
              type: 'string',
              description: 'Reference ID (the filename slug, e.g., "how-to-build-react-apps")',
            },
            docsDir: {
              type: 'string',
              description: 'Optional: Docs folder path (default: docs/ai/references)',
            },
          },
          required: ['refId'],
        },
      },
      {
        name: 'delete_cached',
        description: 'Delete a cached reference from the temp folder.',
        inputSchema: {
          type: 'object',
          properties: {
            refId: {
              type: 'string',
              description: 'Reference ID to delete (the filename slug)',
            },
          },
          required: ['refId'],
        },
      },
      {
        name: 'extract_links',
        description: 'Extract all http/https links from a cached reference markdown. Returns list of links with their text and URLs.',
        inputSchema: {
          type: 'object',
          properties: {
            refId: {
              type: 'string',
              description: 'Reference ID to extract links from (the filename slug)',
            },
            outputFormat: {
              type: 'string',
              description: 'Output format: summary (default) or json',
              enum: ['summary', 'json'],
            },
          },
          required: ['refId'],
        },
      },
      {
        name: 'fetch_links',
        description: 'Fetch all links from a cached reference. Extracts links and fetches each one, caching as new references. Uses parallel fetching (max 5 concurrent).',
        inputSchema: {
          type: 'object',
          properties: {
            refId: {
              type: 'string',
              description: 'Reference ID to extract and fetch links from',
            },
            refetch: {
              type: 'boolean',
              description: 'Force re-fetch even if URLs already cached (default: false)',
            },
            outputFormat: {
              type: 'string',
              description: 'Output format: summary (default) or json',
              enum: ['summary', 'json'],
            },
          },
          required: ['refId'],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'fetch_url':
      return handleFetchUrl(
        args as {
          url: string;
          query?: string;
          minQuality?: number;
          tempDir?: string;
          outputFormat?: 'summary' | 'path' | 'json';
          refetch?: boolean;
        }
      );

    case 'list_cached':
      return handleListCached(
        args as {
          tempDir?: string;
        }
      );

    case 'promote_reference':
      return handlePromoteReference(
        args as {
          refId: string;
          docsDir?: string;
        }
      );

    case 'delete_cached':
      return handleDeleteCached(
        args as {
          refId: string;
        }
      );

    case 'extract_links':
      return handleExtractLinks(
        args as {
          refId: string;
          outputFormat?: 'summary' | 'json';
        }
      );

    case 'fetch_links':
      return handleFetchLinks(
        args as {
          refId: string;
          refetch?: boolean;
          outputFormat?: 'summary' | 'json';
        }
      );

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

async function handleFetchUrl(args: {
  url: string;
  query?: string;
  minQuality?: number;
  tempDir?: string;
  outputFormat?: 'summary' | 'path' | 'json';
  refetch?: boolean;
}) {
  const config = loadConfig({
    minQuality: args.minQuality,
    tempDir: args.tempDir,
  });

  const result = await fetchUrl(args.url, config, false);

  await closeBrowser();

  if (!result.success) {
    const errorText =
      `Error: ${result.error}` +
      (result.suggestion ? `\nSuggestion: ${result.suggestion}` : '') +
      (result.quality ? `\nQuality: ${result.quality.score}/100` : '');
    return {
      content: [{ type: 'text', text: errorText }],
    };
  }

  const saveResult = await saveToTemp(config, result.title!, args.url, result.markdown!, args.query, args.refetch);

  if (saveResult.error) {
    return {
      content: [{ type: 'text', text: `Error: Save failed: ${saveResult.error}` }],
    };
  }

  // Handle already exists case
  if (saveResult.alreadyExists) {
    const outputFormat = args.outputFormat || 'summary';
    if (outputFormat === 'path') {
      return { content: [{ type: 'text', text: saveResult.filepath }] };
    }
    if (outputFormat === 'json') {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            alreadyExists: true,
            refId: saveResult.refId,
            filepath: saveResult.filepath,
            message: 'URL already fetched. Use refetch: true to update.',
          }, null, 2),
        }],
      };
    }
    return {
      content: [{
        type: 'text',
        text: `Already cached: ${saveResult.refId}\nFilepath: ${saveResult.filepath}\n\nUse refetch: true to update.`,
      }],
    };
  }

  const outputFormat = args.outputFormat || 'summary';

  // Path-only output
  if (outputFormat === 'path') {
    return {
      content: [{ type: 'text', text: saveResult.filepath }],
    };
  }

  // JSON output
  if (outputFormat === 'json') {
    const jsonData = {
      success: true,
      refId: saveResult.refId,
      title: result.title,
      byline: result.byline,
      siteName: result.siteName,
      excerpt: result.excerpt,
      url: args.url,
      filepath: saveResult.filepath,
      size: result.markdown!.length,
      tokens: Math.round(result.markdown!.length / 4),
      quality: result.quality?.score,
      usedPlaywright: result.usedPlaywright,
      playwrightReason: result.playwrightReason,
      query: args.query,
    };
    return {
      content: [{ type: 'text', text: JSON.stringify(jsonData, null, 2) }],
    };
  }

  // Summary output (default) - clean, LLM-friendly
  let text = `Cached: ${saveResult.refId}\n\n`;
  text += `Title: ${result.title}\n`;
  if (result.byline) text += `Author: ${result.byline}\n`;
  if (result.siteName) text += `Source: ${result.siteName}\n`;
  if (result.excerpt) {
    const excerpt = result.excerpt.slice(0, 150);
    text += `Summary: ${excerpt}${result.excerpt.length > 150 ? '...' : ''}\n`;
  }
  text += `\nFilepath: ${saveResult.filepath}\n`;
  text += `Size: ${result.markdown!.length} chars (~${Math.round(result.markdown!.length / 4)} tokens)\n`;
  text += `Quality: ${result.quality?.score}/100`;

  if (result.usedPlaywright) {
    text += `\nPlaywright: Yes (${result.playwrightReason})`;
  }

  return {
    content: [{ type: 'text', text }],
  };
}

async function handleListCached(args: { tempDir?: string }) {
  const config = loadConfig({ tempDir: args.tempDir });
  const result = listCached(config);

  if (result.error) {
    return {
      content: [{ type: 'text', text: `Error: ${result.error}` }],
    };
  }

  if (result.references.length === 0) {
    return {
      content: [{ type: 'text', text: `No cached references in ${config.paths.tempDir}/` }],
    };
  }

  let text = `Cached references (${result.references.length}):\n\n`;

  for (const ref of result.references) {
    text += `${ref.refId} | ${ref.title.slice(0, 50)}${ref.title.length > 50 ? '...' : ''}\n`;
    text += `  Date: ${ref.fetchedDate} | Size: ${Math.round(ref.size / 1024)}KB\n`;
    text += `  URL: ${ref.url.slice(0, 60)}${ref.url.length > 60 ? '...' : ''}\n\n`;
  }

  return {
    content: [{ type: 'text', text: text.trim() }],
  };
}

async function handlePromoteReference(args: { refId: string; docsDir?: string }) {
  const config = loadConfig({ docsDir: args.docsDir });
  const result = promoteReference(config, args.refId);

  if (!result.success) {
    return {
      content: [{ type: 'text', text: `Error: ${result.error}` }],
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: `Promoted: ${args.refId}\nFrom: ${result.fromPath}\nTo: ${result.toPath}`,
      },
    ],
  };
}

async function handleDeleteCached(args: { refId: string }) {
  const config = loadConfig();
  const result = deleteCached(config, args.refId);

  if (!result.success) {
    return {
      content: [{ type: 'text', text: `Error: ${result.error}` }],
    };
  }

  return {
    content: [
      {
        type: 'text',
        text: `Deleted: ${args.refId}\nFile: ${result.filepath}`,
      },
    ],
  };
}

async function handleExtractLinks(args: { refId: string; outputFormat?: 'summary' | 'json' }) {
  const config = loadConfig();
  const result = extractLinksFromCached(config, args.refId);

  if (result.error) {
    return {
      content: [{ type: 'text', text: `Error: ${result.error}` }],
    };
  }

  if (args.outputFormat === 'json') {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          sourceRef: result.sourceRef,
          count: result.count,
          links: result.links,
        }, null, 2),
      }],
    };
  }

  if (result.count === 0) {
    return {
      content: [{ type: 'text', text: `No links found in ${args.refId}` }],
    };
  }

  let text = `Found ${result.count} links in ${args.refId}:\n\n`;
  for (const link of result.links) {
    text += `${link.text} | ${link.href}\n`;
  }

  return {
    content: [{ type: 'text', text: text.trim() }],
  };
}

interface FetchLinksResult {
  url: string;
  status: 'new' | 'cached' | 'failed';
  refId?: string;
  error?: string;
}

async function handleFetchLinks(args: { refId: string; refetch?: boolean; outputFormat?: 'summary' | 'json' }) {
  const config = loadConfig();
  const linksResult = extractLinksFromCached(config, args.refId);

  if (linksResult.error) {
    return {
      content: [{ type: 'text', text: `Error: ${linksResult.error}` }],
    };
  }

  if (linksResult.count === 0) {
    if (args.outputFormat === 'json') {
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, message: 'No links to fetch', results: [] }, null, 2) }],
      };
    }
    return {
      content: [{ type: 'text', text: `No links found in ${args.refId}` }],
    };
  }

  const results: FetchLinksResult[] = [];
  const concurrency = 5;
  const urls = linksResult.links.map(l => l.href);

  // Process in batches of 5
  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const batchPromises = batch.map(async (url): Promise<FetchLinksResult> => {
      try {
        const fetchResult = await fetchUrl(url, config, false);

        if (!fetchResult.success) {
          return { url, status: 'failed', error: fetchResult.error };
        }

        const saveResult = await saveToTemp(
          config,
          fetchResult.title!,
          url,
          fetchResult.markdown!,
          undefined,
          args.refetch
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
  }

  // Close browser after all fetches
  await closeBrowser();

  const newCount = results.filter(r => r.status === 'new').length;
  const cachedCount = results.filter(r => r.status === 'cached').length;
  const failedCount = results.filter(r => r.status === 'failed').length;

  if (args.outputFormat === 'json') {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: true,
          sourceRef: args.refId,
          summary: { new: newCount, cached: cachedCount, failed: failedCount },
          results,
        }, null, 2),
      }],
    };
  }

  let text = `Fetched links from ${args.refId}:\n\n`;
  for (const r of results) {
    if (r.status === 'new') {
      text += `new: ${r.refId}\n`;
    } else if (r.status === 'cached') {
      text += `cached: ${r.refId}\n`;
    } else {
      text += `failed: ${r.url} - ${r.error}\n`;
    }
  }
  text += `\nSummary: ${newCount} new, ${cachedCount} cached, ${failedCount} failed`;

  return {
    content: [{ type: 'text', text }],
  };
}

export async function serveMcp() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Arcfetch MCP server v${getVersion()} running on stdio`);
}

// Auto-start if run directly
if (import.meta.main) {
  serveMcp().catch((error) => {
    console.error('Server error:', error);
    process.exit(1);
  });
}
