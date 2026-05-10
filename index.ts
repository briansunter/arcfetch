#!/usr/bin/env bun

/**
 * Arcfetch MCP Server
 *
 * Tools are defined in `src/mcp/tools.ts`; each tool's name, description,
 * JSON Schema, Zod validation, and handler live as one record. This file
 * only handles transport, lifecycle, and process bootstrap.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { closeBrowser } from './src/core/pipeline';
import { registerTools } from './src/mcp/register';
import { allTools } from './src/mcp/tools';
import { getErrorMessage } from './src/utils/error';
import { getVersion } from './src/utils/version';

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

registerTools(server, allTools);

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

if (import.meta.main) {
  serveMcp().catch((error) => {
    console.error('Server error:', getErrorMessage(error));
    process.exit(1);
  });
}
