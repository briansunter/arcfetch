# Two-stage fetch pipeline with quality-score escalation

Most pages can be extracted from plain HTML, and a Chromium process is heavy enough that paying its cost on every fetch would dominate latency and resource usage when arcfetch runs as an MCP server inside an editor. So the pipeline tries `fetch()` first, scores the extracted markdown 0–100, and only escalates to Playwright when the score is below 85. In the marginal band (60–84) both results are produced and the higher-scoring one wins; below 60, Playwright is required and a still-failing result is rejected outright.

A consequence is that arcfetch must remain functional when Playwright isn't installed at all — `postinstall` runs with `|| true`, and the simple-fetch path is treated as a complete product, not a fast path. We accepted weaker results on heavily-JS sites (and a small risk of headless-browser detection on those) as the price.
