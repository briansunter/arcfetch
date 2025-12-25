/**
 * Markdown Quality Validator
 *
 * Validates that extracted markdown is clean and usable.
 * Returns quality score and issues.
 */

export interface ValidationResult {
  isValid: boolean;
  score: number; // 0-100
  issues: string[];
  warnings: string[];
}

export function validateMarkdown(markdown: string): ValidationResult {
  const issues: string[] = [];
  const warnings: string[] = [];
  let score = 100;

  // Check for excessive HTML tags (indicates poor conversion)
  const htmlTagMatches = markdown.match(/<[^>]+>/g);
  const htmlTagCount = htmlTagMatches ? htmlTagMatches.length : 0;

  if (htmlTagCount > 100) {
    score -= 40;
    issues.push(`${htmlTagCount} leftover HTML tags found (likely forum/discussion thread)`);
  } else if (htmlTagCount > 50) {
    score -= 20;
    warnings.push(`${htmlTagCount} HTML tags present`);
  } else if (htmlTagCount > 10) {
    score -= 5;
    warnings.push(`${htmlTagCount} minor HTML tags present`);
  }

  // Check for table structure (tr/td) not converted
  const tableTagMatches = markdown.match(/<t[rd][\s>]/gi);
  const tableTagCount = tableTagMatches ? tableTagMatches.length : 0;

  if (tableTagCount > 50) {
    score -= 30;
    issues.push(`${tableTagCount} unconverted table tags (complex layout not suitable)`);
  }

  // Check markdown to HTML ratio (too much HTML means poor extraction)
  const htmlCharCount = markdown.match(/<[^>]*>/g)?.join('').length || 0;
  const htmlRatio = htmlCharCount / markdown.length;

  if (htmlRatio > 0.3) {
    score -= 25;
    issues.push(`${(htmlRatio * 100).toFixed(1)}% of content is HTML tags`);
  } else if (htmlRatio > 0.15) {
    score -= 10;
    warnings.push(`${(htmlRatio * 100).toFixed(1)}% HTML tag ratio`);
  }

  // Check for script tags (should never be present)
  const scriptMatches = markdown.match(/<script/gi);
  if (scriptMatches && scriptMatches.length > 0) {
    score -= 15;
    warnings.push(`${scriptMatches.length} script tags present`);
  }

  // Check for style tags
  const styleMatches = markdown.match(/<style/gi);
  if (styleMatches && styleMatches.length > 0) {
    score -= 10;
    warnings.push(`${styleMatches.length} style tags present`);
  }

  // Check for minimal/blank content
  const contentLength = markdown.replace(/<[^>]*>/g, '').replace(/[#*\-_`\[\]()]/g, '').trim().length;

  if (contentLength === 0) {
    score = 0;
    issues.push("Blank content - no text extracted");
  } else if (contentLength < 50) {
    score -= 50;
    issues.push(`Extremely short content (${contentLength} chars) - likely extraction failure`);
  } else if (contentLength < 200 && (htmlTagCount > 50 || tableTagCount > 20)) {
    score -= 30;
    issues.push(`Only ${contentLength} chars of actual content with excessive HTML (extraction likely failed)`);
  } else if (contentLength < 300) {
    score -= 15;
    warnings.push(`Short content (${contentLength} chars) - may not be a full article`);
  }

  // Check for excessive newlines (indicates poor formatting)
  const excessiveNewlines = markdown.match(/\n{5,}/g);
  if (excessiveNewlines && excessiveNewlines.length > 10) {
    score -= 5;
    warnings.push(`${excessiveNewlines.length} sections with excessive newlines`);
  }

  // Quality thresholds
  const isValid = score >= 60; // Below 60 is unusable

  return {
    isValid,
    score: Math.max(0, score),
    issues,
    warnings,
  };
}

/**
 * Generate human-readable quality report
 */
export function formatValidationReport(result: ValidationResult): string {
  let report = `**Quality Score**: ${result.score}/100`;

  if (result.score >= 90) {
    report += " ✅ Excellent";
  } else if (result.score >= 75) {
    report += " ✅ Good";
  } else if (result.score >= 60) {
    report += " ⚠️ Acceptable";
  } else {
    report += " ❌ Poor";
  }

  if (result.issues.length > 0) {
    report += "\n\n**Issues**:\n";
    result.issues.forEach(issue => {
      report += `- ${issue}\n`;
    });
  }

  if (result.warnings.length > 0) {
    report += "\n**Warnings**:\n";
    result.warnings.forEach(warning => {
      report += `- ${warning}\n`;
    });
  }

  return report;
}
