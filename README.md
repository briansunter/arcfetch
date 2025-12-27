# arcfetch

Fetch URLs, extract clean article content, and cache as markdown. Supports automatic JavaScript rendering fallback via Playwright.

## Features

- **Smart Fetching**: Simple HTTP first, automatic Playwright fallback for JS-heavy sites
- **Quality Gates**: Configurable quality thresholds with automatic retry
- **Clean Markdown**: Mozilla Readability + Turndown for 90-95% token reduction
- **Temp → Docs Workflow**: Cache to temp folder, promote to docs when ready
- **CLI & MCP**: Available as command-line tool and MCP server

## Installation

```bash
# For users
npm install -g arcfetch

# For development
bun install
```

## Quick Start

### CLI

```bash
# Fetch a URL
arcfetch fetch https://example.com/article

# List cached references
arcfetch list

# Promote to docs folder
arcfetch promote REF-001

# Delete a reference
arcfetch delete REF-001
```

### MCP Server

Add to your Claude Code MCP configuration:

```json
{
  "mcpServers": {
    "arcfetch": {
      "command": "bun",
      "args": ["run", "/path/to/arcfetch/index.ts"]
    }
  }
}
```

## CLI Commands

### fetch

Fetch URL and save to temp folder.

```bash
arcfetch fetch <url> [options]

Options:
  -q, --query <text>        Search query (saved as metadata)
  -o, --output <format>     Output: text, json, summary (default: text)
  -v, --verbose             Show detailed output
  --pretty                  Human-friendly output with emojis
  --min-quality <n>         Minimum quality score 0-100 (default: 60)
  --temp-dir <path>         Temp folder (default: .tmp)
  --docs-dir <path>         Docs folder (default: docs/ai/references)
  --wait-strategy <mode>    Playwright wait strategy: networkidle, domcontentloaded, load
  --force-playwright        Skip simple fetch and use Playwright directly
```

### list

List all cached references.

```bash
arcfetch list [-o json]
```

### promote

Move reference from temp to docs folder.

```bash
arcfetch promote <ref-id>
```

### delete

Delete a cached reference.

```bash
arcfetch delete <ref-id>
```

### config

Show current configuration.

```bash
arcfetch config
```

## MCP Tools

| Tool | Description |
|------|-------------|
| `fetch_url` | Fetch URL with auto JS fallback, save to temp |
| `list_cached` | List all cached references |
| `promote_reference` | Move from temp to docs folder |
| `delete_cached` | Delete a cached reference |

## Configuration

### Config File

Create `arcfetch.config.json` in your project root:

```json
{
  "quality": {
    "minScore": 60,
    "jsRetryThreshold": 85
  },
  "paths": {
    "tempDir": ".tmp",
    "docsDir": "docs/ai/references"
  },
  "playwright": {
    "timeout": 30000,
    "waitStrategy": "networkidle"
  }
}
```

### Environment Variables

```bash
ARCFETCH_MIN_SCORE=60
ARCFETCH_TEMP_DIR=.tmp
ARCFETCH_DOCS_DIR=docs/ai/references
```

## Quality Pipeline

```
URL → Simple Fetch → Quality Check
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
     Score ≥ 85      60-84           < 60
         │               │               │
         ▼               ▼               ▼
       Save        Try Playwright   Try Playwright
                   (if better)      (required)
                         │               │
                         ▼               ▼
                   Compare &       Score ≥ 60?
                   use best        Yes → Save
                                   No → Error
```

## Playwright Wait Strategies

| Strategy | Description |
|----------|-------------|
| `networkidle` | Wait until network is idle (slowest, most reliable) |
| `domcontentloaded` | Wait until DOM is loaded (faster) |
| `load` | Wait until page load event completes (fastest) |

## File Structure

```
.tmp/                          # Temporary cache (default)
  REF-001-article-title.md
  REF-002-another-article.md

docs/ai/references/            # Permanent docs (after promote)
  REF-001-article-title.md
```

## Examples

### Force Playwright for JS-heavy sites

```bash
arcfetch fetch https://spa-heavy-site.com --force-playwright --wait-strategy domcontentloaded
```

### Fetch and get JSON output

```bash
arcfetch fetch https://example.com -o json
```

### Use in scripts

```bash
# Get just the ref ID and path
result=$(arcfetch fetch https://example.com -o summary)
ref_id=$(echo $result | cut -d'|' -f1)
filepath=$(echo $result | cut -d'|' -f2)
```

## License

MIT
