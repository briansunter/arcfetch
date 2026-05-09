Status: completed

# Slice 5: Extract `references/format` module from cache.ts

## What to build

A new module `src/core/references/format.ts` owns:

- The `Reference` (or renamed `CachedReference`) record shape.
- Frontmatter (de)serialization: `serializeFrontmatter(meta)`, `parseFrontmatter(content) → { meta, body }`.
- Slug derivation: `slugify(title)` and the unique-path collision logic.
- The `temporary` ↔ `permanent` status invariant: `markPermanent(content)` (replaces the regex at `cache.ts:292`).

These helpers are the only place in the codebase that knows the on-disk format of a Reference.

`cache.ts` keeps its store responsibilities (directory scanning, mtime-keyed index, save / list / find / promote / delete) but delegates every format concern to `references/format`. The regex `/^status:\s*temporary$/m` no longer appears in cache.ts.

## Acceptance criteria

- [ ] `src/core/references/format.ts` exists.
- [ ] cache.ts contains no frontmatter-format regexes, slug logic, or `temporary` string literals.
- [ ] All existing cache tests pass unchanged.
- [ ] `bun run typecheck` passes.
- [ ] `bun test` passes.

## Blocked by

None — can start immediately. Cleaner if Slice 4 lands first (smaller cache.ts to refactor) but not required.
