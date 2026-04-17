/**
 * @module errors
 * @description Roadie error taxonomy. All errors thrown in production code
 *   (src/ excl. tests) extend RoadieError with a code, user-facing message,
 *   and optional cause.
 *
 * @usage
 *   throw new RoadieError(
 *     'DB_OPEN_FAILED',
 *     'Cannot open project database. Try: roadie.reset',
 *     cause,
 *   );
 *
 * @depends-on (none)
 * @depended-on-by shell/chat-participant.ts, engine/*, analyzer/*,
 *   generator/*, dictionary/*, model/database.ts, learning/*
 */

/**
 * Base error class for all Roadie errors.
 * Provides a machine-readable code + user-facing message.
 */
export class RoadieError extends Error {
  readonly code: string;
  readonly userMessage: string;
  override readonly cause: unknown;

  constructor(code: string, userMessage: string, cause?: unknown) {
    super(`[${code}] ${userMessage}`);
    Object.setPrototypeOf(this, RoadieError.prototype);

    this.code = code;
    this.userMessage = userMessage;
    this.cause = cause;
    this.name = 'RoadieError';
  }
}

/**
 * Error codes (A3 taxonomy):
 *
 * DB_*: Database and persistence failures
 *   - DB_OPEN_FAILED: Cannot open SQLite file
 *   - DB_QUERY_FAILED: Query or write failed
 *   - DB_CORRUPT: Corruption detected; recovery attempted
 *   - DB_MIGRATION_FAILED: Schema upgrade failed
 *
 * PROJECT_*: Project analysis failures
 *   - PROJECT_SCAN_FAILED: Directory walk or parsing failed
 *   - PROJECT_ANALYSIS_TIMEOUT: Analysis took too long
 *
 * ANALYSIS_*: Dependency/pattern analysis
 *   - ANALYSIS_FAILED: Generic analysis failure
 *
 * FILE_*: File I/O and generation
 *   - FILE_READ_FAILED: Cannot read file
 *   - FILE_WRITE_FAILED: Cannot write file
 *   - FILE_GEN_FAILED: File generation logic error
 *
 * WATCHER_*: File system watcher failures
 *   - WATCHER_ERROR: File watcher crashed
 *
 * SPAWN_*: Agent spawning / LLM integration
 *   - SPAWN_FAILED: Cannot spawn agent
 *   - SPAWN_TIMEOUT: Agent did not respond in time
 *
 * WORKFLOW_*: Workflow engine failures
 *   - WORKFLOW_VALIDATION_FAILED: Invalid workflow definition
 *   - WORKFLOW_EXECUTION_FAILED: Step execution error
 *
 * CONFIG_*: Configuration failures
 *   - CONFIG_INVALID: Invalid configuration value
 *   - CONFIG_READ_FAILED: Cannot read VS Code settings
 *
 * CLASSIFIER_*: Intent classification failures
 *   - CLASSIFIER_FAILED: Classification engine error
 *   - CLASSIFIER_TIMEOUT: Classification took too long
 *
 * CHAT_*: Chat participant failures
 *   - CHAT_HANDLER_FAILED: Chat message handler error
 *   - CHAT_CANCELLED: User cancelled the operation
 *
 * FS_*: Filesystem boundary violations (security)
 *   - FS_BOUNDARY_VIOLATION: Write outside allowed paths
 *
 * NETWORK_*: Network access (should not occur; security gate)
 *   - NETWORK_ATTEMPT: Attempted network access
 */

// ─────────────────────────────────────────────────────────────────────────────
// Database
// ─────────────────────────────────────────────────────────────────────────────

export class DbOpenError extends RoadieError {
  constructor(path: string, cause?: unknown) {
    super(
      'DB_OPEN_FAILED',
      `Cannot open project database at ${path}. Try: roadie.reset`,
      cause,
    );
  }
}

export class DbQueryError extends RoadieError {
  constructor(operation: string, cause?: unknown) {
    super(
      'DB_QUERY_FAILED',
      `Database ${operation} failed. Check the Roadie output channel.`,
      cause,
    );
  }
}

export class DbCorruptionError extends RoadieError {
  constructor(cause?: unknown) {
    super(
      'DB_CORRUPT',
      'Project database corruption detected. Backup saved; database will be reset on next activation.',
      cause,
    );
  }
}

export class DbMigrationError extends RoadieError {
  constructor(fromVersion: number, toVersion: number, cause?: unknown) {
    super(
      'DB_MIGRATION_FAILED',
      `Cannot upgrade database from v${fromVersion} to v${toVersion}. Backup saved.`,
      cause,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Project Analysis
// ─────────────────────────────────────────────────────────────────────────────

export class ProjectScanError extends RoadieError {
  constructor(root: string, cause?: unknown) {
    super(
      'PROJECT_SCAN_FAILED',
      `Cannot scan project root ${root}. Check folder permissions.`,
      cause,
    );
  }
}

export class ProjectAnalysisTimeoutError extends RoadieError {
  constructor(timeoutMs: number) {
    super(
      'PROJECT_ANALYSIS_TIMEOUT',
      `Project analysis exceeded ${timeoutMs}ms timeout. Large projects may need to exclude node_modules.`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// File I/O
// ─────────────────────────────────────────────────────────────────────────────

export class FileReadError extends RoadieError {
  constructor(path: string, cause?: unknown) {
    super(
      'FILE_READ_FAILED',
      `Cannot read ${path}. Check file permissions.`,
      cause,
    );
  }
}

export class FileWriteError extends RoadieError {
  constructor(path: string, cause?: unknown) {
    super(
      'FILE_WRITE_FAILED',
      `Cannot write to ${path}. Check directory permissions and disk space.`,
      cause,
    );
  }
}

export class FileGenError extends RoadieError {
  constructor(templateName: string, cause?: unknown) {
    super(
      'FILE_GEN_FAILED',
      `Generator failed for ${templateName}. Check the Roadie output.`,
      cause,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Watcher
// ─────────────────────────────────────────────────────────────────────────────

export class WatcherError extends RoadieError {
  constructor(cause?: unknown) {
    super(
      'WATCHER_ERROR',
      'File watcher crashed. Restart VS Code to resume watching.', cause,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent / Spawner
// ─────────────────────────────────────────────────────────────────────────────

export class SpawnError extends RoadieError {
  constructor(cause?: unknown) {
    super(
      'SPAWN_FAILED',
      'Cannot spawn AI agent. Check GitHub Copilot integration.',
      cause,
    );
  }
}

export class SpawnTimeoutError extends RoadieError {
  constructor(timeoutMs: number) {
    super(
      'SPAWN_TIMEOUT',
      `Agent did not respond within ${timeoutMs}ms. Try again.`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Workflow Engine
// ─────────────────────────────────────────────────────────────────────────────

export class WorkflowValidationError extends RoadieError {
  constructor(reason: string, cause?: unknown) {
    super(
      'WORKFLOW_VALIDATION_FAILED',
      `Invalid workflow: ${reason}`,
      cause,
    );
  }
}

export class WorkflowExecutionError extends RoadieError {
  constructor(stepId: string, cause?: unknown) {
    super(
      'WORKFLOW_EXECUTION_FAILED',
      `Workflow step '${stepId}' failed. See output for details.`,
      cause,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

export class ConfigError extends RoadieError {
  constructor(setting: string, reason: string, cause?: unknown) {
    super(
      'CONFIG_INVALID',
      `Invalid setting 'roadie.${setting}': ${reason}`,
      cause,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Classifier
// ─────────────────────────────────────────────────────────────────────────────

export class ClassifierError extends RoadieError {
  constructor(cause?: unknown) {
    super(
      'CLASSIFIER_FAILED',
      'Intent classification failed. Try asking your question in a different way.',
      cause,
    );
  }
}

export class ClassifierTimeoutError extends RoadieError {
  constructor(timeoutMs: number) {
    super(
      'CLASSIFIER_TIMEOUT',
      `Classification took longer than ${timeoutMs}ms. Try a shorter question.`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Chat Participant
// ─────────────────────────────────────────────────────────────────────────────

export class ChatHandlerError extends RoadieError {
  constructor(cause?: unknown) {
    super(
      'CHAT_HANDLER_FAILED',
      'Chat handler crashed. See output for details.',
      cause,
    );
  }
}

export class ChatCancelledError extends RoadieError {
  constructor() {
    super(
      'CHAT_CANCELLED',
      'Operation cancelled by user.',
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Security: Filesystem Boundary
// ─────────────────────────────────────────────────────────────────────────────

export class FsBoundaryViolationError extends RoadieError {
  constructor(path: string) {
    super(
      'FS_BOUNDARY_VIOLATION',
      `Attempted to write outside allowed paths: ${path}`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Security: Network (should never occur; gate H7)
// ─────────────────────────────────────────────────────────────────────────────

export class NetworkAttemptError extends RoadieError {
  constructor(url: string) {
    super(
      'NETWORK_ATTEMPT',
      `Unexpected network access attempt: ${url}`,
    );
  }
}
