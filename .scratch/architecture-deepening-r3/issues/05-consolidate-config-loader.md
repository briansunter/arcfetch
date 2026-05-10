# Consolidate `src/config/` loader files

Status: ready-for-agent

## Parent

`.scratch/architecture-deepening-r3/PRD.md`

## What to build

The config loading chain — defaults → config file → env vars → CLI overrides → Zod validation — currently spans `src/config/loader.ts`, `src/config/index.ts`, `src/config/schema.ts`, and `src/config/defaults.ts`. Each individual file isn't shallow on its own, but the seam between them obscures precedence: a reader chasing "if both `ARCFETCH_MIN_SCORE` and `--min-score` are set, who wins?" has to walk three modules. The `deepMerge` helper is untyped and lives alone.

Consolidate the loader. Merge `loader.ts` and `index.ts` if they are split for no real reason; inline `deepMerge` and mark it private to the merged file; keep legacy `SOFETCH_*` env-var handling in a clearly-named private function so the intent is visible. Leave `schema.ts` and `defaults.ts` alone — they are pure data and earn their separation.

Behavior is identical: same precedence, same legacy-name fallbacks, same Zod validation errors.

## Acceptance criteria

- [ ] The loader is one file, not split between `loader.ts` and `index.ts` (unless there's a load-bearing reason to keep them separate — document if so)
- [ ] Precedence (defaults < file < env < CLI < validate) is readable top-to-bottom in one function
- [ ] `deepMerge` is no longer exported; lives next to its single caller
- [ ] Legacy `SOFETCH_*` env-var fallback is isolated in a private function whose name says "legacy"
- [ ] Behavior is identical — existing config tests pass without changes
- [ ] `bun test` passes; `bun run check` and `bun run typecheck` pass

## Blocked by

None - can start immediately
