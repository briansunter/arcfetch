Status: completed

# Slice 6: Shrink `markdown-cleaner.ts` to a single export

## What to build

`src/utils/markdown-cleaner.ts` currently exports four functions: `cleanMarkdown`, `advancedClean`, `finalCleanup`, `cleanMarkdownComplete`. Only `cleanMarkdownComplete` is used outside the module. The other three become module-private.

Existing unit tests for the intermediate functions either:
(a) move to test only `cleanMarkdownComplete`'s observable behaviour, or
(b) keep targeting the internals directly (tests live in the same module's test file and can reach private functions if `// @internal` is used).

Pick whichever requires less test churn.

## Acceptance criteria

- [ ] `markdown-cleaner.ts` has exactly one public export: `cleanMarkdownComplete`.
- [ ] All extractor tests pass unchanged (the only external consumer).
- [ ] `bun run typecheck` passes.
- [ ] `bun test` passes.

## Blocked by

None — can start immediately.
