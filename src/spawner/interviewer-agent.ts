/**
 * @module interviewer-agent
 * @description Stub implementation of InterviewerAgent for Phase 1.
 *   Full implementation deferred to Phase 2.
 */

import type { ProgressReporter, WorkflowContext, ModelTier } from '../types';

export interface InterviewResult {
  transcript: string[];
  requirementsBrief: string;
  finalConfidence: number;
  totalQuestions: number;
  stoppedBy: string;
}

export class InterviewerAgent {
  constructor(
    private modelProvider: any,
    private progress: ProgressReporter,
  ) {}

  async conduct(context: WorkflowContext, modelTier: ModelTier): Promise<InterviewResult> {
    return {
      transcript: ['[Stub: interview not yet implemented]'],
      requirementsBrief: 'Interview phase deferred to Phase 2.',
      finalConfidence: 0,
      totalQuestions: 0,
      stoppedBy: 'stub',
    };
  }
}
