import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { ArcfetchConfig } from '../config/schema';
import { getErrorMessage } from '../utils/error';

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
 * Escape a string value for safe inclusion in YAML frontmatter.
 * Strips newlines and wraps in double quotes with internal quotes escaped.
 */
function sanitizeYamlValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function escapeYamlValue(value: string): string {
  const sanitized = sanitizeYamlValue(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${sanitized}"`;
}

function unescapeYamlValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim();
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'").trim();
  }
  return trimmed;
}

function parseFrontmatter(frontmatter: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const line of frontmatter.split('\n')) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) {
      continue;
    }

    values[match[1]] = unescapeYamlValue(match[2] ?? '');
  }

  return values;
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
 * Generate a slug from title
 */
function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
    .replace(/^-|-$/g, '');

  return slug || 'untitled';
}

function getUniqueMarkdownPath(dir: string, baseSlug: string): { refId: string; filepath: string } {
  const suffixBudget = 8;
  const base = baseSlug.slice(0, 60 - suffixBudget).replace(/-$/g, '') || 'untitled';
  let refId = baseSlug;
  let filepath = join(dir, `${refId}.md`);
  let counter = 2;

  while (existsSync(filepath)) {
    refId = `${base}-${counter}`;
    filepath = join(dir, `${refId}.md`);
    counter++;
  }

  return { refId, filepath };
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
    const ref = existing && refetch ? existing : getUniqueMarkdownPath(tempDir, slug);
    const refId = existing && refetch ? existing.refId : ref.refId;
    const filepath = ref.filepath;

    const today = new Date().toISOString().split('T')[0];
    let fileContent = `---\n`;
    fileContent += `title: ${escapeYamlValue(title)}\n`;
    fileContent += `source_url: ${escapeYamlValue(url)}\n`;
    fileContent += `fetched_date: ${today}\n`;
    fileContent += `type: web\n`;
    fileContent += `status: temporary\n`;
    if (query) {
      fileContent += `query: ${escapeYamlValue(query)}\n`;
    }
    fileContent += `---\n\n`;
    fileContent += content;

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

      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!frontmatterMatch) continue;

      const metadata = parseFrontmatter(frontmatterMatch[1]);

      // Use filename (without .md) as refId
      const slug = file.replace(/\.md$/, '');

      const ref = {
        refId: slug,
        title: metadata.title ?? '',
        url: metadata.source_url ?? '',
        filepath,
        fetchedDate: metadata.fetched_date ?? '',
        size: content.length,
        query: metadata.query || undefined,
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

    let content = readFileSync(cached.filepath, 'utf-8');

    content = content.replace(/^status:\s*temporary$/m, 'status: permanent');

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

    writeFileSync(toPath, content, 'utf-8');

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
  const links: ExtractedLink[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < content.length; index++) {
    if (content[index] !== '[' || content[index - 1] === '!') {
      continue;
    }

    const closeTextIndex = findClosingBracket(content, index);
    if (closeTextIndex === -1 || content[closeTextIndex + 1] !== '(') {
      continue;
    }

    const parsedLink = parseMarkdownLinkDestination(content, closeTextIndex + 2);
    if (!parsedLink) {
      continue;
    }

    const text = content.slice(index + 1, closeTextIndex);
    const href = parsedLink.href;

    try {
      const parsedUrl = new URL(href);
      if ((parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') && !seen.has(href)) {
        seen.add(href);
        links.push({ text, href });
      }
    } catch {
      // Ignore invalid, relative, anchor, mailto, and other non-URL destinations.
    }

    index = parsedLink.endIndex;
  }

  return links;
}

function findClosingBracket(content: string, openIndex: number): number {
  for (let index = openIndex + 1; index < content.length; index++) {
    if (content[index] === '\\') {
      index++;
      continue;
    }
    if (content[index] === ']') {
      return index;
    }
  }
  return -1;
}

function parseMarkdownLinkDestination(content: string, startIndex: number): { href: string; endIndex: number } | null {
  let index = startIndex;
  while (/\s/.test(content[index] ?? '')) {
    index++;
  }

  let href = '';

  if (content[index] === '<') {
    const closeAngleIndex = content.indexOf('>', index + 1);
    if (closeAngleIndex === -1) {
      return null;
    }
    href = content.slice(index + 1, closeAngleIndex).trim();
    index = closeAngleIndex + 1;
  } else {
    const destinationStart = index;
    let depth = 0;

    for (; index < content.length; index++) {
      const char = content[index];
      if (char === '\\') {
        index++;
        continue;
      }
      if (char === '(') {
        depth++;
        continue;
      }
      if (char === ')') {
        if (depth === 0) {
          break;
        }
        depth--;
        continue;
      }
      if (/\s/.test(char) && depth === 0) {
        break;
      }
    }

    href = content.slice(destinationStart, index).trim();
  }

  while (/\s/.test(content[index] ?? '')) {
    index++;
  }

  if (content[index] !== ')') {
    const closeParenIndex = content.indexOf(')', index);
    if (closeParenIndex === -1) {
      return null;
    }
    index = closeParenIndex;
  }

  if (!href) {
    return null;
  }

  return { href, endIndex: index };
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
    const message = getErrorMessage(error);
    return {
      links: [],
      count: 0,
      sourceRef: refId,
      error: message,
    };
  }
}
