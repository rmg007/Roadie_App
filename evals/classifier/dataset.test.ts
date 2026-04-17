/**
 * evals/classifier/dataset.test.ts — Dataset hygiene gate (C0 / C3)
 *
 * Fails CI if:
 *   - any intent has < 20 samples
 *   - any prompt is duplicated
 *   - any prompt exceeds 500 characters
 *   - any expectedIntent is not in the known set
 *   - entries that have an addedIn field are missing source or addedIn
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const DATASET_PATH = path.resolve(process.cwd(), 'evals/classifier/dataset.jsonl');

const KNOWN_INTENTS = new Set([
  'bug_fix',
  'dependency',
  'document',
  'feature',
  'general_chat',
  'onboard',
  'refactor',
  'review',
]);

const MIN_SAMPLES = 20;
const MAX_PROMPT_LENGTH = 500;

interface DatasetEntry {
  prompt: string;
  expectedIntent: string;
  source?: string;
  addedIn?: string;
  [key: string]: unknown;
}

function loadDataset(): DatasetEntry[] {
  const raw = fs.readFileSync(DATASET_PATH, 'utf8');
  return raw
    .split('\n')
    .filter(Boolean)
    .map((line, idx) => {
      try {
        return JSON.parse(line) as DatasetEntry;
      } catch {
        throw new Error(`Invalid JSON on line ${idx + 1}: ${line.substring(0, 80)}`);
      }
    });
}

let _dataset: DatasetEntry[] | undefined;
function getDataset(): DatasetEntry[] {
  _dataset ??= loadDataset();
  return _dataset;
}

describe('Dataset hygiene: intent sample counts', () => {
  it(`every intent has ≥ ${MIN_SAMPLES} samples`, () => {
    const dataset = getDataset();
    const counts = new Map<string, number>();
    for (const entry of dataset) {
      counts.set(entry.expectedIntent, (counts.get(entry.expectedIntent) ?? 0) + 1);
    }
    const below: Array<[string, number]> = [];
    for (const [intent, count] of counts.entries()) {
      if (count < MIN_SAMPLES) {
        below.push([intent, count]);
      }
    }
    if (below.length > 0) {
      const msg = below.map(([i, c]) => `${i}: ${c}/${MIN_SAMPLES}`).join(', ');
      expect.fail(`Intents below ${MIN_SAMPLES}-sample minimum: ${msg}`);
    }
  });
});

describe('Dataset hygiene: duplicate prompts', () => {
  it('no duplicate prompts', () => {
    const dataset = getDataset();
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const entry of dataset) {
      if (seen.has(entry.prompt)) {
        duplicates.push(entry.prompt);
      }
      seen.add(entry.prompt);
    }
    expect(duplicates, `Duplicate prompts found: ${duplicates.slice(0, 5).join(' | ')}`).toHaveLength(0);
  });
});

describe('Dataset hygiene: prompt length', () => {
  it(`no prompt exceeds ${MAX_PROMPT_LENGTH} characters`, () => {
    const dataset = getDataset();
    const too_long = dataset.filter((e) => e.prompt.length > MAX_PROMPT_LENGTH);
    if (too_long.length > 0) {
      const msg = too_long.map((e) => `"${e.prompt.substring(0, 60)}..." (${e.prompt.length} chars)`).join('\n');
      expect.fail(`Prompts exceeding ${MAX_PROMPT_LENGTH} chars:\n${msg}`);
    }
  });
});

describe('Dataset hygiene: known intent set', () => {
  it('every expectedIntent is in the known set', () => {
    const dataset = getDataset();
    const unknown = dataset.filter((e) => !KNOWN_INTENTS.has(e.expectedIntent));
    if (unknown.length > 0) {
      const msg = unknown.map((e) => `"${e.prompt.substring(0, 40)}" => "${e.expectedIntent}"`).join(', ');
      expect.fail(`Unknown intents found: ${msg}`);
    }
  });
});

describe('Dataset hygiene: field presence on versioned entries', () => {
  it('entries with addedIn must also have source', () => {
    const dataset = getDataset();
    const bad = dataset.filter((e) => e.addedIn !== undefined && e.source === undefined);
    if (bad.length > 0) {
      const msg = bad.map((e) => `"${e.prompt.substring(0, 40)}" (addedIn=${String(e.addedIn)})`).join(', ');
      expect.fail(`Entries with addedIn but missing source: ${msg}`);
    }
  });

  it('entries with source must also have addedIn', () => {
    const dataset = getDataset();
    const bad = dataset.filter((e) => e.source !== undefined && e.addedIn === undefined);
    if (bad.length > 0) {
      const msg = bad.map((e) => `"${e.prompt.substring(0, 40)}" (source=${String(e.source)})`).join(', ');
      expect.fail(`Entries with source but missing addedIn: ${msg}`);
    }
  });
});
