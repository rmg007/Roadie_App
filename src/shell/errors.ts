export enum RoadieErrorCode {
  DB_WRITE_FAILED = 'DB_WRITE_FAILED',
  DB_INITIALIZATION_FAILED = 'DB_INITIALIZATION_FAILED',
  FILE_READ_FAILED = 'FILE_READ_FAILED',
  FILE_WRITE_FAILED = 'FILE_WRITE_FAILED',
  ANALYSIS_FAILED = 'ANALYSIS_FAILED',
  GENERATION_FAILED = 'GENERATION_FAILED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

export class RoadieError extends Error {
  constructor(public readonly code: RoadieErrorCode, message: string, public readonly detail?: any) {
    super(`[${code}] ${message}`);
    this.name = 'RoadieError';
  }
}
