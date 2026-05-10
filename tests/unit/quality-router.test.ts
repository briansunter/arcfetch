import { describe, expect, test } from 'bun:test';
import { type QualityThresholds, routeByQuality } from '../../src/core/quality-router';
import type { ValidationResult } from '../../src/utils/markdown-validator';

/**
 * Build a minimal ValidationResult with the given score. The router only
 * reads `score`, so everything else can stay empty — and that's the point:
 * decisions are score-driven, not content-driven.
 */
function validation(score: number): ValidationResult {
  return {
    isValid: score >= 60,
    score,
    issues: [],
    warnings: [],
  };
}

const DEFAULT_THRESHOLDS: QualityThresholds = { minScore: 60, jsRetryThreshold: 85 };

describe('routeByQuality (default thresholds 60 / 85)', () => {
  test('score above jsRetryThreshold → accept', () => {
    expect(routeByQuality(validation(99), DEFAULT_THRESHOLDS)).toEqual({ action: 'accept' });
    expect(routeByQuality(validation(100), DEFAULT_THRESHOLDS)).toEqual({ action: 'accept' });
    expect(routeByQuality(validation(86), DEFAULT_THRESHOLDS)).toEqual({ action: 'accept' });
  });

  test('score equal to jsRetryThreshold → accept (lower bound is inclusive)', () => {
    expect(routeByQuality(validation(85), DEFAULT_THRESHOLDS)).toEqual({ action: 'accept' });
  });

  test('score just below jsRetryThreshold → try-playwright-keep-higher', () => {
    expect(routeByQuality(validation(84.999), DEFAULT_THRESHOLDS)).toEqual({
      action: 'try-playwright-keep-higher',
    });
    expect(routeByQuality(validation(84), DEFAULT_THRESHOLDS)).toEqual({
      action: 'try-playwright-keep-higher',
    });
  });

  test('mid-marginal score → try-playwright-keep-higher', () => {
    expect(routeByQuality(validation(72), DEFAULT_THRESHOLDS)).toEqual({
      action: 'try-playwright-keep-higher',
    });
  });

  test('score equal to minScore → try-playwright-keep-higher (lower bound is inclusive)', () => {
    expect(routeByQuality(validation(60), DEFAULT_THRESHOLDS)).toEqual({
      action: 'try-playwright-keep-higher',
    });
  });

  test('score just below minScore → require-playwright', () => {
    expect(routeByQuality(validation(59.999), DEFAULT_THRESHOLDS)).toEqual({
      action: 'require-playwright',
    });
    expect(routeByQuality(validation(59), DEFAULT_THRESHOLDS)).toEqual({
      action: 'require-playwright',
    });
  });

  test('low score → require-playwright', () => {
    expect(routeByQuality(validation(0), DEFAULT_THRESHOLDS)).toEqual({ action: 'require-playwright' });
    expect(routeByQuality(validation(30), DEFAULT_THRESHOLDS)).toEqual({ action: 'require-playwright' });
  });
});

describe('routeByQuality with custom thresholds', () => {
  test('thresholds flow through from the second argument', () => {
    const strict: QualityThresholds = { minScore: 80, jsRetryThreshold: 95 };

    // 85 used to be "accept" under defaults; under strict it's marginal
    expect(routeByQuality(validation(85), strict)).toEqual({ action: 'try-playwright-keep-higher' });
    // 79 is below the new minScore even though it was marginal under defaults
    expect(routeByQuality(validation(79), strict)).toEqual({ action: 'require-playwright' });
    // 96 clears the new jsRetryThreshold
    expect(routeByQuality(validation(96), strict)).toEqual({ action: 'accept' });
  });

  test('collapsed band (minScore === jsRetryThreshold) skips the marginal action', () => {
    const collapsed: QualityThresholds = { minScore: 70, jsRetryThreshold: 70 };

    // Exactly at the boundary hits the accept band first.
    expect(routeByQuality(validation(70), collapsed)).toEqual({ action: 'accept' });
    expect(routeByQuality(validation(71), collapsed)).toEqual({ action: 'accept' });
    expect(routeByQuality(validation(69), collapsed)).toEqual({ action: 'require-playwright' });
  });

  test('zero thresholds accept everything', () => {
    const permissive: QualityThresholds = { minScore: 0, jsRetryThreshold: 0 };
    expect(routeByQuality(validation(0), permissive)).toEqual({ action: 'accept' });
    expect(routeByQuality(validation(50), permissive)).toEqual({ action: 'accept' });
  });
});
