/**
 * Configuration loader for arcfetch.
 *
 * Precedence (lowest to highest): defaults < config file < env vars < CLI overrides.
 * The final merged config is validated through Zod (`ArcfetchConfigSchema`).
 *
 * Public entry point is `loadConfig`; the lower-level pieces (`findConfigFile`,
 * `loadConfigFromFile`, `loadConfigFromEnv`) are exported for tests and tooling.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { getErrorMessage } from '../utils/error';
import { DEFAULT_CONFIG } from './defaults';
import { type ArcfetchConfig, ArcfetchConfigSchema } from './schema';

export * from './defaults';
export * from './schema';

type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

const CONFIG_FILES = ['arcfetch.config.json', '.arcfetchrc', '.arcfetchrc.json'];

export interface CliConfigOverrides {
  minQuality?: number;
  jsRetryThreshold?: number;
  tempDir?: string;
  docsDir?: string;
  waitStrategy?: 'networkidle' | 'domcontentloaded' | 'load';
  timeout?: number;
}

// ---------------------------------------------------------------------------
// Public loader pipeline
// ---------------------------------------------------------------------------

export function loadConfig(cliOverrides: CliConfigOverrides = {}): ArcfetchConfig {
  // 1. Defaults (deep-copied so we never mutate DEFAULT_CONFIG).
  let config: ArcfetchConfig = JSON.parse(JSON.stringify(DEFAULT_CONFIG));

  // 2. Config file overrides defaults.
  const configFile = findConfigFile();
  if (configFile) {
    config = deepMerge(config, loadConfigFromFile(configFile));
  }

  // 3. Environment variables override file.
  config = deepMerge(config, loadConfigFromEnv());

  // 4. CLI flags override everything below.
  applyCliOverrides(config, cliOverrides);

  // 5. Validate the final shape.
  return validate(config);
}

// ---------------------------------------------------------------------------
// Config file discovery & loading
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Environment variable loading
// ---------------------------------------------------------------------------

export function loadConfigFromEnv(): DeepPartial<ArcfetchConfig> {
  const config: DeepPartial<ArcfetchConfig> = {};

  // Primary ARCFETCH_* names, with SOFETCH_* kept as a legacy fallback.
  const minScore = process.env.ARCFETCH_MIN_SCORE ?? readLegacyEnvOverride('SOFETCH_MIN_SCORE');
  const jsRetryThreshold =
    process.env.ARCFETCH_JS_RETRY_THRESHOLD ?? readLegacyEnvOverride('SOFETCH_JS_RETRY_THRESHOLD');
  const tempDir = process.env.ARCFETCH_TEMP_DIR ?? readLegacyEnvOverride('SOFETCH_TEMP_DIR');
  const docsDir = process.env.ARCFETCH_DOCS_DIR ?? readLegacyEnvOverride('SOFETCH_DOCS_DIR');

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

/**
 * Legacy `SOFETCH_*` env-var fallback. Kept around so older setups that pre-date
 * the rename to arcfetch keep working; primary `ARCFETCH_*` names always win.
 */
function readLegacyEnvOverride(legacyName: string): string | undefined {
  return process.env[legacyName];
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function parseEnvInt(value: string): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
}

function applyCliOverrides(config: ArcfetchConfig, cliOverrides: CliConfigOverrides): void {
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
}

function validate(config: ArcfetchConfig): ArcfetchConfig {
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

/**
 * Deep-merges `source` into `target` for plain-object trees. Source values of
 * `undefined` are ignored; nested objects recurse, arrays/primitives replace.
 *
 * Private to the loader pipeline — every caller lives in this file.
 */
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
