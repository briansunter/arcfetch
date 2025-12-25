#!/usr/bin/env bun
/**
 * Fetchi MCP Server v3.0
 * 
 * Tools:
 * - fetch_url: Fetch URL with automatic JS fallback, save to temp
 * - list_cached: List all cached references
 * - promote_reference: Move from temp to docs folder
 * - delete_cached: Delete a cached reference
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { loadConfig } from './src/config/index.js';
import { fetchUrl, closeBrowser } from './src/core/pipeline.js';
import { saveToTemp, listCached, promoteReference, deleteCached } from './src/core/cache.js';

const server = new Server(
  {
    name: "fetchi",
    version: "3.0.0",
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
        name: "fetch_url",
        description: `Fetch URL, extract article content, convert to clean markdown, and save to temp folder.

Features:
- Automatic JavaScript rendering fallback (via Playwright/Docker)
- Quality validation with configurable thresholds
- 90-95% token reduction vs raw HTML

Returns summary with title, author, excerpt. Use Read tool to access full content.`,
        inputSchema: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "URL to fetch",
            },
            query: {
              type: "string",
              description: "Optional: What you're looking for (saved as metadata)",
            },
            minQuality: {
              type: "number",
              description: "Optional: Minimum quality score 0-100 (default: 60)",
            },
            tempDir: {
              type: "string",
              description: "Optional: Temp folder path (default: .tmp)",
            },
          },
          required: ["url"],
        },
      },
      {
        name: "list_cached",
        description: "List all cached references in the temp folder. Shows ref ID, title, date, size, and URL for each.",
        inputSchema: {
          type: "object",
          properties: {
            tempDir: {
              type: "string",
              description: "Optional: Temp folder path (default: .tmp)",
            },
          },
        },
      },
      {
        name: "promote_reference",
        description: "Move a cached reference from temp folder to permanent docs folder. Updates status from 'temporary' to 'permanent'.",
        inputSchema: {
          type: "object",
          properties: {
            refId: {
              type: "string",
              description: "Reference ID (e.g., REF-001)",
            },
            docsDir: {
              type: "string",
              description: "Optional: Docs folder path (default: docs/ai/references)",
            },
          },
          required: ["refId"],
        },
      },
      {
        name: "delete_cached",
        description: "Delete a cached reference from the temp folder.",
        inputSchema: {
          type: "object",
          properties: {
            refId: {
              type: "string",
              description: "Reference ID to delete (e.g., REF-001)",
            },
          },
          required: ["refId"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "fetch_url":
      return handleFetchUrl(args as {
        url: string;
        query?: string;
        minQuality?: number;
        tempDir?: string;
      });

    case "list_cached":
      return handleListCached(args as {
        tempDir?: string;
      });

    case "promote_reference":
      return handlePromoteReference(args as {
        refId: string;
        docsDir?: string;
      });

    case "delete_cached":
      return handleDeleteCached(args as {
        refId: string;
      });

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

async function handleFetchUrl(args: {
  url: string;
  query?: string;
  minQuality?: number;
  tempDir?: string;
}) {
  const config = loadConfig({
    minQuality: args.minQuality,
    tempDir: args.tempDir,
  });

  const result = await fetchUrl(args.url, config, false);

  await closeBrowser();

  if (!result.success) {
    return {
      content: [{
        type: "text",
        text: `❌ ${result.error}${result.suggestion ? `\n\n💡 ${result.suggestion}` : ''}${result.quality ? `\n📊 Quality: ${result.quality.score}/100` : ''}`,
      }],
    };
  }

  const saveResult = await saveToTemp(
    config,
    result.title!,
    args.url,
    result.markdown!,
    args.query
  );

  if (saveResult.error) {
    return {
      content: [{
        type: "text",
        text: `❌ Save failed: ${saveResult.error}`,
      }],
    };
  }

  let text = `✅ Cached: ${saveResult.refId}\n\n`;
  text += `**Title**: ${result.title}\n`;
  if (result.byline) text += `**Author**: ${result.byline}\n`;
  if (result.siteName) text += `**Source**: ${result.siteName}\n`;
  if (result.excerpt) {
    const excerpt = result.excerpt.slice(0, 150);
    text += `**Summary**: ${excerpt}${result.excerpt.length > 150 ? '...' : ''}\n`;
  }
  text += `\n**Saved to**: \`${saveResult.filepath}\`\n`;
  text += `**Size**: ${result.markdown!.length} chars (~${Math.round(result.markdown!.length / 4)} tokens)\n`;
  text += `**Quality**: ${result.quality?.score}/100\n`;
  
  if (result.usedPlaywright) {
    text += `**Playwright**: Yes (${result.playwrightReason})\n`;
  }

  text += `\n⚠️ **IMPORTANT**: This is only a summary. Full content saved in file above.\n`;
  text += `📖 **To read**: Use Read tool on \`${saveResult.filepath}\`\n`;
  text += `📤 **To promote**: Use promote_reference with refId "${saveResult.refId}"`;

  return {
    content: [{ type: "text", text }],
  };
}

async function handleListCached(args: { tempDir?: string }) {
  const config = loadConfig({ tempDir: args.tempDir });
  const result = listCached(config);

  if (result.error) {
    return {
      content: [{ type: "text", text: `❌ ${result.error}` }],
    };
  }

  if (result.references.length === 0) {
    return {
      content: [{ type: "text", text: `No cached references in ${config.paths.tempDir}/` }],
    };
  }

  let text = `📚 **Cached references** (${result.references.length}):\n\n`;

  for (const ref of result.references) {
    text += `**${ref.refId}** | ${ref.title.slice(0, 50)}${ref.title.length > 50 ? '...' : ''}\n`;
    text += `   📅 ${ref.fetchedDate} | 📄 ${Math.round(ref.size / 1024)}KB\n`;
    text += `   🔗 ${ref.url.slice(0, 60)}${ref.url.length > 60 ? '...' : ''}\n\n`;
  }

  text += `💡 Use **promote_reference** to move to docs folder\n`;
  text += `💡 Use **delete_cached** to remove`;

  return {
    content: [{ type: "text", text }],
  };
}

async function handlePromoteReference(args: { refId: string; docsDir?: string }) {
  const config = loadConfig({ docsDir: args.docsDir });
  const result = promoteReference(config, args.refId);

  if (!result.success) {
    return {
      content: [{ type: "text", text: `❌ ${result.error}` }],
    };
  }

  return {
    content: [{
      type: "text",
      text: `✅ Promoted ${args.refId}\n\n**From**: ${result.fromPath}\n**To**: ${result.toPath}`,
    }],
  };
}

async function handleDeleteCached(args: { refId: string }) {
  const config = loadConfig();
  const result = deleteCached(config, args.refId);

  if (!result.success) {
    return {
      content: [{ type: "text", text: `❌ ${result.error}` }],
    };
  }

  return {
    content: [{
      type: "text",
      text: `✅ Deleted ${args.refId}\n\n**File**: ${result.filepath}`,
    }],
  };
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Fetchi MCP server v3.0 running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
