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

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { loadConfig } from './src/config/index';
import { deleteCached, extractLinksFromCached, listCached, promoteReference } from './src/core/cache';
import { fetchLinksFromRef } from './src/core/fetch-links';
import { closeBrowser } from './src/core/pipeline';
import { acquireReference } from './src/core/references/acquire';
import { getErrorMessage } from './src/utils/error';
import { getVersion } from './src/utils/version';

const FetchUrlArgsSchema = z.object({
  url: z.string(),
  query: z.string().optional(),
  minQuality: z.number().min(0).max(100).optional(),
  tempDir: z.string().optional(),
  outputFormat: z.enum(['summary', 'path', 'json']).optional(),
  refetch: z.boolean().optional(),
});

const ListCachedArgsSchema = z.object({
  tempDir: z.string().optional(),
});

const PromoteReferenceArgsSchema = z.object({
  refId: z.string(),
  tempDir: z.string().optional(),
  docsDir: z.string().optional(),
});

const RefIdArgsSchema = z.object({
  refId: z.string(),
  tempDir: z.string().optional(),
});

const ExtractLinksArgsSchema = z.object({
  refId: z.string(),
  tempDir: z.string().optional(),
  outputFormat: z.enum(['summary', 'json']).optional(),
});

const FetchLinksArgsSchema = z.object({
  refId: z.string(),
  tempDir: z.string().optional(),
  docsDir: z.string().optional(),
  refetch: z.boolean().optional(),
  outputFormat: z.enum(['summary', 'json']).optional(),
});

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
- Automatic JavaScript rendering fallback (via Playwright)
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
              description: 'Optional: Temp folder path (default: .tmp/arcfetch)',
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
              description: 'Optional: Temp folder path (default: .tmp/arcfetch)',
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
            tempDir: {
              type: 'string',
              description: 'Optional: Temp folder path (default: .tmp/arcfetch)',
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
            tempDir: {
              type: 'string',
              description: 'Optional: Temp folder path (default: .tmp/arcfetch)',
            },
          },
          required: ['refId'],
        },
      },
      {
        name: 'extract_links',
        description:
          'Extract all http/https links from a cached reference markdown. Returns list of links with their text and URLs.',
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
            tempDir: {
              type: 'string',
              description: 'Optional: Temp folder path (default: .tmp/arcfetch)',
            },
          },
          required: ['refId'],
        },
      },
      {
        name: 'fetch_links',
        description:
          'Fetch all links from a cached reference. Extracts links and fetches each one, caching as new references. Uses parallel fetching (max 3 concurrent).',
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
            tempDir: {
              type: 'string',
              description: 'Optional: Temp folder path (default: .tmp/arcfetch)',
            },
            docsDir: {
              type: 'string',
              description: 'Optional: Docs folder path (default: docs/ai/references)',
            },
          },
          required: ['refId'],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    const { name, arguments: args } = request.params;

    switch (name) {
      case 'fetch_url':
        return handleFetchUrl(FetchUrlArgsSchema.parse(args));

      case 'list_cached':
        return handleListCached(ListCachedArgsSchema.parse(args));

      case 'promote_reference':
        return handlePromoteReference(PromoteReferenceArgsSchema.parse(args));

      case 'delete_cached':
        return handleDeleteCached(RefIdArgsSchema.parse(args));

      case 'extract_links':
        return handleExtractLinks(ExtractLinksArgsSchema.parse(args));

      case 'fetch_links':
        return handleFetchLinks(FetchLinksArgsSchema.parse(args));

      default:
        return {
          content: [{ type: 'text', text: `Error: Unknown tool: ${name}` }],
        };
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return {
        content: [
          {
            type: 'text',
            text: `Invalid arguments: ${error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
          },
        ],
      };
    }
    const message = getErrorMessage(error);
    return {
      content: [{ type: 'text', text: `Error: ${message}` }],
    };
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

  const outcome = await acquireReference(args.url, config, {
    query: args.query,
    refetch: args.refetch,
  });

  const outputFormat = args.outputFormat || 'summary';

  if (!outcome.ok) {
    if (outcome.stage === 'save') {
      return {
        content: [{ type: 'text', text: `Error: Save failed: ${outcome.error}` }],
      };
    }
    const errorText =
      `Error: ${outcome.error}` +
      (outcome.suggestion ? `\nSuggestion: ${outcome.suggestion}` : '') +
      (outcome.quality ? `\nQuality: ${outcome.quality.score}/100` : '');
    return {
      content: [{ type: 'text', text: errorText }],
    };
  }

  if (outcome.source === 'cached') {
    if (outputFormat === 'path') {
      return { content: [{ type: 'text', text: outcome.filepath }] };
    }
    if (outputFormat === 'json') {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: true,
                alreadyExists: true,
                refId: outcome.refId,
                filepath: outcome.filepath,
                message: 'URL already fetched. Use refetch: true to update.',
              },
              null,
              2
            ),
          },
        ],
      };
    }
    return {
      content: [
        {
          type: 'text',
          text: `Already cached: ${outcome.refId}\nFilepath: ${outcome.filepath}\n\nUse refetch: true to update.`,
        },
      ],
    };
  }

  if (outputFormat === 'path') {
    return {
      content: [{ type: 'text', text: outcome.filepath }],
    };
  }

  if (outputFormat === 'json') {
    const jsonData = {
      success: true,
      refId: outcome.refId,
      title: outcome.title,
      byline: outcome.byline,
      siteName: outcome.siteName,
      excerpt: outcome.excerpt,
      url: args.url,
      filepath: outcome.filepath,
      size: outcome.markdownLength,
      tokens: Math.round(outcome.markdownLength / 4),
      quality: outcome.quality.score,
      usedPlaywright: outcome.usedPlaywright,
      playwrightReason: outcome.playwrightReason,
      query: args.query,
    };
    return {
      content: [{ type: 'text', text: JSON.stringify(jsonData, null, 2) }],
    };
  }

  let text = `Cached: ${outcome.refId}\n\n`;
  text += `Title: ${outcome.title}\n`;
  if (outcome.byline) text += `Author: ${outcome.byline}\n`;
  if (outcome.siteName) text += `Source: ${outcome.siteName}\n`;
  if (outcome.excerpt) {
    const excerpt = outcome.excerpt.slice(0, 150);
    text += `Summary: ${excerpt}${outcome.excerpt.length > 150 ? '...' : ''}\n`;
  }
  text += `\nFilepath: ${outcome.filepath}\n`;
  text += `Size: ${outcome.markdownLength} chars (~${Math.round(outcome.markdownLength / 4)} tokens)\n`;
  text += `Quality: ${outcome.quality.score}/100`;

  if (outcome.usedPlaywright) {
    text += `\nPlaywright: Yes (${outcome.playwrightReason})`;
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

async function handlePromoteReference(args: { refId: string; tempDir?: string; docsDir?: string }) {
  const config = loadConfig({ tempDir: args.tempDir, docsDir: args.docsDir });
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

async function handleDeleteCached(args: { refId: string; tempDir?: string }) {
  const config = loadConfig({ tempDir: args.tempDir });
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

async function handleExtractLinks(args: { refId: string; tempDir?: string; outputFormat?: 'summary' | 'json' }) {
  const config = loadConfig({ tempDir: args.tempDir });
  const result = extractLinksFromCached(config, args.refId);

  if (result.error) {
    return {
      content: [{ type: 'text', text: `Error: ${result.error}` }],
    };
  }

  if (args.outputFormat === 'json') {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              sourceRef: result.sourceRef,
              count: result.count,
              links: result.links,
            },
            null,
            2
          ),
        },
      ],
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

async function handleFetchLinks(args: {
  refId: string;
  tempDir?: string;
  docsDir?: string;
  refetch?: boolean;
  outputFormat?: 'summary' | 'json';
}) {
  const config = loadConfig({ tempDir: args.tempDir, docsDir: args.docsDir });
  const { results, summary, error } = await fetchLinksFromRef(config, args.refId, { refetch: args.refetch });

  if (error) {
    return {
      content: [{ type: 'text', text: `Error: ${error}` }],
    };
  }

  if (results.length === 0) {
    if (args.outputFormat === 'json') {
      return {
        content: [
          { type: 'text', text: JSON.stringify({ success: true, message: 'No links to fetch', results: [] }, null, 2) },
        ],
      };
    }
    return {
      content: [{ type: 'text', text: `No links found in ${args.refId}` }],
    };
  }

  if (args.outputFormat === 'json') {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              success: true,
              sourceRef: args.refId,
              summary,
              results,
            },
            null,
            2
          ),
        },
      ],
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
  text += `\nSummary: ${summary.new} new, ${summary.cached} cached, ${summary.failed} failed`;

  return {
    content: [{ type: 'text', text }],
  };
}

export async function serveMcp() {
  const cleanup = async () => {
    await closeBrowser();
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Arcfetch MCP server v${getVersion()} running on stdio`);
}

// Auto-start if run directly
if (import.meta.main) {
  serveMcp().catch((error) => {
    console.error('Server error:', getErrorMessage(error));
    process.exit(1);
  });
}
