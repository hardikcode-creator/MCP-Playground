import 'dotenv/config';

/**
 * Runtime configuration for the AI services.
 *
 * Everything talks to a local Ollama instance through its OpenAI-compatible
 * endpoint (`/v1`), so the standard `openai` SDK is used unchanged — only the
 * `baseURL` and `apiKey` are swapped out.
 */
/**
 * Controls thinking on thinking-capable models via Ollama's OpenAI-compatible
 * endpoint (`reasoning_effort`). `'none'` disables thinking; `'low'|'medium'|
 * 'high'` enable it with increasing trace length. Ollama auto-enables thinking
 * for capable models when omitted, so we set it explicitly for predictability.
 */
export type ReasoningEffort = 'high' | 'medium' | 'low' | 'none';

export type AiConfig = {
  /** OpenAI-compatible base URL. For Ollama this is `http://host:11434/v1`. */
  baseUrl: string;
  /** Ollama ignores this, but the OpenAI SDK demands a non-empty string. */
  apiKey: string;
  /** Model name as known to Ollama (e.g. `llama3.1`, `qwen2.5`, `mistral`). */
  model: string;
  /** Sampling temperature. Mapping is precision work, so default is 0. */
  temperature: number;
  /** Per-request timeout in milliseconds. */
  requestTimeoutMs: number;
  /** Thinking effort for thinking-capable models. */
  reasoningEffort: ReasoningEffort;
};

const DEFAULTS = {
  baseUrl: 'http://localhost:11434/v1',
  apiKey: 'ollama',
  model: 'llama3.1',
  temperature: 0,
  requestTimeoutMs: 60_000,
  reasoningEffort: 'medium' as ReasoningEffort,
} as const;

function num(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function effort(value: string | undefined, fallback: ReasoningEffort): ReasoningEffort {
  const v = (value ?? '').trim().toLowerCase();
  if (v === 'high' || v === 'medium' || v === 'low' || v === 'none') return v;
  return fallback;
}

/**
 * Load config from environment variables, falling back to sane local-Ollama
 * defaults. Callers may also pass explicit overrides to `loadAiConfig`.
 */
export function loadAiConfig(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    baseUrl: overrides.baseUrl ?? process.env.OLLAMA_BASE_URL ?? DEFAULTS.baseUrl,
    apiKey: overrides.apiKey ?? process.env.OLLAMA_API_KEY ?? DEFAULTS.apiKey,
    model: overrides.model ?? process.env.OLLAMA_MODEL ?? DEFAULTS.model,
    temperature:
      overrides.temperature ??
      num(process.env.AI_TEMPERATURE, DEFAULTS.temperature),
    requestTimeoutMs:
      overrides.requestTimeoutMs ??
      num(process.env.AI_REQUEST_TIMEOUT_MS, DEFAULTS.requestTimeoutMs),
    reasoningEffort:
      overrides.reasoningEffort ??
      effort(process.env.AI_REASONING_EFFORT, DEFAULTS.reasoningEffort),
  };
}
