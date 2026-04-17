/**
 * @test vscode.contract.test.ts
 * @description Validates that VSCodeModelProvider conforms to ModelProvider contract.
 *   This test runs in two modes:
 *   1. Unit test mode (vi.mock vscode) — validates the contract even with mocked API
 *   2. E2E mode (real VS Code) — validates against real models, runs in Phase 3
 *
 *   The system message round-trip is the regression check for v0.7.13.
 * @inputs VSCodeModelProvider (mocked or real)
 * @outputs Contract validation results
 * @depends-on vscode-providers.ts, model-provider.contract.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock vscode only if not already mocked (E2E tests provide real instance)
if (!globalThis.__vscodeModelProvider__) {
  vi.mock('vscode', () => ({
    lm: {
      selectChatModels: vi.fn(async (selector: { id?: string }) => {
        if (selector.id && selector.id.includes('nonexistent')) {
          return [];
        }
        return [
          {
            id: 'test-model-1',
            name: 'Test Model 1',
            vendor: 'test',
            family: 'test-family',
            maxInputTokens: 4096,
            sendRequest: vi.fn(async () => ({
              text: (async function* () {
                yield 'Test response.';
              })(),
              usage: { inputTokens: 10, outputTokens: 5 },
            })),
          },
        ];
      }),
    },
    CancellationTokenSource: class {
      token = { isCancellationRequested: false, onCancellationRequested: vi.fn() };
      cancel = vi.fn();
    },
    LanguageModelChatMessage: {
      User: vi.fn((content: string) => ({ role: 'user', content })),
      Assistant: vi.fn((content: string) => ({ role: 'assistant', content })),
      // Intentionally no System() — catching the v0.7.13 bug
    },
  }));
}

import { VSCodeModelProvider } from '../vscode-providers';
import { ModelProviderContract } from './model-provider.contract';

describe('VSCodeModelProvider Contract', () => {
  let provider: VSCodeModelProvider;

  beforeEach(() => {
    provider = new VSCodeModelProvider();
  });

  it('selectModels returns valid ModelInfo objects', async () => {
    const contract = new ModelProviderContract(provider);
    // Skip validation if no models available (expected in unit test mode)
    try {
      await contract.validateSelectModelsContract();
    } catch (err: unknown) {
      if ((err instanceof Error) && err.message.includes('No models available')) {
        // Expected in unit tests
        return;
      }
      throw err;
    }
  });

  it('selectModels filtering works', async () => {
    const models = await provider.selectModels({});
    if (models.length === 0) {
      // Skip if no models (unit test mock)
      return;
    }

    const firstModel = models[0];
    const byId = await provider.selectModels({ id: firstModel.id });
    expect(byId).toHaveLength(1);
    expect(byId[0].id).toBe(firstModel.id);
  });

  it('sendRequest returns well-formed ModelResponse', async () => {
    const models = await provider.selectModels({});
    if (models.length === 0) {
      // Skip if no models (unit test mock)
      return;
    }

    const contract = new ModelProviderContract(provider);
    const response = await contract.validateSendRequestContract(models[0].id);

    expect(response).toBeDefined();
    expect(response.text).toBeTypeOf('string');
    expect(response.toolCalls).toBeInstanceOf(Array);
    expect(response.usage.inputTokens).toBeGreaterThanOrEqual(0);
    expect(response.usage.outputTokens).toBeGreaterThanOrEqual(0);
  });

  it('system message round-trip works (v0.7.13 regression)', async () => {
    const models = await provider.selectModels({});
    if (models.length === 0) {
      // Skip if no models (unit test mock)
      return;
    }

    const contract = new ModelProviderContract(provider);
    await contract.validateSystemMessageRoundTrip(models[0].id);
  });

  it('assistant message round-trip works', async () => {
    const models = await provider.selectModels({});
    if (models.length === 0) {
      // Skip if no models (unit test mock)
      return;
    }

    const contract = new ModelProviderContract(provider);
    await contract.validateAssistantMessageRoundTrip(models[0].id);
  });

  it('throws for non-existent model', async () => {
    await expect(
      provider.sendRequest('nonexistent-model-xyz', [{ role: 'user', content: 'test' }], {}),
    ).rejects.toThrow('not found');
  });
});
