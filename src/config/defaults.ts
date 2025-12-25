import type { FetchiConfig } from './schema.js';

export const DEFAULT_CONFIG: FetchiConfig = {
  quality: {
    minScore: 60,
    jsRetryThreshold: 85,
  },
  paths: {
    tempDir: '.tmp',
    docsDir: 'docs/ai/references',
  },
  playwright: {
    mode: 'auto',
    dockerImage: 'mcr.microsoft.com/playwright:v1.40.0-jammy',
    timeout: 30000,
    waitStrategy: 'networkidle',
  },
  retry: {
    maxAttempts: 2,
    backoffMs: 1000,
  },
};
