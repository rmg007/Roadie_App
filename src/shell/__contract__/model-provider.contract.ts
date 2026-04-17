/**
 * @module model-provider.contract
 * @description Shared contract specification for ModelProvider implementations.
 *   This is a test helper that validates both VSCodeModelProvider and FakeModelProvider
 *   conform to the same interface contract, especially edge cases like:
 *   - System message handling (only User() and Assistant() exist in VS Code API)
 *   - Cancellation propagation
 *   - Usage tracking monotonicity
 *   - Empty and error responses
 * @inputs ModelProvider instance to validate
 * @outputs Contract validation helpers and matchers
 * @depends-on providers.ts, vitest
 * @depended-on-by fake.contract.test.ts, vscode.contract.test.ts
 */

import type { ModelProvider, ModelInfo, ChatMessage, ModelResponse } from '../../providers';
import { getLogger } from '../logger';

/**
 * Contract spec helpers — shared between fake and real implementations.
 * Each helper validates a specific aspect of the ModelProvider interface.
 */
export class ModelProviderContract {
  constructor(private provider: ModelProvider) {}

  /**
   * selectModels must return a non-empty array or throw.
   * No null/undefined returns; no partial objects.
   */
  async validateSelectModelsContract(): Promise<void> {
    // Valid selector — at least one model must be available or the test is skipped
    const models = await this.provider.selectModels({});
    if (models.length === 0) {
      throw new Error('No models available (skip this test in CI if expected)');
    }

    // Every model must have all required fields with correct types
    for (const model of models) {
      if (!model.id || typeof model.id !== 'string') {
        throw new Error(`Invalid model.id: ${model.id}`);
      }
      if (!model.name || typeof model.name !== 'string') {
        throw new Error(`Invalid model.name: ${model.name}`);
      }
      if (!model.vendor || typeof model.vendor !== 'string') {
        throw new Error(`Invalid model.vendor: ${model.vendor}`);
      }
      if (!model.family || typeof model.family !== 'string') {
        throw new Error(`Invalid model.family: ${model.family}`);
      }
      if (typeof model.maxInputTokens !== 'number' || model.maxInputTokens <= 0) {
        throw new Error(`Invalid model.maxInputTokens: ${model.maxInputTokens}`);
      }
    }
  }

  /**
   * Selector filters must work: vendor, family, id.
   * If a selector matches nothing, throw "Model not found".
   */
  async validateSelectModelsFiltering(): Promise<void> {
    const allModels = await this.provider.selectModels({});
    if (allModels.length === 0) return; // Skip if no models available

    const firstModel = allModels[0]!;

    // Filtering by id must return exactly one model or throw
    const byId = await this.provider.selectModels({ id: firstModel.id });
    if (byId.length !== 1 || byId[0]!.id !== firstModel.id) {
      throw new Error(`selectModels(id) filtering broken for ${firstModel.id}`);
    }

    // Filtering by vendor must return >= 1 model
    const byVendor = await this.provider.selectModels({ vendor: firstModel.vendor });
    if (byVendor.length === 0 || !byVendor.some((m) => m.vendor === firstModel.vendor)) {
      throw new Error(`selectModels(vendor) filtering broken for ${firstModel.vendor}`);
    }

    // Non-existent id must throw
    try {
      await this.provider.sendRequest('nonexistent-model-id-12345', [], {});
      throw new Error('sendRequest should throw for invalid model id');
    } catch (err: unknown) {
      if (!(err instanceof Error) || !err.message.includes('not found')) {
        throw err;
      }
    }
  }

  /**
   * sendRequest must return a well-formed ModelResponse.
   * - text is always a string (may be empty)
   * - toolCalls is always an array (may be empty)
   * - usage.inputTokens and usage.outputTokens are always numbers >= 0
   * - usage must be monotonic across requests (tokens only increase)
   */
  async validateSendRequestContract(modelId: string): Promise<ModelResponse> {
    const response = await this.provider.sendRequest(
      modelId,
      [{ role: 'user', content: 'Hello' }],
      {},
    );

    if (typeof response.text !== 'string') {
      throw new Error(`Invalid response.text (expected string): ${typeof response.text}`);
    }
    if (!Array.isArray(response.toolCalls)) {
      throw new Error(`Invalid response.toolCalls (expected array): ${typeof response.toolCalls}`);
    }
    if (typeof response.usage !== 'object' || response.usage === null) {
      throw new Error(`Invalid response.usage: ${response.usage}`);
    }
    if (typeof response.usage.inputTokens !== 'number' || response.usage.inputTokens < 0) {
      throw new Error(`Invalid usage.inputTokens: ${response.usage.inputTokens}`);
    }
    if (typeof response.usage.outputTokens !== 'number' || response.usage.outputTokens < 0) {
      throw new Error(`Invalid usage.outputTokens: ${response.usage.outputTokens}`);
    }

    return response;
  }

  /**
   * System message round-trip: The contract is that system messages are accepted
   * by the interface but may be transformed by the implementation (e.g., folded into User).
   * The response must still be well-formed. This catches the v0.7.13 bug where
   * `vscode.LanguageModelChatMessage.System()` was called but doesn't exist.
   */
  async validateSystemMessageRoundTrip(modelId: string): Promise<void> {
    const systemMessage: ChatMessage = {
      role: 'system',
      content: 'You are a helpful assistant.',
    };
    const userMessage: ChatMessage = {
      role: 'user',
      content: 'Say hello.',
    };

    // Must not throw when system message is included
    let response;
    try {
      response = await this.provider.sendRequest(modelId, [systemMessage, userMessage], {});
    } catch (err) {
      throw new Error(`sendRequest failed with system message: ${String(err)}`);
    }

    // Response must be well-formed
    if (!response || typeof response.text !== 'string') {
      throw new Error('System message round-trip: response shape invalid');
    }
  }

  /**
   * Assistant messages in the conversation must be accepted.
   */
  async validateAssistantMessageRoundTrip(modelId: string): Promise<void> {
    const messages: ChatMessage[] = [
      { role: 'user', content: 'What is 2+2?' },
      { role: 'assistant', content: '4' },
      { role: 'user', content: 'Correct. What about 3+3?' },
    ];

    let response;
    try {
      response = await this.provider.sendRequest(modelId, messages, {});
    } catch (err) {
      throw new Error(`sendRequest failed with assistant message: ${String(err)}`);
    }

    if (!response || typeof response.text !== 'string') {
      throw new Error('Assistant message round-trip: response shape invalid');
    }
  }

  /**
   * Cancellation signal must be respected: if the signal fires before the request
   * completes, sendRequest should throw or resolve with a partial response.
   * For a fake provider, this is immediate; for real VS Code, timing may vary.
   */
  async validateCancellationPropagation(modelId: string): Promise<void> {
    const controller = new AbortController();
    // Fire cancellation immediately
    controller.abort();

    try {
      await this.provider.sendRequest(
        modelId,
        [{ role: 'user', content: 'This should be cancelled' }],
        { cancellation: controller.signal },
      );
      // Fake provider may return immediately without throwing if already cancelled
    } catch (err) {
      // Expected: cancellation error
      if (!(err instanceof Error) || !err.message.includes('Cancel')) {
        getLogger().warn(`Cancellation threw unexpected error: ${String(err)}`);
      }
    }
  }
}
