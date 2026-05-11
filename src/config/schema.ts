import { z } from 'zod';

const QualityConfigSchema = z.object({
  minScore: z.number().int().min(0).max(100).default(60),
  jsRetryThreshold: z.number().int().min(0).max(100).default(85),
});

const PathsConfigSchema = z.object({
  tempDir: z.string().min(1).default('.tmp/arcfetch'),
  docsDir: z.string().min(1).default('docs/ai/references'),
});

const PlaywrightConfigSchema = z.object({
  timeout: z.number().int().positive().default(30000),
  waitStrategy: z.enum(['networkidle', 'domcontentloaded', 'load']).default('networkidle'),
});

export const ArcfetchConfigSchema = z
  .object({
    quality: QualityConfigSchema.default({}),
    paths: PathsConfigSchema.default({}),
    playwright: PlaywrightConfigSchema.default({}),
  })
  .superRefine((config, ctx) => {
    if (config.quality.minScore > config.quality.jsRetryThreshold) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['quality', 'minScore'],
        message: 'minScore must be less than or equal to jsRetryThreshold',
      });
    }
  });

export type ArcfetchConfig = z.infer<typeof ArcfetchConfigSchema>;
export type PlaywrightConfig = z.infer<typeof PlaywrightConfigSchema>;
