# Local Playwright only — no remote browser provider

The `BrowserManager` interface and the `// Only local mode is supported` comment in `src/core/playwright/manager.ts` exist because remote browser providers (Browserbase, Steel, Bright Data, etc.) were considered and deliberately not adopted. The interface is retained so a future remote implementation could slot in cleanly, but the unconditional `new LocalBrowserManager(config)` is the policy.

The two load-bearing reasons are **cost** and **external dependency**. Remote browsers bill per request or per minute — for an end-user CLI / MCP server fetching a handful of pages, that turns a free tool into one with a recurring SaaS bill, including for users who never trigger the Playwright path. And piping the Playwright fallback through a third party means a vendor outage breaks arcfetch even when the user's machine and target site are both fine; for a tool whose whole job is "fetch this URL", that's a worse failure mode than just running locally.

If a remote provider is added later it should be opt-in via config, never the default — the local path stays the baseline that has to work standalone.
