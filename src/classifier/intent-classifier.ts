/**
 * @module intent-classifier
 * @description Two-tier intent classification for chat prompts.
 *   Tier 1: Local keyword/regex matching (instant, zero cost).
 *   Tier 2: LLM-based classification via structured output (double-duty pattern).
 * @inputs Developer chat prompt (string)
 * @outputs ClassificationResult (intent, confidence, signals)
 * @depends-on intent-patterns.ts (pattern map)
 * @depended-on-by shell/chat-participant.ts (routing)
 */

import type { IntentType, ClassificationResult } from '../types';
import {
  INTENT_PATTERNS,
  NEGATIVE_SIGNALS,
  CONFIDENCE_THRESHOLDS,
} from './intent-patterns';
import { LLMClassificationResponseSchema } from '../schemas';
import type { WorkflowStats } from '../learning/learning-database';

/**
 * Two-tier intent classifier implementing the IntentClassifier interface.
 *
 * Usage by ChatParticipantHandler:
 * 1. Call classify(prompt) for local classification
 * 2. If requiresLLM is true, prepend getClassificationPromptPrefix() to system prompt
 * 3. After receiving LLM response, call parseClassification(responseText)
 * 4. If parseClassification returns null, fall back to general_chat
 */
export class IntentClassifier {
  /**
   * Local classification — instant, zero cost.
   * Runs INTENT_PATTERNS against the prompt, computes weighted scores,
   * applies negative signals, then maps to a confidence threshold.
   * Latency budget: <10ms.
   */
  classify(prompt: string): ClassificationResult {
    // Trim but do NOT lowercase — some patterns are deliberately case-sensitive
    // (e.g., /TypeError:/, /README/, /TypeScript/). Patterns that need
    // case-insensitivity already have the /i flag.
    const normalized = prompt.trim();

    if (normalized.length > 10_000) {
      return {
        intent: 'general_chat',
        confidence: CONFIDENCE_THRESHOLDS.unknown,
        signals: ['prompt-too-long'],
        requiresLLM: true,
      };
    }

    // 1. Score each intent by summing matched pattern weights.
    //    Track earliest match position for tie-breaking (if two intents
    //    score identically, the one mentioned first in the prompt wins).
    const intentScores = new Map<
      string,
      { score: number; signals: string[]; firstMatchIdx: number }
    >();

    for (const [intent, patterns] of Object.entries(INTENT_PATTERNS)) {
      let score = 0;
      let firstMatchIdx = Infinity;
      const matched: string[] = [];
      for (const p of patterns) {
        const m = p.regex.exec(normalized);
        if (m) {
          score += p.weight;
          matched.push(p.label);
          firstMatchIdx = Math.min(firstMatchIdx, m.index);
        }
      }
      intentScores.set(intent, {
        score: Math.min(score, 1.0),
        signals: matched,
        firstMatchIdx,
      });
    }

    // 2. Sort intents by score descending, tie-break by earliest mention in prompt
    const sorted = [...intentScores.entries()].sort((a, b) => {
      if (b[1].score !== a[1].score) return b[1].score - a[1].score;
      return a[1].firstMatchIdx - b[1].firstMatchIdx; // earlier mention wins
    });
    if (sorted.length === 0) {
      return {
        intent: 'general_chat',
        confidence: CONFIDENCE_THRESHOLDS.unknown,
        signals: [],
        requiresLLM: true,
      };
    }

    // sorted.length > 0 is guaranteed by the guard above
    const topEntry = sorted[0]!;
    const topIntent = topEntry[0];
    const topData = topEntry[1];

    // 3. If no intent scores above minimum, return general_chat (unknown).
    //    Threshold 0.20 accepts single weak signals (weight 0.20 patterns
    //    like "build", "enable", "support", "understand") which the dataset
    //    expects to be classified, not dropped to general_chat.
    if (topData.score < 0.2) {
      return {
        intent: 'general_chat',
        confidence: CONFIDENCE_THRESHOLDS.unknown,
        signals: [],
        requiresLLM: true,
      };
    }

    // 4. Check negative signals against the original prompt
    let negativeHit = false;
    for (const neg of NEGATIVE_SIGNALS) {
      if (neg.regex.test(normalized)) {
        topData.signals.push(neg.label);
        negativeHit = true;
      }
    }

    if (negativeHit) {
      return {
        intent: 'general_chat',
        confidence: CONFIDENCE_THRESHOLDS.negativeOverride,
        signals: topData.signals,
        requiresLLM: true,
      };
    }

    // 5. Ambiguity check: second-highest must be meaningful (>= 0.3)
    //    and close to the top score (within ambiguousDelta).
    if (sorted.length >= 2) {
      const secondScore = sorted[1]![1].score;
      if (
        secondScore >= 0.3 &&
        topData.score - secondScore < CONFIDENCE_THRESHOLDS.ambiguousDelta
      ) {
        return {
          intent: topIntent as IntentType,
          confidence: CONFIDENCE_THRESHOLDS.ambiguousCap,
          signals: topData.signals,
          requiresLLM: true,
        };
      }
    }

    // 6. Clear winner — map confidence to threshold based on signal type
    const hasSignalPattern = topData.signals.some((s) => s.startsWith('signal:'));
    const confidence = hasSignalPattern
      ? CONFIDENCE_THRESHOLDS.primaryPlusSecondary
      : CONFIDENCE_THRESHOLDS.primaryOnly;

    return {
      intent: topIntent as IntentType,
      confidence,
      signals: topData.signals,
      requiresLLM: confidence < CONFIDENCE_THRESHOLDS.requiresLLMBelow,
    };
  }

  /**
   * Parse LLM classification from a response that includes structured output.
   * Extracts the first JSON block and validates it against the schema.
   * Returns null if no valid classification found (caller falls back to general_chat).
   */
  parseClassification(responseText: string): ClassificationResult | null {
    const match = responseText.match(/\{[\s\S]*?\}/);
    if (!match) return null;

    try {
      const parsed = LLMClassificationResponseSchema.safeParse(JSON.parse(match[0]));
      if (!parsed.success) return null;

      return {
        intent: parsed.data.intent as IntentType,
        confidence: CONFIDENCE_THRESHOLDS.llmClassification,
        signals: ['llm_classification'],
        requiresLLM: false,
      };
    } catch {
      return null;
    }
  }

  /**
   * Adjust a ClassificationResult's confidence using per-repo learning data.
   * Pure function — no DB access. Caller fetches stats and passes them in.
   *
   * Gate: fewer than 5 runs for the classified intent → returns result unchanged.
   * Formula:
   *   successBias   = (successRate - 0.5) * 0.20   // -0.10 … +0.10
   *   cancelPenalty = cancelRate * 0.15              // 0 … -0.15
   *   adjusted      = clamp(base + successBias - cancelPenalty, 0.30, 0.95)
   */
  adjustWithLearning(
    result: ClassificationResult,
    stats: WorkflowStats,
    cancelStats: Array<{ workflowType: string; totalRuns: number; cancelledRuns: number }>,
  ): ClassificationResult {
    const intentType = result.intent;
    const byType = stats.byType[intentType];

    // Gate: not enough data
    if (!byType || byType.count < 5) return result;

    const runs = byType.count;
    const successRate = runs > 0 ? byType.successCount / runs : 0;

    const cancelRow = cancelStats.find((r) => r.workflowType === intentType);
    const cancelRate = cancelRow && cancelRow.totalRuns > 0
      ? cancelRow.cancelledRuns / cancelRow.totalRuns
      : 0;

    const successBias = (successRate - 0.5) * 0.20;
    const cancelPenalty = cancelRate * 0.15;
    const adjusted = Math.max(0.30, Math.min(0.95, result.confidence + successBias - cancelPenalty));

    return { ...result, confidence: adjusted };
  }

  /**
   * Generate the structured-output prefix to prepend to the system prompt
   * when LLM classification is needed (requiresLLM === true).
   * The LLM responds with a JSON block FIRST, then provides its main response.
   */
  getClassificationPromptPrefix(): string {
    return [
      'Before responding, classify this request as one of:',
      '  - bug_fix: Fix an error or bug',
      '  - feature: Add a new feature',
      '  - refactor: Restructure code',
      '  - review: Review code changes',
      '  - document: Write/update documentation',
      '  - dependency: Update dependencies',
      '  - onboard: Understand the project',
      '  - general_chat: General question not matching above',
      '',
      'Respond with a JSON block FIRST, before your main response:',
      '{"intent": "<intent>", "reasoning": "<brief explanation>"}',
      '',
      'Then provide your main response.',
    ].join('\n');
  }
}
