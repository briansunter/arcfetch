# sofetch

Fetch URLs, extract clean article content, and cache as markdown. Supports automatic JavaScript rendering fallback via Playwright (local or Docker).

## Features

- **Smart Fetching**: Simple HTTP first, automatic Playwright fallback for JS-heavy sites
- **Quality Gates**: Configurable quality thresholds with automatic retry
- **Docker Support**: Auto-launches Playwright in Docker when available
- **Clean Markdown**: Mozilla Readability + Turndown for 90-95% token reduction
- **Temp → Docs Workflow**: Cache to temp folder, promote to docs when ready
- **CLI & MCP**: Available as command-line tool and MCP server

## Installation

```bash
bun install
```

For Docker Playwright support (recommended):
```bash
docker pull mcr.microsoft.com/playwright:v1.40.0-jammy
```

## Quick Start

### CLI

```bash
# Fetch a URL
sofetch fetch https://example.com/article

# List cached references
sofetch list

# Promote to docs folder
sofetch promote REF-001

# Delete a reference
sofetch delete REF-001
```

### MCP Server

Add to your Claude Code MCP configuration:

```json
{
  "mcpServers": {
    "sofetch": {
      "command": "bun",
      "args": ["run", "/path/to/sofetch/index.ts"]
    }
  }
}
```

## CLI Commands

### fetch

Fetch URL and save to temp folder.

```bash
sofetch fetch <url> [options]

Options:
  -q, --query <text>      Search query (saved as metadata)
  -o, --output <format>   Output: text, json, summary (default: text)
  -v, --verbose           Show detailed output
  --min-quality <n>       Minimum quality score 0-100 (default: 60)
  --temp-dir <path>       Temp folder (default: .tmp)
  --docs-dir <path>       Docs folder (default: docs/ai/references)
  --playwright <mode>     Playwright mode: auto, local, docker
```

### list

List all cached references.

```bash
sofetch list [-o json]
```

### promote

Move reference from temp to docs folder.

```bash
sofetch promote <ref-id>
```

### delete

Delete a cached reference.

```bash
sofetch delete <ref-id>
```

### config

Show current configuration.

```bash
sofetch config
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

Create `sofetch.config.json` in your project root:

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
    "mode": "auto",
    "dockerImage": "mcr.microsoft.com/playwright:v1.40.0-jammy",
    "timeout": 30000
  }
}
```

### Environment Variables

```bash
SOFETCH_MIN_SCORE=60
SOFETCH_TEMP_DIR=.tmp
SOFETCH_DOCS_DIR=docs/ai/references
SOFETCH_PLAYWRIGHT_MODE=auto
SOFETCH_DOCKER_IMAGE=mcr.microsoft.com/playwright:v1.40.0-jammy
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

## Playwright Modes

| Mode | Description |
|------|-------------|
| `auto` | Use Docker if available, fall back to local |
| `docker` | Docker only (fails if Docker unavailable) |
| `local` | Local Playwright only (requires `bun install`) |

## File Structure

```
.tmp/                          # Temporary cache (default)
  REF-001-article-title.md
  REF-002-another-article.md

docs/ai/references/            # Permanent docs (after promote)
  REF-001-article-title.md
```

## Examples

### Fetch with custom quality threshold

```bash
sofetch fetch https://spa-heavy-site.com --min-quality 70 --playwright docker
```

### Fetch and get JSON output

```bash
sofetch fetch https://example.com -o json
```

### Use in scripts

```bash
# Get just the ref ID and path
result=$(sofetch fetch https://example.com -o summary)
ref_id=$(echo $result | cut -d'|' -f1)
filepath=$(echo $result | cut -d'|' -f2)
```

## License

MIT
