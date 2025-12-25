#!/usr/bin/env bun

/**
 * Test MCP server fetch_and_cache integration
 * Simulates what happens when Claude calls the MCP tool
 */

import { spawn } from 'child_process';

interface MCPRequest {
  jsonrpc: string;
  id: number;
  method: string;
  params: {
    name: string;
    arguments: {
      url: string;
      query?: string;
    };
  };
}

interface MCPResponse {
  jsonrpc: string;
  id: number;
  result?: {
    content: Array<{
      type: string;
      text: string;
    }>;
  };
  error?: {
    code: number;
    message: string;
  };
}

async function testMCPServer(url: string, query?: string): Promise<void> {
  console.log(`\n🧪 Testing MCP Server Integration\n`);
  console.log(`URL: ${url}`);
  if (query) console.log(`Query: ${query}`);
  console.log();

  // Create MCP request
  const request: MCPRequest = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "fetch_and_cache",
      arguments: {
        url,
        ...(query && { query })
      }
    }
  };

  // Get the AMS repo root from environment or use HOME
  const amsRepoRoot = process.env.AMS_REPO_ROOT ||
    (process.env.HOME ? `${process.env.HOME}/.dotfiles` : process.cwd());

  // Spawn MCP server
  const server = spawn('bun', ['run', 'index.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AMS_REPO_ROOT: amsRepoRoot
    }
  });

  let response = '';
  let error = '';

  server.stdout.on('data', (data) => {
    response += data.toString();
  });

  server.stderr.on('data', (data) => {
    error += data.toString();
  });

  // Send request
  server.stdin.write(JSON.stringify(request) + '\n');

  // Wait for response
  await new Promise((resolve) => setTimeout(resolve, 3000));

  // Close
  server.stdin.end();
  server.kill();

  // Parse response
  console.log('Raw response:', response.substring(0, 500));

  try {
    const lines = response.split('\n').filter(l => l.trim());
    for (const line of lines) {
      try {
        const parsed: MCPResponse = JSON.parse(line);
        if (parsed.result?.content) {
          console.log('\n✅ Success! MCP Response:');
          console.log(parsed.result.content[0].text);
          return;
        }
        if (parsed.error) {
          console.log('\n❌ Error:', parsed.error.message);
          return;
        }
      } catch (e) {
        // Skip non-JSON lines
      }
    }
  } catch (e) {
    console.log('\n⚠️  Could not parse response');
  }

  if (error) {
    console.log('\n⚠️  Stderr:', error);
  }
}

// Test with example.com
const url = process.argv[2] || "https://example.com";
const query = process.argv[3];

testMCPServer(url, query);
