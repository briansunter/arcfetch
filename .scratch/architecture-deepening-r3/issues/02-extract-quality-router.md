# Extract Quality-Score routing into a pure decision function

Status: ready-for-agent

## Parent

`.scratch/architecture-deepening-r3/PRD.md`

## What to build

ADR-0001's three-band pipeline algorithm — accept simple at ≥85, try Playwright and keep the higher in 60–84, require Playwright below 60 — is implemented as an `if`/`else` ladder mid-`fetchUrl` in `src/core/pipeline.ts`. It is the algorithm of the pipeline, but today it is tangled with simple-fetch invocation, markdown extraction, and Playwright orchestration. A test that wants to verify "marginal score escalates to Playwright" has to stub all three of those concerns.

Pull the band logic out into a pure decision function — input is the validation result and the relevant thresholds from config; output is a tagged decision the caller switches on (e.g. `accept`, `try-playwright-and-keep-higher`, `require-playwright`). Have `fetchUrl` call it once after each validation pass and dispatch on the result. The thresholds, the comparisons, and the rationale all live in the new module.

Tests verify the decision matrix independently of fetch I/O.

## Acceptance criteria

- [ ] A new pure module owns the Quality-Score routing decision; thresholds from config flow in via parameters, not via direct config-module reads inside the function
- [ ] `pipeline.fetchUrl` no longer contains the band comparisons inline — it dispatches on the routing result
- [ ] A new unit test file covers the decision matrix end-to-end without mocking simple-fetch, extraction, or Playwright
- [ ] Existing pipeline behavior is preserved: same Playwright trigger conditions, same "keep higher" tie-break in the marginal band, same below-threshold rejection
- [ ] `bun test` passes (no regressions)
- [ ] `bun run check` and `bun run typecheck` pass

## Blocked by

None - can start immediately
