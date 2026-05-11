# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Arcfetch is a URL fetching and article extraction tool that converts web pages to clean markdown. It operates as both a CLI tool and an MCP server. The key value proposition is automatic JavaScript rendering fallback via Playwright when simple HTTP fetching produces low-quality results.

Package name: `arcfetch` | Repository: `briansunter/arcfetch`

## Commands

```bash
# Install dependencies
bun install

# Run tests
bun test                    # All tests
bun test tests/unit/        # Unit tests only
bun test tests/integration/ # Integration tests only
bun test tests/e2e/         # E2E tests only
bun test --coverage         # With coverage
bun test path/to/file.test.ts  # Single test file

# Type checking
bun run typecheck

# Linting & formatting (Biome)
bun run lint                # Check lint issues
bun run lint:fix            # Auto-fix lint issues
bun run format              # Format code
bun run check               # Lint + format check
bun run check:fix           # Lint + format auto-fix

# CLI usage
bun run cli.ts fetch <url>          # Fetch URL to temp cache
bun run cli.ts list                 # List cached references
bun run cli.ts links <ref-id>       # Extract links from cached ref
bun run cli.ts fetch-links <ref-id> # Fetch all links from cached ref
bun run cli.ts promote <ref-id>     # Move temp → docs (permanent)
bun run cli.ts delete <ref-id>      # Delete cached reference
bun run cli.ts config               # Show current configuration
bun run cli.ts mcp                  # Start MCP server

# Run as MCP server directly
bun run index.ts
```

## Architecture

### Entry Points
- `index.ts` - MCP server entry point. Exposes 6 tools: `fetch_url`, `list_cached`, `promote_reference`, `delete_cached`, `extract_links`, `fetch_links`
- `cli.ts` - CLI entry point with commands: fetch, list, links, fetch-links, promote, delete, config, mcp

### Core Pipeline (`src/core/`)
The fetching pipeline in `pipeline.ts` follows this flow:
1. Simple HTTP fetch first (with browser-like User-Agent)
2. Extract content with Readability + Turndown → markdown
3. Validate quality score (0-100)
4. If score >= 85: accept as-is
5. If score 60-84: try Playwright, use whichever result scores higher
6. If score < 60: Playwright required, fail if still below threshold

Key modules:
- `references/acquire.ts` - The "URL → Reference" workflow. One function (`acquireReference`) every consumer (CLI, MCP, fetch-links) calls; owns cache lookup, fetch, save. Does NOT touch the browser lifecycle — callers wrap their call in `try { acquire } finally { closeBrowser() }` (see Gotchas). Tests fake this seam to drive higher-level logic.
- `references/format.ts` - On-disk Reference format: frontmatter (de)serialization, slug rules, the `temporary`↔`permanent` status invariant. Only place that knows the persistence shape.
- `extractor.ts` - HTML→markdown using Mozilla Readability + Turndown
- `cache.ts` - The Reference store: directory scan, mtime-keyed in-memory index, save/list/find/promote/delete. Delegates format concerns to `references/format`.
- `fetch-links.ts` - Concurrent fetch of links extracted from a cached reference (max 3 in flight, MAX_LINKS=200). Owns the batch browser lifecycle: opens Chromium once for the loop, closes once at the end.
- `quality-router.ts` - Pure routing function. Maps a quality score + thresholds to a routing decision (`accept` / `try-playwright-keep-higher` / `require-playwright`). Implements ADR-0001's three-band algorithm; pipeline.ts dispatches on its output.
- `browser.ts` - Local Playwright fallback (singleton Chromium + stealth plugin); exports `fetchWithBrowser` and `closeBrowser`. See ADR-0003.

### Presentation (`src/ui/`)
- `render.ts` - Output rendering for both CLI and MCP. Single `OutputFormat` union (`text` | `pretty` | `json` | `path` | `compact`). Each surface maps its own flags/args to one of these and consumes the resulting string. The renderer does not know about CLI flags or MCP arguments.

### Configuration (`src/config/`)
Config loading priority: CLI args → env vars → config file → defaults

Config files checked: `arcfetch.config.json`, `.arcfetchrc`, `.arcfetchrc.json`

Schema defined with Zod in `schema.ts`. Key settings:
- `quality.minScore` (default: 60) - Below this, content is rejected
- `quality.jsRetryThreshold` (default: 85) - Above this, skip Playwright
- `playwright.timeout` (default: 30000) - Playwright navigation timeout
- `playwright.waitStrategy` (default: `networkidle`) - Options: `networkidle`, `domcontentloaded`, `load`
- `paths.tempDir` (default: `.tmp/arcfetch`) - Temp cache directory
- `paths.docsDir` (default: `docs/ai/references`) - Permanent docs directory

Environment variables:
- `ARCFETCH_MIN_SCORE` - Override minimum quality score
- `ARCFETCH_JS_RETRY_THRESHOLD` - Override JS retry threshold
- `ARCFETCH_TEMP_DIR` - Override temp directory
- `ARCFETCH_DOCS_DIR` - Override docs directory

### Utilities (`src/utils/`)
- `markdown-validator.ts` - Quality scoring based on leftover HTML tags, content length, ratio analysis
- `markdown-cleaner.ts` - Post-processing cleanup of converted markdown (single public export: `cleanMarkdownComplete`)
- `markdown-links.ts` - Pure markdown-link parser (`extractLinksFromMarkdown`); extracted from cache.ts so it can be tested independently
- `url-safety.ts` - SSRF defense: rejects private/loopback/CGNAT/multicast addresses both at URL parse time and after DNS resolution (see ADR-0002)
- `version.ts` - Reads version from package.json

### File Storage Pattern
Fetched content is saved as markdown files with YAML frontmatter:
- Ref IDs are slugified titles (e.g., `how-to-build-react-apps`), not numbered
- Temp storage: `.tmp/arcfetch/<slug>.md` (status: temporary)
- Permanent: `docs/ai/references/<slug>.md` (status: permanent, after promote)
- Frontmatter fields: `title`, `source_url`, `fetched_date`, `type`, `status`, `query`
- Duplicate detection by URL: re-fetching same URL returns existing ref unless `--refetch` flag

## Code Style
- Biome for linting and formatting (not ESLint/Prettier)
- Single quotes, semicolons, ES5 trailing commas
- Indent: 2 spaces, line width: 120
- `noUnusedVariables`: warn, `noUnusedImports`: warn, `noExplicitAny`: warn
- TypeScript strict mode enabled

## Gotchas
- Playwright is installed via `postinstall` script with `|| true` (won't fail if install fails)
- `acquireReference` never touches the browser lifecycle — callers own `closeBrowser()`. Single-shot callers (CLI `commandFetch`, MCP `fetch_url` handler) wrap their one call in `try { acquire } finally { closeBrowser() }`; the batch caller (`fetchLinksFromRef`) wraps its concurrency loop once so Chromium launches at most once per batch.
- Semantic-release is configured on `master` branch with `@semantic-release/git` for auto-versioning

## Agent skills

### Issue tracker

Issues and PRDs live as markdown files in `.scratch/<feature-slug>/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical labels (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
