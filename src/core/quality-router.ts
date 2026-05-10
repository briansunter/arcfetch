/**
 * Quality-Score routing for the two-stage fetch pipeline.
 *
 * Implements ADR-0001's three-band algorithm as a pure decision function:
 *
 *   - score >= jsRetryThreshold (default 85)  → accept simple result
 *   - score in [minScore, jsRetryThreshold)   → try Playwright, keep whichever scores higher
 *   - score <  minScore        (default 60)   → require Playwright; reject if still below threshold
 *
 * Inputs are the validation result and the relevant thresholds. Output is a
 * tagged decision the pipeline switches on. The module is pure — no I/O, no
 * config-module reads, no Playwright knowledge — so the decision matrix can
 * be tested without mocking fetch / extraction / Playwright.
 */

import type { ValidationResult } from '../utils/markdown-validator';

export interface QualityThresholds {
  /** Floor below which a Playwright result is also rejected (default 60). */
  minScore: number;
  /** At or above this score we skip Playwright entirely (default 85). */
  jsRetryThreshold: number;
}

export type QualityDecision =
  | { action: 'accept' }
  | { action: 'try-playwright-keep-higher' }
  | { action: 'require-playwright' };

/**
 * Route a validated extraction through the three-band ladder.
 *
 * The decision is determined entirely by the score and the thresholds — no
 * side effects, no I/O. The caller dispatches on `decision.action`.
 */
export function routeByQuality(validation: ValidationResult, thresholds: QualityThresholds): QualityDecision {
  if (validation.score >= thresholds.jsRetryThreshold) {
    return { action: 'accept' };
  }

  if (validation.score >= thresholds.minScore) {
    return { action: 'try-playwright-keep-higher' };
  }

  return { action: 'require-playwright' };
}
