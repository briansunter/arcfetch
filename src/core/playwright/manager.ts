import type { PlaywrightConfig } from '../../config/schema.js';
import type { BrowserManager, FetchWithBrowserResult } from './types.js';
import { LocalBrowserManager } from './local.js';

let currentManager: BrowserManager | null = null;

export async function getBrowserManager(config: PlaywrightConfig): Promise<BrowserManager> {
  if (currentManager) {
    return currentManager;
  }

  // Only local mode is supported
  currentManager = new LocalBrowserManager(config);
  return currentManager;
}

export async function fetchWithBrowser(
  url: string,
  config: PlaywrightConfig,
  verbose = false
): Promise<FetchWithBrowserResult> {
  const manager = await getBrowserManager(config);
  const browser = await manager.getBrowser();
  
  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();
    
    if (verbose) {
      console.error(`🎭 Playwright: Navigating to ${url}`);
    }
    
    await page.goto(url, {
      waitUntil: config.waitStrategy,
      timeout: config.timeout,
    });
    
    const html = await page.content();
    
    if (verbose) {
      console.error(`🎭 Playwright: Got ${html.length} chars of HTML`);
    }
    
    await page.close();
    await context.close();

    return { html };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { html: '', error: message };
  }
}

export async function closeBrowser(): Promise<void> {
  if (currentManager) {
    await currentManager.closeBrowser();
    currentManager = null;
  }
}
