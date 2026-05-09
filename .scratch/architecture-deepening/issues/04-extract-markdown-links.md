Status: completed

# Slice 4: Extract markdown-link parser to `utils/markdown-links.ts`

## What to build

The pure markdown-link parsing (`extractLinksFromMarkdown`, `findClosingBracket`, `parseMarkdownLinkDestination`, the `ExtractedLink` type) currently in `src/core/cache.ts:364-495` moves to `src/utils/markdown-links.ts`. The functions become the only exports of that module.

`extractLinksFromCached` in cache.ts becomes a thin wrapper: read the cached file, strip frontmatter, call `extractLinksFromMarkdown` from the new module.

## Acceptance criteria

- [ ] `src/utils/markdown-links.ts` exists and exports `extractLinksFromMarkdown` plus `ExtractedLink`.
- [ ] cache.ts no longer contains the link-parsing logic.
- [ ] All existing link-extraction tests pass unchanged.
- [ ] `bun run typecheck` passes.
- [ ] `bun test` passes.

## Blocked by

None — can start immediately.
