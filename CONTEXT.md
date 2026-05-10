# Arcfetch

The domain is "fetching a web Page and turning it into a curated, locally-stored Reference." Arcfetch is a tool for human-or-LLM-curated reading: it pulls a Page, extracts a clean markdown rendering, and persists that rendering as a Reference under a stable identifier. Most fetches are exploratory; only the ones a user (or an LLM acting on their behalf) deems worth keeping graduate to the permanent tier.

## Language

### Core

**Reference**:
A fetched-and-persisted markdown rendering of a Page. The unit of work the tool produces and manages. Has a `RefId`, a `source_url`, a `Lifecycle` status, and a body of markdown.
_Avoid_: cache entry, document, article, file. (We may store it as a file, but the concept is the Reference, not the file.)

**Page**:
The thing on the web at a URL. Distinct from a **Reference** — a Reference is *our* extracted rendering of a Page. The Page can change without our Reference changing; refetching a Reference produces a new rendering of the (possibly-changed) Page.

**RefId**:
The stable identifier for a Reference. Derived from the **Slug** of the Reference's title at fetch time. Used as the filename stem and as the public handle in CLI commands and MCP tool arguments.
_Avoid_: id, key, name, slug-id.

**Slug**:
A URL-safe, lowercase, hyphenated token derived from a title (or other source string), capped at 60 chars. Always normalised through NFKD and stripped of combining marks. Collisions are resolved with a numeric suffix: `example-domain`, `example-domain-2`, …
_Avoid_: handle, identifier (those are RefId).

### Lifecycle

**Lifecycle**:
A Reference is either **Temporary** (the default, lives in the temp tier) or **Permanent** (graduated to the docs tier). Recorded as `status: temporary` or `status: permanent` in the file's frontmatter. The transition is one-directional and driven by the user.

**Temporary Reference**:
A Reference fresh from a fetch, sitting in the temp tier (`paths.tempDir`, default `.tmp/arcfetch/`). Exploratory; not yet curated.
_Avoid_: cached, draft, pending.

**Permanent Reference**:
A Reference that has been **Promoted** — moved to the docs tier (`paths.docsDir`, default `docs/ai/references/`) and re-flagged with `status: permanent`. Considered worth keeping.

**Promote**:
The deliberate human (or LLM-on-behalf-of-human) act of moving a **Temporary Reference** to the **Permanent** tier. This is a one-way operation; never automated. (See ADR-0004.)

### Workflow

**Acquire**:
The workflow that turns a URL into a Reference: cache lookup → simple HTTP fetch (with quality-score-gated Playwright fallback per ADR-0001) → save to the temp tier → return outcome. Owned by `acquireReference` in `src/core/references/`.
_Avoid_: fetch (`fetch` is one step inside acquiring, not the whole thing), get, ingest.

**AcquisitionOutcome**:
The discriminated union returned from acquiring. Tagged on `ok` (success vs. failure), then on `source` (`'cached'` vs. `'fetched'`) for success or `stage` (`'fetch'` vs. `'save'`) for failure.

**Refetch**:
Re-acquire a Reference for a URL whose Reference already exists, overwriting the existing markdown body. Preserves the original RefId so external callers' references stay valid. Triggered by the `--refetch` CLI flag or `refetch: true` MCP argument.

**Quality Score**:
A 0-100 score produced by the markdown validator, used to route a fetch through the pipeline (≥85 accept simple, 60-84 try Playwright and keep the higher, <60 require Playwright). Pinned thresholds documented in ADR-0001.

## Relationships

- A **Page** at a URL produces, on Acquire, exactly one **Reference**.
- A **Reference** has exactly one **RefId** (its **Slug**) and exactly one `source_url` (its originating Page URL).
- A **Reference** has exactly one **Lifecycle** state at a time: **Temporary** or **Permanent**.
- A **Permanent Reference** was, at some prior point, a **Temporary Reference** that the user **Promoted**.
- A **Refetch** updates a Reference's body in place; it does not create a new RefId.

## Example dialogue

> **Dev**: "What happens if the user fetches the same URL twice?"
> **Domain expert**: "The second call sees the existing Reference and returns it as `source: 'cached'`. Nothing on disk changes."
>
> **Dev**: "And if they pass `--refetch`?"
> **Domain expert**: "Then we Acquire again — fetch the Page, re-extract, overwrite the body — but we keep the same RefId. So if anything else in their notes already linked to that RefId, it still resolves."
>
> **Dev**: "What about the docs directory? If a Reference is already Permanent, can it be Refetched?"
> **Domain expert**: "Promote is one-way as designed. Refetch operates on Temporary References in the temp tier. To update a Permanent Reference's body you'd delete it from the docs tier, fetch fresh into temp, and Promote again."

## Flagged ambiguities

- "cache" was used to mean both the **Temporary** tier and the in-memory mtime-keyed index inside `cache.ts`. Resolved: prefer "temp tier" or "Temporary Reference" for the on-disk concept; "the cache index" only for the in-process structure.
- "fetch" was used loosely for both the HTTP request and the full Acquire workflow. Resolved: "fetch" means the HTTP step (`pipeline.fetchUrl`); "Acquire" is the full URL→Reference workflow.
- "document" was sometimes used for a Reference. Resolved: avoid; say Reference. "Document" is reserved for the input HTML that Readability operates on.
