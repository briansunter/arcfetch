import { z } from 'zod';
import { loadConfig } from '../config/index';
import { deleteCached, extractLinksFromCached, listCached, promoteReference } from '../core/cache';
import { fetchLinksFromRef } from '../core/fetch-links';
import { closeBrowser } from '../core/pipeline';
import { acquireReference } from '../core/references/acquire';
import {
  type OutputFormat,
  renderDeleteResult,
  renderFetchLinksResult,
  renderFetchOutcome,
  renderLinksResult,
  renderListResult,
  renderPromoteResult,
} from '../ui/render';
import { type McpTool, mcpText } from './register';

function mcpFormat(outputFormat: 'summary' | 'path' | 'json' | undefined): OutputFormat {
  if (outputFormat === 'path') return 'path';
  if (outputFormat === 'json') return 'json';
  return 'text';
}

function jsonOrText(outputFormat: 'summary' | 'json' | undefined): OutputFormat {
  return outputFormat === 'json' ? 'json' : 'text';
}

const TEMP_DIR_PROP = {
  type: 'string',
  description: 'Optional: Temp folder path (default: .tmp/arcfetch)',
} as const;

const DOCS_DIR_PROP = {
  type: 'string',
  description: 'Optional: Docs folder path (default: docs/ai/references)',
} as const;

const FetchUrlArgs = z.object({
  url: z.string(),
  query: z.string().optional(),
  minQuality: z.number().min(0).max(100).optional(),
  tempDir: z.string().optional(),
  outputFormat: z.enum(['summary', 'path', 'json']).optional(),
  refetch: z.boolean().optional(),
});

const fetchUrlTool: McpTool<z.infer<typeof FetchUrlArgs>> = {
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
      url: { type: 'string', description: 'URL to fetch' },
      query: { type: 'string', description: "Optional: What you're looking for (saved as metadata)" },
      minQuality: { type: 'number', description: 'Optional: Minimum quality score 0-100 (default: 60)' },
      tempDir: TEMP_DIR_PROP,
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
  argsSchema: FetchUrlArgs,
  handle: async (args) => {
    const config = loadConfig({ minQuality: args.minQuality, tempDir: args.tempDir });
    let outcome: Awaited<ReturnType<typeof acquireReference>>;
    try {
      outcome = await acquireReference(args.url, config, { query: args.query, refetch: args.refetch });
    } finally {
      await closeBrowser();
    }
    return mcpText(
      renderFetchOutcome({ outcome, url: args.url, query: args.query, format: mcpFormat(args.outputFormat) })
    );
  },
};

const ListCachedArgs = z.object({
  tempDir: z.string().optional(),
});

const listCachedTool: McpTool<z.infer<typeof ListCachedArgs>> = {
  name: 'list_cached',
  description: 'List all cached references in the temp folder. Shows ref ID, title, date, size, and URL for each.',
  inputSchema: {
    type: 'object',
    properties: { tempDir: TEMP_DIR_PROP },
  },
  argsSchema: ListCachedArgs,
  handle: (args) => {
    const config = loadConfig({ tempDir: args.tempDir });
    const result = listCached(config);
    if (result.error) {
      return mcpText(`Error: ${result.error}`);
    }
    return mcpText(renderListResult(result.references, config.paths.tempDir, 'text'));
  },
};

const PromoteReferenceArgs = z.object({
  refId: z.string(),
  tempDir: z.string().optional(),
  docsDir: z.string().optional(),
});

const promoteReferenceTool: McpTool<z.infer<typeof PromoteReferenceArgs>> = {
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
      docsDir: DOCS_DIR_PROP,
      tempDir: TEMP_DIR_PROP,
    },
    required: ['refId'],
  },
  argsSchema: PromoteReferenceArgs,
  handle: (args) => {
    const config = loadConfig({ tempDir: args.tempDir, docsDir: args.docsDir });
    const result = promoteReference(config, args.refId);
    return mcpText(renderPromoteResult(args.refId, result, 'text'));
  },
};

const DeleteCachedArgs = z.object({
  refId: z.string(),
  tempDir: z.string().optional(),
});

const deleteCachedTool: McpTool<z.infer<typeof DeleteCachedArgs>> = {
  name: 'delete_cached',
  description: 'Delete a cached reference from the temp folder.',
  inputSchema: {
    type: 'object',
    properties: {
      refId: { type: 'string', description: 'Reference ID to delete (the filename slug)' },
      tempDir: TEMP_DIR_PROP,
    },
    required: ['refId'],
  },
  argsSchema: DeleteCachedArgs,
  handle: (args) => {
    const config = loadConfig({ tempDir: args.tempDir });
    const result = deleteCached(config, args.refId);
    return mcpText(renderDeleteResult(args.refId, result, 'text'));
  },
};

const ExtractLinksArgs = z.object({
  refId: z.string(),
  tempDir: z.string().optional(),
  outputFormat: z.enum(['summary', 'json']).optional(),
});

const extractLinksTool: McpTool<z.infer<typeof ExtractLinksArgs>> = {
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
      tempDir: TEMP_DIR_PROP,
    },
    required: ['refId'],
  },
  argsSchema: ExtractLinksArgs,
  handle: (args) => {
    const config = loadConfig({ tempDir: args.tempDir });
    const result = extractLinksFromCached(config, args.refId);
    return mcpText(renderLinksResult(args.refId, result, jsonOrText(args.outputFormat)));
  },
};

const FetchLinksArgs = z.object({
  refId: z.string(),
  tempDir: z.string().optional(),
  docsDir: z.string().optional(),
  refetch: z.boolean().optional(),
  outputFormat: z.enum(['summary', 'json']).optional(),
});

const fetchLinksTool: McpTool<z.infer<typeof FetchLinksArgs>> = {
  name: 'fetch_links',
  description:
    'Fetch all links from a cached reference. Extracts links and fetches each one, caching as new references. Uses parallel fetching (max 3 concurrent).',
  inputSchema: {
    type: 'object',
    properties: {
      refId: { type: 'string', description: 'Reference ID to extract and fetch links from' },
      refetch: {
        type: 'boolean',
        description: 'Force re-fetch even if URLs already cached (default: false)',
      },
      outputFormat: {
        type: 'string',
        description: 'Output format: summary (default) or json',
        enum: ['summary', 'json'],
      },
      tempDir: TEMP_DIR_PROP,
      docsDir: DOCS_DIR_PROP,
    },
    required: ['refId'],
  },
  argsSchema: FetchLinksArgs,
  handle: async (args) => {
    const config = loadConfig({ tempDir: args.tempDir, docsDir: args.docsDir });
    const result = await fetchLinksFromRef(config, args.refId, { refetch: args.refetch });
    return mcpText(renderFetchLinksResult(args.refId, result, jsonOrText(args.outputFormat)));
  },
};

// biome-ignore lint/suspicious/noExplicitAny: each tool has its own arg type; the registrar treats them uniformly.
export const allTools: McpTool<any>[] = [
  fetchUrlTool,
  listCachedTool,
  promoteReferenceTool,
  deleteCachedTool,
  extractLinksTool,
  fetchLinksTool,
];
