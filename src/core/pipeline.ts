import type { FetchiConfig } from '../config/schema.js';
import { validateMarkdown, type ValidationResult } from '../utils/markdown-validator.js';
import { fetchWithBrowser, closeBrowser } from './playwright/manager.js';
import { processHtmlToMarkdown } from './extractor.js';

export interface FetchResult {
  success: boolean;
  markdown?: string;
  title?: string;
  byline?: string;
  excerpt?: string;
  siteName?: string;
  quality?: ValidationResult;
  error?: string;
  suggestion?: string;
  usedPlaywright?: boolean;
  playwrightReason?: string;
}

interface SimpleFetchResult {
  html: string;
  error?: string;
}

async function simpleFetch(url: string, verbose = false): Promise<SimpleFetchResult> {
  try {
    if (verbose) {
      console.error(`📡 Simple fetch: ${url}`);
    }

    const response = await fetch(url, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });

    if (!response.ok) {
      return { html: '', error: `HTTP ${response.status}: ${response.statusText}` };
    }

    const html = await response.text();

    if (verbose) {
      console.error(`📡 Simple fetch: Got ${html.length} chars`);
    }

    return { html };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { html: '', error: message };
  }
}

async function tryPlaywright(
  url: string,
  config: FetchiConfig,
  reason: string,
  verbose = false
): Promise<FetchResult> {
  if (verbose) {
    console.error(`🎭 Trying Playwright (reason: ${reason})`);
  }

  const browserResult = await fetchWithBrowser(url, config.playwright, verbose);

  if (browserResult.error) {
    return {
      success: false,
      error: `Playwright fetch failed: ${browserResult.error}`,
    };
  }

  const extracted = await processHtmlToMarkdown(browserResult.html, url, verbose);

  if (extracted.error) {
    return {
      success: false,
      error: extracted.error,
    };
  }

  const quality = validateMarkdown(extracted.markdown!);

  if (quality.score < config.quality.minScore) {
    return {
      success: false,
      error: `Content quality too low (${quality.score}/100) even with JavaScript rendering`,
      quality,
      suggestion: 'This page may be a login wall, forum, or complex web app not suitable for article extraction',
      usedPlaywright: true,
      playwrightReason: reason,
    };
  }

  return {
    success: true,
    markdown: extracted.markdown,
    title: extracted.title,
    byline: extracted.byline,
    excerpt: extracted.excerpt,
    siteName: extracted.siteName,
    quality,
    usedPlaywright: true,
    playwrightReason: reason,
  };
}

export async function fetchUrl(
  url: string,
  config: FetchiConfig,
  verbose = false,
  forcePlaywright = false
): Promise<FetchResult> {
  if (forcePlaywright) {
    if (verbose) {
      console.error(`⚡ Force Playwright mode enabled`);
    }
    return tryPlaywright(url, config, 'forced', verbose);
  }

  const simpleResult = await simpleFetch(url, verbose);

  if (simpleResult.error) {
    if (verbose) {
      console.error(`📡 Simple fetch failed: ${simpleResult.error}`);
    }
    return tryPlaywright(url, config, 'network_error', verbose);
  }

  const extracted = await processHtmlToMarkdown(simpleResult.html, url, verbose);

  if (extracted.error) {
    if (verbose) {
      console.error(`📝 Extraction failed: ${extracted.error}`);
    }
    return tryPlaywright(url, config, 'extraction_failed', verbose);
  }

  const quality = validateMarkdown(extracted.markdown!);

  if (verbose) {
    console.error(`📊 Quality score: ${quality.score}/100`);
  }

  if (quality.score >= config.quality.jsRetryThreshold) {
    return {
      success: true,
      markdown: extracted.markdown,
      title: extracted.title,
      byline: extracted.byline,
      excerpt: extracted.excerpt,
      siteName: extracted.siteName,
      quality,
    };
  }

  if (quality.score >= config.quality.minScore) {
    if (verbose) {
      console.error(`📊 Quality marginal (${quality.score}), trying Playwright...`);
    }

    const playwrightResult = await tryPlaywright(url, config, 'quality_marginal', verbose);

    if (playwrightResult.success && playwrightResult.quality!.score > quality.score) {
      return playwrightResult;
    }

    return {
      success: true,
      markdown: extracted.markdown,
      title: extracted.title,
      byline: extracted.byline,
      excerpt: extracted.excerpt,
      siteName: extracted.siteName,
      quality,
    };
  }

  if (verbose) {
    console.error(`📊 Quality too low (${quality.score}), trying Playwright...`);
  }

  return tryPlaywright(url, config, 'quality_too_low', verbose);
}

export { closeBrowser };
