/**
 * Maximum HTML document size, in bytes, accepted by either fetch stage of the
 * pipeline: the simple HTTP fetch (src/core/pipeline.ts) and the Playwright
 * rendered-page fallback (src/core/browser.ts). Centralizing this single product
 * limit keeps the two guards from silently drifting apart — a JS-rendered page
 * cannot bypass the cap that bounds the simple fetch, and vice versa.
 */
export const MAX_HTML_BYTES = 10 * 1024 * 1024;
