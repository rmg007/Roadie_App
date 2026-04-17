/**
 * Phase 2 — Performance budgets
 *
 * Measures median-of-5 wall-clock time for key operations. Results are logged
 * to the console as CI artifacts. After 2 weeks of stable baselines, budgets
 * will be promoted to blocking assertions (see plan §4 Phase 2).
 *
 * MONITOR-ONLY: Budgets defined here are currently advisory (warn, not fail).
 * Promote by changing `BLOCKING = false` to `true` after baselines are stable.
 */

import { describe, it } from 'vitest';
import { IntentClassifier } from '../classifier/intent-classifier';
import { WorkflowEngine } from '../engine/workflow-engine';
import { StepExecutor } from '../engine/step-executor';
import { LearningDatabase } from '../learning/learning-database';
import type { ProjectModel, TechStackEntry, DirectoryNode, ProjectCommand, WorkflowDefinition } from '../types';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Set to true after 2-week monitoring period to make budgets release-blocking */
const BLOCKING = true;

/** Number of samples per benchmark (median taken) */
const SAMPLES = 5;

/** Budget thresholds in milliseconds (p95 + 20% of observed baseline) */
const BUDGETS_MS = {
  classifierInference: 100,
  workflowWallTime: 5_000,
  workflowWallTime7Step: 10_000,
  workflowStats1k: 250,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function measureMs(fn: () => Promise<void> | void): Promise<number> {
  const start = performance.now();
  await fn();
  return performance.now() - start;
}

async function medianOf(samples: number, fn: () => Promise<void> | void): Promise<number> {
  const times: number[] = [];
  for (let i = 0; i < samples; i++) {
    times.push(await measureMs(fn));
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
}

function logBudget(name: string, medianMs: number, budgetMs: number): void {
  const pct = ((medianMs / budgetMs) * 100).toFixed(0);
  const status = medianMs <= budgetMs ? 'OK' : 'OVER BUDGET';
  console.log(`[perf] ${name}: ${medianMs.toFixed(1)}ms median / ${budgetMs}ms budget (${pct}%) — ${status}`);
}

function assertBudget(name: string, medianMs: number, budgetMs: number): void {
  logBudget(name, medianMs, budgetMs);
  if (BLOCKING && medianMs > budgetMs) {
    throw new Error(
      `Budget exceeded: ${name} took ${medianMs.toFixed(1)}ms (budget: ${budgetMs}ms). ` +
        'To update budgets, rerun with ROADIE_UPDATE_BUDGETS=1 and file a PR with a baseline rerun.',
    );
  }
}

// ---------------------------------------------------------------------------
// Fixture model (same as snapshot tests)
// ---------------------------------------------------------------------------

const srcFiles = (dir: string, count: number): DirectoryNode[] =>
  Array.from({ length: count }, (_, i) => ({
    path: `${dir}/file${i}.ts`,
    type: 'file' as const,
    children: [],
  }));

const TECH_STACK: TechStackEntry[] = [
  { category: 'language', name: 'TypeScript', version: '5.2.0', sourceFile: 'package.json' },
  { category: 'test_tool', name: 'Vitest', version: '0.34.0', sourceFile: 'package.json' },
];

const DIR_STRUCTURE: DirectoryNode = {
  path: '/workspace',
  type: 'directory',
  children: [
    { path: '/workspace/src', type: 'directory', role: 'source', children: srcFiles('/workspace/src', 4) },
    { path: '/workspace/test', type: 'directory', role: 'test', children: srcFiles('/workspace/test', 3) },
  ],
};

const COMMANDS: ProjectCommand[] = [{ name: 'test', command: 'npm test', sourceFile: 'package.json', type: 'test' }];

const FIXTURE_MODEL: ProjectModel = {
  getTechStack: () => TECH_STACK,
  getDirectoryStructure: () => DIR_STRUCTURE,
  getPatterns: () => [],
  getCommands: () => COMMANDS,
  getPreferences: () => ({ telemetryEnabled: false, autoCommit: false }),
  toContext: () => ({ techStack: TECH_STACK, directoryStructure: DIR_STRUCTURE, patterns: [], commands: COMMANDS, serialized: '' }),
  update: () => {},
};

// ---------------------------------------------------------------------------
// P1 — IntentClassifier inference
// ---------------------------------------------------------------------------

describe('Perf: IntentClassifier.classify()', () => {
  it('median inference time stays within budget', async () => {
    const classifier = new IntentClassifier();
    const prompts = [
      'fix the null pointer bug in auth module',
      'add a new dashboard feature for analytics',
      'how do I get started with this codebase',
    ];
    let idx = 0;

    const medianMs = await medianOf(SAMPLES, () => {
      classifier.classify(prompts[idx++ % prompts.length]);
    });

    assertBudget('IntentClassifier.classify', medianMs, BUDGETS_MS.classifierInference);
  });
});

// ---------------------------------------------------------------------------
// P2 — WorkflowEngine wall time (fake handler, 3 sequential steps)
// ---------------------------------------------------------------------------

describe('Perf: WorkflowEngine.execute() (3 steps, fake handler)', () => {
  it('median wall time stays within budget', async () => {
    const FAKE_DEFINITION: WorkflowDefinition = {
      id: 'perf-test-workflow',
      name: 'Perf Test Workflow',
      steps: [
        {
          id: 'step-1',
          name: 'Analyse',
          type: 'sequential',
          agentRole: 'planner',
          modelTier: 'free',
          toolScope: 'research',
          promptTemplate: 'Analyse {user_request}',
          timeoutMs: 30_000,
          maxRetries: 1,
        },
        {
          id: 'step-2',
          name: 'Implement',
          type: 'sequential',
          agentRole: 'fixer',
          modelTier: 'standard',
          toolScope: 'workspace',
          promptTemplate: 'Implement {user_request}',
          timeoutMs: 30_000,
          maxRetries: 1,
        },
        {
          id: 'step-3',
          name: 'Review',
          type: 'sequential',
          agentRole: 'reviewer',
          modelTier: 'free',
          toolScope: 'research',
          promptTemplate: 'Review changes for {user_request}',
          timeoutMs: 30_000,
          maxRetries: 1,
        },
      ],
    };

    const handler = async () => ({ state: 'COMPLETED' as const, output: 'ok' });
    const executor = new StepExecutor(handler);
    const engine = new WorkflowEngine(executor);

    const context = {
      userRequest: 'perf test request',
      model: FIXTURE_MODEL,
      workspaceRoot: '/tmp/perf-test',
      cancellation: { isCancelled: false, onCancelled: () => () => {} },
      progress: { report: () => {} },
    };

    const medianMs = await medianOf(SAMPLES, () => engine.execute(FAKE_DEFINITION, context));

    assertBudget('WorkflowEngine.execute (3 steps)', medianMs, BUDGETS_MS.workflowWallTime);
  });
});

// ---------------------------------------------------------------------------
// P3 — WorkflowEngine 7-step wall time (matches the longest shipped workflow)
// ---------------------------------------------------------------------------

describe('Perf: WorkflowEngine.execute() (7 steps, fake handler)', () => {
  it('median wall time stays within budget', async () => {
    const ROLES: Array<'planner' | 'fixer' | 'reviewer'> = [
      'planner', 'planner', 'fixer', 'fixer', 'fixer', 'reviewer', 'reviewer',
    ];
    const definition: WorkflowDefinition = {
      id: 'perf-test-7-step',
      name: 'Perf Test 7-step',
      steps: ROLES.map((role, i) => ({
        id: `step-${i + 1}`,
        name: `Step ${i + 1}`,
        type: 'sequential',
        agentRole: role,
        modelTier: 'free',
        toolScope: 'research',
        promptTemplate: `Step ${i + 1} for {user_request}`,
        timeoutMs: 30_000,
        maxRetries: 1,
      })),
    };

    const handler = async () => ({ state: 'COMPLETED' as const, output: 'ok' });
    const engine = new WorkflowEngine(new StepExecutor(handler));
    const context = {
      userRequest: '7-step perf request',
      model: FIXTURE_MODEL,
      workspaceRoot: '/tmp/perf-test-7',
      cancellation: { isCancelled: false, onCancelled: () => () => {} },
      progress: { report: () => {} },
    };

    const medianMs = await medianOf(SAMPLES, () => engine.execute(definition, context));
    assertBudget('WorkflowEngine.execute (7 steps)', medianMs, BUDGETS_MS.workflowWallTime7Step);
  });
});

// ---------------------------------------------------------------------------
// P4 — LearningDatabase.getWorkflowStats on 1,000 records
// ---------------------------------------------------------------------------

describe('Perf: LearningDatabase.getWorkflowStats() (1,000 records)', () => {
  it('median query time stays within budget', async () => {
    const rawDb = new DatabaseSync(':memory:');
    rawDb.exec('PRAGMA journal_mode = WAL');
    const learning = new LearningDatabase();
    learning.initialize(rawDb, { workflowHistory: true });

    const types = ['bug_fix', 'feature', 'refactor', 'review', 'document', 'dependency', 'onboard'];
    const statuses: Array<'COMPLETED' | 'PAUSED' | 'cancelled'> = ['COMPLETED', 'PAUSED', 'cancelled'];
    for (let i = 0; i < 1_000; i++) {
      learning.recordWorkflowOutcome({
        workflowType: types[i % types.length],
        prompt: `seed:${i}`,
        status: statuses[i % statuses.length],
        stepsCompleted: 3,
        stepsTotal: 5,
        durationMs: 1_000 + i,
      });
    }

    const medianMs = await medianOf(SAMPLES, () => {
      learning.getWorkflowStats();
    });
    assertBudget('LearningDatabase.getWorkflowStats (1k rows)', medianMs, BUDGETS_MS.workflowStats1k);
    learning.close();
  });
});
