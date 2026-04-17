/**
 * Phase 5 — Classifier evaluation (Vitest integration)
 *
 * Runs the intent classifier against the labelled dataset and reports
 * macro-averaged accuracy and per-intent accuracy.
 *
 * BLOCKING (v0.9.1+): Classifier pattern expansion in v0.9.1 raised macro-acc
 * to ~96% with every intent well above the 60% per-intent floor. The gate is
 * now enforced by default; regressions fail CI. The ROADIE_GATE_CLASSIFIER_EVAL
 * env var has been removed as a gate.
 *
 * The standalone runner (evals/classifier/run.ts) additionally writes
 * evals/trend.tsv and produces a confusion matrix for the weekly CI job.
 *
 * Dataset: evals/classifier/dataset.jsonl (211 entries as of v0.9.0)
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { IntentClassifier } from '../classifier/intent-classifier';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MACRO_THRESHOLD = 0.80;
/** Intents with ≥ 20 dataset samples must meet the high threshold */
const PER_INTENT_THRESHOLD_HI = 0.80;
/** Intents with < 20 dataset samples use the lower threshold */
const PER_INTENT_THRESHOLD_LO = 0.70;
const BLOCKING = true;
const DATASET_PATH = path.resolve(process.cwd(), 'evals/classifier/dataset.jsonl');

function expectAtLeast(label: string, actual: number, threshold: number): void {
  if (BLOCKING) {
    expect(actual, label).toBeGreaterThanOrEqual(threshold);
  } else if (actual < threshold) {
    console.warn(
      `[eval] ${label}: ${(actual * 100).toFixed(1)}% < ${(threshold * 100).toFixed(0)}% — ` +
      'BELOW THRESHOLD (monitor-only; set ROADIE_GATE_CLASSIFIER_EVAL=1 to enforce)'
    );
  }
}

// ---------------------------------------------------------------------------
// Load dataset
// ---------------------------------------------------------------------------

interface DatasetEntry {
  prompt: string;
  expectedIntent: string;
}

function loadDataset(): DatasetEntry[] {
  const raw = fs.readFileSync(DATASET_PATH, 'utf8');
  return raw
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as DatasetEntry);
}

// ---------------------------------------------------------------------------
// Run classifier on dataset
// ---------------------------------------------------------------------------

function evaluate(): {
  macroAcc: number;
  perIntentAcc: Record<string, number>;
  totalCorrect: number;
  total: number;
} {
  const dataset = loadDataset();
  const classifier = new IntentClassifier();
  const correct = new Map<string, number>();
  const totals = new Map<string, number>();
  let totalCorrect = 0;

  for (const entry of dataset) {
    const result = classifier.classify(entry.prompt);
    totals.set(entry.expectedIntent, (totals.get(entry.expectedIntent) ?? 0) + 1);
    if (result.intent === entry.expectedIntent) {
      correct.set(entry.expectedIntent, (correct.get(entry.expectedIntent) ?? 0) + 1);
      totalCorrect++;
    }
  }

  const intents = [...totals.keys()];
  const perIntentAcc: Record<string, number> = {};
  for (const intent of intents) {
    perIntentAcc[intent] = (correct.get(intent) ?? 0) / (totals.get(intent) ?? 1);
  }
  const macroAcc = intents.reduce((sum, i) => sum + perIntentAcc[i], 0) / intents.length;

  return { macroAcc, perIntentAcc, totalCorrect, total: dataset.length };
}

// Cache evaluation result — run once per test file
let _result: ReturnType<typeof evaluate> | undefined;
function getResult() {
  _result ??= evaluate();
  return _result;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Classifier eval: macro-accuracy', () => {
  it(`macro-averaged accuracy is ≥ ${(MACRO_THRESHOLD * 100).toFixed(0)}%`, () => {
    const { macroAcc, totalCorrect, total } = getResult();
    console.log(`[eval] macro-acc: ${(macroAcc * 100).toFixed(1)}% (${totalCorrect}/${total} correct)`);
    expectAtLeast('macro-acc', macroAcc, MACRO_THRESHOLD);
  });
});

describe('Classifier eval: per-intent accuracy', () => {
  // Load dataset at module level to derive intent list and sample counts for test generation
  const dataset = fs.existsSync(DATASET_PATH)
    ? fs
        .readFileSync(DATASET_PATH, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as DatasetEntry)
    : [];

  const intentSet = new Set(dataset.map((e) => e.expectedIntent));

  // Count samples per intent to select the correct threshold
  const sampleCounts = new Map<string, number>();
  for (const entry of dataset) {
    sampleCounts.set(entry.expectedIntent, (sampleCounts.get(entry.expectedIntent) ?? 0) + 1);
  }

  for (const intent of intentSet) {
    const sampleCount = sampleCounts.get(intent) ?? 0;
    const threshold = sampleCount >= 20 ? PER_INTENT_THRESHOLD_HI : PER_INTENT_THRESHOLD_LO;
    it(`${intent}: accuracy ≥ ${(threshold * 100).toFixed(0)}% (${sampleCount} samples)`, () => {
      const { perIntentAcc } = getResult();
      const acc = perIntentAcc[intent] ?? 0;
      console.log(`[eval] ${intent}: ${(acc * 100).toFixed(1)}% (threshold=${(threshold * 100).toFixed(0)}%, n=${sampleCount})`);
      expectAtLeast(intent, acc, threshold);
    });
  }
});
