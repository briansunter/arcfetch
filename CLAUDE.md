# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Sofetch is a URL fetching and article extraction tool that converts web pages to clean markdown. It operates as both a CLI tool and an MCP server. The key value proposition is automatic JavaScript rendering fallback via Playwright when simple HTTP fetching produces low-quality results.

## Commands

```bash
# Install dependencies
bun install

# Run tests
bun test                    # All tests
bun test tests/unit/        # Unit tests only
bun test tests/integration/ # Integration tests only
bun test path/to/file.test.ts  # Single test file

# Type checking
bun run typecheck

# CLI usage
bun run cli.ts fetch <url>
bun run cli.ts list
bun run cli.ts promote <ref-id>
bun run cli.ts delete <ref-id>

# Run as MCP server
bun run index.ts
```

## Architecture

### Entry Points
- `index.ts` - MCP server entry point. Exposes tools: `fetch_url`, `list_cached`, `promote_reference`, `delete_cached`
- `cli.ts` - CLI entry point with commands: fetch, list, promote, delete, config

### Core Pipeline (`src/core/`)
The fetching pipeline in `pipeline.ts` follows this flow:
1. Simple HTTP fetch first
2. Extract content with Readability + Turndown → markdown
3. Validate quality score (0-100)
4. If score < 85 and > 60: try Playwright, use whichever is better
5. If score < 60: Playwright required, fail if still below threshold

Key modules:
- `extractor.ts` - HTML→markdown using Mozilla Readability + Turndown
- `cache.ts` - File-based caching with REF-XXX IDs, frontmatter metadata
- `playwright/manager.ts` - Playwright abstraction supporting local and Docker modes

### Configuration (`src/config/`)
Config loading priority: CLI args → env vars → config file → defaults

Config files checked: `archfetch.config.json`, `.archfetchrc`, `.archfetchrc.json`

Schema defined with Zod in `schema.ts`. Key thresholds:
- `quality.minScore` (default: 60) - Below this, content is rejected
- `quality.jsRetryThreshold` (default: 85) - Above this, skip Playwright entirely

### Utilities (`src/utils/`)
- `markdown-validator.ts` - Quality scoring based on leftover HTML tags, content length, ratio analysis
- `markdown-cleaner.ts` - Post-processing cleanup of converted markdown

### File Storage Pattern
Fetched content is saved as markdown files with YAML frontmatter:
- Temp storage: `.tmp/REF-001-slug.md` (status: temporary)
- Permanent: `docs/ai/references/REF-001-slug.md` (status: permanent after promote)

## Playwright Modes

The `playwright.mode` config controls JavaScript rendering:
- `auto` (default): Use Docker if available, fallback to local
- `docker`: Docker only (requires `mcr.microsoft.com/playwright:v1.40.0-jammy`)
- `local`: Local Playwright only
