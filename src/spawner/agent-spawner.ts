/**
 * @module agent-spawner
 * @description Creates ephemeral subagents. Accepts AgentConfig, resolves
 *   the model via ModelResolver, constructs prompt via PromptBuilder,
 *   scopes tools via ToolRegistry, sends request via ModelProvider, and
 *   returns AgentResult. Supports parallel spawning via Promise.allSettled.
 * @inputs AgentConfig
 * @outputs AgentResult
 * @depends-on model-resolver.ts, prompt-builder.ts, tool-registry.ts,
 *   providers.ts, shell/logger.ts
 * @depended-on-by step-executor.ts (via StepHandlerFn wiring)
 */

import type { AgentConfig, AgentResult } from '../types';
import type { ModelProvider } from '../providers';
import { ModelResolver } from '../engine/model-resolver';
import { PromptBuilder } from './prompt-builder';
import { ToolRegistry } from './tool-registry';
import { getLogger } from '../shell/logger';

export class AgentSpawner {
  private modelProvider: ModelProvider;
  private modelResolver: ModelResolver;
  private promptBuilder: PromptBuilder;
  private toolRegistry: ToolRegistry;

  constructor(
    modelProvider: ModelProvider,
    promptBuilder?: PromptBuilder,
    toolRegistry?: ToolRegistry,
  ) {
    this.modelProvider = modelProvider;
    this.modelResolver = new ModelResolver(modelProvider);
    this.promptBuilder = promptBuilder ?? new PromptBuilder();
    this.toolRegistry  = toolRegistry  ?? new ToolRegistry();
  }

  /**
   * Spawn a single subagent and return its result.
   */
  async spawn(config: AgentConfig): Promise<AgentResult> {
    const log = getLogger();

    log.debug(`[${config.role}] Resolving model for tier: ${config.modelTier}`);

    try {
      // 1. Resolve model for the requested tier
      const modelInfo = await this.modelResolver.resolve(config.modelTier);
      log.info(`[${config.role}] Model resolved: ${modelInfo.id}`);

      // 2. Build the three-layer prompt messages
      const messages = this.promptBuilder.buildMessages(config);
      log.debug(`[${config.role}] Prompt built (${messages.map((m) => m.content.length).reduce((sum, len) => sum + len, 0)} chars)`);

      // 3. Scope tools
      const toolNames = this.toolRegistry.getToolNames(config.tools);
      log.debug(`[${config.role}] Tools scoped: [${toolNames.join(', ')}]`);

      // 4. Send request via ModelProvider
      log.info(`[${config.role}] Sending request (tools: ${config.tools})`);
      const response = await this.modelProvider.sendRequest(
        modelInfo.id,
        messages,
        {
          tools: toolNames.map((name) => ({
            name,
            description: name,
            inputSchema: {},
          })),
          ...(config.cancellation !== undefined ? { cancellation: config.cancellation } : {}),
        },
      );

      log.info(`[${config.role}] Response received (${response.text.length} chars)`);

      return {
        output:      response.text,
        toolResults: [],
        tokenUsage:  { input: response.usage.inputTokens, output: response.usage.outputTokens },
        status:      'success',
        model:       modelInfo.id,
      };
    } catch (err) {
      const isTimeout = err instanceof Error && err.message.includes('timed out');
      const status: AgentResult['status'] = isTimeout ? 'timeout' : 'failed';
      const errMsg = err instanceof Error ? err.message : String(err);

      log.error(`[${config.role}] ${isTimeout ? 'Timed out' : 'Failed'}: ${errMsg}`);

      return {
        output:      '',
        toolResults: [],
        tokenUsage:  { input: 0, output: 0 },
        status,
        model:       '',
        error:       errMsg,
      };
    }
  }

  /**
   * Spawn multiple agents in parallel. One failing branch does not block others.
   */
  async spawnParallel(configs: AgentConfig[]): Promise<AgentResult[]> {
    const log = getLogger();
    log.info(`Spawning ${configs.length} agents in parallel: [${configs.map((c) => c.role).join(', ')}]`);

    const results = await Promise.allSettled(configs.map((c) => this.spawn(c)));

    const mapped = results.map((r, i) => {
      if (r.status === 'fulfilled') return r.value;
      const errMsg = r.reason instanceof Error ? r.reason.message : String(r.reason);
      log.warn(`Parallel spawn [${configs[i]?.role ?? i}] rejected: ${errMsg}`);
      return {
        output:      '',
        toolResults: [],
        tokenUsage:  { input: 0, output: 0 },
        status:      'failed' as const,
        model:       '',
        error:       errMsg,
      };
    });

    const succeeded = mapped.filter((r) => r.status === 'success').length;
    log.info(`Parallel spawn complete: ${succeeded}/${configs.length} succeeded`);

    return mapped;
  }
}
