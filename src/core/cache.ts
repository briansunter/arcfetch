import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from 'fs';
import { writeFile, unlink } from 'fs/promises';
import { join, basename, resolve } from 'path';
import type { FetchiConfig } from '../config/schema.js';

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
 * Get the next available reference ID
 */
export function getNextRefId(dir: string): string {
  if (!existsSync(dir)) {
    return 'REF-001';
  }

  try {
    const files = readdirSync(dir);
    let maxId = 0;

    for (const file of files) {
      const match = file.match(/REF-(\d+)/);
      if (match) {
        const id = parseInt(match[1], 10);
        if (id > maxId) maxId = id;
      }
    }

    return `REF-${String(maxId + 1).padStart(3, '0')}`;
  } catch {
    return 'REF-001';
  }
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
  query?: string
): Promise<SaveResult> {
  try {
    const tempDir = config.paths.tempDir;

    mkdirSync(tempDir, { recursive: true });

    const refId = getNextRefId(tempDir);
    const slug = slugify(title);
    const filename = `${refId}-${slug}.md`;
    const filepath = join(tempDir, filename);

    const today = new Date().toISOString().split('T')[0];
    let fileContent = `---\n`;
    fileContent += `id: ${refId}\n`;
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

    return { refId, filepath };
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

    const files = readdirSync(tempDir).filter(f => f.endsWith('.md') && f.startsWith('REF-'));
    const references: CachedReference[] = [];

    for (const file of files) {
      const filepath = join(tempDir, file);
      const content = readFileSync(filepath, 'utf-8');

      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (!frontmatterMatch) continue;

      const frontmatter = frontmatterMatch[1];

      const getId = (key: string): string => {
        const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
        return match ? match[1].trim().replace(/^["']|["']$/g, '').trim() : '';
      };

      const ref = {
        refId: getId('id'),
        title: getId('title'),
        url: getId('source_url'),
        filepath,
        fetchedDate: getId('fetched_date'),
        size: content.length,
        query: getId('query') || undefined,
      };
      references.push(ref);
    }

    references.sort((a, b) => b.refId.localeCompare(a.refId));

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
