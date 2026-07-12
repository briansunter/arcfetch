import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicPromoteReference, atomicReplaceReference, atomicWriteReference } from '../../src/core/references/format';

const DOCS = '.test-format-docs';
const TEMP = '.test-format-temp';

// A staging file is any non-.md temp the helper writes into the dir.
function stagingLeftovers(dir: string = DOCS): string[] {
  return readdirSync(dir).filter((f) => !f.endsWith('.md'));
}

describe('atomicPromoteReference', () => {
  beforeEach(() => {
    if (existsSync(DOCS)) rmSync(DOCS, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(DOCS)) rmSync(DOCS, { recursive: true });
  });

  test('claims the base name and writes complete content, no staging temp left', () => {
    mkdirSync(DOCS, { recursive: true });
    const content = '---\nstatus: permanent\n---\n\nbody line one\nbody line two';

    const { refId, toPath } = atomicPromoteReference(DOCS, 'my-ref', content);

    expect(refId).toBe('my-ref');
    expect(toPath.endsWith('my-ref.md')).toBe(true);
    expect(readFileSync(toPath, 'utf-8')).toBe(content);
    expect(stagingLeftovers()).toEqual([]);
  });

  test('advances -2/-3 suffix on collision and never overwrites existing docs', () => {
    mkdirSync(DOCS, { recursive: true });
    writeFileSync(join(DOCS, 'my-ref.md'), 'first', 'utf-8');
    writeFileSync(join(DOCS, 'my-ref-2.md'), 'second', 'utf-8');

    const { refId, toPath } = atomicPromoteReference(DOCS, 'my-ref', 'incoming');

    expect(refId).toBe('my-ref-3');
    expect(toPath.endsWith('my-ref-3.md')).toBe(true);
    expect(readFileSync(join(DOCS, 'my-ref.md'), 'utf-8')).toBe('first');
    expect(readFileSync(join(DOCS, 'my-ref-2.md'), 'utf-8')).toBe('second');
    expect(readFileSync(toPath, 'utf-8')).toBe('incoming');
    expect(stagingLeftovers()).toEqual([]);
  });

  test('two claims on the same stem never clobber — distinct paths, both intact', () => {
    // Models a concurrent promotion race against the same destination name.
    mkdirSync(DOCS, { recursive: true });

    const a = atomicPromoteReference(DOCS, 'race', 'a-content');
    const b = atomicPromoteReference(DOCS, 'race', 'b-content');

    expect(a.toPath).not.toBe(b.toPath);
    expect(a.toPath.endsWith('race.md')).toBe(true);
    expect(b.toPath.endsWith('race-2.md')).toBe(true);
    expect(readFileSync(a.toPath, 'utf-8')).toBe('a-content');
    expect(readFileSync(b.toPath, 'utf-8')).toBe('b-content');
    expect(stagingLeftovers()).toEqual([]);
  });

  test('throws and leaves no staging file when the staging write itself fails', () => {
    // docsDir resolves to a regular file: the staging path is `<file>/<name>`
    // and its creation fails (ENOTDIR). The finally must clean up any staging.
    writeFileSync(DOCS, 'i-am-a-file-not-a-dir', 'utf-8');

    expect(() => atomicPromoteReference(DOCS, 'my-ref', 'content')).toThrow();
    // No staging temp leaked alongside the bogus "dir".
    expect(readFileSync(DOCS, 'utf-8')).toBe('i-am-a-file-not-a-dir');
  });
});

describe('atomicWriteReference', () => {
  beforeEach(() => {
    if (existsSync(TEMP)) rmSync(TEMP, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEMP)) rmSync(TEMP, { recursive: true });
  });

  test('publishes complete content at the base slug, no staging temp left', () => {
    mkdirSync(TEMP, { recursive: true });
    const content = '---\nstatus: temporary\n---\n\ncomplete body line one\nbody line two';

    const { refId, filepath } = atomicWriteReference(TEMP, 'my-ref', content);

    expect(refId).toBe('my-ref');
    expect(filepath.endsWith('my-ref.md')).toBe(true);
    expect(readFileSync(filepath, 'utf-8')).toBe(content);
    expect(stagingLeftovers(TEMP)).toEqual([]);
  });

  test('advances -2/-3 suffix on collision and never overwrites existing files', () => {
    mkdirSync(TEMP, { recursive: true });
    writeFileSync(join(TEMP, 'my-ref.md'), 'first', 'utf-8');
    writeFileSync(join(TEMP, 'my-ref-2.md'), 'second', 'utf-8');

    const { refId, filepath } = atomicWriteReference(TEMP, 'my-ref', 'incoming');

    expect(refId).toBe('my-ref-3');
    expect(filepath.endsWith('my-ref-3.md')).toBe(true);
    expect(readFileSync(join(TEMP, 'my-ref.md'), 'utf-8')).toBe('first');
    expect(readFileSync(join(TEMP, 'my-ref-2.md'), 'utf-8')).toBe('second');
    expect(readFileSync(filepath, 'utf-8')).toBe('incoming');
    expect(stagingLeftovers(TEMP)).toEqual([]);
  });

  test('repeated same-stem claims stay distinct and each holds complete content', () => {
    // Models concurrent writes racing on the same slug.
    mkdirSync(TEMP, { recursive: true });

    const a = atomicWriteReference(TEMP, 'race', 'a-content');
    const b = atomicWriteReference(TEMP, 'race', 'b-content');
    const c = atomicWriteReference(TEMP, 'race', 'c-content');

    expect(new Set([a.filepath, b.filepath, c.filepath]).size).toBe(3);
    expect(a.refId).toBe('race');
    expect(b.refId).toBe('race-2');
    expect(c.refId).toBe('race-3');
    expect(readFileSync(a.filepath, 'utf-8')).toBe('a-content');
    expect(readFileSync(b.filepath, 'utf-8')).toBe('b-content');
    expect(readFileSync(c.filepath, 'utf-8')).toBe('c-content');
    expect(stagingLeftovers(TEMP)).toEqual([]);
  });

  test('throws and leaves no staging temp when the staging write fails', () => {
    // dir resolves to a regular file: the staging path is `<file>/<name>` and
    // its creation fails (ENOTDIR). The finally must clean up any staging.
    writeFileSync(TEMP, 'i-am-a-file-not-a-dir', 'utf-8');

    expect(() => atomicWriteReference(TEMP, 'my-ref', 'content')).toThrow();
    // No staging temp replaced the bogus "dir".
    expect(readFileSync(TEMP, 'utf-8')).toBe('i-am-a-file-not-a-dir');
  });
});

describe('atomicReplaceReference', () => {
  beforeEach(() => {
    if (existsSync(TEMP)) rmSync(TEMP, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEMP)) rmSync(TEMP, { recursive: true });
  });

  test('fully replaces a known target at the same path, leaving no staging temp', () => {
    mkdirSync(TEMP, { recursive: true });
    const target = join(TEMP, 'my-ref.md');
    writeFileSync(target, '---\nstatus: temporary\n---\n\nold complete body', 'utf-8');

    const content = '---\nstatus: temporary\n---\n\nnew complete body\nline two';
    atomicReplaceReference(target, content);

    // The target was fully replaced at the identical path; the old body is gone.
    expect(readFileSync(target, 'utf-8')).toBe(content);
    expect(readFileSync(target, 'utf-8')).not.toContain('old complete body');
    // No staging temp was leaked alongside the finished .md.
    expect(stagingLeftovers(TEMP)).toEqual([]);
    expect(readdirSync(TEMP).some((f) => /\.refetch-.*\.tmp$/.test(f))).toBe(false);
  });

  test('throws and leaves prior target content intact when staging creation fails', () => {
    // targetPath's directory resolves to a regular file: the staging path
    // `<file>/<name>` cannot be created (ENOTDIR). The finally must clean up any
    // staging and the prior content (the file masquerading as the dir) must be
    // left untouched — no partial file, no destroyed body.
    writeFileSync(TEMP, 'prior complete content', 'utf-8');
    const target = join(TEMP, 'my-ref.md');

    expect(() => atomicReplaceReference(target, 'new content')).toThrow();
    // No staging temp appeared and the prior bytes are intact (no partial file,
    // no destroyed body). TEMP is a file here, so there is nothing to scandir —
    // the intact bytes are the proof the target was never touched.
    expect(readFileSync(TEMP, 'utf-8')).toBe('prior complete content');
  });
});
