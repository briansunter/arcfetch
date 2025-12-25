#!/usr/bin/env bun

/**
 * Test complete fetch-and-cache flow
 * Run from an AMS repository
 */

import { existsSync } from "fs";
import { join } from "path";
import { spawn } from "child_process";
import * as cheerio from "cheerio";
import TurndownService from "turndown";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

function findAmsRepo(): string | null {
  let current = process.cwd();

  for (let i = 0; i < 5; i++) {
    const amsDir = join(current, "docs/ams");
    const required = ["tasks", "decisions", "learnings", "sops"];

    if (required.every(dir => existsSync(join(amsDir, dir)))) {
      return current;
    }

    const parent = join(current, "..");
    if (parent === current) break;
    current = parent;
  }

  return null;
}

function extractTitle(html: string, url: string): string {
  try {
    const $ = cheerio.load(html);
    const title = $('title').text().trim();
    if (title) return title;
    const h1 = $('h1').first().text().trim();
    if (h1) return h1;
  } catch {}

  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return url;
  }
}

function saveToReference(
  repoRoot: string,
  title: string,
  url: string,
  content: string,
  query?: string
): Promise<{ refId?: string; error?: string; output?: string }> {
  return new Promise((resolve) => {
    const scriptPath = join(import.meta.dir, "..", "..", "scripts", "create-reference.ts");

    const args = [
      scriptPath,
      repoRoot,
      "--title", title,
      "--url", url,
      "--content", content,
      "--type", "web",
      "--temp",
    ];

    if (query) {
      args.push("--query", query);
    }

    const proc = spawn("bun", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (exitCode) => {
      if (exitCode !== 0) {
        resolve({ error: stderr || "Failed to save reference", output: stdout });
        return;
      }

      const match = stdout.match(/ID:\s*(REF-\d+)/);
      const refId = match ? match[1] : undefined;

      resolve({ refId, output: stdout });
    });
  });
}

async function testFullFlow() {
  console.log("🧪 Testing Full Fetch and Cache Flow\n");

  // 1. Check AMS repo
  console.log("Step 1: Finding AMS repository...");
  const repoRoot = findAmsRepo();
  if (!repoRoot) {
    console.error("❌ Not in an AMS repository!");
    console.error("Run this from a directory with docs/ams/ structure");
    process.exit(1);
  }
  console.log(`✅ Found AMS repo: ${repoRoot}\n`);

  // 2. Fetch URL
  const testUrl = "https://bun.sh";
  const query = "What is Bun?";
  console.log(`Step 2: Fetching ${testUrl}...`);

  const response = await fetch(testUrl, {
    redirect: 'follow',
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AMS-Test/1.0)' },
  });

  if (!response.ok) {
    console.error(`❌ HTTP ${response.status}`);
    process.exit(1);
  }

  const html = await response.text();
  console.log(`✅ Fetched ${html.length} bytes\n`);

  // 3. Convert to markdown
  console.log("Step 3: Converting to markdown...");
  const title = extractTitle(html, testUrl);
  const markdown = turndown.turndown(html);
  console.log(`✅ Converted to markdown: ${markdown.length} chars`);
  console.log(`   Title: ${title}\n`);

  // 4. Save to .tmp/
  console.log("Step 4: Saving to docs/ams/.tmp/...");
  const { refId, error, output } = await saveToReference(
    repoRoot,
    title,
    testUrl,
    markdown,
    query
  );

  if (error) {
    console.error(`❌ Save failed: ${error}`);
    if (output) console.error(output);
    process.exit(1);
  }

  console.log(`✅ Saved as ${refId}\n`);
  if (output) {
    console.log("Script output:");
    console.log(output);
  }

  // 5. Verify file exists
  const tmpDir = join(repoRoot, "docs/ams/.tmp");
  console.log(`\nStep 5: Verifying file in ${tmpDir}...`);

  const { readdirSync } = await import("fs");
  const files = readdirSync(tmpDir).filter(f => f.includes(refId!));

  if (files.length === 0) {
    console.error(`❌ File not found!`);
    process.exit(1);
  }

  console.log(`✅ File created: ${files[0]}`);
  console.log(`\n🎉 Complete workflow test PASSED!`);
}

testFullFlow().catch(error => {
  console.error("Test failed:", error);
  process.exit(1);
});
