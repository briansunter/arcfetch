---
name: sofetch
description: Use when working with @briansunter/sofetch CLI for URL fetching, article extraction, and cache management. Triggers: fetching URLs, batch processing, managing cached references, promoting/deleting content, or integrating sofetch into automation pipelines.
---

# sofetch

Guide for using the sofetch CLI tool to fetch web content, extract articles, and manage cached references.

## Overview

sofetch converts web pages to clean markdown with automatic JavaScript rendering fallback via Playwright when needed.

## Installation

```bash
# Install globally
bun install -g @briansunter/sofetch

# Or use via bunx
bunx @briansunter/sofetch <command>
```

## Commands

### fetch

Fetch URL and save to temp folder.

```bash
bunx @briansunter/sofetch fetch <url> [options]
```

**Options:**
- `-q, --query <text>` - Search query (saved as metadata)
- `-o, --output <format>` - Output format (default: text)
  - `text` - Plain text (LLM-friendly)
  - `json` - Structured JSON
  - `path` - Just the filepath
  - `summary` - REF-ID|filepath format
- `--pretty` - Human-friendly output with emojis
- `-v, --verbose` - Show detailed output
- `--min-quality <n>` - Minimum quality score 0-100 (default: 60)
- `--temp-dir <path>` - Temp folder (default: .tmp)
- `--docs-dir <path>` - Docs folder (default: docs/ai/references)
- `--playwright <mode>` - Playwright mode: auto, local, docker

**Examples:**

```bash
# Basic fetch (plain text output for LLMs)
bunx @briansunter/sofetch fetch https://example.com/article

# Get just the filepath
bunx @briansunter/sofetch fetch https://example.com -o path

# Human-friendly output with emojis
bunx @briansunter/sofetch fetch https://example.com --pretty

# JSON output for scripting
bunx @briansunter/sofetch fetch https://example.com -o json

# With search query metadata
bunx @briansunter/sofetch fetch https://example.com -q "search term"

# Verbose mode to see what's happening
bunx @briansunter/sofetch fetch https://example.com -v
```

**Process:** HTTP fetch → Extract content → Quality score (0-100) → Playwright retry if score < 85

### list

List all cached references.

```bash
bunx @briansunter/sofetch list [options]
```

**Options:**
- `-o, --output <format>` - Output format: text, json
- `--pretty` - Human-friendly output with emojis

**Examples:**

```bash
# List references (plain text)
bunx @briansunter/sofetch list

# Pretty output with emojis
bunx @briansunter/sofetch list --pretty

# JSON output
bunx @briansunter/sofetch list -o json
```

### promote

Move reference from temp to docs folder.

```bash
bunx @briansunter/sofetch promote <ref-id> [options]
```

**Options:**
- `-o, --output <format>` - Output format: text, json
- `--pretty` - Human-friendly output with emojis

**Examples:**

```bash
bunx @briansunter/sofetch promote REF-001
bunx @briansunter/sofetch promote REF-001 --pretty
bunx @briansunter/sofetch promote REF-001 -o json
```

### delete

Delete a cached reference.

```bash
bunx @briansunter/sofetch delete <ref-id> [options]
```

**Options:**
- `-o, --output <format>` - Output format: text, json
- `--pretty` - Human-friendly output with emojis

**Examples:**

```bash
bunx @briansunter/sofetch delete REF-001
bunx @briansunter/sofetch delete REF-001 --pretty
```

### config

Show current configuration.

```bash
bunx @briansunter/sofetch config
```

Displays all config settings including quality thresholds, paths, and Playwright mode.

## Workflow Patterns

### Single Article

```bash
bunx @briansunter/sofetch fetch https://example.com/guide
cat .tmp/REF-001-guide.md  # Review
bunx @briansunter/sofetch promote REF-001  # If good
```

### Batch Fetch

```bash
for url in "url1" "url2" "url3"; do
  bunx @briansunter/sofetch fetch "$url"
done

bunx @briansunter/sofetch list  # Review all
bunx @briansunter/sofetch promote REF-001  # Promote desired
```

### Cleanup Temp References

```bash
bunx @briansunter/sofetch list
bunx @briansunter/sofetch delete REF-001  # Delete unwanted
```

### Scripting with JSON Output

```bash
# Fetch and parse result
RESULT=$(bunx @briansunter/sofetch fetch https://example.com -o json)
REF_ID=$(echo "$RESULT" | jq -r '.refId')
FILEPATH=$(echo "$RESULT" | jq -r '.filepath')
QUALITY=$(echo "$RESULT" | jq -r '.quality')

# Conditional promote based on quality
if (( QUALITY >= 85 )); then
  bunx @briansunter/sofetch promote "$REF_ID"
fi
```

## Configuration

### Config File Priority

1. CLI arguments
2. Environment variables
3. `sofetch.config.json`
4. `.sofetchrc`
5. `.sofetchrc.json`

### Create `sofetch.config.json`

```json
{
  "quality": {
    "minScore": 60,
    "jsRetryThreshold": 85
  },
  "playwright": {
    "mode": "auto"
  },
  "paths": {
    "tempDir": ".tmp",
    "docsDir": "docs/ai/references"
  }
}
```

### Environment Variables

```bash
export SOFETCH_MIN_SCORE=60
export SOFETCH_TEMP_DIR=".tmp"
export SOFETCH_DOCS_DIR="docs/ai/references"
export SOFETCH_PLAYWRIGHT_MODE="auto"
```

### Quality Thresholds

- **minScore** (default: 60) - Below this, content rejected
- **jsRetryThreshold** (default: 85) - Above this, skip Playwright

### Playwright Modes

- `auto` - Docker if available, fallback to local (default)
- `docker` - Docker only
- `local` - Local Playwright only

## MCP Server

```bash
bunx @briansunter/sofetch
# Tools: fetch_url, list_cached, promote_reference, delete_cached
```

## File Format

Fetched files include YAML frontmatter:

```markdown
---
ref_id: REF-001
url: https://example.com/article
status: temporary
fetched_at: 2025-12-25T10:00:00Z
quality_score: 87
playwright_used: false
query: search term
---

# Article Title

Content...
```

## Quality Scoring

- **≥ 85** - Excellent, ready to promote
- **60-84** - Good, review manually
- **< 60** - Poor, consider deleting

## References

- Project: https://github.com/briansunter/sofetch
- MCP: https://modelcontextprotocol.io
