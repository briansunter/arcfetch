import { describe, expect, test } from 'bun:test';
import { allTools } from '../../src/mcp/tools';

/**
 * Regression coverage for the fetch_url MCP tool's parameter surface. These
 * tests inspect the tool definition directly (its Zod argsSchema and the
 * advertised JSON inputSchema) so they run without a browser or network.
 *
 * They lock in the MCP/CLI parity contract for browser-behavior controls:
 *   - waitStrategy: networkidle | domcontentloaded | load
 *   - forcePlaywright: boolean
 * and the wiring target names exposed to MCP clients.
 */
describe('fetch_url tool schema', () => {
  const tool = allTools.find((t) => t.name === 'fetch_url');
  expect(tool).toBeDefined();
  if (!tool) throw new Error('fetch_url tool not registered');
  const argsSchema = tool.argsSchema;
  const props = tool.inputSchema.properties as Record<string, Record<string, unknown>>;

  describe('argsSchema validation', () => {
    test('accepts each valid waitStrategy value', () => {
      for (const strategy of ['networkidle', 'domcontentloaded', 'load'] as const) {
        const parsed = argsSchema.safeParse({ url: 'https://example.com', waitStrategy: strategy });
        expect(parsed.success).toBe(true);
        if (parsed.success) expect(parsed.data.waitStrategy).toBe(strategy);
      }
    });

    test('accepts forcePlaywright boolean', () => {
      const truthy = argsSchema.safeParse({ url: 'https://example.com', forcePlaywright: true });
      expect(truthy.success).toBe(true);
      if (truthy.success) expect(truthy.data.forcePlaywright).toBe(true);

      const falsy = argsSchema.safeParse({ url: 'https://example.com', forcePlaywright: false });
      expect(falsy.success).toBe(true);
      if (falsy.success) expect(falsy.data.forcePlaywright).toBe(false);
    });

    test('rejects an invalid waitStrategy value', () => {
      const parsed = argsSchema.safeParse({ url: 'https://example.com', waitStrategy: 'until-heat-death' });
      expect(parsed.success).toBe(false);
    });

    test('omits waitStrategy and forcePlaywright (defaults) when not supplied', () => {
      const parsed = argsSchema.safeParse({ url: 'https://example.com' });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.waitStrategy).toBeUndefined();
        expect(parsed.data.forcePlaywright).toBeUndefined();
      }
    });

    test('preserves existing fetch_url fields', () => {
      const parsed = argsSchema.safeParse({
        url: 'https://example.com',
        query: 'react',
        minQuality: 70,
        tempDir: '.tmp/x',
        outputFormat: 'path',
        refetch: true,
        waitStrategy: 'load',
        forcePlaywright: true,
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data).toMatchObject({
          query: 'react',
          minQuality: 70,
          tempDir: '.tmp/x',
          outputFormat: 'path',
          refetch: true,
        });
      }
    });
  });

  describe('inputSchema advertisement', () => {
    test('advertises waitStrategy as a string enum with the three strategies', () => {
      const prop = props.waitStrategy as { type: string; enum: string[]; description: string };
      expect(props.waitStrategy).toBeDefined();
      expect(prop.type).toBe('string');
      expect(prop.enum).toEqual(['networkidle', 'domcontentloaded', 'load']);
      expect(typeof prop.description).toBe('string');
      expect(prop.description.length).toBeGreaterThan(0);
    });

    test('advertises forcePlaywright as a boolean with a description', () => {
      const prop = props.forcePlaywright as { type: string; description: string };
      expect(props.forcePlaywright).toBeDefined();
      expect(prop.type).toBe('boolean');
      expect(typeof prop.description).toBe('string');
      expect(prop.description.length).toBeGreaterThan(0);
    });

    test('keeps url as the only required property', () => {
      expect(tool.inputSchema.required).toEqual(['url']);
    });
  });
});
