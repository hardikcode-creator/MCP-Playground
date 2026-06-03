import OpenAI from 'openai';
import type { AiConfig, ReasoningEffort } from '../config.js';

/** A model reply split into the final answer and (optionally) its thinking trace. */
export type ChatResult = {
  /** The final answer content — expected to be the JSON object we asked for. */
  content: string;
  /** The model's reasoning trace, when a thinking model produced one. */
  thinking?: string;
};

/**
 * A thin wrapper over the OpenAI SDK, pointed at Ollama's OpenAI-compatible
 * endpoint. The rest of the codebase only depends on `chatJson`, so the model
 * provider can be swapped without touching the mapper.
 */
export class LlmClient {
  private readonly client: OpenAI;
  readonly model: string;
  readonly reasoningEffort: ReasoningEffort;
  private readonly temperature: number;
  private readonly timeoutMs: number;

  constructor(config: AiConfig) {
    this.client = new OpenAI({
      baseURL: config.baseUrl,
      apiKey: config.apiKey,
    });
    this.model = config.model;
    this.temperature = config.temperature;
    this.timeoutMs = config.requestTimeoutMs;
    this.reasoningEffort = config.reasoningEffort;
  }

  /**
   * Run a chat completion that is constrained to return a single JSON object.
   *
   * Ollama honours `response_format: { type: 'json_object' }` (it maps to its
   * own `format: "json"`), which forces well-formed JSON out of the model. On a
   * thinking-capable model, `reasoning_effort` controls the thinking trace,
   * which Ollama returns in a separate field (so `content` stays clean JSON).
   * We still parse defensively in the caller.
   */
  async chatJson(messages: ChatMessage[]): Promise<ChatResult> {
    // `reasoning_effort` is accepted by Ollama's OpenAI-compatible endpoint but
    // isn't in this SDK version's typed params, so attach it via a cast. Omit
    // it entirely for 'none'? No — Ollama treats 'none' as "thinking off", and
    // omitting it would auto-enable thinking, so we always send it explicitly.
    const params = {
      model: this.model,
      temperature: this.temperature,
      response_format: { type: 'json_object' as const },
      reasoning_effort: this.reasoningEffort,
      messages,
    };

    const completion = await this.client.chat.completions.create(
      params as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
      { timeout: this.timeoutMs },
    );

    const message = completion.choices[0]?.message;
    const content = message?.content;
    if (!content || content.trim() === '') {
      throw new LlmError(
        `Model "${this.model}" returned an empty completion. ` +
          `Is the model pulled and able to follow JSON formatting?`,
      );
    }
    return { content, thinking: extractThinking(message) };
  }
}

/**
 * Pull the reasoning trace off the response message. Different OpenAI-compatible
 * providers expose it under different keys (Ollama: `reasoning`/`reasoning_content`;
 * some models surface `thinking`), so we check all of them.
 */
function extractThinking(message: unknown): string | undefined {
  if (!message || typeof message !== 'object') return undefined;
  const m = message as Record<string, unknown>;
  for (const key of ['reasoning', 'reasoning_content', 'thinking']) {
    const v = m[key];
    if (typeof v === 'string' && v.trim() !== '') return v;
  }
  return undefined;
}

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export class LlmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmError';
  }
}
