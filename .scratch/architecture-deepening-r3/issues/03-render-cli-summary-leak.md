# Fix `'cli-summary'` leak in `render.ts`

Status: ready-for-agent

## Parent

`.scratch/architecture-deepening-r3/PRD.md`

## What to build

`src/core/render.ts` carries an `OutputFormat` union that includes `'cli-summary'` — a format only the CLI's `fetch` command ever emits. A CLI-shaped concept lives in `src/core/`, which is the wrong tier. The same module also exports `renderLinkProgressLine`, which has no external callers; it's a private helper that escaped its file.

Light refactor (this slice — the heavier builder/format-dispatch split is explicitly out of scope):

- Relocate the renderer to a presentation tier (e.g. `src/ui/render.ts` or similar — pick whichever directory name best fits the existing layout). It is no longer "core."
- Drop `renderLinkProgressLine` from the exports; keep it as a file-local helper.
- If the format identifier `'cli-summary'` only describes a CLI surface, rename it honestly so the union no longer implies the core knows about a CLI.

End-user output is byte-identical for every CLI and MCP path.

## Acceptance criteria

- [ ] The renderer no longer lives under `src/core/`
- [ ] No `'cli-summary'` string remains in the renderer's public API surface; if a comparable internal identifier is needed, it is named in a way that doesn't reach across tiers
- [ ] `renderLinkProgressLine` is no longer in the module's exports
- [ ] CLI output (text/pretty/json/path modes, plus the fetch-summary one) is byte-identical before and after — verify with snapshot tests or by diffing CLI output on the same input
- [ ] MCP tool output (text content) is byte-identical before and after
- [ ] `bun test` passes; `bun run check` and `bun run typecheck` pass

## Blocked by

None - can start immediately
