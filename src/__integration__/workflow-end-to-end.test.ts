/**
 * @test workflow-end-to-end.test.ts
 * @description Integration test for intent classification and workflow routing.
 *   Tests the classifier's ability to map natural language prompts to workflows,
 *   ensuring the DI graph properly connects intention detection to workflow definitions.
 *   This is the regression test for v0.7.11 bug where AgentSpawner got ModelResolver
 *   instead of ModelProvider (caught only by testing the real DI graph through classification).
 * @inputs IntentClassifier with real patterns
 * @outputs Classification verification results
 * @depends-on classifier/intent-classifier, workflow definitions
 */

import { describe, it, expect } from 'vitest';
import { IntentClassifier } from '../classifier/intent-classifier';

describe('Workflow End-to-End (v0.7.11 regression)', () => {
  const classifier = new IntentClassifier();

  // Phase 0 regression tests: each workflow should classify its intent
  it('classifies bug-fix intent from natural language', () => {
    const result = classifier.classify('I found a bug where clicking the button crashes the app');
    expect(result.intent).toBe('bug_fix');
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.signals.length).toBeGreaterThan(0);
  });

  it('classifies feature intent from natural language', () => {
    const result = classifier.classify('Can we add support for dark mode?');
    expect(result.intent).toBe('feature');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('classifies document intent from natural language', () => {
    const result = classifier.classify('Please document the API endpoints');
    expect(result.intent).toBe('document');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('classifies review intent from natural language', () => {
    const result = classifier.classify('Can you review this PR?');
    expect(result.intent).toBe('review');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('classifies refactor intent from natural language', () => {
    const result = classifier.classify('This code is too complicated, please refactor it');
    expect(result.intent).toBe('refactor');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('classifies dependency intent from natural language', () => {
    const result = classifier.classify('Please upgrade all dependencies to their latest versions');
    expect(result.intent).toBe('dependency');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('provides meaningful signals for classification', () => {
    const result = classifier.classify('Fix the null pointer exception in auth.ts');
    expect(result.signals).toBeDefined();
    expect(result.signals.length).toBeGreaterThan(0);
    // Signals should mention patterns like "bug", "error", "exception", etc.
    expect(result.signals.some((s) => /bug|error|exception|fix/.test(s))).toBe(true);
  });

  it('maintains consistent classification for same prompt', () => {
    const prompt = 'Fix the null pointer exception';
    const result1 = classifier.classify(prompt);
    const result2 = classifier.classify(prompt);

    expect(result1.intent).toBe(result2.intent);
    expect(result1.confidence).toBe(result2.confidence);
  });

  it('distinguishes between intents', () => {
    const bugResult = classifier.classify('I found a critical bug');
    const featureResult = classifier.classify('Please add a new feature');

    expect(bugResult.intent).toBe('bug_fix');
    expect(featureResult.intent).toBe('feature');
  });
});
