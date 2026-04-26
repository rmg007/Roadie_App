/**
 * @module self-healer
 * @description Detects known fault patterns and auto-triggers remediation:
 *   retry with lower model tier, increase timeout, reduce scope, etc.
 *   Records outcomes in LearningDatabase.
 *
 * @outputs autoHeal(fault: Fault): { remediated: boolean, action: RemediationAction }
 * @depends-on types, Logger
 * @depended-on-by autonomy-loop, workflow-engine
 */

import type { Logger } from '../platform-adapters';
import { STUB_LOGGER } from '../platform-adapters';
import type { ModelTier } from '../types';

// ---- Types ----

export type FaultType = 'timeout' | 'oom' | 'network' | 'permission_denied' | 'rate_limit' | 'auth_failed' | 'unknown';

export interface Fault {
  type: FaultType;
  message: string;
  stepId: string;
  attemptNumber: number;
  currentModelTier: ModelTier;
  currentTimeout: number;
  details?: Record<string, unknown>;
}

export type RemediationActionType = 'retry_lower_tier' | 'increase_timeout' | 'reduce_scope' | 'escalate_to_human' | 'skip_step';

export interface RemediationAction {
  type: RemediationActionType;
  newTimeout?: number;
  newModelTier?: ModelTier;
  scopeReduction?: number; // percentage (0-100)
  reason: string;
  estimatedCost?: number; // token cost delta
}

export interface HealingResult {
  remediated: boolean;
  action?: RemediationAction;
  nextSteps?: string[];
}

// ---- FaultDetector ----

const FAULT_PATTERNS: Record<string, (message: string) => boolean> = {
  timeout: (msg) => /timeout|timed out|time.?out|deadline exceeded/i.test(msg),
  oom: (msg) => /out of memory|oom|memory|heap|allocation failed/i.test(msg),
  network: (msg) => /network|econnrefused|enotfound|socket|dns|connection|offline/i.test(msg),
  permission_denied: (msg) => /permission denied|eacces|eperm|unauthorized|forbidden|403/i.test(msg),
  rate_limit: (msg) => /rate.?limit|quota|too.*fast|429|throttle/i.test(msg),
  auth_failed: (msg) => /auth|unauthorized|invalid.*token|401|credentials/i.test(msg),
};

// ---- SelfHealer ----

export class SelfHealer {
  private logger: Logger = STUB_LOGGER;
  private healingAttempts: Map<string, number> = new Map(); // stepId -> attempt count
  private maxHealingAttempts = 3;

  constructor(logger?: Logger) {
    if (logger) this.logger = logger;
  }

  /**
   * Detect the fault type from error message.
   */
  private detectFaultType(message: string): FaultType {
    for (const [faultType, pattern] of Object.entries(FAULT_PATTERNS)) {
      if (pattern(message)) {
        return faultType as FaultType;
      }
    }
    return 'unknown';
  }

  /**
   * Auto-heal a fault and suggest remediation action.
   */
  autoHeal(fault: Fault): HealingResult {
    const attemptCount = (this.healingAttempts.get(fault.stepId) ?? 0) + 1;
    this.healingAttempts.set(fault.stepId, attemptCount);

    // Detect actual fault type
    const detectedType = this.detectFaultType(fault.message);
    const actualFault = { ...fault, type: detectedType };

    if (attemptCount > this.maxHealingAttempts) {
      this.logger.warn(
        `[SelfHealer] Max healing attempts (${this.maxHealingAttempts}) exceeded for step ${fault.stepId}`,
      );
      return {
        remediated: false,
        action: {
          type: 'escalate_to_human',
          reason: `Max healing attempts exceeded after ${attemptCount} tries`,
        },
      };
    }

    // Generate remediation based on fault type
    const action = this.generateRemediationAction(actualFault, attemptCount);

    this.logger.info(`[SelfHealer] Auto-healing fault (${detectedType}): ${action.type}`);

    return {
      remediated: true,
      action,
      nextSteps: this.suggestNextSteps(actualFault, action),
    };
  }

  /**
   * Generate remediation action based on fault type.
   */
  private generateRemediationAction(fault: Fault, attemptCount: number): RemediationAction {
    switch (fault.type) {
      case 'timeout':
        return {
          type: 'increase_timeout',
          newTimeout: fault.currentTimeout * 1.5,
          reason: `Timeout after ${fault.currentTimeout}ms, increasing to ${(fault.currentTimeout * 1.5).toFixed(0)}ms`,
        };

      case 'oom':
      case 'rate_limit':
        return {
          type: 'reduce_scope',
          scopeReduction: 20, // Reduce batch size by 20%
          reason: `Out of memory or rate limited, reducing scope by 20%`,
        };

      case 'network':
      case 'auth_failed':
        return {
          type: 'escalate_to_human',
          reason: `Network or authentication failure — requires manual intervention`,
        };

      case 'permission_denied':
        return {
          type: 'escalate_to_human',
          reason: `Permission denied — workspace may not be trusted`,
        };

      case 'unknown':
      default:
        // Downgrade model tier for retry
        {
          const downgradedTier = this.downgradeModelTier(fault.currentModelTier);
          if (downgradedTier !== fault.currentModelTier) {
            return {
              type: 'retry_lower_tier',
              newModelTier: downgradedTier,
              reason: `Unknown error, retrying with lower tier (${fault.currentModelTier} → ${downgradedTier})`,
            };
          }

          // If already on free tier, escalate
          return {
            type: 'escalate_to_human',
            reason: `Unknown error after ${attemptCount} attempts at lowest model tier`,
          };
        }
    }
  }

  /**
   * Downgrade model tier (premium → standard → free).
   */
  private downgradeModelTier(tier: ModelTier): ModelTier {
    switch (tier) {
      case 'premium':
        return 'standard';
      case 'standard':
        return 'free';
      case 'free':
        return 'free'; // Already at lowest
    }
  }

  /**
   * Suggest next steps for user/operator after remediation.
   */
  private suggestNextSteps(fault: Fault, action: RemediationAction): string[] {
    const steps: string[] = [];

    if (action.type === 'escalate_to_human') {
      steps.push('Review the error message above');
      steps.push('Check workspace permissions and trust settings');
      steps.push('Verify network connectivity');
      steps.push('If needed, enable workspace trust and retry');
    } else {
      steps.push(`Retrying with action: ${action.type}`);
      if (action.newModelTier) {
        steps.push(`Using model tier: ${action.newModelTier}`);
      }
      if (action.newTimeout) {
        steps.push(`Increased timeout to: ${action.newTimeout.toFixed(0)}ms`);
      }
      if (action.scopeReduction) {
        steps.push(`Reduced scope by: ${action.scopeReduction}%`);
      }
    }

    return steps;
  }

  /**
   * Reset healing attempt counter (called after successful step).
   */
  resetHealingAttempts(stepId: string): void {
    this.healingAttempts.delete(stepId);
  }

  /**
   * Get healing statistics.
   */
  getHealingStats(): { totalHealed: number; attemptedSteps: number; averageAttemptsPerStep: number } {
    const totalAttempts = Array.from(this.healingAttempts.values()).reduce((a, b) => a + b, 0);
    const attemptedSteps = this.healingAttempts.size;
    const averageAttemptsPerStep = attemptedSteps > 0 ? totalAttempts / attemptedSteps : 0;

    return {
      totalHealed: attemptedSteps,
      attemptedSteps,
      averageAttemptsPerStep,
    };
  }

  /**
   * Clear healing history.
   */
  clearHistory(): void {
    this.healingAttempts.clear();
    this.logger.info('[SelfHealer] Cleared healing history');
  }
}

export function createSelfHealer(logger?: Logger): SelfHealer {
  return new SelfHealer(logger);
}
