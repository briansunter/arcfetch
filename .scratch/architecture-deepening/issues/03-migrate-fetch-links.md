Status: completed

# Slice 3: Migrate `fetchLinksFromRef` to `acquireReference`, delete `FetchLinksDeps`

## What to build

`fetchLinksFromRef` switches its per-link work from the inline `fetchUrl` + `saveToTemp` recipe to a single `acquireReference` call. The `FetchLinksDeps` parameter (the test-injection workaround) is removed entirely — tests now fake `acquireReference` if they need to.

The concurrency-3 batch loop, MAX_LINKS guard, and `closeBrowser` in the outer `finally` stay; per-link `closeBrowser` calls move inside `acquireReference` (already added in slice 1) so the outer `finally` becomes a single defensive call rather than the load-bearing cleanup.

Existing tests that use `FetchLinksDeps` are rewritten to inject a fake `acquireReference` (preferred) or to mock the new module.

## Acceptance criteria

- [ ] `FetchLinksDeps` interface is deleted.
- [ ] `fetchLinksFromRef` signature accepts only its real inputs (config, refId, options) — no test-injection params.
- [ ] All existing fetch-links tests pass with the new injection point.
- [ ] `bun run typecheck` passes.
- [ ] `bun test` passes.

## Blocked by

- `01-acquire-reference-module.md`
