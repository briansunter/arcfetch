import type { Browser, Page } from 'playwright';

export interface BrowserManager {
  getBrowser(): Promise<Browser>;
  closeBrowser(): Promise<void>;
  isDocker(): boolean;
}

export interface FetchWithBrowserResult {
  html: string;
  error?: string;
}
