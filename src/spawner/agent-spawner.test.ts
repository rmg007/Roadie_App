import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock vscode so the module can be imported in test environments
vi.mock('vscode', () => ({
  window: { createOutputChannel: vi.fn(() => ({ appendLine: vi.fn(), dispose: vi.fn(), show: vi.fn() })) },
}));

import { AgentSpawner } from './agent-spawner';
import type { ModelProvider, ModelInfo, ModelSelector, ModelRequestOptions, ModelResponse } from '../providers';
import type { AgentConfig } from '../types';

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    role: 'fixer',
    modelTier: 'free',
    tools: 'implementation',
    promptTemplate: 'Fix the bug',
    context: {},
    timeoutMs: 5000,
    ...overrides,
  };
}

function makeMockProvider(responseText = 'Fixed the bug'): ModelProvider {
  return {
    selectModels: vi.fn().mockResolvedValue([
      { id: 'copilot-gpt-4.1', name: 'gpt-4.1', vendor: 'openai', family: 'gpt-4', maxInputTokens: 10000 } satisfies ModelInfo,
    ]),
    sendRequest: vi.fn().mockResolvedValue({
      text: responseText,
      toolCalls: [],
      usage: { inputTokens: responseText.length, outputTokens: responseText.length },
    } satisfies ModelResponse),
  };
}

describe('AgentSpawner', () => {
  let provider: ModelProvider;
  let spawner: AgentSpawner;

  beforeEach(() => {
    provider = makeMockProvider();
    spawner = new AgentSpawner(provider);
  });

  it('spawns an agent and returns success result', async () => {
    const result = await spawner.spawn(makeConfig());
    expect(result.status).toBe('success');
    expect(result.output).toBe('Fixed the bug');
    expect(result.model).toBe('copilot-gpt-4.1');
  });

  it('tracks token usage from provider response', async () => {
    const result = await spawner.spawn(makeConfig());
    expect(result.tokenUsage.input).toBeGreaterThan(0);
    expect(result.tokenUsage.output).toBeGreaterThan(0);
  });

  it('returns failed status when model is unavailable', async () => {
    const emptyProvider: ModelProvider = {
      selectModels: vi.fn().mockResolvedValue([]),
      sendRequest: vi.fn(),
    };
    spawner = new AgentSpawner(emptyProvider);
    const result = await spawner.spawn(makeConfig());
    expect(result.status).toBe('failed');
    expect(result.error).toBeDefined();
  });

  it('returns failed status when sendRequest throws', async () => {
    const badProvider: ModelProvider = {
      selectModels: vi.fn().mockResolvedValue([
        { id: 'copilot-gpt-4.1', name: 'gpt-4.1', vendor: 'openai', family: 'gpt-4', maxInputTokens: 10000 },
      ]),
      sendRequest: vi.fn().mockRejectedValue(new Error('LLM error')),
    };
    spawner = new AgentSpawner(badProvider);

    const result = await spawner.spawn(makeConfig());
    expect(result.status).toBe('failed');
    expect(result.error).toContain('LLM error');
  });

  it('spawnParallel runs 3 agents concurrently', async () => {
    const configs = [
      makeConfig({ role: 'database_agent' }),
      makeConfig({ role: 'backend_agent' }),
      makeConfig({ role: 'frontend_agent' }),
    ];

    const results = await spawner.spawnParallel(configs);
    expect(results).toHaveLength(3);
    expect(results.every((r) => r.status === 'success')).toBe(true);
  });

  it('one failing parallel branch does not block others', async () => {
    const mixedProvider: ModelProvider = {
      selectModels: vi.fn().mockResolvedValue([
        { id: 'copilot-gpt-4.1', name: 'gpt-4.1', vendor: 'openai', family: 'gpt-4', maxInputTokens: 10000 },
      ]),
      sendRequest: vi.fn()
        .mockResolvedValueOnce({ text: 'OK 1', toolCalls: [], usage: { inputTokens: 4, outputTokens: 4 } })
        .mockRejectedValueOnce(new Error('branch 2 failed'))
        .mockResolvedValueOnce({ text: 'OK 3', toolCalls: [], usage: { inputTokens: 4, outputTokens: 4 } }),
    };
    spawner = new AgentSpawner(mixedProvider);

    const results = await spawner.spawnParallel([
      makeConfig({ role: 'database_agent' }),
      makeConfig({ role: 'backend_agent' }),
      makeConfig({ role: 'frontend_agent' }),
    ]);

    expect(results).toHaveLength(3);
    expect(results[0].status).toBe('success');
    expect(results[1].status).toBe('failed');
    expect(results[2].status).toBe('success');
  });
});
