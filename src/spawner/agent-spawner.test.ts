import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => ({
  lm: { selectChatModels: vi.fn() },
  LanguageModelChatMessage: { User: (text: string) => ({ role: 1, content: text }) },
  CancellationTokenSource: class { token = { isCancellationRequested: false, onCancellationRequested: vi.fn() }; },
}));

import * as vscode from 'vscode';
import { AgentSpawner } from './agent-spawner';
import { ModelResolver } from '../engine/model-resolver';
import type { AgentConfig } from '../types';

const mockSelectChatModels = vi.mocked(vscode.lm.selectChatModels);

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

function makeMockModel(response = 'Fixed the bug') {
  return {
    id: 'copilot-gpt-4.1',
    sendRequest: vi.fn().mockResolvedValue({
      text: (async function* () { yield response; })(),
      stream: (async function* () { yield { value: response }; })(),
    }),
  };
}

describe('AgentSpawner', () => {
  let spawner: AgentSpawner;

  beforeEach(() => {
    mockSelectChatModels.mockReset();
    const mockModel = makeMockModel();
    mockSelectChatModels.mockResolvedValue([mockModel] as unknown as vscode.LanguageModelChat[]);
    spawner = new AgentSpawner(new ModelResolver());
  });

  it('spawns an agent and returns success result', async () => {
    const result = await spawner.spawn(makeConfig());
    expect(result.status).toBe('success');
    expect(result.output).toBe('Fixed the bug');
    expect(result.model).toBe('copilot-gpt-4.1');
  });

  it('tracks token usage (approximate from string lengths)', async () => {
    const result = await spawner.spawn(makeConfig());
    expect(result.tokenUsage.input).toBeGreaterThan(0);
    expect(result.tokenUsage.output).toBeGreaterThan(0);
  });

  it('returns failed status when model is unavailable', async () => {
    mockSelectChatModels.mockResolvedValue([]);
    const result = await spawner.spawn(makeConfig());
    expect(result.status).toBe('failed');
    expect(result.error).toBeDefined();
  });

  it('returns failed status when sendRequest throws', async () => {
    const badModel = {
      id: 'copilot-gpt-4.1',
      sendRequest: vi.fn().mockRejectedValue(new Error('LLM error')),
    };
    mockSelectChatModels.mockResolvedValue([badModel] as unknown as vscode.LanguageModelChat[]);
    spawner = new AgentSpawner(new ModelResolver());

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
    const failModel = {
      id: 'copilot-gpt-4.1',
      sendRequest: vi.fn()
        .mockResolvedValueOnce({ text: (async function* () { yield 'OK 1'; })(), stream: (async function* () {})() })
        .mockRejectedValueOnce(new Error('branch 2 failed'))
        .mockResolvedValueOnce({ text: (async function* () { yield 'OK 3'; })(), stream: (async function* () {})() }),
    };
    mockSelectChatModels.mockResolvedValue([failModel] as unknown as vscode.LanguageModelChat[]);
    spawner = new AgentSpawner(new ModelResolver());

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
