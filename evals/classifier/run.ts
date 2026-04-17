#!/usr/bin/env node
/**
 * evals/classifier/run.ts — Classifier accuracy evaluation
 *
 * Loads dataset.jsonl, runs each prompt through IntentClassifier, produces
 * a confusion matrix and per-intent macro-averaged accuracy, then appends
 * one line to evals/trend.tsv.
 *
 * Exit codes:
 *   0 — macro-accuracy ≥ 80% and no intent below 60%
 *   1 — accuracy threshold not met (merge block unless overridden)
 *   2 — dataset could not be loaded or is empty
 *
 * Usage:
 *   npx ts-node evals/classifier/run.ts [--no-gate]
 *   node --import tsx/esm evals/classifier/run.ts
 *
 * --no-gate: log results but do not exit(1) on threshold failures.
 *            Use when introducing new intents or during monitoring period.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { IntentClassifier } from '../../src/classifier/intent-classifier';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DATASET_PATH = path.resolve(__dirname, 'dataset.jsonl');
const TREND_PATH = path.resolve(__dirname, '..', 'trend.tsv');
const CONFUSION_BASELINE_PATH = path.resolve(__dirname, '..', 'confusion.json');
const MACRO_THRESHOLD = 0.80;
const PER_INTENT_THRESHOLD = 0.60;
const DROP_BLOCK_THRESHOLD = 0.02; // 2pp drop blocks merge
const CONFUSION_DRIFT_THRESHOLD = 5; // absolute points

const noGate = process.argv.includes('--no-gate');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DatasetEntry {
  prompt: string;
  expectedIntent: string;
  expectedConfidence?: number;
  requiresLLM?: boolean;
}

// ---------------------------------------------------------------------------
// Load dataset
// ---------------------------------------------------------------------------

function loadDataset(): DatasetEntry[] {
  if (!fs.existsSync(DATASET_PATH)) {
    console.error(`[eval] Dataset not found: ${DATASET_PATH}`);
    process.exit(2);
  }
  const lines = fs.readFileSync(DATASET_PATH, 'utf8').split('\n').filter(Boolean);
  if (!lines.length) {
    console.error('[eval] Dataset is empty.');
    process.exit(2);
  }
  return lines.map((l, i) => {
    try {
      return JSON.parse(l) as DatasetEntry;
    } catch {
      console.error(`[eval] Invalid JSON on line ${i + 1}: ${l.substring(0, 80)}`);
      process.exit(2);
    }
  });
}

// ---------------------------------------------------------------------------
// Run evaluation
// ---------------------------------------------------------------------------

function run(): void {
  const dataset = loadDataset();
  const classifier = new IntentClassifier();

  const intents = new Set<string>();
  const correct = new Map<string, number>();
  const total = new Map<string, number>();
  const confusion: Record<string, Record<string, number>> = {};

  let totalCorrect = 0;

  for (const entry of dataset) {
    const result = classifier.classify(entry.prompt);
    const predicted = result.intent;
    const expected = entry.expectedIntent;

    intents.add(expected);
    intents.add(predicted);

    total.set(expected, (total.get(expected) ?? 0) + 1);
    if (predicted === expected) {
      correct.set(expected, (correct.get(expected) ?? 0) + 1);
      totalCorrect++;
    }

    confusion[expected] ??= {};
    confusion[expected][predicted] = (confusion[expected][predicted] ?? 0) + 1;
  }

  // Per-intent accuracy
  const perIntentAcc: Record<string, number> = {};
  for (const intent of intents) {
    const n = total.get(intent) ?? 0;
    perIntentAcc[intent] = n > 0 ? (correct.get(intent) ?? 0) / n : 0;
  }

  const macroAcc = [...intents].reduce((sum, i) => sum + (perIntentAcc[i] ?? 0), 0) / intents.size;
  const overallAcc = totalCorrect / dataset.length;

  // ---------------------------------------------------------------------------
  // Report
  // ---------------------------------------------------------------------------

  console.log('\n=== Roadie Classifier Evaluation ===\n');
  console.log(`Dataset: ${dataset.length} entries`);
  console.log(`Overall accuracy: ${(overallAcc * 100).toFixed(1)}%`);
  console.log(`Macro-averaged accuracy: ${(macroAcc * 100).toFixed(1)}% (threshold: ${(MACRO_THRESHOLD * 100).toFixed(0)}%)`);
  console.log('\nPer-intent accuracy:');

  const intentsSorted = [...intents].sort();
  for (const intent of intentsSorted) {
    const acc = perIntentAcc[intent] ?? 0;
    const n = total.get(intent) ?? 0;
    const c = correct.get(intent) ?? 0;
    const flag = acc < PER_INTENT_THRESHOLD ? ' ⚠ BELOW THRESHOLD' : '';
    console.log(`  ${intent.padEnd(16)} ${(acc * 100).toFixed(1).padStart(5)}%  (${c}/${n})${flag}`);
  }

  console.log('\nConfusion matrix (row=expected, col=predicted):');
  const header = [''.padEnd(16), ...intentsSorted.map((i) => i.substring(0, 10).padStart(12))].join('');
  console.log(header);
  for (const expected of intentsSorted) {
    const row = [expected.padEnd(16), ...intentsSorted.map((pred) => String(confusion[expected]?.[pred] ?? 0).padStart(12))].join('');
    console.log(row);
  }

  // ---------------------------------------------------------------------------
  // Confusion matrix regression check (C5)
  // ---------------------------------------------------------------------------

  if (fs.existsSync(CONFUSION_BASELINE_PATH)) {
    try {
      const baseline = JSON.parse(fs.readFileSync(CONFUSION_BASELINE_PATH, 'utf8')) as {
        matrix: Record<string, Record<string, number>>;
      };
      const drifts: string[] = [];
      for (const expected of intentsSorted) {
        for (const pred of intentsSorted) {
          const current = confusion[expected]?.[pred] ?? 0;
          const base = baseline.matrix[expected]?.[pred] ?? 0;
          const drift = Math.abs(current - base);
          if (drift > CONFUSION_DRIFT_THRESHOLD) {
            drifts.push(`${expected}→${pred}: baseline=${base}, current=${current} (drift=${drift})`);
          }
        }
      }
      if (drifts.length > 0) {
        console.warn('\n[eval] WARN: Confusion matrix drifted > 5 points vs baseline:');
        for (const d of drifts) {
          console.warn(`  ${d}`);
        }
        console.warn('[eval] Update evals/confusion.json if this regression is intentional.');
      } else {
        console.log('\n[eval] Confusion matrix within baseline tolerance.');
      }
    } catch {
      console.warn('[eval] Could not load confusion baseline — skipping drift check.');
    }
  }

  // ---------------------------------------------------------------------------
  // Trend tracking
  // ---------------------------------------------------------------------------

  const date = new Date().toISOString().split('T')[0];
  const perIntentCols = intentsSorted.map((i) => (perIntentAcc[i] ?? 0).toFixed(3)).join('\t');
  const trendLine = `${date}\t${macroAcc.toFixed(3)}\t${perIntentCols}\n`;

  const trendHeader = `date\tmacro_acc\t${intentsSorted.join('\t')}\n`;
  if (!fs.existsSync(TREND_PATH)) {
    fs.writeFileSync(TREND_PATH, trendHeader);
  }
  fs.appendFileSync(TREND_PATH, trendLine);
  console.log(`\n[eval] Trend updated: ${TREND_PATH}`);

  // ---------------------------------------------------------------------------
  // Threshold enforcement
  // ---------------------------------------------------------------------------

  const belowIntent = intentsSorted.filter((i) => (perIntentAcc[i] ?? 0) < PER_INTENT_THRESHOLD);

  if (!noGate) {
    if (macroAcc < MACRO_THRESHOLD) {
      console.error(`\n[eval] FAIL: macro-accuracy ${(macroAcc * 100).toFixed(1)}% < ${(MACRO_THRESHOLD * 100).toFixed(0)}% threshold`);
      process.exit(1);
    }
    if (belowIntent.length > 0) {
      console.error(`\n[eval] FAIL: intents below ${(PER_INTENT_THRESHOLD * 100).toFixed(0)}% threshold: ${belowIntent.join(', ')}`);
      process.exit(1);
    }
    // Check for 2pp regression vs last trend line
    const trendContent = fs.existsSync(TREND_PATH) ? fs.readFileSync(TREND_PATH, 'utf8') : '';
    const trendLines = trendContent.split('\n').filter(Boolean);
    if (trendLines.length >= 3) {
      // At least 2 data lines (header + ≥2 data rows)
      const prevLine = trendLines[trendLines.length - 2];
      const prevMacroAcc = parseFloat(prevLine.split('\t')[1]);
      if (!isNaN(prevMacroAcc) && prevMacroAcc - macroAcc > DROP_BLOCK_THRESHOLD) {
        console.error(
          `\n[eval] FAIL: macro-accuracy dropped ${((prevMacroAcc - macroAcc) * 100).toFixed(1)}pp from ${(prevMacroAcc * 100).toFixed(1)}% to ${(macroAcc * 100).toFixed(1)}%. ` +
          `Override with --no-gate and provide written justification.`,
        );
        process.exit(1);
      }
    }
    console.log('\n[eval] PASS: all thresholds met');
  } else {
    console.log('\n[eval] --no-gate: thresholds not enforced');
  }
}

run();
