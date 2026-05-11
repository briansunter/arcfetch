import type { ArcfetchConfig } from '../config/schema';
import { getErrorMessage } from '../utils/error';
import { type ValidationResult, validateMarkdown } from '../utils/markdown-validator';
import { assertSafePublicUrl } from '../utils/url-safety';
import { closeBrowser, fetchWithBrowser } from './browser';
import { processHtmlToMarkdown } from './extractor';
import { routeByQuality } from './quality-router';

interface FetchResultSuccess {
  success: true;
  markdown: string;
  title: string;
  quality: ValidationResult;
  byline?: string;
  excerpt?: string;
  siteName?: string;
  usedPlaywright?: boolean;
  playwrightReason?: string;
  suggestion?: string;
}

interface FetchResultError {
  success: false;
  error: string;
  quality?: ValidationResult;
  suggestion?: string;
  usedPlaywright?: boolean;
  playwrightReason?: string;
}

export type FetchResult = FetchResultSuccess | FetchResultError;

interface SimpleFetchResult {
  html: string;
  error?: string;
  retryable?: boolean;
}

const MAX_REDIRECTS = 5;
const MAX_HTML_BYTES = 10 * 1024 * 1024;

function isSupportedContentType(contentType: string | null): boolean {
  if (!contentType) {
    return true;
  }

  const mediaType = contentType.split(';')[0].trim().toLowerCase();

  return (
    mediaType === 'text/html' ||
    mediaType === 'application/xhtml+xml' ||
    mediaType === 'text/plain' ||
    mediaType === 'text/xml' ||
    mediaType === 'application/xml' ||
    mediaType.endsWith('+xml')
  );
}

async function readTextWithLimit(response: Response): Promise<string> {
  const contentLength = response.headers.get('content-length');
  if (contentLength && Number(contentLength) > MAX_HTML_BYTES) {
    throw new Error(`Response too large (${contentLength} bytes, max ${MAX_HTML_BYTES})`);
  }

  if (!response.body) {
    return response.text();
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value) {
      continue;
    }

    totalBytes += value.byteLength;
    if (totalBytes > MAX_HTML_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`Response too large (over ${MAX_HTML_BYTES} bytes)`);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(bytes);
}

async function simpleFetch(url: string, verbose = false, redirectCount = 0): Promise<SimpleFetchResult> {
  try {
    const safety = await assertSafePublicUrl(url);
    if (!safety.safe || !safety.url) {
      return { html: '', error: safety.error ?? 'URL failed safety validation', retryable: false };
    }

    if (verbose) {
      console.error(`📡 Simple fetch: ${safety.url.toString()}`);
    }

    const response = await fetch(safety.url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        return { html: '', error: `HTTP ${response.status}: redirect without Location header`, retryable: false };
      }
      if (redirectCount >= MAX_REDIRECTS) {
        return { html: '', error: `Too many redirects (max ${MAX_REDIRECTS})`, retryable: false };
      }

      const redirectUrl = new URL(location, safety.url).toString();
      return simpleFetch(redirectUrl, verbose, redirectCount + 1);
    }

    if (!response.ok) {
      return { html: '', error: `HTTP ${response.status}: ${response.statusText}` };
    }

    if (!isSupportedContentType(response.headers.get('content-type'))) {
      return {
        html: '',
        error: `Unsupported content type: ${response.headers.get('content-type')}`,
        retryable: false,
      };
    }

    let html: string;
    try {
      html = await readTextWithLimit(response);
    } catch (error) {
      return { html: '', error: getErrorMessage(error), retryable: false };
    }

    if (verbose) {
      console.error(`📡 Simple fetch: Got ${html.length} chars`);
    }

    return { html };
  } catch (error) {
    const message = getErrorMessage(error);
    return { html: '', error: message, retryable: true };
  }
}

async function tryPlaywright(
  url: string,
  config: ArcfetchConfig,
  reason: string,
  verbose = false
): Promise<FetchResult> {
  if (verbose) {
    console.error(`🎭 Trying Playwright (reason: ${reason})`);
  }

  const browserResult = await fetchWithBrowser(url, config.playwright, { verbose });

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

  const quality = validateMarkdown(extracted.markdown!, { sourceHtmlLength: browserResult.html.length });
  const decision = routeByQuality(quality, config.quality);

  if (decision.action === 'require-playwright') {
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
    markdown: extracted.markdown!,
    title: extracted.title ?? '',
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
  config: ArcfetchConfig,
  verbose = false,
  forcePlaywright = false
): Promise<FetchResult> {
  const safety = await assertSafePublicUrl(url);
  if (!safety.safe || !safety.url) {
    return {
      success: false,
      error: safety.error ?? 'URL failed safety validation',
    };
  }

  const safeUrl = safety.url.toString();

  if (forcePlaywright) {
    if (verbose) {
      console.error('⚡ Force Playwright mode enabled');
    }
    return tryPlaywright(safeUrl, config, 'forced', verbose);
  }

  const simpleResult = await simpleFetch(safeUrl, verbose);

  if (simpleResult.error) {
    if (verbose) {
      console.error(`📡 Simple fetch failed: ${simpleResult.error}`);
    }
    if (simpleResult.retryable === false) {
      return {
        success: false,
        error: simpleResult.error,
      };
    }
    return tryPlaywright(safeUrl, config, 'network_error', verbose);
  }

  const extracted = await processHtmlToMarkdown(simpleResult.html, safeUrl, verbose);

  if (extracted.error) {
    if (verbose) {
      console.error(`📝 Extraction failed: ${extracted.error}`);
    }
    return tryPlaywright(safeUrl, config, 'extraction_failed', verbose);
  }

  const quality = validateMarkdown(extracted.markdown!, { sourceHtmlLength: simpleResult.html.length });

  if (verbose) {
    console.error(`📊 Quality score: ${quality.score}/100`);
    if (quality.issues.length > 0) {
      for (const issue of quality.issues) {
        console.error(`   ⚠ ${issue}`);
      }
    }
  }

  const decision = routeByQuality(quality, config.quality);

  switch (decision.action) {
    case 'accept':
      return {
        success: true,
        markdown: extracted.markdown!,
        title: extracted.title ?? '',
        byline: extracted.byline,
        excerpt: extracted.excerpt,
        siteName: extracted.siteName,
        quality,
      };

    case 'try-playwright-keep-higher': {
      if (verbose) {
        console.error(`📊 Quality marginal (${quality.score}), trying Playwright...`);
      }

      const playwrightResult = await tryPlaywright(safeUrl, config, 'quality_marginal', verbose);

      if (playwrightResult.success && playwrightResult.quality.score > quality.score) {
        return playwrightResult;
      }

      return {
        success: true,
        markdown: extracted.markdown!,
        title: extracted.title ?? '',
        byline: extracted.byline,
        excerpt: extracted.excerpt,
        siteName: extracted.siteName,
        quality,
      };
    }

    case 'require-playwright':
      if (verbose) {
        console.error(`📊 Quality too low (${quality.score}), trying Playwright...`);
      }
      return tryPlaywright(safeUrl, config, 'quality_too_low', verbose);
  }
}

export { closeBrowser };
