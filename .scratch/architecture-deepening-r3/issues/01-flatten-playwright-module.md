# Flatten `src/core/playwright/` into a single browser module

Status: ready-for-agent

## Parent

`.scratch/architecture-deepening-r3/PRD.md`

## What to build

The `BrowserManager` interface in `src/core/playwright/` has exactly one adapter (`LocalBrowserManager`). ADR-0003 forbids ever adding a second one — remote browser providers (Browserbase, Steel, Bright Data) were deliberately rejected on cost + external-dependency grounds. The interface exists for a future that has been pre-ruled-out.

Collapse the directory into a single module that exports the two functions callers actually use (`fetchWithBrowser`, `closeBrowser`) directly. Inline what's currently `LocalBrowserManager` — there is no second adapter and there will not be one. Keep the cost / external-dependency policy as a comment in the new module so the decision doesn't get re-litigated, and rewrite ADR-0003's "keep the interface so remote could slot in cleanly" framing to reflect the new reality (the interface is gone; remote support, if it ever happens, is a rewrite, not a slot-in).

Behavior is identical: same Playwright launch, same fingerprinting, same timeout, same context lifecycle, same `closeBrowser()` semantics on SIGINT/SIGTERM.

## Acceptance criteria

- [ ] `src/core/playwright/` no longer exists as a directory; a single module (e.g. `src/core/browser.ts`) takes its place
- [ ] No `BrowserManager` interface remains; no `getBrowserManager()` indirection at call sites
- [ ] All cost / external-dependency rationale that ADR-0003 currently carries is preserved either in the new module's header comment or in the rewritten ADR
- [ ] ADR-0003 is rewritten to drop the "keep the interface" framing — the policy is still "local only," the mechanism is no longer "an unused interface"
- [ ] `bun test` passes
- [ ] `bun run check` and `bun run typecheck` pass
- [ ] CLI smoke test (`bun run cli.ts fetch https://example.com`) succeeds for both simple-fetch and Playwright-fallback paths

## Blocked by

None - can start immediately
