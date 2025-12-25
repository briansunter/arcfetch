import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { FetchiConfigSchema, type FetchiConfig } from './schema.js';
import { DEFAULT_CONFIG } from './defaults.js';

const CONFIG_FILES = [
  'fetchi.config.json',
  '.fetchirc',
  '.fetchirc.json',
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
  } catch (error) {
    console.warn(`Warning: Could not load config from ${path}`);
    return {};
  }
}

export function loadConfigFromEnv(): Partial<FetchiConfig> {
  const config: any = {};
  
  if (process.env.FETCHI_MIN_SCORE) {
    config.quality = config.quality || {};
    config.quality.minScore = parseInt(process.env.FETCHI_MIN_SCORE, 10);
  }
  if (process.env.FETCHI_JS_RETRY_THRESHOLD) {
    config.quality = config.quality || {};
    config.quality.jsRetryThreshold = parseInt(process.env.FETCHI_JS_RETRY_THRESHOLD, 10);
  }
  
  if (process.env.FETCHI_TEMP_DIR) {
    config.paths = config.paths || {};
    config.paths.tempDir = process.env.FETCHI_TEMP_DIR;
  }
  if (process.env.FETCHI_DOCS_DIR) {
    config.paths = config.paths || {};
    config.paths.docsDir = process.env.FETCHI_DOCS_DIR;
  }
  
  if (process.env.FETCHI_PLAYWRIGHT_MODE) {
    config.playwright = config.playwright || {};
    config.playwright.mode = process.env.FETCHI_PLAYWRIGHT_MODE;
  }
  if (process.env.FETCHI_DOCKER_IMAGE) {
    config.playwright = config.playwright || {};
    config.playwright.dockerImage = process.env.FETCHI_DOCKER_IMAGE;
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
  let config: any = { ...DEFAULT_CONFIG };
  
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

function deepMerge(target: any, source: any): any {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(result[key] || {}, source[key]);
    } else if (source[key] !== undefined) {
      result[key] = source[key];
    }
  }
  return result;
}
