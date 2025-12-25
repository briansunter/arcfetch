#!/usr/bin/env bun

/**
 * Standalone test for fetch and markdown conversion
 */

import * as cheerio from "cheerio";
import TurndownService from "turndown";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

function extractTitle(html: string, url: string): string {
  try {
    const $ = cheerio.load(html);
    const title = $('title').text().trim();
    if (title) return title;

    const h1 = $('h1').first().text().trim();
    if (h1) return h1;
  } catch {
    // Continue to fallback
  }

  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return url;
  }
}

async function testFetch(url: string) {
  console.log(`\n🔍 Testing fetch: ${url}\n`);

  try {
    const response = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AMS-Fetch/1.0)',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    const title = extractTitle(html, url);
    const markdown = turndown.turndown(html);

    console.log(`✅ Fetch successful`);
    console.log(`Title: ${title}`);
    console.log(`Content length: ${markdown.length} chars`);
    console.log(`\nFirst 500 chars of markdown:\n`);
    console.log(markdown.substring(0, 500));
    console.log(`\n... (truncated)\n`);

    return true;
  } catch (error) {
    console.error(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

// Test with a simple, fast-loading page
const testUrl = process.argv[2] || "https://bun.sh";
testFetch(testUrl);
