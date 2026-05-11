import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '../../src/config/defaults';
import { findConfigFile, loadConfig, loadConfigFromEnv, loadConfigFromFile } from '../../src/config/index';

const TEST_DIR = '.test-loader-temp';

describe('config loader', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
    // Clear environment variables before each test
    delete process.env.ARCFETCH_MIN_SCORE;
    delete process.env.ARCFETCH_JS_RETRY_THRESHOLD;
    delete process.env.ARCFETCH_TEMP_DIR;
    delete process.env.ARCFETCH_DOCS_DIR;
  });

  afterEach(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
    delete process.env.ARCFETCH_MIN_SCORE;
    delete process.env.ARCFETCH_JS_RETRY_THRESHOLD;
    delete process.env.ARCFETCH_TEMP_DIR;
    delete process.env.ARCFETCH_DOCS_DIR;
  });

  describe('findConfigFile', () => {
    test('returns null when no config file exists', () => {
      const result = findConfigFile(TEST_DIR);
      expect(result).toBeNull();
    });

    test('finds arcfetch.config.json first', () => {
      writeFileSync(join(TEST_DIR, 'arcfetch.config.json'), '{}');
      writeFileSync(join(TEST_DIR, '.arcfetchrc'), '{}');

      const result = findConfigFile(TEST_DIR);
      expect(result).toBe(join(TEST_DIR, 'arcfetch.config.json'));
    });

    test('finds .arcfetchrc when arcfetch.config.json does not exist', () => {
      writeFileSync(join(TEST_DIR, '.arcfetchrc'), '{}');
      writeFileSync(join(TEST_DIR, '.arcfetchrc.json'), '{}');

      const result = findConfigFile(TEST_DIR);
      expect(result).toBe(join(TEST_DIR, '.arcfetchrc'));
    });

    test('finds .arcfetchrc.json when others do not exist', () => {
      writeFileSync(join(TEST_DIR, '.arcfetchrc.json'), '{}');

      const result = findConfigFile(TEST_DIR);
      expect(result).toBe(join(TEST_DIR, '.arcfetchrc.json'));
    });
  });

  describe('loadConfigFromFile', () => {
    test('loads valid JSON config file', () => {
      const configPath = join(TEST_DIR, 'config.json');
      const configData = { quality: { minScore: 70 } };
      writeFileSync(configPath, JSON.stringify(configData));

      const result = loadConfigFromFile(configPath);
      expect(result.quality?.minScore).toBe(70);
    });

    test('returns empty object for invalid JSON', () => {
      const configPath = join(TEST_DIR, 'invalid.json');
      writeFileSync(configPath, 'not valid json');

      const result = loadConfigFromFile(configPath);
      expect(Object.keys(result).length).toBe(0);
    });

    test('returns empty object for non-existent file', () => {
      const result = loadConfigFromFile(join(TEST_DIR, 'nonexistent.json'));
      expect(Object.keys(result).length).toBe(0);
    });

    test('loads complete config with all sections', () => {
      const config = {
        quality: {
          minScore: 50,
          jsRetryThreshold: 80,
        },
        paths: {
          tempDir: '/custom/temp',
          docsDir: '/custom/docs',
        },
        playwright: {
          mode: 'docker',
          timeout: 60000,
        },
      };
      const configPath = join(TEST_DIR, 'full-config.json');
      writeFileSync(configPath, JSON.stringify(config));

      const result = loadConfigFromFile(configPath);
      expect(result.quality?.minScore).toBe(50);
      expect(result.quality?.jsRetryThreshold).toBe(80);
      expect(result.paths?.tempDir).toBe('/custom/temp');
      expect(result.paths?.docsDir).toBe('/custom/docs');
    });
  });

  describe('loadConfigFromEnv', () => {
    test('returns empty config when no env vars set', () => {
      const result = loadConfigFromEnv();
      expect(result).toEqual({});
    });

    test('loads ARCFETCH_MIN_SCORE', () => {
      process.env.ARCFETCH_MIN_SCORE = '75';
      const result = loadConfigFromEnv();
      expect(result.quality?.minScore).toBe(75);
    });

    test('loads ARCFETCH_JS_RETRY_THRESHOLD', () => {
      process.env.ARCFETCH_JS_RETRY_THRESHOLD = '90';
      const result = loadConfigFromEnv();
      expect(result.quality?.jsRetryThreshold).toBe(90);
    });

    test('loads ARCFETCH_TEMP_DIR', () => {
      process.env.ARCFETCH_TEMP_DIR = '/my/temp';
      const result = loadConfigFromEnv();
      expect(result.paths?.tempDir).toBe('/my/temp');
    });

    test('loads ARCFETCH_DOCS_DIR', () => {
      process.env.ARCFETCH_DOCS_DIR = '/my/docs';
      const result = loadConfigFromEnv();
      expect(result.paths?.docsDir).toBe('/my/docs');
    });

    test('loads multiple env vars together', () => {
      process.env.ARCFETCH_MIN_SCORE = '55';
      process.env.ARCFETCH_TEMP_DIR = '/env/temp';

      const result = loadConfigFromEnv();
      expect(result.quality?.minScore).toBe(55);
      expect(result.paths?.tempDir).toBe('/env/temp');
    });
  });

  describe('loadConfig', () => {
    test('returns default config when no overrides', () => {
      const config = loadConfig();
      expect(config.quality.minScore).toBe(DEFAULT_CONFIG.quality.minScore);
      expect(config.quality.jsRetryThreshold).toBe(DEFAULT_CONFIG.quality.jsRetryThreshold);
      expect(config.playwright.timeout).toBe(DEFAULT_CONFIG.playwright.timeout);
      expect(config.playwright.waitStrategy).toBe(DEFAULT_CONFIG.playwright.waitStrategy);
    });

    test('CLI overrides take precedence', () => {
      const config = loadConfig({
        minQuality: 45,
        jsRetryThreshold: 95,
        tempDir: '/cli/temp',
        docsDir: '/cli/docs',
        timeout: 45000,
      });

      expect(config.quality.minScore).toBe(45);
      expect(config.quality.jsRetryThreshold).toBe(95);
      expect(config.paths.tempDir).toBe('/cli/temp');
      expect(config.paths.docsDir).toBe('/cli/docs');
      expect(config.playwright.timeout).toBe(45000);
    });

    test('env vars override defaults', () => {
      process.env.ARCFETCH_MIN_SCORE = '55';

      const config = loadConfig();
      expect(config.quality.minScore).toBe(55);
    });

    test('CLI overrides env vars', () => {
      process.env.ARCFETCH_MIN_SCORE = '55';
      const config = loadConfig({ minQuality: 40 });
      expect(config.quality.minScore).toBe(40);
    });

    test('validates final config with Zod schema', () => {
      // This should work since we pass valid values
      const config = loadConfig({ minQuality: 50 });
      expect(config.quality.minScore).toBe(50);
    });

    test('partial CLI overrides preserve other values', () => {
      const config = loadConfig({ minQuality: 70 });
      // minQuality is overridden
      expect(config.quality.minScore).toBe(70);
      // jsRetryThreshold should still be default
      expect(config.quality.jsRetryThreshold).toBe(DEFAULT_CONFIG.quality.jsRetryThreshold);
      // paths should still be defaults
      expect(config.paths.tempDir).toBe(DEFAULT_CONFIG.paths.tempDir);
    });
  });

  describe('precedence order', () => {
    test('defaults < env < CLI overrides', () => {
      // Set env var
      process.env.ARCFETCH_MIN_SCORE = '55';

      // Without CLI override, env takes precedence
      const configFromEnv = loadConfig();
      expect(configFromEnv.quality.minScore).toBe(55);

      // With CLI override, CLI takes precedence
      const configFromCli = loadConfig({ minQuality: 40 });
      expect(configFromCli.quality.minScore).toBe(40);
    });
  });

  describe('default config values', () => {
    test('default minScore is 60', () => {
      expect(DEFAULT_CONFIG.quality.minScore).toBe(60);
    });

    test('default jsRetryThreshold is 85', () => {
      expect(DEFAULT_CONFIG.quality.jsRetryThreshold).toBe(85);
    });

    test('default timeout is 30000', () => {
      expect(DEFAULT_CONFIG.playwright.timeout).toBe(30000);
    });

    test('default tempDir is .tmp/arcfetch', () => {
      expect(DEFAULT_CONFIG.paths.tempDir).toBe('.tmp/arcfetch');
    });

    test('default docsDir is docs/ai/references', () => {
      expect(DEFAULT_CONFIG.paths.docsDir).toBe('docs/ai/references');
    });
  });
});
