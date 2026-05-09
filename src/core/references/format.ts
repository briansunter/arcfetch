import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface ReferenceMetadata {
  title: string;
  url: string;
  fetchedDate: string;
  query?: string;
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n*/;
const FRONTMATTER_BLOCK_RE = /^---\n([\s\S]*?)\n---/;
const STATUS_TEMPORARY_RE = /^status:\s*temporary$/m;

const SLUG_MAX = 60;
const SLUG_SUFFIX_BUDGET = 8;

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

export function parseFrontmatter(frontmatter: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of frontmatter.split('\n')) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    values[match[1]] = unescapeYamlValue(match[2] ?? '');
  }
  return values;
}

/**
 * Parse a Reference file's content into its metadata block + body. Returns
 * null if the file lacks frontmatter.
 */
export function parseReferenceFile(content: string): { metadata: Record<string, string>; body: string } | null {
  const match = content.match(FRONTMATTER_BLOCK_RE);
  if (!match) return null;
  const metadata = parseFrontmatter(match[1]);
  const stripped = content.match(FRONTMATTER_RE);
  const body = stripped ? content.substring(stripped[0].length) : content;
  return { metadata, body };
}

/**
 * Build the on-disk content for a temporary Reference: frontmatter + body.
 */
export function buildTemporaryReferenceFile(
  meta: { title: string; url: string; fetchedDate: string; query?: string },
  body: string
): string {
  let out = '---\n';
  out += `title: ${escapeYamlValue(meta.title)}\n`;
  out += `source_url: ${escapeYamlValue(meta.url)}\n`;
  out += `fetched_date: ${meta.fetchedDate}\n`;
  out += `type: web\n`;
  out += `status: temporary\n`;
  if (meta.query) {
    out += `query: ${escapeYamlValue(meta.query)}\n`;
  }
  out += '---\n\n';
  out += body;
  return out;
}

/**
 * Flip a Reference file's status from `temporary` to `permanent`. The rest of
 * the content is left untouched.
 */
export function markPermanent(content: string): string {
  return content.replace(STATUS_TEMPORARY_RE, 'status: permanent');
}

/**
 * Derive a slug from a title. The result is at most 60 chars, lowercase
 * a-z0-9 with hyphens. Returns 'untitled' if the title produces an empty
 * slug.
 */
export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/^-|-$/g, '');

  return slug || 'untitled';
}

/**
 * Resolve a unique on-disk path for a new Reference under `dir`. If the
 * desired slug collides with an existing file, append `-2`, `-3`, … to a
 * truncated base.
 */
export function reserveReferencePath(dir: string, baseSlug: string): { refId: string; filepath: string } {
  const base = baseSlug.slice(0, SLUG_MAX - SLUG_SUFFIX_BUDGET).replace(/-$/g, '') || 'untitled';
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
