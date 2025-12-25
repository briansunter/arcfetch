import { z } from 'zod';

export const QualityConfigSchema = z.object({
  minScore: z.number().min(0).max(100).default(60),
  jsRetryThreshold: z.number().min(0).max(100).default(85),
});

export const PathsConfigSchema = z.object({
  tempDir: z.string().default('.tmp'),
  docsDir: z.string().default('docs/ai/references'),
});

export const PlaywrightConfigSchema = z.object({
  mode: z.enum(['local', 'docker', 'auto']).default('auto'),
  dockerImage: z.string().default('mcr.microsoft.com/playwright:v1.40.0-jammy'),
  timeout: z.number().default(30000),
  waitStrategy: z.enum(['networkidle', 'domcontentloaded', 'load']).default('networkidle'),
});

export const RetryConfigSchema = z.object({
  maxAttempts: z.number().default(2),
  backoffMs: z.number().default(1000),
});

export const FetchiConfigSchema = z.object({
  quality: QualityConfigSchema.default({}),
  paths: PathsConfigSchema.default({}),
  playwright: PlaywrightConfigSchema.default({}),
  retry: RetryConfigSchema.default({}),
});

export type FetchiConfig = z.infer<typeof FetchiConfigSchema>;
export type QualityConfig = z.infer<typeof QualityConfigSchema>;
export type PathsConfig = z.infer<typeof PathsConfigSchema>;
export type PlaywrightConfig = z.infer<typeof PlaywrightConfigSchema>;
export type RetryConfig = z.infer<typeof RetryConfigSchema>;
