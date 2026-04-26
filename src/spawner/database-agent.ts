/**
 * @module database-agent
 * @description Stub implementation of DatabaseAgent for Phase 1.
 *   Full implementation deferred to Phase 2.
 */

import type { ProgressReporter } from '../types';

export interface DatabaseAgentResult {
  schemaPrisma: string;
  typesTS: string;
}

export class DatabaseAgent {
  constructor(
    private modelProvider: unknown,
    private progress: ProgressReporter,
  ) {}

  async generate(
    _requirementsBrief: string,
    _interviewTranscript: string[],
    _conventions: unknown,
  ): Promise<DatabaseAgentResult> {
    return {
      schemaPrisma: '// Stub: database schema generation deferred to Phase 2',
      typesTS: '// Stub: database types generation deferred to Phase 2',
    };
  }
}
