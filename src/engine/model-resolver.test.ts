import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ModelResolver } from './model-resolver';
import { ModelUnavailableError } from './errors';
import type { ModelProvider, ModelInfo, ModelSelector, ModelRequestOptions, ModelResponse } from '../providers';

// Mock ModelProvider for testing
function makeMockProvider(models: ModelInfo[]): ModelProvider {
  return {
    selectModels: vi.fn().mockResolvedValue(models),
    sendRequest: vi.fn().mockResolvedValue({
      text: '',
      toolCalls: [],
      usage: { inputTokens: 0, outputTokens: 0 },
    } satisfies ModelResponse),
  };
}

function makeModel(id: string): ModelInfo {
  return { id, name: id, vendor: 'test', family: 'test', maxInputTokens: 10000 };
}

describe('ModelResolver', () => {
  it('resolves free tier to the first matching model', async () => {
    const provider = makeMockProvider([
      makeModel('copilot-gpt-4.1'),
      makeModel('copilot-gpt-5-mini'),
    ]);
    const resolver = new ModelResolver(provider);
    const model = await resolver.resolve('free');
    expect(model.id).toBe('copilot-gpt-4.1');
  });

  it('resolves standard tier to the first available preference', async () => {
    const provider = makeMockProvider([
      makeModel('copilot-gpt-5.2'),
      makeModel('copilot-gemini-2.5-pro'),
    ]);
    const resolver = new ModelResolver(provider);
    const model = await resolver.resolve('standard');
    // claude-sonnet-4.6 is first in preference but not available; gpt-5.2 is next
    expect(model.id).toBe('copilot-gpt-5.2');
  });

  it('resolves premium tier when premium model is available', async () => {
    const provider = makeMockProvider([
      makeModel('copilot-claude-opus-4.6'),
      makeModel('copilot-gpt-4.1'),
    ]);
    const resolver = new ModelResolver(provider);
    const model = await resolver.resolve('premium');
    expect(model.id).toBe('copilot-claude-opus-4.6');
  });

  it('falls back from premium to standard to free', async () => {
    const provider = makeMockProvider([makeModel('copilot-gpt-4.1')]);
    const resolver = new ModelResolver(provider);
    const model = await resolver.resolve('premium');
    expect(model.id).toBe('copilot-gpt-4.1');
  });

  it('falls back from standard to free when standard unavailable', async () => {
    const provider = makeMockProvider([makeModel('copilot-gpt-5-mini')]);
    const resolver = new ModelResolver(provider);
    const model = await resolver.resolve('standard');
    expect(model.id).toBe('copilot-gpt-5-mini');
  });

  it('prefers earlier model in preference list when multiple available', async () => {
    const provider = makeMockProvider([
      makeModel('copilot-gemini-2.5-pro'),
      makeModel('copilot-claude-sonnet-4.6'),
    ]);
    const resolver = new ModelResolver(provider);
    const model = await resolver.resolve('standard');
    // claude-sonnet-4.6 is first in TIER_PREFERENCE.standard
    expect(model.id).toBe('copilot-claude-sonnet-4.6');
  });

  it('matches model id using includes() (substring match)', async () => {
    const provider = makeMockProvider([makeModel('some-prefix-gpt-4.1-suffix')]);
    const resolver = new ModelResolver(provider);
    const model = await resolver.resolve('free');
    expect(model.id).toBe('some-prefix-gpt-4.1-suffix');
  });

  it('throws ModelUnavailableError when nothing matches', async () => {
    const provider = makeMockProvider([]);
    const resolver = new ModelResolver(provider);
    await expect(resolver.resolve('free')).rejects.toBeInstanceOf(ModelUnavailableError);
  });

  it('throws ModelUnavailableError from premium with all tried models across tiers', async () => {
    const provider = makeMockProvider([]);
    const resolver = new ModelResolver(provider);
    try {
      await resolver.resolve('premium');
      throw new Error('expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ModelUnavailableError);
      const mue = err as ModelUnavailableError;
      expect(mue.triedModels).toEqual(expect.arrayContaining([
        'claude-opus-4.6',
        'claude-sonnet-4.6',
        'gpt-5.2',
        'gemini-2.5-pro',
        'gpt-4.1',
        'gpt-5-mini',
      ]));
    }
  });

  it('error has correct code and category', async () => {
    const provider = makeMockProvider([]);
    const resolver = new ModelResolver(provider);
    try {
      await resolver.resolve('free');
      throw new Error('expected to throw');
    } catch (err) {
      const mue = err as ModelUnavailableError;
      expect(mue.code).toBe('MODEL_UNAVAILABLE');
      expect(mue.category).toBe('external');
      expect(mue.userFacing).toBe(true);
      expect(mue.requestedTier).toBe('free');
    }
  });
});
