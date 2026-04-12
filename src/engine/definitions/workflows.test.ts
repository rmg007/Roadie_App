import { describe, it, expect, vi } from 'vitest';
import { FEATURE_WORKFLOW } from './feature';
import { REFACTOR_WORKFLOW } from './refactor';
import { REVIEW_WORKFLOW } from './review';
import { DOCUMENT_WORKFLOW } from './document';
import { DEPENDENCY_WORKFLOW } from './dependency';
import { ONBOARD_WORKFLOW } from './onboard';
import { BUG_FIX_WORKFLOW } from './bug-fix';
import { WorkflowEngine } from '../workflow-engine';
import { StepExecutor, type StepHandlerFn } from '../step-executor';
import { WorkflowState } from '../../types';
import type { WorkflowDefinition, WorkflowContext, WorkflowStep, StepResult } from '../../types';

// ---- Helpers ----

function makeContext(): WorkflowContext {
  return {
    prompt: 'test prompt',
    intent: { intent: 'general_chat', confidence: 0.9, signals: [], requiresLLM: false },
    projectModel: {} as WorkflowContext['projectModel'],
    chatResponseStream: {
      progress: vi.fn(),
      markdown: vi.fn(),
      button: vi.fn(),
      push: vi.fn(),
    } as unknown as WorkflowContext['chatResponseStream'],
    cancellationToken: {
      isCancellationRequested: false,
      onCancellationRequested: vi.fn(),
    } as unknown as WorkflowContext['cancellationToken'],
  };
}

function successHandler(): StepHandlerFn {
  return vi.fn().mockImplementation(
    (step: WorkflowStep) => Promise.resolve({
      stepId: step.id,
      status: 'success' as const,
      output: `Output from ${step.id}`,
      tokenUsage: { input: 100, output: 50 },
      attempts: 1,
      modelUsed: 'gpt-4.1',
    }),
  );
}

async function executeWorkflow(def: WorkflowDefinition): Promise<{ state: WorkflowState; stepCount: number }> {
  const engine = new WorkflowEngine(new StepExecutor(successHandler()));
  const result = await engine.execute(def, makeContext());
  return { state: result.state, stepCount: result.stepResults.length };
}

// ---- Structure validation for all 7 workflows ----

const ALL_WORKFLOWS: [string, WorkflowDefinition][] = [
  ['Bug Fix', BUG_FIX_WORKFLOW],
  ['Feature', FEATURE_WORKFLOW],
  ['Refactor', REFACTOR_WORKFLOW],
  ['Review', REVIEW_WORKFLOW],
  ['Document', DOCUMENT_WORKFLOW],
  ['Dependency', DEPENDENCY_WORKFLOW],
  ['Onboard', ONBOARD_WORKFLOW],
];

describe('All Workflow Definitions — structure', () => {
  it.each(ALL_WORKFLOWS)('%s has a non-empty id', (_name, wf) => {
    expect(wf.id.length).toBeGreaterThan(0);
  });

  it.each(ALL_WORKFLOWS)('%s has a non-empty name', (_name, wf) => {
    expect(wf.name.length).toBeGreaterThan(0);
  });

  it.each(ALL_WORKFLOWS)('%s has at least 1 step', (_name, wf) => {
    expect(wf.steps.length).toBeGreaterThanOrEqual(1);
  });

  it.each(ALL_WORKFLOWS)('%s steps all have prompt templates', (_name, wf) => {
    for (const step of wf.steps) {
      expect(step.promptTemplate.length, `Step ${step.id} missing template`).toBeGreaterThan(0);
    }
  });

  it.each(ALL_WORKFLOWS)('%s steps all have unique ids', (_name, wf) => {
    const ids = wf.steps.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ---- Per-workflow specific tests ----

describe('Feature Workflow', () => {
  it('has 7 steps', () => {
    expect(FEATURE_WORKFLOW.steps).toHaveLength(7);
  });

  it('step 3 is parallel with 3 branches (DB, backend, frontend)', () => {
    const s = FEATURE_WORKFLOW.steps[2];
    expect(s.type).toBe('parallel');
    expect(s.branches).toHaveLength(3);
    expect(s.branches![0].agentRole).toBe('database_agent');
    expect(s.branches![1].agentRole).toBe('backend_agent');
    expect(s.branches![2].agentRole).toBe('frontend_agent');
  });

  it('step 6 (quality review) uses standard tier', () => {
    expect(FEATURE_WORKFLOW.steps[5].modelTier).toBe('standard');
  });

  it('completes all steps with mock handler', async () => {
    const { state, stepCount } = await executeWorkflow(FEATURE_WORKFLOW);
    expect(state).toBe(WorkflowState.COMPLETED);
    expect(stepCount).toBe(7);
  });
});

describe('Refactor Workflow', () => {
  it('has 5 steps', () => {
    expect(REFACTOR_WORKFLOW.steps).toHaveLength(5);
  });

  it('step 2 (characterization tests) uses standard tier', () => {
    expect(REFACTOR_WORKFLOW.steps[1].modelTier).toBe('standard');
  });

  it('step 3 (refactor) has maxRetries=3', () => {
    expect(REFACTOR_WORKFLOW.steps[2].maxRetries).toBe(3);
  });

  it('completes all steps with mock handler', async () => {
    const { state, stepCount } = await executeWorkflow(REFACTOR_WORKFLOW);
    expect(state).toBe(WorkflowState.COMPLETED);
    expect(stepCount).toBe(5);
  });
});

describe('Review Workflow', () => {
  it('has 2 top-level steps (parallel review + consolidation)', () => {
    expect(REVIEW_WORKFLOW.steps).toHaveLength(2);
  });

  it('step 1 is parallel with 5 branches', () => {
    const s = REVIEW_WORKFLOW.steps[0];
    expect(s.type).toBe('parallel');
    expect(s.branches).toHaveLength(5);
  });

  it('security review uses standard tier', () => {
    const security = REVIEW_WORKFLOW.steps[0].branches![0];
    expect(security.agentRole).toBe('security_reviewer');
    expect(security.modelTier).toBe('standard');
  });

  it('other passes use free tier', () => {
    const branches = REVIEW_WORKFLOW.steps[0].branches!.slice(1);
    expect(branches.every((b) => b.modelTier === 'free')).toBe(true);
  });

  it('completes with mock handler', async () => {
    const { state, stepCount } = await executeWorkflow(REVIEW_WORKFLOW);
    expect(state).toBe(WorkflowState.COMPLETED);
    expect(stepCount).toBe(2);
  });
});

describe('Document Workflow', () => {
  it('has 4 steps', () => {
    expect(DOCUMENT_WORKFLOW.steps).toHaveLength(4);
  });

  it('all steps use free tier (documentation is low-cost)', () => {
    expect(DOCUMENT_WORKFLOW.steps.every((s) => s.modelTier === 'free')).toBe(true);
  });

  it('step 3 uses documentation toolScope', () => {
    expect(DOCUMENT_WORKFLOW.steps[2].toolScope).toBe('documentation');
  });

  it('completes with mock handler', async () => {
    const { state, stepCount } = await executeWorkflow(DOCUMENT_WORKFLOW);
    expect(state).toBe(WorkflowState.COMPLETED);
    expect(stepCount).toBe(4);
  });
});

describe('Dependency Workflow', () => {
  it('has 5 steps', () => {
    expect(DEPENDENCY_WORKFLOW.steps).toHaveLength(5);
  });

  it('step 2 (identify targets) uses standard tier for breaking change reasoning', () => {
    expect(DEPENDENCY_WORKFLOW.steps[1].modelTier).toBe('standard');
  });

  it('step 4 (verify) has 300s timeout', () => {
    expect(DEPENDENCY_WORKFLOW.steps[3].timeoutMs).toBe(300_000);
  });

  it('completes with mock handler', async () => {
    const { state, stepCount } = await executeWorkflow(DEPENDENCY_WORKFLOW);
    expect(state).toBe(WorkflowState.COMPLETED);
    expect(stepCount).toBe(5);
  });
});

describe('Onboard Workflow', () => {
  it('has 4 steps', () => {
    expect(ONBOARD_WORKFLOW.steps).toHaveLength(4);
  });

  it('all steps use free tier (onboarding is low-cost)', () => {
    expect(ONBOARD_WORKFLOW.steps.every((s) => s.modelTier === 'free')).toBe(true);
  });

  it('step 2 uses documentarian role', () => {
    expect(ONBOARD_WORKFLOW.steps[1].agentRole).toBe('documentarian');
  });

  it('completes with mock handler', async () => {
    const { state, stepCount } = await executeWorkflow(ONBOARD_WORKFLOW);
    expect(state).toBe(WorkflowState.COMPLETED);
    expect(stepCount).toBe(4);
  });
});
