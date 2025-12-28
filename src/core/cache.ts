import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import type { FetchiConfig } from '../config/schema';

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

/**
 * Find a cached reference by URL
 */
export function findByUrl(config: FetchiConfig, url: string): CachedReference | null {
  const { references } = listCached(config);
  return references.find(r => r.url === url) || null;
}

/**
 * Generate a slug from title
 */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

/**
 * Save content to temp directory
 */
export async function saveToTemp(
  config: FetchiConfig,
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
    const filename = `${slug}.md`;
    // Use existing filepath if refetching, otherwise use new path
    const filepath = existing && refetch ? existing.filepath : join(tempDir, filename);

    const today = new Date().toISOString().split('T')[0];
    let fileContent = `---\n`;
    fileContent += `title: "${title.replace(/"/g, '\\"')}"\n`;
    fileContent += `source_url: ${url}\n`;
    fileContent += `fetched_date: ${today}\n`;
    fileContent += `type: web\n`;
    fileContent += `status: temporary\n`;
    if (query) {
      fileContent += `query: "${query.replace(/"/g, '\\"')}"\n`;
    }
    fileContent += `---\n\n`;
    fileContent += content;

    await writeFile(filepath, fileContent, 'utf-8');

    return { refId: slug, filepath };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { refId: '', filepath: '', error: message };
  }
}

/**
 * List all cached references
 */
export function listCached(config: FetchiConfig): ListResult {
  try {
    const tempDir = config.paths.tempDir;

    if (!existsSync(tempDir)) {
      return { references: [] };
    }

    const files = readdirSync(tempDir).filter(f => f.endsWith('.md'));
    const references: CachedReference[] = [];

    for (const file of files) {
      const filepath = join(tempDir, file);
      const content = readFileSync(filepath, 'utf-8');

      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!frontmatterMatch) continue;

      const frontmatter = frontmatterMatch[1];

      const getValue = (key: string): string => {
        const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
        return match ? match[1].trim().replace(/^["']|["']$/g, '').trim() : '';
      };

      // Use filename (without .md) as refId
      const slug = file.replace(/\.md$/, '');

      const ref = {
        refId: slug,
        title: getValue('title'),
        url: getValue('source_url'),
        filepath,
        fetchedDate: getValue('fetched_date'),
        size: content.length,
        query: getValue('query') || undefined,
      };
      references.push(ref);
    }

    // Sort by fetched date (newest first)
    references.sort((a, b) => b.fetchedDate.localeCompare(a.fetchedDate));

    return { references };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { references: [], error: message };
  }
}

/**
 * Find a cached reference by ID
 */
export function findCached(config: FetchiConfig, refId: string): CachedReference | null {
  const { references } = listCached(config);
  return references.find(r => r.refId === refId) || null;
}

/**
 * Promote a reference from temp to docs folder
 */
export function promoteReference(config: FetchiConfig, refId: string): PromoteResult {
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

    let content = readFileSync(cached.filepath, 'utf-8');

    content = content.replace(/^status:\s*temporary$/m, 'status: permanent');

    const filename = basename(cached.filepath);
    const toPath = join(docsDir, filename);

    writeFileSync(toPath, content, 'utf-8');

    unlinkSync(cached.filepath);

    return {
      success: true,
      fromPath: cached.filepath,
      toPath,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
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
export function deleteCached(config: FetchiConfig, refId: string): DeleteResult {
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

    return {
      success: true,
      filepath: cached.filepath,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      filepath: '',
      error: message,
    };
  }
}

/**
 * Get cache root (for backwards compatibility)
 */
export function findCacheRoot(): string {
  return process.cwd();
}

// ============================================================================
// LINK EXTRACTION
// ============================================================================

export interface ExtractedLink {
  text: string;
  href: string;
}

export interface LinkExtractionResult {
  links: ExtractedLink[];
  count: number;
  sourceRef: string;
  error?: string;
}

/**
 * Extract all http/https links from markdown content
 */
function extractLinksFromMarkdown(content: string): ExtractedLink[] {
  // Match markdown links: [text](url)
  const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  const links: ExtractedLink[] = [];
  const seen = new Set<string>();

  for (const match of content.matchAll(linkRegex)) {
    const text = match[1];
    const href = match[2];

    // Only include http/https links, skip anchors, relative paths, mailto, etc.
    if (href.startsWith('http://') || href.startsWith('https://')) {
      // Deduplicate by href
      if (!seen.has(href)) {
        seen.add(href);
        links.push({ text, href });
      }
    }
  }

  return links;
}

/**
 * Extract all links from a cached reference
 */
export function extractLinksFromCached(config: FetchiConfig, refId: string): LinkExtractionResult {
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

    // Skip frontmatter, only extract from body
    const frontmatterMatch = content.match(/^---\n[\s\S]*?\n---\n*/);
    const body = frontmatterMatch ? content.substring(frontmatterMatch[0].length) : content;

    const links = extractLinksFromMarkdown(body);

    return {
      links,
      count: links.length,
      sourceRef: refId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      links: [],
      count: 0,
      sourceRef: refId,
      error: message,
    };
  }
}
