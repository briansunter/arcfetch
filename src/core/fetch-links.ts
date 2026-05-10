import type { ArcfetchConfig } from '../config/schema';
import { getErrorMessage } from '../utils/error';
import { extractLinksFromCached } from './cache';
import { closeBrowser as defaultCloseBrowser } from './pipeline';
import {
  type AcquireOptions,
  type AcquisitionOutcome,
  acquireReference as defaultAcquireReference,
} from './references/acquire';

export interface FetchLinkResult {
  url: string;
  status: 'new' | 'cached' | 'failed';
  refId?: string;
  error?: string;
}

export interface FetchLinksFromRefResult {
  results: FetchLinkResult[];
  summary: { new: number; cached: number; failed: number };
  error?: string;
}

const MAX_LINKS = 200;

export interface FetchLinksOptions {
  refetch?: boolean;
  verbose?: boolean;
  onProgress?: (result: FetchLinkResult) => void;
  acquireReference?: (url: string, config: ArcfetchConfig, opts?: AcquireOptions) => Promise<AcquisitionOutcome>;
  closeBrowser?: typeof defaultCloseBrowser;
}

export async function fetchLinksFromRef(
  config: ArcfetchConfig,
  refId: string,
  options: FetchLinksOptions = {}
): Promise<FetchLinksFromRefResult> {
  const acquire = options.acquireReference ?? defaultAcquireReference;
  const closeBrowser = options.closeBrowser ?? defaultCloseBrowser;

  const linksResult = extractLinksFromCached(config, refId);

  if (linksResult.error) {
    return { results: [], summary: { new: 0, cached: 0, failed: 0 }, error: linksResult.error };
  }

  if (linksResult.count === 0) {
    return { results: [], summary: { new: 0, cached: 0, failed: 0 } };
  }

  const urls = linksResult.links.map((l) => l.href);

  if (urls.length > MAX_LINKS) {
    await closeBrowser();
    return {
      results: [],
      summary: { new: 0, cached: 0, failed: urls.length },
      error: `Too many links (${urls.length}). Maximum is ${MAX_LINKS}. Filter links before fetching.`,
    };
  }

  const results: FetchLinkResult[] = [];
  const concurrency = 3;
  const verbose = options.verbose ?? false;
  const refetch = options.refetch ?? false;

  try {
    for (let i = 0; i < urls.length; i += concurrency) {
      const batch = urls.slice(i, i + concurrency);
      const batchPromises = batch.map(async (url): Promise<FetchLinkResult> => {
        try {
          const outcome = await acquire(url, config, { refetch, verbose });

          if (!outcome.ok) {
            return { url, status: 'failed', error: outcome.error };
          }

          if (outcome.source === 'cached') {
            return { url, status: 'cached', refId: outcome.refId };
          }

          return { url, status: 'new', refId: outcome.refId };
        } catch (error) {
          const message = getErrorMessage(error);
          return { url, status: 'failed', error: message };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      if (options.onProgress) {
        for (const r of batchResults) {
          options.onProgress(r);
        }
      }
    }
  } finally {
    await closeBrowser();
  }

  const summary = {
    new: results.filter((r) => r.status === 'new').length,
    cached: results.filter((r) => r.status === 'cached').length,
    failed: results.filter((r) => r.status === 'failed').length,
  };

  return { results, summary };
}
