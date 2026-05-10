# Architecture deepening — round 3

Status: in-progress

Third pass through arcfetch's architecture, after the `acquireReference` extraction (round 1) and the renderer / MCP-registrar / test-fixtures pass (round 2). The obvious targets are gone; this round picks at subtler friction.

## Candidates

1. **Flatten `src/core/playwright/`** — one-adapter-only `BrowserManager` interface is a hypothetical seam; ADR-0003 forbids the second adapter that would justify it. Collapse to a single module and rewrite the ADR's framing.
2. **Extract Quality-Score routing** — ADR-0001's three-band decision ladder lives mid-`fetchUrl`, tangled with HTTP I/O. Pull it into a pure routing function so it can be unit-tested without mocking fetch + extract + Playwright.
3. **Fix `'cli-summary'` leak in `render.ts`** — a CLI-shaped format string lives in `src/core/`. Light cleanup: relocate the renderer to a presentation surface and drop the unused exported helper.
4. **Drop `closeAfter` from `AcquireOptions`** — one-caller interface bloat. Move the batch browser lifecycle into `fetch-links`, which is the only place that wants browser reuse across acquires.
5. **Consolidate `src/config/` loader** — precedence chain (defaults → file → env → CLI → validate) spans four files; merging at least `loader.ts` + `index.ts` improves locality without losing leverage.

## Non-goals

- No new tools, commands, MCP capabilities, or end-user behavior changes. All five slices are refactors with behavior-preserving tests.
- No ADR additions beyond rewriting ADR-0003's framing as part of slice 1.

## Out of scope (deferred)

- A deeper builder + format-dispatch split of `render.ts` (slice 3 heavy option). Defer until a third presentation surface arrives.
