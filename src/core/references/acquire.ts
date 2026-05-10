import type { ArcfetchConfig } from '../../config/schema';
import type { ValidationResult } from '../../utils/markdown-validator';
import { findByUrl, saveToTemp } from '../cache';
import { closeBrowser as defaultCloseBrowser, fetchUrl as defaultFetchUrl, type FetchResult } from '../pipeline';

export type AcquisitionOutcome =
  | {
      ok: true;
      source: 'cached';
      refId: string;
      filepath: string;
    }
  | {
      ok: true;
      source: 'fetched';
      refId: string;
      filepath: string;
      title: string;
      byline?: string;
      excerpt?: string;
      siteName?: string;
      quality: ValidationResult;
      markdownLength: number;
      usedPlaywright?: boolean;
      playwrightReason?: string;
    }
  | {
      ok: false;
      stage: 'fetch';
      error: string;
      suggestion?: string;
      quality?: ValidationResult;
      usedPlaywright?: boolean;
      playwrightReason?: string;
    }
  | {
      ok: false;
      stage: 'save';
      error: string;
    };

export interface AcquireOptions {
  query?: string;
  refetch?: boolean;
  verbose?: boolean;
  forcePlaywright?: boolean;
  /**
   * Whether to close the browser after this call (default: true). Batch
   * callers (e.g., fetchLinksFromRef) set this to false and own the close
   * themselves to avoid relaunching Chromium between iterations.
   */
  closeAfter?: boolean;
  fetchUrl?: typeof defaultFetchUrl;
  closeBrowser?: typeof defaultCloseBrowser;
}

export async function acquireReference(
  url: string,
  config: ArcfetchConfig,
  opts: AcquireOptions = {}
): Promise<AcquisitionOutcome> {
  const fetchUrl = opts.fetchUrl ?? defaultFetchUrl;
  const closeBrowser = opts.closeBrowser ?? defaultCloseBrowser;
  const closeAfter = opts.closeAfter ?? true;

  if (!opts.refetch) {
    const cached = findByUrl(config, url);
    if (cached) {
      return {
        ok: true,
        source: 'cached',
        refId: cached.refId,
        filepath: cached.filepath,
      };
    }
  }

  let fetchResult: FetchResult;
  try {
    fetchResult = await fetchUrl(url, config, opts.verbose ?? false, opts.forcePlaywright ?? false);
  } finally {
    if (closeAfter) await closeBrowser();
  }

  if (!fetchResult.success) {
    return {
      ok: false,
      stage: 'fetch',
      error: fetchResult.error,
      suggestion: fetchResult.suggestion,
      quality: fetchResult.quality,
      usedPlaywright: fetchResult.usedPlaywright,
      playwrightReason: fetchResult.playwrightReason,
    };
  }

  const saveResult = await saveToTemp(config, fetchResult.title, url, fetchResult.markdown, opts.query, opts.refetch);

  if (saveResult.error) {
    return { ok: false, stage: 'save', error: saveResult.error };
  }

  if (saveResult.alreadyExists) {
    return {
      ok: true,
      source: 'cached',
      refId: saveResult.refId,
      filepath: saveResult.filepath,
    };
  }

  return {
    ok: true,
    source: 'fetched',
    refId: saveResult.refId,
    filepath: saveResult.filepath,
    title: fetchResult.title,
    byline: fetchResult.byline,
    excerpt: fetchResult.excerpt,
    siteName: fetchResult.siteName,
    quality: fetchResult.quality,
    markdownLength: fetchResult.markdown.length,
    usedPlaywright: fetchResult.usedPlaywright,
    playwrightReason: fetchResult.playwrightReason,
  };
}
