import { chromium, type Browser } from 'playwright-extra';
import stealth from 'puppeteer-extra-plugin-stealth';
import type { PlaywrightConfig } from '../../config/schema.js';
import type { BrowserManager } from './types.js';

chromium.use(stealth());

let browserInstance: Browser | null = null;

export class LocalBrowserManager implements BrowserManager {
  private config: PlaywrightConfig;
  
  constructor(config: PlaywrightConfig) {
    this.config = config;
  }
  
  async getBrowser(): Promise<Browser> {
    if (!browserInstance) {
      browserInstance = await chromium.launch({ 
        headless: true,
        timeout: this.config.timeout,
      });
    }
    return browserInstance;
  }
  
  async closeBrowser(): Promise<void> {
    if (browserInstance) {
      await browserInstance.close();
      browserInstance = null;
    }
  }
  
  isDocker(): boolean {
    return false;
  }
}
