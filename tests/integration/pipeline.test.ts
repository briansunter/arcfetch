#!/usr/bin/env bun

/**
 * Integration test for complete HTML→Markdown pipeline
 * Tests: Fetch → Readability → Turndown → Markdown Cleaning
 */

import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { cleanMarkdownComplete } from "./markdown-cleaner";

// Configure Turndown with optimal settings
const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
  emDelimiter: "*",
  strongDelimiter: "**",
  hr: "---",
});

turndown.use(gfm);

turndown.addRule('removeComments', {
  filter: (node) => node.nodeType === 8,
  replacement: () => ''
});

async function testCompletePipeline(url: string) {
  console.log(`\n🧪 Testing Complete Pipeline: ${url}\n`);

  // Step 1: Fetch
  console.log("Step 1: Fetching URL...");
  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; AMS-Test/2.0)',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const html = await response.text();
  console.log(`✅ Fetched ${html.length} bytes of HTML\n`);

  // Step 2: Extract with Readability
  console.log("Step 2: Extracting article with Readability...");
  const { document } = parseHTML(html, { url });
  const reader = new Readability(document, {
    debug: false,
    maxElemsToParse: 0,
    nbTopCandidates: 5,
    charThreshold: 500,
    keepClasses: false,
  });

  const article = reader.parse();

  if (!article) {
    console.log("⚠️  Readability could not extract article (may not be an article page)");
    return;
  }

  console.log(`✅ Extracted article:`);
  console.log(`   Title: ${article.title}`);
  console.log(`   Author: ${article.byline || 'N/A'}`);
  console.log(`   Excerpt: ${article.excerpt?.slice(0, 100) || 'N/A'}...`);
  console.log(`   Content length: ${article.content.length} chars\n`);

  // Step 3: Convert to Markdown
  console.log("Step 3: Converting to Markdown with Turndown...");
  const rawMarkdown = turndown.turndown(article.content);
  console.log(`✅ Converted to ${rawMarkdown.length} chars of markdown\n`);

  // Step 4: Clean Markdown
  console.log("Step 4: Cleaning markdown...");
  const cleanedMarkdown = cleanMarkdownComplete(rawMarkdown);
  console.log(`✅ Cleaned to ${cleanedMarkdown.length} chars of markdown\n`);

  // Results
  const htmlToRawReduction = ((html.length - rawMarkdown.length) / html.length * 100).toFixed(1);
  const rawToCleanReduction = ((rawMarkdown.length - cleanedMarkdown.length) / rawMarkdown.length * 100).toFixed(1);
  const totalReduction = ((html.length - cleanedMarkdown.length) / html.length * 100).toFixed(1);

  console.log("📊 Token Reduction:");
  console.log(`   HTML → Raw Markdown: ${htmlToRawReduction}% reduction`);
  console.log(`   Raw → Clean Markdown: ${rawToCleanReduction}% reduction`);
  console.log(`   Total HTML → Clean: ${totalReduction}% reduction\n`);

  console.log("📝 Final Output Preview (first 500 chars):");
  console.log("─".repeat(60));
  console.log(cleanedMarkdown.slice(0, 500));
  console.log("─".repeat(60));
  console.log("... (truncated)\n");

  console.log("✨ Test completed successfully!");

  // Verify quality
  console.log("\n🔍 Quality Checks:");
  const checks = [
    {
      name: "Has title",
      pass: cleanedMarkdown.includes(article.title.slice(0, 20)),
    },
    {
      name: "No excessive newlines",
      pass: !cleanedMarkdown.includes("\n\n\n\n"),
    },
    {
      name: "No HTML comments",
      pass: !cleanedMarkdown.includes("<!--"),
    },
    {
      name: "No script tags",
      pass: !cleanedMarkdown.includes("<script"),
    },
    {
      name: "Significant reduction",
      pass: parseFloat(totalReduction) > 50,
    },
  ];

  checks.forEach(check => {
    console.log(`   ${check.pass ? '✅' : '❌'} ${check.name}`);
  });

  const allPassed = checks.every(c => c.pass);
  if (allPassed) {
    console.log("\n🎉 All quality checks passed!");
  } else {
    console.log("\n⚠️  Some quality checks failed");
  }

  return {
    article,
    rawMarkdown,
    cleanedMarkdown,
    metrics: {
      htmlSize: html.length,
      rawMarkdownSize: rawMarkdown.length,
      cleanMarkdownSize: cleanedMarkdown.length,
      htmlToRawReduction,
      rawToCleanReduction,
      totalReduction,
    }
  };
}

// Test with a documentation page (clean article structure)
const testUrl = process.argv[2] || "https://bun.sh/docs";

testCompletePipeline(testUrl).catch(error => {
  console.error("\n❌ Test failed:", error.message);
  process.exit(1);
});
