Status: completed

# Slice 1: Introduce `acquireReference` module and migrate MCP `handleFetchUrl`

## What to build

A new module `src/core/references/acquire.ts` exposing one function:

```
acquireReference(url, config, opts?) → AcquisitionResult
```

It owns the full "URL → Reference" workflow:

1. Cache lookup by URL (skip if `opts.refetch`).
2. If hit: return `{ source: 'cached', refId, filepath, … }`.
3. Otherwise: run `pipeline.fetchUrl`, then `cache.saveToTemp`, then ensure the browser closes (via `closeBrowser`) regardless of outcome.
4. Return `{ source: 'fetched', refId, filepath, title, byline, excerpt, siteName, quality, usedPlaywright, playwrightReason }` on success, or `{ source: 'failed', error, suggestion?, quality? }` on failure.

`index.ts:handleFetchUrl` is rewritten to call `acquireReference` once and dispatch only on the result shape — no direct calls to `fetchUrl` / `saveToTemp` / `findByUrl` / `closeBrowser` in that handler.

CLI and `fetch-links` are NOT migrated in this slice (covered by slices 2 and 3).

## Acceptance criteria

- [ ] `src/core/references/acquire.ts` exists and exports `acquireReference` plus its result type.
- [ ] `handleFetchUrl` in `index.ts` no longer imports `fetchUrl`, `saveToTemp`, `findByUrl`, or `closeBrowser` directly.
- [ ] Existing MCP integration tests pass unchanged.
- [ ] New unit tests for `acquireReference` cover: cache hit, cache miss → fetched, fetch failure, save failure, refetch flag.
- [ ] `bun run typecheck` passes.
- [ ] `bun test` passes.

## Blocked by

None — can start immediately.
