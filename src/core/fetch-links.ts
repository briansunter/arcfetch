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
const CONCURRENCY = 3;

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

  const verbose = options.verbose ?? false;
  const refetch = options.refetch ?? false;

  // Sliding-window acquisition: a fixed pool of CONCURRENCY workers drains a
  // shared queue, so the moment one acquisition finishes its worker pulls the
  // next link. A slow URL therefore never idles the other slots the way fixed
  // batches would. Completions land in `settled` by source index; `emitReady`
  // drains them in source order, so results and progress callbacks are emitted
  // in source order regardless of completion order.
  const results: FetchLinkResult[] = [];
  const settled: Array<FetchLinkResult | undefined> = new Array(urls.length);
  let emitCursor = 0;
  let progressError: { error: unknown } | null = null;

  // `progressError` is assigned inside the `emitReady` closure, so the
  // outer-scope control-flow narrowing cannot see that assignment. Reading it
  // from a nested function uses its declared type and avoids TS collapsing it
  // to `never`.
  const rethrowIfAborted = (): void => {
    if (progressError !== null) {
      throw progressError.error;
    }
  };

  const emitReady = (): void => {
    if (progressError !== null) return;
    while (emitCursor < settled.length) {
      const result = settled[emitCursor];
      if (result === undefined) break;
      results.push(result);
      emitCursor++;
      if (options.onProgress) {
        try {
          options.onProgress(result);
        } catch (error) {
          progressError = { error };
          return;
        }
      }
    }
  };

  const acquireOne = async (url: string): Promise<FetchLinkResult> => {
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
  };

  const queue = Array.from({ length: urls.length }, (_, index) => index);

  const worker = async (): Promise<void> => {
    while (progressError === null) {
      const index = queue.shift();
      if (index === undefined) return;

      const result = await acquireOne(urls[index]);
      settled[index] = result;
      emitReady();
    }
  };

  try {
    const workerCount = Math.min(CONCURRENCY, urls.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
  } finally {
    // Close only once every in-flight acquisition has settled: the workers do
    // not pull new work after a progress error, but they always finish the
    // acquisition they are already running before returning.
    await closeBrowser();
  }

  rethrowIfAborted();

  const summary = {
    new: results.filter((r) => r.status === 'new').length,
    cached: results.filter((r) => r.status === 'cached').length,
    failed: results.filter((r) => r.status === 'failed').length,
  };

  return { results, summary };
}
