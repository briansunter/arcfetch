import type { ArcfetchConfig } from '../config/schema';
import { getErrorMessage } from '../utils/error';
import { extractLinksFromCached, saveToTemp } from './cache';
import { closeBrowser as defaultCloseBrowser, fetchUrl as defaultFetchUrl } from './pipeline';

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

export interface FetchLinksDeps {
  fetchUrl?: typeof defaultFetchUrl;
  closeBrowser?: typeof defaultCloseBrowser;
}

export async function fetchLinksFromRef(
  config: ArcfetchConfig,
  refId: string,
  options?: {
    refetch?: boolean;
    verbose?: boolean;
    onProgress?: (result: FetchLinkResult) => void;
  } & FetchLinksDeps
): Promise<FetchLinksFromRefResult> {
  const fetchUrl = options?.fetchUrl ?? defaultFetchUrl;
  const closeBrowser = options?.closeBrowser ?? defaultCloseBrowser;

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
  const verbose = options?.verbose ?? false;
  const refetch = options?.refetch ?? false;

  try {
    for (let i = 0; i < urls.length; i += concurrency) {
      const batch = urls.slice(i, i + concurrency);
      const batchPromises = batch.map(async (url): Promise<FetchLinkResult> => {
        try {
          const fetchResult = await fetchUrl(url, config, verbose);

          if (!fetchResult.success) {
            return { url, status: 'failed', error: fetchResult.error };
          }

          const saveResult = await saveToTemp(config, fetchResult.title, url, fetchResult.markdown, undefined, refetch);

          if (saveResult.error) {
            return { url, status: 'failed', error: saveResult.error };
          }

          if (saveResult.alreadyExists) {
            return { url, status: 'cached', refId: saveResult.refId };
          }

          return { url, status: 'new', refId: saveResult.refId };
        } catch (error) {
          const message = getErrorMessage(error);
          return { url, status: 'failed', error: message };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      if (options?.onProgress) {
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
