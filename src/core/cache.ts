import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { ArcfetchConfig } from '../config/schema';
import { getErrorMessage } from '../utils/error';
import { type ExtractedLink, extractLinksFromMarkdown } from '../utils/markdown-links';
import {
  atomicPromoteReference,
  atomicReplaceReference,
  atomicWriteReference,
  buildTemporaryReferenceFile,
  markPermanent,
  parseReferenceFile,
  slugify,
} from './references/format';

export interface CachedReference {
  refId: string;
  title: string;
  url: string;
  filepath: string;
  fetchedDate: string;
  size: number;
  query?: string;
}

export interface SaveResult {
  refId: string;
  filepath: string;
  alreadyExists?: boolean;
  error?: string;
}

export interface ListResult {
  references: CachedReference[];
  error?: string;
}

export interface PromoteResult {
  success: boolean;
  fromPath: string;
  toPath: string;
  error?: string;
}

export interface DeleteResult {
  success: boolean;
  filepath: string;
  error?: string;
}

// In-memory cache index to avoid repeated directory scans
let cachedIndex: { references: CachedReference[]; dir: string; signature: string } | null = null;

// Sort references newest-first by fetched date, ties broken by refId. Shared by
// the disk read (listCached) and the in-memory mutation updates below so a warmed
// index stays ordered identically to a freshly-read one.
const byFetchedDateThenRefId = (a: CachedReference, b: CachedReference): number =>
  b.fetchedDate.localeCompare(a.fetchedDate) || a.refId.localeCompare(b.refId);

// Directory mtime alone is unreliable: macOS APFS reports `mtimeMs` with ~1ms
// resolution, so a rapid rmSync+mkdirSync cycle (or two writes within the same
// millisecond) produces identical timestamps. Hash filename+size+mtime per file
// instead so external mutations and quick test cycles invalidate correctly.
function getDirSignature(dir: string): string | null {
  try {
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.md'))
      .sort();
    const parts: string[] = [];
    for (const file of files) {
      const stat = statSync(join(dir, file));
      parts.push(`${file}:${stat.size}:${stat.mtimeMs}`);
    }
    return parts.join('|');
  } catch {
    return null;
  }
}

function getCachedIndex(config: ArcfetchConfig): CachedReference[] {
  const tempDir = config.paths.tempDir;
  const signature = getDirSignature(tempDir);
  if (signature === null) {
    // The directory is absent/unreadable, so a warm index for it cannot still
    // be valid — drop it. Without this, an index warmed before the directory was
    // removed (e.g. an external `rm` of the whole temp tier) would survive and be
    // mutated onto by later self-mutations instead of rebuilding from disk.
    if (cachedIndex?.dir === tempDir) {
      cachedIndex = null;
    }
    return [];
  }
  if (cachedIndex && cachedIndex.dir === tempDir && cachedIndex.signature === signature) {
    return cachedIndex.references;
  }
  const { references } = listCached(config);
  cachedIndex = { references, dir: tempDir, signature };
  return references;
}

/**
 * Recompute and store the warmed index's directory signature after this process
 * has mutated the temp directory on disk. The signature is the external-mutation
 * guard that {@link getCachedIndex} recomputes on every lookup; without
 * refreshing it the next lookup would observe a stale signature, miss, and
 * re-read every file. If the signature cannot be recomputed (e.g. the directory
 * was removed) the warm index is dropped so the next lookup rebuilds safely.
 */
function refreshCachedSignature(tempDir: string): void {
  if (!cachedIndex) return;
  const signature = getDirSignature(tempDir);
  if (signature === null) {
    cachedIndex = null;
    return;
  }
  cachedIndex.signature = signature;
}

/**
 * Canonical HTTP URL identity for duplicate detection. Fragments are never
 * sent to servers, and the WHATWG URL parser (the same parser the fetch layer
 * uses) canonicalises equivalent spellings such as host case and default
 * ports — so raw string equality would let `https://example.com/a`,
 * `https://example.com/a#s`, and `HTTPS://EXAMPLE.COM:443/a` create distinct
 * References for the same resource. This collapses them by parsing with
 * `new URL`, dropping the fragment, and returning the canonical string.
 *
 * Deliberately narrow in two ways. First, only `http:` and `https:` URLs are
 * canonicalised: any other scheme (ftp:, file:, mailto:, ...) keeps the raw
 * string — whether or not the WHATWG parser accepts it — so non-HTTP metadata
 * a direct cache caller might store retains raw-string identity. Second, only
 * the parser's own canonicalisations apply: query ordering, path case, and
 * other spellings the parser preserves are left intact, so those remain
 * distinct identities. A URL that fails to parse also falls back to the raw
 * string.
 */
function cacheUrlIdentity(url: string): string {
  try {
    const parsed = new URL(url);
    // Canonical identity is defined for HTTP(S) only; any other scheme keeps
    // raw-string identity regardless of whether the parser accepted it.
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return url;
    }
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Find a cached reference by URL, comparing on the canonical URL identity so
 * equivalent spellings (fragment, host case, default port) resolve to the same
 * Reference instead of creating duplicates.
 */
export function findByUrl(config: ArcfetchConfig, url: string): CachedReference | null {
  const references = getCachedIndex(config);
  const identity = cacheUrlIdentity(url);
  return references.find((r) => cacheUrlIdentity(r.url) === identity) || null;
}

/**
 * Save content to temp directory
 */
export async function saveToTemp(
  config: ArcfetchConfig,
  title: string,
  url: string,
  content: string,
  query?: string,
  refetch?: boolean
): Promise<SaveResult> {
  try {
    const tempDir = config.paths.tempDir;

    // Check if URL was already fetched (unless refetch is true)
    const existing = findByUrl(config, url);
    if (existing && !refetch) {
      return {
        refId: existing.refId,
        filepath: existing.filepath,
        alreadyExists: true,
      };
    }

    mkdirSync(tempDir, { recursive: true });

    const slug = slugify(title);
    const today = new Date().toISOString().split('T')[0];
    // Preserve the originally stored source URL when a refetch arrives through
    // an equivalent spelling (fragment/case/default-port variant): findByUrl
    // collapses such spellings to one existing Reference, so the refetch must
    // not rewrite that Reference's stored URL with the caller's variant. A
    // brand-new Reference keeps the caller-provided URL verbatim.
    const storeUrl = existing ? existing.url : url;
    const fileContent = buildTemporaryReferenceFile({ title, url: storeUrl, fetchedDate: today, query }, content);

    let refId: string;
    let filepath: string;

    if (existing && refetch) {
      // Intentional overwrite of a known existing path — not a new-file race,
      // but still crash-safe: stage the complete body in a sibling temp file and
      // atomically rename it over the target so an interruption can never expose
      // a partial file or destroy the previous complete body.
      refId = existing.refId;
      filepath = existing.filepath;
      atomicReplaceReference(filepath, fileContent);
    } else {
      // New file: atomically claim the first free slug so concurrent saves with
      // the same title (different URLs) cannot clobber each other.
      ({ refId, filepath } = atomicWriteReference(tempDir, slug, fileContent));
    }

    // Reflect the successful write in a warm index instead of dropping it for a
    // full re-read. A compatible warm index (same temp dir) is updated in place
    // and its signature refreshed so the next lookup hits without re-parsing; an
    // absent/incompatible index falls back to null and rebuilds lazily on read.
    if (cachedIndex && cachedIndex.dir === tempDir) {
      if (existing && refetch) {
        // `existing` is the live element of the warm index (located via
        // findByUrl, which reads this same array); update its mutable fields in
        // place, preserving refId/url/filepath.
        existing.title = title;
        existing.fetchedDate = today;
        existing.size = fileContent.length;
        existing.query = query || undefined;
      } else {
        cachedIndex.references.push({
          refId,
          filepath,
          title,
          url,
          fetchedDate: today,
          size: fileContent.length,
          query: query || undefined,
        });
      }
      cachedIndex.references.sort(byFetchedDateThenRefId);
      refreshCachedSignature(tempDir);
    } else {
      cachedIndex = null;
    }

    return { refId, filepath };
  } catch (error) {
    const message = getErrorMessage(error);
    return { refId: '', filepath: '', error: message };
  }
}

/**
 * List all cached references
 */
export function listCached(config: ArcfetchConfig): ListResult {
  try {
    const tempDir = config.paths.tempDir;

    if (!existsSync(tempDir)) {
      return { references: [] };
    }

    const files = readdirSync(tempDir).filter((f) => f.endsWith('.md'));
    const references: CachedReference[] = [];

    for (const file of files) {
      const filepath = join(tempDir, file);
      const content = readFileSync(filepath, 'utf-8');

      const parsed = parseReferenceFile(content);
      if (!parsed) continue;

      // Use filename (without .md) as refId
      const slug = file.replace(/\.md$/, '');

      const ref = {
        refId: slug,
        title: parsed.metadata.title ?? '',
        url: parsed.metadata.source_url ?? '',
        filepath,
        fetchedDate: parsed.metadata.fetched_date ?? '',
        size: content.length,
        query: parsed.metadata.query || undefined,
      };
      references.push(ref);
    }

    // Sort by fetched date (newest first)
    references.sort(byFetchedDateThenRefId);

    return { references };
  } catch (error) {
    const message = getErrorMessage(error);
    return { references: [], error: message };
  }
}

/**
 * Find a cached reference by ID
 */
export function findCached(config: ArcfetchConfig, refId: string): CachedReference | null {
  const references = getCachedIndex(config);
  return references.find((r) => r.refId === refId) || null;
}

/**
 * Promote a reference from temp to docs folder
 */
export function promoteReference(config: ArcfetchConfig, refId: string): PromoteResult {
  try {
    const cached = findCached(config, refId);

    if (!cached) {
      return {
        success: false,
        fromPath: '',
        toPath: '',
        error: `Reference ${refId} not found in ${config.paths.tempDir}`,
      };
    }

    const docsDir = config.paths.docsDir;

    mkdirSync(docsDir, { recursive: true });

    const original = readFileSync(cached.filepath, 'utf-8');
    const promoted = markPermanent(original);

    // Atomically + exclusively claim a docs destination. The destination is
    // never seen partially written, a concurrent promotion cannot clobber this
    // one (or be clobbered), and an existing docs file is never overwritten.
    const baseStem = basename(cached.filepath).replace(/\.md$/, '');
    const { toPath } = atomicPromoteReference(docsDir, baseStem, promoted);

    // The source is removed only after a complete destination has been claimed.
    try {
      unlinkSync(cached.filepath);
    } catch (unlinkError) {
      // The destination exists but the source could not be removed: do not
      // report success while the reference lives in both tiers. Best-effort
      // undo the destination we just claimed (this is the file we created, not
      // a pre-existing one — atomicPromoteReference never overwrites).
      try {
        unlinkSync(toPath);
      } catch (compensateError) {
        return {
          success: false,
          fromPath: cached.filepath,
          toPath,
          error: `Promoted ${cached.filepath} to ${toPath} but could not remove source: ${getErrorMessage(
            unlinkError
          )}; compensating removal of destination also failed: ${getErrorMessage(compensateError)}`,
        };
      }
      return {
        success: false,
        fromPath: cached.filepath,
        toPath: '',
        error: `Promoted to ${toPath} but could not remove source: ${getErrorMessage(unlinkError)}`,
      };
    }

    // Reflect the source removal in a warm index instead of dropping it for a
    // full re-read. The promote wrote only to docsDir; tempDir changed solely via
    // the source unlink above, so refreshing the signature keeps the warm index
    // valid. On an absent/incompatible warm index, fall back to null/rebuild.
    if (cachedIndex && cachedIndex.dir === config.paths.tempDir) {
      const idx = cachedIndex.references.findIndex((r) => r.refId === refId);
      if (idx >= 0) cachedIndex.references.splice(idx, 1);
      refreshCachedSignature(config.paths.tempDir);
    } else {
      cachedIndex = null;
    }

    return {
      success: true,
      fromPath: cached.filepath,
      toPath,
    };
  } catch (error) {
    const message = getErrorMessage(error);
    return {
      success: false,
      fromPath: '',
      toPath: '',
      error: message,
    };
  }
}

/**
 * Delete a cached reference
 */
export function deleteCached(config: ArcfetchConfig, refId: string): DeleteResult {
  try {
    const cached = findCached(config, refId);

    if (!cached) {
      return {
        success: false,
        filepath: '',
        error: `Reference ${refId} not found in ${config.paths.tempDir}`,
      };
    }

    unlinkSync(cached.filepath);

    // Reflect the removal in a warm index instead of dropping it for a full
    // re-read; refresh the signature so the next lookup hits. Fall back to
    // null/rebuild on an absent/incompatible warm index.
    if (cachedIndex && cachedIndex.dir === config.paths.tempDir) {
      const idx = cachedIndex.references.findIndex((r) => r.refId === refId);
      if (idx >= 0) cachedIndex.references.splice(idx, 1);
      refreshCachedSignature(config.paths.tempDir);
    } else {
      cachedIndex = null;
    }

    return {
      success: true,
      filepath: cached.filepath,
    };
  } catch (error) {
    const message = getErrorMessage(error);
    return {
      success: false,
      filepath: '',
      error: message,
    };
  }
}

// ============================================================================
// LINK EXTRACTION
// ============================================================================

export interface LinkExtractionResult {
  links: ExtractedLink[];
  count: number;
  sourceRef: string;
  error?: string;
}

/**
 * Extract all links from a cached reference
 */
export function extractLinksFromCached(config: ArcfetchConfig, refId: string): LinkExtractionResult {
  try {
    const cached = findCached(config, refId);

    if (!cached) {
      return {
        links: [],
        count: 0,
        sourceRef: refId,
        error: `Reference ${refId} not found in ${config.paths.tempDir}`,
      };
    }

    const content = readFileSync(cached.filepath, 'utf-8');
    const parsed = parseReferenceFile(content);
    const body = parsed ? parsed.body : content;

    // Resolve relative links against the reference's source URL when it is a
    // valid http/https URL, so same-site/article-local links become crawlable.
    // An absent or invalid source URL safely falls back to absolute-only.
    const links = extractLinksFromMarkdown(body, cached.url);

    return {
      links,
      count: links.length,
      sourceRef: refId,
    };
  } catch (error) {
    const message = getErrorMessage(error);
    return {
      links: [],
      count: 0,
      sourceRef: refId,
      error: message,
    };
  }
}
