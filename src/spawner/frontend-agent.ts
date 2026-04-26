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
    private modelProvider: unknown,
    private progress: ProgressReporter,
  ) {}

  async generate(
    _requirementsBrief: string,
    _apiSpec: string,
    _conventions: unknown,
  ): Promise<FrontendAgentResult> {
    return {
      pagesTSX: '// Stub: frontend pages generation deferred to Phase 2',
      formsTSX: '// Stub: frontend forms generation deferred to Phase 2',
      useApiTS: '// Stub: frontend hooks generation deferred to Phase 2',
      typesTS: '// Stub: frontend types generation deferred to Phase 2',
    };
  }
}
