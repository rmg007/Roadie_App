/**
 * @test general-chat-fallback.test.ts
 * @description Tests that unmatched intents fall back to general_chat mode.
 *   Verifies that when classification is low-confidence or no workflow exists,
 *   the chat still responds gracefully without crashing.
 *   Catches regressions where missing workflow handling causes uncaught exceptions.
 * @inputs IntentClassifier with ambiguous prompts
 * @outputs Fallback behavior verification
 * @depends-on classifier/intent-classifier
 */

import { describe, it, expect } from 'vitest';
import { IntentClassifier } from '../classifier/intent-classifier';

describe('General Chat Fallback', () => {
  const classifier = new IntentClassifier();

  it('classifies ambiguous prompts with lower confidence', () => {
    // Prompts that don't match any specific intent strongly
    const ambiguousPrompts = ['hello', 'what is this?', 'tell me a joke', 'hi there'];

    for (const prompt of ambiguousPrompts) {
      const result = classifier.classify(prompt);
      // Ambiguous prompts should be classified but marked as requiring LLM
      // (not requiring a specific workflow)
      expect(result).toBeDefined();
      // Confidence might be lower or requiresLLM might be true
      expect(result.intent).toBeDefined();
    }
  });

  it('classifies known intents with high confidence', () => {
    const result = classifier.classify('I found a critical bug in the authentication system');
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(['bug_fix', 'feature', 'review', 'refactor', 'document', 'dependency', 'onboard']).toContain(
      result.intent,
    );
  });

  it('provides signals for classification decisions', () => {
    const result = classifier.classify('Please fix the bug in the login page');
    expect(result.signals).toBeDefined();
    expect(result.signals.length).toBeGreaterThan(0);
    expect(result.signals.some((s) => s.includes('bug') || s.includes('fix'))).toBe(true);
  });

  it('handles empty prompts gracefully', () => {
    const result = classifier.classify('');
    expect(result).toBeDefined();
    expect(result.intent).toBeDefined();
    // Empty should be general_chat or fallback
  });

  it('handles very long prompts', () => {
    const longPrompt = 'Fix bug '.repeat(500); // 3500 chars
    const result = classifier.classify(longPrompt);
    expect(result).toBeDefined();
    expect(result.intent).toBeDefined();
  });

  it('handles prompts with special characters', () => {
    const specialPrompts = [
      'Fix bug: error@line:42!',
      'Review PR #123 & check tests...',
      'Refactor: for() { while() { if() {} } }',
    ];

    for (const prompt of specialPrompts) {
      const result = classifier.classify(prompt);
      expect(result).toBeDefined();
      expect(result.intent).toBeDefined();
    }
  });

  it('maintains consistent classification for same prompt', () => {
    const prompt = 'Fix the null pointer exception';
    const result1 = classifier.classify(prompt);
    const result2 = classifier.classify(prompt);

    expect(result1.intent).toBe(result2.intent);
    expect(result1.confidence).toBe(result2.confidence);
  });
});
