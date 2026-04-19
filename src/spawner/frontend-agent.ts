/**
 * @module frontend-agent
 * @description Stub implementation of FrontendAgent for Phase 1.
 *   Full implementation deferred to Phase 2.
 */

import type { ProgressReporter } from '../types';

export interface FrontendAgentResult {
  pagesTSX: string;
  formsTSX: string;
  useApiTS: string;
  typesTS: string;
}

export class FrontendAgent {
  constructor(
    private modelProvider: any,
    private progress: ProgressReporter,
  ) {}

  async generate(
    requirementsBrief: string,
    apiSpec: string,
    conventions: any,
  ): Promise<FrontendAgentResult> {
    return {
      pagesTSX: '// Stub: frontend pages generation deferred to Phase 2',
      formsTSX: '// Stub: frontend forms generation deferred to Phase 2',
      useApiTS: '// Stub: frontend hooks generation deferred to Phase 2',
      typesTS: '// Stub: frontend types generation deferred to Phase 2',
    };
  }
}
