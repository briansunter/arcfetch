# Drop `closeAfter` from `AcquireOptions`; move batch browser lifecycle into `fetch-links`

Status: ready-for-agent

## Parent

`.scratch/architecture-deepening-r3/PRD.md`

## What to build

`AcquireOptions.closeAfter` exists solely because `fetchLinksFromRef` wants to reuse the browser across N acquires instead of relaunching Chromium each time. It has exactly one production caller that flips it from the default. The contract "if you set `closeAfter: false`, you own `closeBrowser()`" is documented prose, not a type-enforced invariant — and that invariant is paying for one caller's batch optimization at the cost of interface complexity on every other call site.

Move the batch browser lifecycle into `fetch-links` itself. The fetch-links module already owns the concurrency loop (max 3 in flight, MAX_LINKS=200); having it own the "open browser → acquire N times → close once" pattern is locality, not leak. Acquire becomes "always cleans up after itself."

The fetch-links module may need a small helper that wraps the lifecycle (open / try / finally close) around its existing concurrency loop, or it may just inline it next to the loop. Either is fine.

## Acceptance criteria

- [ ] `closeAfter` no longer exists on `AcquireOptions`; `acquireReference` always closes the browser on its own exit
- [ ] `fetchLinksFromRef` opens the browser once at the start of a batch, runs N acquires using the default cleanup-each-time path or a small shared utility, and ensures the browser closes exactly once after the batch (even on partial failure)
- [ ] No Chromium-relaunch regression: a 200-link batch still launches the browser at most once, not 200 times
- [ ] `tests/unit/acquire.test.ts` no longer exercises the `closeAfter` matrix
- [ ] `tests/unit/fetch-links.test.ts` verifies that browser cleanup happens exactly once per batch, including on error paths
- [ ] `bun test` passes; `bun run check` and `bun run typecheck` pass

## Blocked by

None - can start immediately
