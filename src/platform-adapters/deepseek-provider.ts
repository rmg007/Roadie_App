import { ModelProvider, ChatMessage, ModelRequestOptions, ModelResponse, ModelInfo, ModelSelector } from '../providers';

export class DeepSeekProvider implements ModelProvider {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://api.deepseek.com/v1';

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async selectModels(selector: ModelSelector): Promise<ModelInfo[]> {
    // DeepSeek typically offers deepseek-chat and deepseek-reasoner
    return [
      {
        id: 'deepseek-chat',
        name: 'DeepSeek V3',
        vendor: 'DeepSeek',
        family: 'deepseek-chat',
        maxInputTokens: 64000
      },
      {
        id: 'deepseek-reasoner',
        name: 'DeepSeek R1',
        vendor: 'DeepSeek',
        family: 'deepseek-reasoner',
        maxInputTokens: 64000
      }
    ].filter(m => !selector.id || m.id === selector.id);
  }

  async sendRequest(
    modelId: string,
    messages: ChatMessage[],
    options: ModelRequestOptions,
  ): Promise<ModelResponse> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: modelId,
        messages,
        ...options.modelOptions
      })
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`DeepSeek API Error: ${response.statusText} - ${err}`);
    }

    const data = await response.json();
    return {
      text: data.choices[0].message.content,
      toolCalls: [], // DeepSeek supports tools, but we'll keep it simple for now
      usage: {
        inputTokens: data.usage.prompt_tokens,
        outputTokens: data.usage.completion_tokens
      }
    };
  }
}
