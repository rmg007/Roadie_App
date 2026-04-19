/**
 * @module autonomy-loop
 * @description Main autonomy loop orchestrator.
 *   Ties together: drift-detector → dependency-watcher → failure-pattern-learner → model-selector → self-healer
 *   Runs on 30-min interval (from existing cycle).
 *   Logs all autonomy decisions.
 *
 * @inputs All 5 autonomy modules
 * @outputs Unified autonomy decisions and actions
 * @depends-on drift-detector, dependency-watcher, failure-pattern-learner, model-selector, self-healer
 * @depended-on-by container, index
 */

import type { Logger } from '../platform-adapters';
import { STUB_LOGGER } from '../platform-adapters';
import type { DriftDetectionResult } from './drift-detector';
import { createDriftDetector } from './drift-detector';
import type { DependencyWatchResult } from './dependency-watcher';
import { createDependencyWatcher } from './dependency-watcher';
import type { FailurePatternAnalysis } from './failure-pattern-learner';
import { createFailurePatternLearner } from './failure-pattern-learner';
import type { ModelSelectionResult } from './model-selector';
import { createModelSelector } from './model-selector';
import type { HealingResult } from './self-healer';
import { createSelfHealer } from './self-healer';

// ---- Types ----

export interface AutonomyLoopConfig {
  intervalMs?: number;
  projectRoot: string;
  enabled?: boolean;
}

export interface AutonomyCycle {
  cycleId: string;
  timestamp: string;
  driftDetection: DriftDetectionResult;
  dependencyWatch: DependencyWatchResult;
  failureAnalysis: FailurePatternAnalysis;
  decisions: AutonomyDecision[];
  actionsTriggered: AutonomyAction[];
}

export interface AutonomyDecision {
  type: 'drift_remediation' | 'dependency_integration' | 'model_optimization' | 'fault_prevention' | 'none';
  confidence: number;
  reasoning: string;
  requiredApproval?: boolean;
}

export interface AutonomyAction {
  type: string;
  description: string;
  estimatedCost: number; // token cost
  priority: 'critical' | 'high' | 'medium' | 'low';
}

// ---- AutonomyLoop ----

export class AutonomyLoop {
  private logger: Logger = STUB_LOGGER;
  private config: AutonomyLoopConfig;
  private driftDetector: ReturnType<typeof createDriftDetector>;
  private dependencyWatcher: ReturnType<typeof createDependencyWatcher>;
  private failurePatternLearner: ReturnType<typeof createFailurePatternLearner>;
  private modelSelector: ReturnType<typeof createModelSelector>;
  private selfHealer: ReturnType<typeof createSelfHealer>;
  private intervalHandle: NodeJS.Timeout | null = null;
  private lastCycle: AutonomyCycle | null = null;
  private cycleCount = 0;

  constructor(config: AutonomyLoopConfig, logger?: Logger) {
    this.config = config;
    if (logger) this.logger = logger;

    // Initialize all 5 autonomy modules
    this.driftDetector = createDriftDetector(config.projectRoot, logger);
    this.dependencyWatcher = createDependencyWatcher(config.projectRoot, logger);
    this.failurePatternLearner = createFailurePatternLearner(logger);
    this.modelSelector = createModelSelector(this.failurePatternLearner, logger);
    this.selfHealer = createSelfHealer(logger);

    this.logger.info(
      `[AutonomyLoop] Initialized with interval ${config.intervalMs ?? 1_800_000}ms (30min default)`,
    );
  }

  /**
   * Start the autonomy loop (runs every 30 minutes).
   */
  start(): void {
    if (this.intervalHandle) {
      this.logger.warn('[AutonomyLoop] Already running');
      return;
    }

    if (this.config.enabled === false) {
      this.logger.info('[AutonomyLoop] Disabled in config');
      return;
    }

    const intervalMs = this.config.intervalMs ?? 1_800_000; // 30 minutes default

    this.logger.info(`[AutonomyLoop] Starting autonomy loop (${intervalMs}ms interval)`);

    this.intervalHandle = setInterval(() => {
      this.runCycle().catch((err) => {
        this.logger.error('[AutonomyLoop] Cycle failed:', err);
      });
    }, intervalMs);

    // Run first cycle immediately
    this.runCycle().catch((err) => {
      this.logger.error('[AutonomyLoop] Initial cycle failed:', err);
    });
  }

  /**
   * Stop the autonomy loop.
   */
  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      this.logger.info('[AutonomyLoop] Stopped');
    }
  }

  /**
   * Execute a single autonomy cycle.
   */
  async runCycle(): Promise<AutonomyCycle> {
    this.cycleCount++;
    const cycleId = `autonomy-cycle-${this.cycleCount}`;
    const startTime = Date.now();

    this.logger.info(`[AutonomyLoop] Starting cycle ${cycleId}`);

    // 1. Drift detection
    const driftDetection = this.driftDetector.detectDrift();
    const driftMsg = `[AutonomyLoop] Drift detection: ${driftDetection.drifted ? driftDetection.changes.length + ' changes' : 'no drift'}`;
    if (driftDetection.drifted) {
      this.logger.warn(driftMsg);
    } else {
      this.logger.info(driftMsg);
    }

    // 2. Dependency watching
    const dependencyWatch = this.dependencyWatcher.watchDependencies();
    if (dependencyWatch.newDeps.length > 0) {
      this.logger.info(
        `[AutonomyLoop] Found ${dependencyWatch.newDeps.length} new deps, loaded ${dependencyWatch.newSkills.length} skills`,
      );
    }

    // 3. Failure pattern analysis
    const failureAnalysis = this.failurePatternLearner.analyzeFailurePatterns();
    if (failureAnalysis.criticalSteps.length > 0) {
      this.logger.warn(`[AutonomyLoop] Identified ${failureAnalysis.criticalSteps.length} critical failure points`);
    }

    // 4. Make autonomy decisions
    const decisions = this.makeDecisions(driftDetection, dependencyWatch, failureAnalysis);

    // 5. Generate actions
    const actionsTriggered = this.generateActions(decisions);

    const cycle: AutonomyCycle = {
      cycleId,
      timestamp: new Date().toISOString(),
      driftDetection,
      dependencyWatch,
      failureAnalysis,
      decisions,
      actionsTriggered,
    };

    this.lastCycle = cycle;

    const duration = Date.now() - startTime;
    this.logger.info(
      `[AutonomyLoop] Cycle ${cycleId} completed in ${duration}ms: ${actionsTriggered.length} actions triggered`,
    );

    return cycle;
  }

  /**
   * Make autonomy decisions based on analysis results.
   */
  private makeDecisions(
    driftDetection: DriftDetectionResult,
    dependencyWatch: DependencyWatchResult,
    failureAnalysis: FailurePatternAnalysis,
  ): AutonomyDecision[] {
    const decisions: AutonomyDecision[] = [];

    // Decision 1: Drift remediation
    if (driftDetection.drifted && driftDetection.remediationWorkflow) {
      decisions.push({
        type: 'drift_remediation',
        confidence: driftDetection.severity === 'critical' ? 0.95 : 0.8,
        reasoning: `Project drift detected (${driftDetection.severity}): ${driftDetection.remediationWorkflow}`,
        requiredApproval: driftDetection.severity === 'critical',
      });
    }

    // Decision 2: Dependency integration
    if (dependencyWatch.newDeps.length > 0 && dependencyWatch.newSkills.length > 0) {
      decisions.push({
        type: 'dependency_integration',
        confidence: 0.85,
        reasoning: `New dependencies detected: auto-loading ${dependencyWatch.newSkills.length} skills`,
        requiredApproval: false,
      });
    }

    // Decision 3: Model optimization
    if (failureAnalysis.unreliableModels.length > 0) {
      decisions.push({
        type: 'model_optimization',
        confidence: 0.75,
        reasoning: `Found ${failureAnalysis.unreliableModels.length} unreliable model tiers, recommending upgrades`,
        requiredApproval: false,
      });
    }

    // Decision 4: Fault prevention
    if (failureAnalysis.criticalSteps.length > 0) {
      decisions.push({
        type: 'fault_prevention',
        confidence: 0.8,
        reasoning: `${failureAnalysis.criticalSteps.length} steps have failure rate > 30%, enabling auto-healing`,
        requiredApproval: false,
      });
    }

    if (decisions.length === 0) {
      decisions.push({
        type: 'none',
        confidence: 1.0,
        reasoning: 'All systems nominal',
      });
    }

    return decisions;
  }

  /**
   * Generate concrete actions from decisions.
   */
  private generateActions(decisions: AutonomyDecision[]): AutonomyAction[] {
    const actions: AutonomyAction[] = [];

    for (const decision of decisions) {
      switch (decision.type) {
        case 'drift_remediation':
          actions.push({
            type: 'run_remediation_workflow',
            description: 'Run drift remediation workflow',
            estimatedCost: 50_000, // tokens
            priority: 'critical',
          });
          break;

        case 'dependency_integration':
          actions.push({
            type: 'load_skills',
            description: 'Load new dependency skills',
            estimatedCost: 10_000,
            priority: 'high',
          });
          break;

        case 'model_optimization':
          actions.push({
            type: 'upgrade_model_tiers',
            description: 'Upgrade unreliable model tiers',
            estimatedCost: 5_000,
            priority: 'medium',
          });
          break;

        case 'fault_prevention':
          actions.push({
            type: 'enable_self_healing',
            description: 'Enable auto-healing for critical steps',
            estimatedCost: 0,
            priority: 'high',
          });
          break;

        case 'none':
        default:
          break;
      }
    }

    return actions;
  }

  /**
   * Get the last completed cycle.
   */
  getLastCycle(): AutonomyCycle | null {
    return this.lastCycle;
  }

  /**
   * Get cycle statistics.
   */
  getStats(): {
    cyclesRun: number;
    lastCycleId: string | null;
    isRunning: boolean;
  } {
    return {
      cyclesRun: this.cycleCount,
      lastCycleId: this.lastCycle?.cycleId ?? null,
      isRunning: this.intervalHandle !== null,
    };
  }

  /**
   * Get individual module statistics.
   */
  getModuleStats() {
    return {
      failurePatterns: this.failurePatternLearner.analyzeFailurePatterns(),
      modelSelector: {
        trackedStepTypes: this.modelSelector.getTrackedStepTypes(),
      },
      selfHealer: this.selfHealer.getHealingStats(),
    };
  }
}

export function createAutonomyLoop(config: AutonomyLoopConfig, logger?: Logger): AutonomyLoop {
  return new AutonomyLoop(config, logger);
}
