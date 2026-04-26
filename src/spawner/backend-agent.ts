/**
 * @module backend-agent
 * @description Stub implementation of BackendAgent for Phase 1.
 *   Full implementation deferred to Phase 2.
 */

import type { ProgressReporter } from '../types';

export interface BackendAgentResult {
  routesTS: string;
  authTS: string;
  errorsTS: string;
}

export class BackendAgent {
  constructor(
    private modelProvider: unknown,
    private progress: ProgressReporter,
  ) {}

  async generate(
    _requirementsBrief: string,
    _apiSpec: string,
    _databaseSchema: string,
    _conventions: unknown,
  ): Promise<BackendAgentResult> {
    return {
      routesTS: '// Stub: backend routes generation deferred to Phase 2',
      authTS: '// Stub: backend auth generation deferred to Phase 2',
      errorsTS: '// Stub: backend errors generation deferred to Phase 2',
    };
  }
}
