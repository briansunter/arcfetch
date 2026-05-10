import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';
import { getErrorMessage } from '../utils/error';

export interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>;
}

/**
 * A complete MCP tool definition. All four facets that the underlying SDK
 * needs — the listing entry, the per-call Zod validation, and the handler —
 * live together in one record. The registrar wires them into the server.
 */
export interface McpTool<TArgs> {
  name: string;
  description: string;
  /** JSON Schema description shown to MCP clients. */
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  /** Zod schema used to validate `arguments` at call time. */
  argsSchema: z.ZodType<TArgs>;
  /** Handler. Returns the standard MCP `{content: [{type, text}]}` shape. */
  handle: (args: TArgs) => Promise<McpToolResult> | McpToolResult;
}

/**
 * Wire a set of tool definitions into the MCP server. Both the ListTools
 * response and the CallTool dispatcher are set here; the caller does not
 * need to register either handler separately.
 */
export function registerTools(server: Server, tools: McpTool<unknown>[]): void {
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  const byName = new Map(tools.map((t) => [t.name, t]));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = byName.get(name);

    if (!tool) {
      return { content: [{ type: 'text', text: `Error: Unknown tool: ${name}` }] };
    }

    const parsed = tool.argsSchema.safeParse(args);
    if (!parsed.success) {
      const issues = parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
      return { content: [{ type: 'text', text: `Invalid arguments: ${issues}` }] };
    }

    try {
      const result = await tool.handle(parsed.data);
      return { content: result.content };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${getErrorMessage(error)}` }] };
    }
  });
}

/** Convenience: wrap a string in the standard MCP `text` content shape. */
export function mcpText(text: string): McpToolResult {
  return { content: [{ type: 'text', text }] };
}
