import { describe, it, expect } from 'vitest';
import { IntentClassifier } from './intent-classifier';
import { CONFIDENCE_THRESHOLDS } from './intent-patterns';

const classifier = new IntentClassifier();

// =====================================================================
// Per-intent detection tests
// =====================================================================

describe('bug_fix intent', () => {
  it('detects "fix the login error"', () => {
    const r = classifier.classify('fix the login error');
    expect(r.intent).toBe('bug_fix');
    expect(r.confidence).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLDS.requiresLLMBelow);
  });

  it('detects "500 error on the profile page"', () => {
    const r = classifier.classify('500 error on the profile page');
    expect(r.intent).toBe('bug_fix');
  });

  it('detects stack trace with high confidence', () => {
    const r = classifier.classify(
      'TypeError: Cannot read property "user" of undefined at /src/auth.ts:42',
    );
    expect(r.intent).toBe('bug_fix');
    expect(r.confidence).toBe(CONFIDENCE_THRESHOLDS.primaryPlusSecondary);
  });

  it('detects "crashing on startup"', () => {
    const r = classifier.classify('App crashing on startup');
    expect(r.intent).toBe('bug_fix');
  });

  it('detects "not working"', () => {
    const r = classifier.classify('Login is not working after the deploy');
    expect(r.intent).toBe('bug_fix');
  });

  it('detects ReferenceError', () => {
    const r = classifier.classify('ReferenceError: process is not defined');
    expect(r.intent).toBe('bug_fix');
    expect(r.confidence).toBe(CONFIDENCE_THRESHOLDS.primaryPlusSecondary);
  });
});

describe('feature intent', () => {
  it('detects "add dark mode"', () => {
    const r = classifier.classify('Add dark mode to the settings page');
    expect(r.intent).toBe('feature');
  });

  it('detects "implement"', () => {
    const r = classifier.classify('Implement a password reset flow');
    expect(r.intent).toBe('feature');
  });

  it('detects "create"', () => {
    const r = classifier.classify('Create an export to CSV button');
    expect(r.intent).toBe('feature');
  });

  it('detects "build a new"', () => {
    const r = classifier.classify('Build a new admin dashboard');
    expect(r.intent).toBe('feature');
  });

  it('detects "new feature"', () => {
    const r = classifier.classify('New feature: user display names');
    expect(r.intent).toBe('feature');
  });

  it('detects "enable"', () => {
    const r = classifier.classify('Enable webhooks for billing');
    expect(r.intent).toBe('feature');
  });
});

describe('refactor intent', () => {
  it('detects "refactor"', () => {
    const r = classifier.classify('Refactor the authentication module');
    expect(r.intent).toBe('refactor');
  });

  it('detects "clean up"', () => {
    const r = classifier.classify('Clean up the controller layer');
    expect(r.intent).toBe('refactor');
  });

  it('detects "simplify"', () => {
    const r = classifier.classify('Simplify the order total calculation');
    expect(r.intent).toBe('refactor');
  });

  it('detects "extract"', () => {
    const r = classifier.classify('Extract the retry logic into a helper');
    expect(r.intent).toBe('refactor');
  });

  it('detects "restructure"', () => {
    const r = classifier.classify('Restructure the routes file');
    expect(r.intent).toBe('refactor');
  });

  it('detects quality complaint signals', () => {
    const r = classifier.classify('This code is too messy to work with');
    expect(r.intent).toBe('refactor');
  });
});

describe('review intent', () => {
  it('detects "review"', () => {
    const r = classifier.classify('Review my changes');
    expect(r.intent).toBe('review');
  });

  it('detects "audit"', () => {
    const r = classifier.classify('Audit the OrderController for security issues');
    expect(r.intent).toBe('review');
  });

  it('detects "before I push"', () => {
    const r = classifier.classify('Before I push, any issues?');
    expect(r.intent).toBe('review');
    expect(r.confidence).toBe(CONFIDENCE_THRESHOLDS.primaryPlusSecondary);
  });

  it('detects PR mention', () => {
    const r = classifier.classify("Look at my PR and tell me what's wrong");
    expect(r.intent).toBe('review');
  });

  it('detects "pull request"', () => {
    const r = classifier.classify('I want a review of my pull request');
    expect(r.intent).toBe('review');
  });
});

describe('document intent', () => {
  it('detects "document"', () => {
    const r = classifier.classify('Document the public API');
    expect(r.intent).toBe('document');
  });

  it('detects "README"', () => {
    const r = classifier.classify('Write a README for the payments package');
    expect(r.intent).toBe('document');
  });

  it('detects "JSDoc"', () => {
    const r = classifier.classify('Add JSDoc comments to the helpers');
    expect(r.intent).toBe('document');
  });

  it('detects "write documentation"', () => {
    const r = classifier.classify('Write documentation for the flow');
    expect(r.intent).toBe('document');
  });

  it('detects "API docs"', () => {
    const r = classifier.classify('Generate API docs from the spec');
    expect(r.intent).toBe('document');
  });

  it('detects "docs"', () => {
    const r = classifier.classify('Docs for the new SDK please');
    expect(r.intent).toBe('document');
  });
});

describe('dependency intent', () => {
  it('detects "upgrade"', () => {
    const r = classifier.classify('Upgrade React to version 19');
    expect(r.intent).toBe('dependency');
  });

  it('detects "migrate"', () => {
    const r = classifier.classify('Migrate from Prisma 4 to Prisma 5');
    expect(r.intent).toBe('dependency');
  });

  it('detects "dependencies"', () => {
    const r = classifier.classify('Check our dependencies for outdated packages');
    expect(r.intent).toBe('dependency');
  });

  it('detects "CVE"', () => {
    // "CVEs" (plural) doesn't match /CVE\b/ (no word boundary before 's'),
    // but "CVE-2024-1234" does — realistic CVE mention
    const r = classifier.classify('We found a CVE in our auth package');
    expect(r.intent).toBe('dependency');
  });

  it('detects "security audit"', () => {
    const r = classifier.classify('Do a security audit of our npm dependencies');
    expect(r.intent).toBe('dependency');
  });

  it('detects "outdated"', () => {
    const r = classifier.classify('Our packages are outdated');
    expect(r.intent).toBe('dependency');
  });
});

describe('onboard intent', () => {
  it('detects "new to"', () => {
    const r = classifier.classify("I'm new to this codebase");
    expect(r.intent).toBe('onboard');
  });

  it('detects "walk me through"', () => {
    const r = classifier.classify('Walk me through the architecture');
    expect(r.intent).toBe('onboard');
  });

  it('detects "where do I start"', () => {
    const r = classifier.classify('Where do I start?');
    expect(r.intent).toBe('onboard');
  });

  it('detects "onboard"', () => {
    const r = classifier.classify('Can you onboard me to this repository?');
    expect(r.intent).toBe('onboard');
  });

  it('detects "explain the project"', () => {
    const r = classifier.classify('Explain the project structure');
    expect(r.intent).toBe('onboard');
  });

  it('detects "get up to speed"', () => {
    const r = classifier.classify('I need to get up to speed');
    expect(r.intent).toBe('onboard');
  });
});

describe('general_chat fallback', () => {
  it('returns general_chat for unrecognized prompts', () => {
    const r = classifier.classify('What is the capital of France?');
    expect(r.intent).toBe('general_chat');
    expect(r.confidence).toBe(CONFIDENCE_THRESHOLDS.unknown);
    expect(r.requiresLLM).toBe(true);
  });

  it('returns general_chat for "tell me a joke"', () => {
    const r = classifier.classify('Tell me a joke');
    expect(r.intent).toBe('general_chat');
  });
});
