import { randomUUID } from 'node:crypto';
import { existsSync, linkSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

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

function parseFrontmatter(frontmatter: string): Record<string, string> {
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

/**
 * Stage complete content in a unique same-directory temp file, then claim the
 * final path with an exclusive `linkSync`. The destination is never observed
 * in a partially-written state and two concurrent claimants can never clobber
 * one another:
 *
 * 1. The full content is written to a unique staging file in `dir` (so the
 *    eventual link is intra-filesystem and atomic).
 * 2. The final candidate (`firstRefId.md`, then `<suffixBase>-2`, `-3`, …) is
 *    claimed with `linkSync`, which is no-clobber under races — a concurrent
 *    claimant gets EEXIST and advances to the next suffix. The destination
 *    only appears the instant the whole file is present.
 * 3. The staging file is removed on every exit path: success (the destination
 *    now owns the inode), every suffix collision, and any error.
 *
 * Shared by the temp-write and promote paths; each supplies its own staging
 * name, first candidate id, and suffix base so their filename/refId behaviors
 * stay unchanged.
 */
function stageAndClaim(
  dir: string,
  content: string,
  stagingName: string,
  firstRefId: string,
  suffixBase: string
): { refId: string; finalPath: string } {
  const stagingPath = join(dir, stagingName);
  try {
    writeFileSync(stagingPath, content, { encoding: 'utf-8', flag: 'wx' });

    let refId = firstRefId;
    let finalPath = join(dir, `${refId}.md`);
    let counter = 2;
    for (;;) {
      try {
        linkSync(stagingPath, finalPath);
        return { refId, finalPath };
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
        refId = `${suffixBase}-${counter}`;
        finalPath = join(dir, `${refId}.md`);
        counter++;
      }
    }
  } finally {
    // Best-effort: on success the inode lives on via the claimed finalPath; on
    // collision/error nothing final was touched. The file may already be gone
    // or never created.
    try {
      unlinkSync(stagingPath);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Atomically write a new Reference file under `dir`. The complete content is
 * staged in a unique same-directory temp file and then published with an
 * exclusive `linkSync`, so a crash or interruption mid-write can never expose a
 * partial `.md` in the temp tier, and two callers racing on the same slug
 * cannot both claim it — the second gets EEXIST and advances to the next
 * `-2`, `-3`, … suffix automatically.
 *
 * This closes both the reserve→write gap (vs. `reserveReferencePath`'s
 * existsSync loop) and the partial-write window of a bare `writeFileSync`.
 *
 * Only use this for brand-new files. Intentional overwrites of a known path
 * (e.g. the refetch branch) must bypass this and write directly.
 */
export function atomicWriteReference(
  dir: string,
  baseSlug: string,
  content: string
): { refId: string; filepath: string } {
  const base = baseSlug.slice(0, SLUG_MAX - SLUG_SUFFIX_BUDGET).replace(/-$/g, '') || 'untitled';
  const { refId, finalPath } = stageAndClaim(dir, content, `.${baseSlug}.write-${randomUUID()}.tmp`, baseSlug, base);
  return { refId, filepath: finalPath };
}

/**
 * Atomically + exclusively claim a *promoted* (permanent) destination under
 * `docsDir` for `baseStem` (the source filename without `.md`).
 *
 * The complete promoted content is staged in a unique same-directory temp file
 * and then published with an exclusive `linkSync` (via {@link stageAndClaim}),
 * so the destination is never observed partially-written and two concurrent
 * promotions of the same stem can never clobber one another; a concurrent
 * claimant gets EEXIST and advances to the next `-2`, `-3`, … suffix.
 *
 * `baseStem` must already be the bare source stem (no `.md`); the caller owns
 * that derivation so promotion's filename/refId behavior stays unchanged.
 */
export function atomicPromoteReference(
  docsDir: string,
  baseStem: string,
  content: string
): { refId: string; toPath: string } {
  const { refId, finalPath } = stageAndClaim(
    docsDir,
    content,
    `.${baseStem}.promote-${randomUUID()}.tmp`,
    baseStem,
    baseStem
  );
  return { refId, toPath: finalPath };
}

/**
 * Atomically replace a *known existing* target Reference with `content`. The
 * complete content is staged in a unique same-directory temp file using
 * exclusive creation, then published over the target with `renameSync`. A crash
 * or interruption mid-write can never expose a partial file or destroy the
 * previous complete body: until the rename lands, the target still points at its
 * old inode.
 *
 * Use only to overwrite a path that is known to exist (e.g. the refetch branch).
 * New-file creation must use {@link atomicWriteReference}; promotion uses
 * {@link atomicPromoteReference}. Unlike those, this intentionally *replaces*
 * one known path, so it uses `renameSync` rather than the no-clobber `linkSync`.
 */
export function atomicReplaceReference(targetPath: string, content: string): void {
  const stagingPath = join(dirname(targetPath), `.refetch-${randomUUID()}.tmp`);
  try {
    writeFileSync(stagingPath, content, { encoding: 'utf-8', flag: 'wx' });
    renameSync(stagingPath, targetPath);
  } finally {
    // Best-effort: on success the staging inode now lives at targetPath (renamed
    // away), so this is a no-op; on a staging-write or rename failure any staging
    // file that exists is removed so the next attempt starts clean. The prior
    // target is untouched whenever no rename landed.
    try {
      unlinkSync(stagingPath);
    } catch {
      /* ignore */
    }
  }
}
