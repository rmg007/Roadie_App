/**
 * Quick script to find all dataset entries where actual confidence
 * is outside the ±0.20 tolerance of expected.
 * Run with: npx tsx scratch/check-confidence.ts
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { IntentClassifier } from '../src/classifier/intent-classifier';

const dataset = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../test/fixtures/intent-classification/dataset.json'), 'utf8'),
) as Array<{ prompt: string; expectedIntent: string; expectedConfidence: number }>;

const classifier = new IntentClassifier();
const TOLERANCE = 0.21;
const mismatches: string[] = [];
const wrongIntent: string[] = [];

for (const row of dataset) {
  const result = classifier.classify(row.prompt);
  if (result.intent !== row.expectedIntent) {
    wrongIntent.push(`  WRONG INTENT "${row.prompt.slice(0, 50)}" → got=${result.intent}, exp=${row.expectedIntent}`);
  } else {
    const diff = Math.abs(result.confidence - row.expectedConfidence);
    if (diff > TOLERANCE) {
      mismatches.push(
        `  CONFIDENCE "${row.prompt.slice(0, 50)}" → got=${result.confidence}, exp=${row.expectedConfidence}`,
      );
    }
  }
}

console.log(`\n=== WRONG INTENT (${wrongIntent.length}) ===`);
wrongIntent.forEach((m) => console.log(m));
console.log(`\n=== CONFIDENCE MISMATCH (${mismatches.length}) ===`);
mismatches.forEach((m) => console.log(m));
console.log('\nDone.');
