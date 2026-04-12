/**
 * @module agent-spawner
 * @description Creates ephemeral subagents. Accepts AgentConfig, resolves
 *   the model via ModelResolver, constructs prompt via PromptBuilder,
 *   scopes tools via ToolRegistry, sends request via vscode.lm, and
 *   returns AgentResult. Supports parallel spawning via Promise.allSettled.
 * @inputs AgentConfig
 * @outputs AgentResult
 * @depends-on model-resolver.ts, prompt-builder.ts, tool-registry.ts, vscode LM API
 * @depended-on-by step-executor.ts (via StepHandlerFn wiring)
 */

import * as vscode from 'vscode';
import type { AgentConfig, AgentResult } from '../types';
import { ModelResolver } from '../engine/model-resolver';
import { PromptBuilder } from './prompt-builder';
import { ToolRegistry } from './tool-registry';

export class AgentSpawner {
  private modelResolver: ModelResolver;
  private promptBuilder: PromptBuilder;
  private toolRegistry: ToolRegistry;

  constructor(
    modelResolver: ModelResolver,
    promptBuilder?: PromptBuilder,
    toolRegistry?: ToolRegistry,
  ) {
    this.modelResolver = modelResolver;
    this.promptBuilder = promptBuilder ?? new PromptBuilder();
    this.toolRegistry = toolRegistry ?? new ToolRegistry();
  }

  /**
   * Spawn a single subagent and return its result.
   */
  async spawn(config: AgentConfig): Promise<AgentResult> {

    try {
      // 1. Resolve model for the requested tier
      const model = await this.modelResolver.resolve(config.modelTier);

      // 2. Build the three-layer prompt
      const prompt = this.promptBuilder.build(config);

      // 3. Scope tools
      const toolNames = this.toolRegistry.getToolNames(config.tools);

      // 4. Send request via vscode LM API
      const messages = [vscode.LanguageModelChatMessage.User(prompt)];
      const response = await model.sendRequest(
        messages,
        { tools: toolNames.map((name) => ({ name })) } as vscode.LanguageModelChatRequestOptions,
        new vscode.CancellationTokenSource().token,
      );

      // 5. Collect response text from AsyncIterable<string>
      let text = '';
      for await (const chunk of response.text) {
        text += chunk;
      }

      return {
        output: text,
        toolResults: [],
        tokenUsage: { input: prompt.length, output: text.length }, // approximate
        status: 'success',
        model: model.id,
      };
    } catch (err) {
      return {
        output: '',
        toolResults: [],
        tokenUsage: { input: 0, output: 0 },
        status: err instanceof Error && err.message.includes('timed out') ? 'timeout' : 'failed',
        model: '',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Spawn multiple agents in parallel. One failing branch does not block others.
   */
  async spawnParallel(configs: AgentConfig[]): Promise<AgentResult[]> {
    const results = await Promise.allSettled(configs.map((c) => this.spawn(c)));

    return results.map((r, _i) => {
      if (r.status === 'fulfilled') return r.value;
      return {
        output: '',
        toolResults: [],
        tokenUsage: { input: 0, output: 0 },
        status: 'failed' as const,
        model: '',
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      };
    });
  }
}
