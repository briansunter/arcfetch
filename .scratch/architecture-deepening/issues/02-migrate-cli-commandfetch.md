Status: completed

# Slice 2: Migrate CLI `commandFetch` to `acquireReference`

## What to build

`cli.ts:commandFetch` switches from the manual recipe (`findByUrl` → `fetchUrl` → `saveToTemp` → `closeBrowser`) to a single call to `acquireReference`. The four output paths (`text`, `json`, `summary`, `path`, plus the `pretty` variant) remain — only the pre-formatting workflow changes.

The 100ms file-flush sleep at `cli.ts:213` is either:
(a) moved into `acquireReference` if it's still load-bearing (so MCP gets it too), or
(b) removed entirely if testing shows it's no longer needed under current Bun.

Confirm with a test that writes then immediately re-reads the cached file in the same process.

## Acceptance criteria

- [ ] `commandFetch` no longer imports `fetchUrl`, `saveToTemp`, `findByUrl`, or `closeBrowser` directly.
- [ ] All existing CLI integration tests pass unchanged.
- [ ] The file-flush concern is resolved deterministically — either inside `acquireReference` for both consumers, or removed with a test demonstrating it's unnecessary.
- [ ] `bun run typecheck` passes.
- [ ] `bun test` passes.

## Blocked by

- `01-acquire-reference-module.md`
