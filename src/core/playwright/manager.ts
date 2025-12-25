import type { PlaywrightConfig } from '../../config/schema.js';
import type { BrowserManager, FetchWithBrowserResult } from './types.js';
import { LocalBrowserManager } from './local.js';
import { DockerBrowserManager, isDockerAvailable } from './docker.js';

let currentManager: BrowserManager | null = null;

export async function getBrowserManager(config: PlaywrightConfig): Promise<BrowserManager> {
  if (currentManager) {
    return currentManager;
  }
  
  const mode = config.mode;
  
  if (mode === 'local') {
    currentManager = new LocalBrowserManager(config);
    return currentManager;
  }
  
  if (mode === 'docker') {
    const dockerAvailable = await isDockerAvailable();
    if (!dockerAvailable) {
      throw new Error('Docker mode requested but Docker is not available');
    }
    currentManager = new DockerBrowserManager(config);
    return currentManager;
  }
  
  // Auto mode: prefer Docker if available, fall back to local
  if (mode === 'auto') {
    const dockerAvailable = await isDockerAvailable();
    if (dockerAvailable) {
      console.error('Using Docker for Playwright');
      currentManager = new DockerBrowserManager(config);
    } else {
      console.error('Docker not available, using local Playwright');
      currentManager = new LocalBrowserManager(config);
    }
    return currentManager;
  }
  
  throw new Error(`Unknown Playwright mode: ${mode}`);
}

export async function fetchWithBrowser(
  url: string,
  config: PlaywrightConfig,
  verbose = false
): Promise<FetchWithBrowserResult> {
  const manager = await getBrowserManager(config);
  const browser = await manager.getBrowser();
  
  try {
    const page = await browser.newPage();
    
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    if (verbose) {
      console.error(`🎭 Playwright: Navigating to ${url} (${manager.isDocker() ? 'Docker' : 'local'})`);
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
