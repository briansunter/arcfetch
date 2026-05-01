import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { getErrorMessage } from '../utils/error';
import { DEFAULT_CONFIG } from './defaults';
import { type ArcfetchConfig, ArcfetchConfigSchema } from './schema';

type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

const CONFIG_FILES = ['arcfetch.config.json', '.arcfetchrc', '.arcfetchrc.json'];

export function findConfigFile(cwd: string = process.cwd()): string | null {
  for (const file of CONFIG_FILES) {
    const path = join(cwd, file);
    if (existsSync(path)) {
      return path;
    }
  }
  return null;
}

export function loadConfigFromFile(path: string): Partial<ArcfetchConfig> {
  try {
    const content = readFileSync(path, 'utf-8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`Warning: Could not load config from ${path}: ${getErrorMessage(error)}`);
    return {};
  }
}

function getEnv(primaryName: string, legacyName: string): string | undefined {
  return process.env[primaryName] ?? process.env[legacyName];
}

function parseEnvInt(value: string): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}

export function loadConfigFromEnv(): DeepPartial<ArcfetchConfig> {
  const config: DeepPartial<ArcfetchConfig> = {};

  const minScore = getEnv('ARCFETCH_MIN_SCORE', 'SOFETCH_MIN_SCORE');
  const jsRetryThreshold = getEnv('ARCFETCH_JS_RETRY_THRESHOLD', 'SOFETCH_JS_RETRY_THRESHOLD');
  const tempDir = getEnv('ARCFETCH_TEMP_DIR', 'SOFETCH_TEMP_DIR');
  const docsDir = getEnv('ARCFETCH_DOCS_DIR', 'SOFETCH_DOCS_DIR');

  if (minScore) {
    config.quality = config.quality || {};
    config.quality.minScore = parseEnvInt(minScore);
  }
  if (jsRetryThreshold) {
    config.quality = config.quality || {};
    config.quality.jsRetryThreshold = parseEnvInt(jsRetryThreshold);
  }

  if (tempDir) {
    config.paths = config.paths || {};
    config.paths.tempDir = tempDir;
  }
  if (docsDir) {
    config.paths = config.paths || {};
    config.paths.docsDir = docsDir;
  }

  return config;
}

export interface CliConfigOverrides {
  minQuality?: number;
  jsRetryThreshold?: number;
  tempDir?: string;
  docsDir?: string;
  waitStrategy?: 'networkidle' | 'domcontentloaded' | 'load';
  timeout?: number;
}

export function loadConfig(cliOverrides: CliConfigOverrides = {}): ArcfetchConfig {
  // Deep copy to avoid mutating DEFAULT_CONFIG
  let config: ArcfetchConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));

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
  if (cliOverrides.waitStrategy !== undefined) {
    config.playwright.waitStrategy = cliOverrides.waitStrategy;
  }
  if (cliOverrides.timeout !== undefined) {
    config.playwright.timeout = cliOverrides.timeout;
  }

  try {
    return ArcfetchConfigSchema.parse(config);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
      throw new Error(`Invalid configuration: ${issues}`);
    }
    throw error;
  }
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
