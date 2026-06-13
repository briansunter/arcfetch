## [1.3.1](https://github.com/briansunter/arcfetch/compare/v1.3.0...v1.3.1) (2026-06-13)


### Bug Fixes

* close SSRF IPv6 bypass, protect code in cleaner, fix slug race ([76d1adf](https://github.com/briansunter/arcfetch/commit/76d1adfba50cf8448708e8e7eba99c5fe2f58db4)), closes [#include](https://github.com/briansunter/arcfetch/issues/include)

# [1.3.0](https://github.com/briansunter/arcfetch/compare/v1.2.5...v1.3.0) (2026-05-11)


* refactor!: drop legacy SOFETCH_* env-var fallback and unused exports ([ce789a8](https://github.com/briansunter/arcfetch/commit/ce789a8089c96364205669a2f13bb0ffa70ba608))


### BREAKING CHANGES

* `SOFETCH_MIN_SCORE`, `SOFETCH_JS_RETRY_THRESHOLD`,
`SOFETCH_TEMP_DIR`, and `SOFETCH_DOCS_DIR` are no longer read. Use the
`ARCFETCH_*` equivalents (canonical since v1.2.3).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>

## [1.2.5](https://github.com/briansunter/arcfetch/compare/v1.2.4...v1.2.5) (2026-05-11)


### Bug Fixes

* cut npm release for round-3 refactors ([7b6ea1f](https://github.com/briansunter/arcfetch/commit/7b6ea1fc17a67ef7fe50a8379ed72e09188a4022))

## [1.2.4](https://github.com/briansunter/arcfetch/compare/v1.2.3...v1.2.4) (2026-05-10)


### Refactors

Architecture-deepening round 3 — internal refactors with no user-visible behavior change.

* extract `acquireReference` seam and Reference persistence module ([dcf5174](https://github.com/briansunter/arcfetch/commit/dcf5174))
* render-layer, MCP-tool registrar, shared test fixtures, CONTEXT.md ([f1fc302](https://github.com/briansunter/arcfetch/commit/f1fc302))
* drop `closeAfter`; `acquireReference` no longer touches the browser lifecycle — callers own `closeBrowser()` ([bcbe6e0](https://github.com/briansunter/arcfetch/commit/bcbe6e0))
* consolidate `src/config/` loader; isolate legacy `SOFETCH_*` env-var fallbacks ([c08168e](https://github.com/briansunter/arcfetch/commit/c08168e))
* extract Quality-Score band routing into pure `quality-router` decision function ([f577ab1](https://github.com/briansunter/arcfetch/commit/f577ab1))
* flatten `src/core/playwright/` into single `browser.ts`; drop unused `BrowserManager` interface; ADR-0003 rewritten ([1c39601](https://github.com/briansunter/arcfetch/commit/1c39601))
* relocate renderer to `src/ui/`; rename `'cli-summary'` format to `'compact'` ([4d5d098](https://github.com/briansunter/arcfetch/commit/4d5d098))

## [1.2.3](https://github.com/briansunter/arcfetch/compare/v1.2.2...v1.2.3) (2026-05-01)


### Bug Fixes

* harden security, error handling, type safety, and add tests ([eac4e45](https://github.com/briansunter/arcfetch/commit/eac4e459e78c7e1c0cb1e8d954ee567ef8777773))
* harden SSRF defenses, repair cache invalidation, and rename to arcfetch ([0d53fb0](https://github.com/briansunter/arcfetch/commit/0d53fb0967cf665f8d63532c270f0a038dd7ba28))

## [1.2.2](https://github.com/briansunter/arcfetch/compare/v1.2.1...v1.2.2) (2026-02-07)


### Bug Fixes

* prevent hanging with concurrent fetches and parallel subagents ([0a0f959](https://github.com/briansunter/arcfetch/commit/0a0f95974448b9fe1546acd4d9bd2b8e6cf7fa46))

## [1.2.1](https://github.com/briansunter/arcfetch/compare/v1.2.0...v1.2.1) (2026-02-06)


### Bug Fixes

* show friendly error when Playwright browsers are not installed ([b140c7b](https://github.com/briansunter/arcfetch/commit/b140c7b253949d77d5fe21451b580e946454c070))

# [1.2.0](https://github.com/briansunter/arcfetch/compare/v1.1.1...v1.2.0) (2026-02-06)


### Features

* improve CLAUDE.md accuracy and add Claude Code automations ([88b86a9](https://github.com/briansunter/arcfetch/commit/88b86a9fcbe75d285693c4a65b5f6c63898ac496))
* improve quality validation, anti-bot detection, and codebase health ([9dd9413](https://github.com/briansunter/arcfetch/commit/9dd9413b849c599e6d06a6c2b52327195d8c764d))

## [1.1.1](https://github.com/briansunter/arcfetch/compare/v1.1.0...v1.1.1) (2026-01-01)


### Bug Fixes

* correct MCP config format and update plugin version ([6cfa866](https://github.com/briansunter/arcfetch/commit/6cfa8663ccaf04e840b467bc25b89ca8704da6a0))

# [1.1.0](https://github.com/briansunter/arcfetch/compare/v1.0.0...v1.1.0) (2025-12-31)


### Bug Fixes

* move plugin config to repo root ([4df77c1](https://github.com/briansunter/arcfetch/commit/4df77c19ccbfda52383e5345838eb35a947ad9c2))
* remove @semantic-release/git to fix CI ([a5a208f](https://github.com/briansunter/arcfetch/commit/a5a208fb7941fe5ac4c1fb5acc91d8b5d48ffb7d))


### Features

* add MCP server configuration for bunx ([d5b27f9](https://github.com/briansunter/arcfetch/commit/d5b27f940920de27a88526a52fb2693fca10f4fe))
* add mcp subcommand to CLI ([d5826e6](https://github.com/briansunter/arcfetch/commit/d5826e6f84678e3c72a2d542917388040403ede5))


### Reverts

* remove version capping from semantic-release ([3aab6c4](https://github.com/briansunter/arcfetch/commit/3aab6c4c311e66faa528d3f8b898a725e0204fc9))
* restore @semantic-release/git and changelog plugins ([6c9f8fc](https://github.com/briansunter/arcfetch/commit/6c9f8fc9d3f01d29b2ba46f49fead005e56ccfbf))
* restore @semantic-release/git plugin ([c73d5a2](https://github.com/briansunter/arcfetch/commit/c73d5a245c2859b911510f8cc4f6513910a6a590))

# [2.0.0](https://github.com/briansunter/archfetch/compare/v1.0.0...v2.0.0) (2025-12-26)


### Code Refactoring

* remove Docker mode and add force-playwright flag ([9bb491c](https://github.com/briansunter/archfetch/commit/9bb491c1b4ea3dda95590830afeb30074dea47cb))


### BREAKING CHANGES

* Remove Docker mode for Playwright

- Remove Docker browser manager (docker.ts)
- Remove --playwright <mode> CLI flag
- Remove SOFETCH_PLAYWRIGHT_MODE and SOFETCH_DOCKER_IMAGE env vars
- Simplify to local Playwright only (faster, more reliable)

Features:
- Add --force-playwright flag to skip simple fetch
- Add --wait-strategy flag (networkidle/domcontentloaded/load)
- Update postinstall to avoid redownloading Playwright

Fixes:
- Fix container reuse logic (no longer needed)
- Update tests to remove Docker assertions
- Update package.json description

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>

# 1.0.0 (2025-12-26)


* feat!: rename package from arcfetch to archfetch ([1027ed0](https://github.com/briansunter/archfetch/commit/1027ed0e52986cdf3b7b5b8e4e7ab0fb9334894f))


### Bug Fixes

* add .npmignore and files field for clean package ([f0216f4](https://github.com/briansunter/archfetch/commit/f0216f4a196f8dfff8fad66afab3280da7334223))
* correct bin field path in package.json ([b66ef76](https://github.com/briansunter/archfetch/commit/b66ef76076fb8dfe76f251a746ba2716f74a84e9))
* correct BWS download URL to sdk-sm repo ([c2d1448](https://github.com/briansunter/archfetch/commit/c2d14489551e042083298d91fbfc908ffabaa14f))
* set NODE_AUTH_TOKEN for npm auth ([fbbfc4d](https://github.com/briansunter/archfetch/commit/fbbfc4d02d09d1cc527cd219568a67793bb36334))
* update repo URL after rename to archfetch ([3f78e62](https://github.com/briansunter/archfetch/commit/3f78e6254af9c68d85e892974e48d68060dee13d))
* use correct GitHub repo URL (arcfetch) ([6127344](https://github.com/briansunter/archfetch/commit/6127344fd56374de09e68e2aadd390163720e9dd))


### Features

* **ci:** add npm publishing with GitHub Actions OIDC ([336a5eb](https://github.com/briansunter/archfetch/commit/336a5eb97d7ef4fced80a9f4febb0b599ee4cad4))
* **commands:** add hello command ([7fa6319](https://github.com/briansunter/archfetch/commit/7fa6319c824f9fe04a6b4594f855586a1a570b42))
* **skills:** add comprehensive Fetchi CLI skill ([008be33](https://github.com/briansunter/archfetch/commit/008be332012cf4a0bf41b882004026e0214dba20))


### BREAKING CHANGES

* Package renamed from arcfetch to archfetch.
- Update all references to use archfetch
- Add semantic-release for automated publishing
- Add CI workflow for PRs
- Use BWS for npm token management

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
