 * @module requirement-linter
 * @description Analyzes requirement text (PRDs, instructions) for vague, non-measurable language.
 *   Inspired by 'prd-taskmaster' quality gates.
 */

import { Logger, STUB_LOGGER } from '../platform-adapters';

export interface LintResult {
  passed: boolean;
  score: number;
  maxScore: number;
  warnings: Array<{
    term: string;
    suggestion: string;
    context: string;
  }>;
}

const VAGUE_WORDS = [
  "fast", "quick", "slow", "good", "bad", "poor",
  "user-friendly", "easy", "simple", "secure", "safe",
  "scalable", "flexible", "performant", "efficient",
  "intuitive", "robust", "flexible", "modern"
];

const VAGUE_PATTERN = new RegExp(
  `\\b(?:should\\s+be\\s+|must\\s+be\\s+|needs?\\s+to\\s+be\\s+)?(${VAGUE_WORDS.join('|')})\\b`,
  'gi'
);

export class RequirementLinter {
  constructor(private readonly log: Logger = STUB_LOGGER) {}

  /**
   * Scans text for vague descriptors and returns a quality score.
   */
  async lint(text: string): Promise<LintResult> {
    const warnings: LintResult['warnings'] = [];
    const matches = Array.from(text.matchAll(VAGUE_PATTERN));

    for (const match of matches) {
      const term = match[1].toLowerCase();
      const index = match.index || 0;
      const start = Math.max(0, index - 30);
      const end = Math.min(text.length, index + 30);
      const context = text.slice(start, end).replace(/\n/g, ' ').trim();

      warnings.push({
        term,
        suggestion: `Replace '${term}' with a specific, measurable target (e.g. "under 200ms", "SOC2 compliant").`,
        context: `"...${context}..."`
      });
    }

    const maxScore = 100;
    const penaltyPerWarning = 5;
    const score = Math.max(0, maxScore - warnings.length * penaltyPerWarning);

    this.log.info(`Quality Audit Complete | Score: ${score}/${maxScore} | Warnings: ${warnings.length}`);
    if (warnings.length > 0) {
      this.log.debug(`Vague terms detected: ${warnings.map(w => w.term).join(', ')}`);
    }

    return {
      passed: score >= 75,
      score,
      maxScore,
      warnings
    };
  }
}
