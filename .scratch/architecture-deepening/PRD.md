# Architecture Deepening

Improve testability and AI-navigability of the arcfetch core by introducing a single seam for "URL → Reference acquisition" and tightening the persistence boundary inside `cache.ts`.

## Goals

- One seam where every consumer (CLI, MCP, fetch-links) goes through to acquire a Reference for a URL.
- Frontmatter shape, slug rules, and the `temporary` ↔ `permanent` status invariant become private to a single module.
- The test-injection workaround in `fetch-links.ts` (`FetchLinksDeps`) deletes — its existence is the strongest signal that the seam is missing.

## Non-goals

- No change to public CLI flags, MCP tool schemas, or response formats.
- No change to the two-stage fetch pipeline policy (ADR-0001).
- No change to local-only Playwright (ADR-0003).

## Slices

See `issues/`. Six slices, all AFK, executed in dependency order.
