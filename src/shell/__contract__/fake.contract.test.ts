/**
 * @test fake.contract.test.ts
 * @description Validates that FakeModelProvider conforms to ModelProvider contract.
 *   This is a regression test for the v0.7.13 bug where System() was called but doesn't exist.
 *   All contract checks pass on the fake before testing real VS Code implementation.
 * @inputs FakeModelProvider
 * @outputs Contract validation results
 * @depends-on fake-providers.ts, model-provider.contract.ts
 */

import { describe, it, expect } from 'vitest';
import { FakeModelProvider } from '../fake-providers';
import { ModelProviderContract } from './model-provider.contract';

describe('FakeModelProvider Contract', () => {
  it('selectModels returns valid ModelInfo objects', async () => {
    const provider = new FakeModelProvider();
    const contract = new ModelProviderContract(provider);
    await contract.validateSelectModelsContract();
  });

  it('selectModels filtering by id, vendor, family works', async () => {
    const provider = new FakeModelProvider();
    const contract = new ModelProviderContract(provider);
    await contract.validateSelectModelsFiltering();
  });

  it('sendRequest returns well-formed ModelResponse', async () => {
    const provider = new FakeModelProvider();
    const contract = new ModelProviderContract(provider);
    const models = await provider.selectModels({});
    const response = await contract.validateSendRequestContract(models[0].id);

    expect(response).toBeDefined();
    expect(response.text).toBeTypeOf('string');
    expect(response.toolCalls).toBeInstanceOf(Array);
    expect(response.usage.inputTokens).toBeGreaterThanOrEqual(0);
    expect(response.usage.outputTokens).toBeGreaterThanOrEqual(0);
  });

  it('system message round-trip works (v0.7.13 regression)', async () => {
    const provider = new FakeModelProvider();
    const contract = new ModelProviderContract(provider);
    const models = await provider.selectModels({});
    await contract.validateSystemMessageRoundTrip(models[0].id);
  });

  it('assistant message round-trip works', async () => {
    const provider = new FakeModelProvider();
    const contract = new ModelProviderContract(provider);
    const models = await provider.selectModels({});
    await contract.validateAssistantMessageRoundTrip(models[0].id);
  });

  it('cancellation signal is respected', async () => {
    const provider = new FakeModelProvider();
    const contract = new ModelProviderContract(provider);
    const models = await provider.selectModels({});
    await contract.validateCancellationPropagation(models[0].id);
  });

  it('deterministic response for known prompts', async () => {
    const provider = new FakeModelProvider();
    const response = await provider.sendRequest(
      'fake-gpt-4',
      [{ role: 'user', content: 'What is 2+2?' }],
      {},
    );
    expect(response.text).toContain('4');
  });

  it('throws for non-existent model', async () => {
    const provider = new FakeModelProvider();
    await expect(
      provider.sendRequest('nonexistent-model', [{ role: 'user', content: 'test' }], {}),
    ).rejects.toThrow('not found');
  });
});
