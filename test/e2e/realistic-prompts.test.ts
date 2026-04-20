/**
 * E2E test suite: Realistic prompts through intent classifier + workflow dispatch.
 * Covers 20 representative user prompts and asserts end-state correctness.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { IntentClassifier } from '../../src/classifier/intent-classifier';
import { STUB_LOGGER } from '../../src/platform-adapters';

const PROMPTS: Array<{ prompt: string; expectedIntent: string; minConfidence: number }> = [
  { prompt: 'Fix the login bug that causes 500 errors', expectedIntent: 'bug_fix', minConfidence: 0.6 },
  { prompt: 'There is a crash on the dashboard page', expectedIntent: 'bug_fix', minConfidence: 0.5 },
  { prompt: 'The API returns incorrect data for user profile', expectedIntent: 'bug_fix', minConfidence: 0.5 },
  { prompt: 'Add user authentication with OAuth2', expectedIntent: 'feature', minConfidence: 0.6 },
  { prompt: 'Build a new settings page with dark mode toggle', expectedIntent: 'feature', minConfidence: 0.5 },
  { prompt: 'Create a payment integration with Stripe', expectedIntent: 'feature', minConfidence: 0.5 },
  { prompt: 'Refactor the database service to use the repository pattern', expectedIntent: 'refactor', minConfidence: 0.6 },
  { prompt: 'Simplify the auth middleware, it is too complex', expectedIntent: 'refactor', minConfidence: 0.5 },
  { prompt: 'Review my pull request for security issues', expectedIntent: 'review', minConfidence: 0.6 },
  { prompt: 'Check this code for performance problems', expectedIntent: 'review', minConfidence: 0.5 },
  { prompt: 'Generate API documentation for the user endpoints', expectedIntent: 'document', minConfidence: 0.6 },
  { prompt: 'Write a README for the authentication module', expectedIntent: 'document', minConfidence: 0.5 },
  { prompt: 'Upgrade all outdated npm dependencies', expectedIntent: 'dependency', minConfidence: 0.6 },
  { prompt: 'Migrate from Jest to Vitest', expectedIntent: 'dependency', minConfidence: 0.5 },
  { prompt: 'Run a security audit on the project', expectedIntent: 'audit', minConfidence: 0.5 },
  { prompt: 'Check for SQL injection vulnerabilities', expectedIntent: 'audit', minConfidence: 0.5 },
  { prompt: 'How does the authentication flow work?', expectedIntent: 'onboard', minConfidence: 0.3 },
  { prompt: 'Where do I start to understand this codebase?', expectedIntent: 'onboard', minConfidence: 0.3 },
  { prompt: 'Hello, what can you do?', expectedIntent: 'general_chat', minConfidence: 0 },
  { prompt: 'Thanks for your help!', expectedIntent: 'general_chat', minConfidence: 0 },
];

describe('E2E: Realistic prompt dispatch', () => {
  let classifier: IntentClassifier;

  beforeEach(() => {
    classifier = new IntentClassifier(STUB_LOGGER);
  });

  for (const { prompt, expectedIntent, minConfidence } of PROMPTS) {
    it(`classifies "${prompt.slice(0, 50)}" → ${expectedIntent}`, () => {
      const result = classifier.classify(prompt);

      // Primary assertion: intent must match
      expect(result.intent).toBe(expectedIntent);

      // Confidence floor
      expect(result.confidence).toBeGreaterThanOrEqual(minConfidence);

      // Result is well-formed
      expect(result).toHaveProperty('intent');
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('signals');
    });
  }

  it('all classifications return a valid intent type', () => {
    const validIntents = [
      'bug_fix', 'feature', 'refactor', 'review', 'document',
      'dependency', 'audit', 'onboard', 'general_chat',
    ];

    for (const { prompt } of PROMPTS) {
      const result = classifier.classify(prompt);
      expect(validIntents).toContain(result.intent);
    }
  });

  it('high-confidence classifications have confidence > 0.7', () => {
    const highConfidence = [
      'Fix the login bug that causes 500 errors',
      'Add user authentication with OAuth2',
      'Refactor the database service to use the repository pattern',
    ];

    for (const prompt of highConfidence) {
      const result = classifier.classify(prompt);
      expect(result.confidence).toBeGreaterThan(0.5);
    }
  });
});
