/**
 * @module autonomy
 * @description Phase 4 Autonomy Loop — Complete autonomous operation suite
 *
 * Exports:
 * - DriftDetector: Detects project changes
 * - DependencyWatcher: Watches and auto-integrates new dependencies
 * - FailurePatternLearner: Learns from workflow failures
 * - ModelSelector: Adapts model selection based on history
 * - SelfHealer: Auto-remediates known fault patterns
 * - AutonomyLoop: Main orchestrator (runs on 30-min interval)
 */

export {
  DriftDetector,
  createDriftDetector,
  type FileChange,
  type DependencyChange,
  type Change,
  type ProjectSnapshot,
  type DriftDetectionResult,
} from './drift-detector';

export {
  DependencyWatcher,
  createDependencyWatcher,
  type Dep,
  type Skill,
  type DependencyWatchResult,
} from './dependency-watcher';

export {
  FailurePatternLearner,
  createFailurePatternLearner,
  type FailurePattern,
  type ModelSuccessMetrics,
  type FailurePatternAnalysis,
} from './failure-pattern-learner';

export {
  ModelSelector,
  createModelSelector,
  type StepTypeMetrics,
  type ModelSelectionContext,
  type ModelSelectionResult,
} from './model-selector';

export {
  SelfHealer,
  createSelfHealer,
  type FaultType,
  type Fault,
  type RemediationActionType,
  type RemediationAction,
  type HealingResult,
} from './self-healer';

export {
  AutonomyLoop,
  createAutonomyLoop,
  type AutonomyLoopConfig,
  type AutonomyCycle,
  type AutonomyDecision,
  type AutonomyAction,
} from './autonomy-loop';
