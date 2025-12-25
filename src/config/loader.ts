import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FetchiConfigSchema, type FetchiConfig } from './schema.js';
import { DEFAULT_CONFIG } from './defaults.js';

type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

const CONFIG_FILES = [
  'sofetch.config.json',
  '.sofetchrc',
  '.sofetchrc.json',
];

export function findConfigFile(cwd: string = process.cwd()): string | null {
  for (const file of CONFIG_FILES) {
    const path = join(cwd, file);
    if (existsSync(path)) {
      return path;
    }
  }
  return null;
}

export function loadConfigFromFile(path: string): Partial<FetchiConfig> {
  try {
    const content = readFileSync(path, 'utf-8');
    return JSON.parse(content);
  } catch {
    console.warn(`Warning: Could not load config from ${path}`);
    return {};
  }
}

export function loadConfigFromEnv(): DeepPartial<FetchiConfig> {
  const config: DeepPartial<FetchiConfig> = {};

  if (process.env.SOFETCH_MIN_SCORE) {
    config.quality = config.quality || {};
    config.quality.minScore = parseInt(process.env.SOFETCH_MIN_SCORE, 10);
  }
  if (process.env.SOFETCH_JS_RETRY_THRESHOLD) {
    config.quality = config.quality || {};
    config.quality.jsRetryThreshold = parseInt(process.env.SOFETCH_JS_RETRY_THRESHOLD, 10);
  }

  if (process.env.SOFETCH_TEMP_DIR) {
    config.paths = config.paths || {};
    config.paths.tempDir = process.env.SOFETCH_TEMP_DIR;
  }
  if (process.env.SOFETCH_DOCS_DIR) {
    config.paths = config.paths || {};
    config.paths.docsDir = process.env.SOFETCH_DOCS_DIR;
  }

  if (process.env.SOFETCH_PLAYWRIGHT_MODE) {
    const mode = process.env.SOFETCH_PLAYWRIGHT_MODE;
    if (mode === 'local' || mode === 'docker' || mode === 'auto') {
      config.playwright = config.playwright || {};
      config.playwright.mode = mode;
    }
  }
  if (process.env.SOFETCH_DOCKER_IMAGE) {
    config.playwright = config.playwright || {};
    config.playwright.dockerImage = process.env.SOFETCH_DOCKER_IMAGE;
  }

  return config;
}

export interface CliConfigOverrides {
  minQuality?: number;
  jsRetryThreshold?: number;
  tempDir?: string;
  docsDir?: string;
  playwrightMode?: 'local' | 'docker' | 'auto';
  timeout?: number;
}

export function loadConfig(cliOverrides: CliConfigOverrides = {}): FetchiConfig {
  // Deep copy to avoid mutating DEFAULT_CONFIG
  let config: FetchiConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  
  const configFile = findConfigFile();
  if (configFile) {
    const fileConfig = loadConfigFromFile(configFile);
    config = deepMerge(config, fileConfig);
  }
  
  const envConfig = loadConfigFromEnv();
  config = deepMerge(config, envConfig);
  
  if (cliOverrides.minQuality !== undefined) {
    config.quality.minScore = cliOverrides.minQuality;
  }
  if (cliOverrides.jsRetryThreshold !== undefined) {
    config.quality.jsRetryThreshold = cliOverrides.jsRetryThreshold;
  }
  if (cliOverrides.tempDir !== undefined) {
    config.paths.tempDir = cliOverrides.tempDir;
  }
  if (cliOverrides.docsDir !== undefined) {
    config.paths.docsDir = cliOverrides.docsDir;
  }
  if (cliOverrides.playwrightMode !== undefined) {
    config.playwright.mode = cliOverrides.playwrightMode;
  }
  if (cliOverrides.timeout !== undefined) {
    config.playwright.timeout = cliOverrides.timeout;
  }
  
  return FetchiConfigSchema.parse(config);
}

function deepMerge<T extends Record<string, unknown>>(target: T, source: DeepPartial<T>): T {
  const result = { ...target } as T;
  for (const key of Object.keys(source) as (keyof T)[]) {
    const sourceValue = source[key];
    if (sourceValue && typeof sourceValue === 'object' && !Array.isArray(sourceValue)) {
      (result as Record<string, unknown>)[key as string] = deepMerge(
        (result[key] || {}) as Record<string, unknown>,
        sourceValue as DeepPartial<Record<string, unknown>>
      );
    } else if (sourceValue !== undefined) {
      (result as Record<string, unknown>)[key as string] = sourceValue;
    }
  }
  return result;
}
