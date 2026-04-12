import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', () => ({
  lm: {
    selectChatModels: vi.fn(),
  },
}));

import * as vscode from 'vscode';
import { ModelResolver } from './model-resolver';
import { ModelUnavailableError } from './errors';

const mockSelectChatModels = vi.mocked(vscode.lm.selectChatModels);

describe('ModelResolver', () => {
  let resolver: ModelResolver;

  beforeEach(() => {
    resolver = new ModelResolver();
    mockSelectChatModels.mockReset();
  });

  it('resolves free tier to the first matching model', async () => {
    mockSelectChatModels.mockResolvedValue([
      { id: 'copilot-gpt-4.1' },
      { id: 'copilot-gpt-5-mini' },
    ] as vscode.LanguageModelChat[]);
    const model = await resolver.resolve('free');
    expect(model.id).toBe('copilot-gpt-4.1');
  });

  it('resolves standard tier to the first available preference', async () => {
    mockSelectChatModels.mockResolvedValue([
      { id: 'copilot-gpt-5.2' },
      { id: 'copilot-gemini-2.5-pro' },
    ] as vscode.LanguageModelChat[]);
    const model = await resolver.resolve('standard');
    // claude-sonnet-4.6 is first in preference but not available; gpt-5.2 is next
    expect(model.id).toBe('copilot-gpt-5.2');
  });

  it('resolves premium tier when premium model is available', async () => {
    mockSelectChatModels.mockResolvedValue([
      { id: 'copilot-claude-opus-4.6' },
      { id: 'copilot-gpt-4.1' },
    ] as vscode.LanguageModelChat[]);
    const model = await resolver.resolve('premium');
    expect(model.id).toBe('copilot-claude-opus-4.6');
  });

  it('falls back from premium to standard to free', async () => {
    mockSelectChatModels.mockResolvedValue([
      { id: 'copilot-gpt-4.1' },
    ] as vscode.LanguageModelChat[]);
    const model = await resolver.resolve('premium');
    expect(model.id).toBe('copilot-gpt-4.1');
  });

  it('falls back from standard to free when standard unavailable', async () => {
    mockSelectChatModels.mockResolvedValue([
      { id: 'copilot-gpt-5-mini' },
    ] as vscode.LanguageModelChat[]);
    const model = await resolver.resolve('standard');
    expect(model.id).toBe('copilot-gpt-5-mini');
  });

  it('prefers earlier model in preference list when multiple available', async () => {
    mockSelectChatModels.mockResolvedValue([
      { id: 'copilot-gemini-2.5-pro' },
      { id: 'copilot-claude-sonnet-4.6' },
    ] as vscode.LanguageModelChat[]);
    const model = await resolver.resolve('standard');
    // claude-sonnet-4.6 is first in TIER_PREFERENCE.standard
    expect(model.id).toBe('copilot-claude-sonnet-4.6');
  });

  it('matches model id using includes() (substring match)', async () => {
    // VS Code prefixes model ids with 'copilot-' — resolver uses includes()
    mockSelectChatModels.mockResolvedValue([
      { id: 'some-prefix-gpt-4.1-suffix' },
    ] as vscode.LanguageModelChat[]);
    const model = await resolver.resolve('free');
    expect(model.id).toBe('some-prefix-gpt-4.1-suffix');
  });

  it('throws ModelUnavailableError when nothing matches', async () => {
    mockSelectChatModels.mockResolvedValue([]);
    await expect(resolver.resolve('free')).rejects.toBeInstanceOf(ModelUnavailableError);
  });

  it('throws ModelUnavailableError from premium with all tried models across tiers', async () => {
    mockSelectChatModels.mockResolvedValue([]);
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
    mockSelectChatModels.mockResolvedValue([]);
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
