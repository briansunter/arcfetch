import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { ArcfetchConfig } from '../config/schema';
import { getErrorMessage } from '../utils/error';
import { type ExtractedLink, extractLinksFromMarkdown } from '../utils/markdown-links';
import {
  buildTemporaryReferenceFile,
  markPermanent,
  parseReferenceFile,
  reserveReferencePath,
  slugify,
} from './references/format';

export type { ExtractedLink };

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
 * Find a cached reference by URL
 */
export function findByUrl(config: ArcfetchConfig, url: string): CachedReference | null {
  const references = getCachedIndex(config);
  return references.find((r) => r.url === url) || null;
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
    const ref = existing && refetch ? existing : reserveReferencePath(tempDir, slug);
    const refId = existing && refetch ? existing.refId : ref.refId;
    const filepath = ref.filepath;

    const today = new Date().toISOString().split('T')[0];
    const fileContent = buildTemporaryReferenceFile({ title, url, fetchedDate: today, query }, content);

    await writeFile(filepath, fileContent, 'utf-8');

    // Invalidate cache index after mutation
    cachedIndex = null;

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
    references.sort((a, b) => b.fetchedDate.localeCompare(a.fetchedDate) || a.refId.localeCompare(b.refId));

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

    const filename = basename(cached.filepath);
    const desiredPath = join(docsDir, filename);
    const parsedFilename = filename.match(/^(.*?)(\.md)$/);
    let toPath = desiredPath;
    let counter = 2;

    while (existsSync(toPath)) {
      const stem = parsedFilename?.[1] ?? filename.replace(/\.md$/, '');
      const ext = parsedFilename?.[2] ?? '.md';
      toPath = join(docsDir, `${stem}-${counter}${ext}`);
      counter++;
    }

    writeFileSync(toPath, promoted, 'utf-8');

    unlinkSync(cached.filepath);

    // Invalidate cache index after mutation
    cachedIndex = null;

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

    // Invalidate cache index after mutation
    cachedIndex = null;

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

    const links = extractLinksFromMarkdown(body);

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
