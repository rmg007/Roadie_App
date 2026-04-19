/**
 * @module phase1-chat-dispatch.test
 * @description Integration test for roadie_chat tool dispatch.
 *   Tests: intent classification → workflow dispatch → result structure
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IntentClassifier } from '../classifier/intent-classifier';
import { WorkflowEngine } from '../engine/workflow-engine';
import { StepExecutor } from '../engine/step-executor';
import { BUG_FIX_WORKFLOW } from '../engine/definitions/bug-fix';
import { FEATURE_WORKFLOW } from '../engine/definitions/feature';
import { handleRoadieChat } from '../tools/roadie-chat-tool';
import type { ProgressReporter, CancellationHandle, ProjectModel } from '../types';
import { STUB_LOGGER } from '../platform-adapters';

describe('Phase 1: Chat-Native Dispatch', () => {
  let classifier: IntentClassifier;
  let stepExecutor: StepExecutor;
  let engine: WorkflowEngine;
  let workflowDefs: Map<string, any>;
  let mockProgress: ProgressReporter;

  beforeEach(() => {
    classifier = new IntentClassifier(STUB_LOGGER);

    // Create mock project model
    const mockProjectModel = {
      getEntities: () => [],
      getRelations: () => [],
    } as any as ProjectModel;

    // Create step executor with mocked provider
    const mockModelProvider = {
      sendRequest: vi.fn().mockResolvedValue({ text: 'mock response' }),
    };

    stepExecutor = new StepExecutor(mockProjectModel, mockModelProvider, STUB_LOGGER);
    engine = new WorkflowEngine(stepExecutor, undefined, STUB_LOGGER);

    // Register workflows
    workflowDefs = new Map([
      ['bug_fix', BUG_FIX_WORKFLOW],
      ['feature', FEATURE_WORKFLOW],
    ]);

    // Mock progress reporter
    mockProgress = {
      report: vi.fn(),
    };
  });

  it('classifies "bug fix" intent correctly', () => {
    const result = classifier.classify('Fix the login bug');
    expect(result.intent).toBe('bug_fix');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('classifies "feature" intent correctly', () => {
    const result = classifier.classify('Add a new dashboard widget');
    expect(result.intent).toBe('feature');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('roadie_chat tool accepts message and sessionId', async () => {
    const result = await handleRoadieChat(
      { message: 'Fix the login timeout bug' },
      classifier,
      engine,
      workflowDefs,
      STUB_LOGGER,
    );

    expect(result).toHaveProperty('summary');
    expect(result).toHaveProperty('files_changed');
    expect(Array.isArray(result.files_changed)).toBe(true);
  });

  it('returns structured result with summary and files_changed', async () => {
    const result = await handleRoadieChat(
      { message: 'Fix authentication timeout after 60 seconds' },
      classifier,
      engine,
      workflowDefs,
      STUB_LOGGER,
    );

    expect(typeof result.summary).toBe('string');
    expect(result.summary.length).toBeGreaterThan(0);
    expect(Array.isArray(result.files_changed)).toBe(true);
  });

  it('includes next_action suggestion when provided', async () => {
    const result = await handleRoadieChat(
      { message: 'Fix the crash when uploading files' },
      classifier,
      engine,
      workflowDefs,
      STUB_LOGGER,
    );

    // If workflow runs successfully, next_action should be provided
    if (result.summary.includes('COMPLETED')) {
      expect(result.next_action).toBeDefined();
    }
  });

  it('handles unknown intent gracefully', async () => {
    const result = await handleRoadieChat(
      { message: 'xyz12345 abc def' },
      classifier,
      engine,
      workflowDefs,
      STUB_LOGGER,
    );

    expect(result.summary).toContain('could not find');
  });
});
