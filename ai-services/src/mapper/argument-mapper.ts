import { loadAiConfig, type AiConfig } from '../config.js';
import { LlmClient } from '../llm/client.js';
import { pathResolves } from '../json-paths.js';
import {
  LlmResponseSchema,
  type ArgumentMapping,
  type ArgumentMappingInput,
  type ArgumentMappingResult,
  type LlmResponse,
  type PreviousNodeContext,
} from '../types.js';
import { buildMessages } from './prompt.js';

/**
 * Recommends, for each argument of the current node, which key of an upstream
 * node's response it should be mapped to.
 *
 * The output `args` object is directly compatible with the backend workflow
 * model: `reference` mappings become `{ "$ref": { nodeId, path } }` and
 * `literal` mappings become the raw value, so it can be pasted straight into a
 * workflow node's `args`.
 */
export class ArgumentMapper {
  private readonly llm: LlmClient;

  constructor(config?: Partial<AiConfig>) {
    this.llm = new LlmClient(loadAiConfig(config));
  }

  async recommend(
    input: ArgumentMappingInput,
  ): Promise<ArgumentMappingResult> {
    validateInput(input);

    const messages = buildMessages(input);
    const { content, thinking } = await this.llm.chatJson(messages);
    if (thinking) {
      console.error(
        `[ai-services] thinking trace (${this.llm.model}, effort=${this.llm.reasoningEffort}):\n${thinking}`,
      );
    }
    console.error(`[ai-services] raw LLM output (${this.llm.model}):\n${content}`);
    const parsed = parseLlmResponse(content);

    return this.assemble(input, parsed);
  }

  /**
   * Turn the (already-validated) LLM response into the final result:
   *   - guarantee one mapping per schema argument
   *   - verify every `reference` path actually resolves against its node
   *   - assemble the backend-compatible `args` object
   */
  private assemble(
    input: ArgumentMappingInput,
    parsed: LlmResponse,
  ): ArgumentMappingResult {
    const { currentNode, previousNodes } = input;
    const argNames = argumentNames(currentNode.inputSchema);
    const byNodeId = new Map<string, PreviousNodeContext>(
      previousNodes.map((n) => [n.nodeId, n]),
    );
    const llmByArg = new Map(parsed.mappings.map((m) => [m.argument, m]));

    const mappings: ArgumentMapping[] = argNames.map((argument) => {
      const m = llmByArg.get(argument);

      // The model said nothing about this argument → leave it for the user.
      if (!m) {
        return {
          argument,
          decision: 'unmapped',
          confidence: 0,
          reasoning: 'No recommendation was produced for this argument.',
        };
      }

      if (m.decision === 'reference') {
        // Defend against a hallucinated nodeId or path.
        const node = m.ref ? byNodeId.get(m.ref.nodeId) : undefined;
        if (!m.ref || !node) {
          return {
            argument,
            decision: 'unmapped',
            confidence: Math.min(m.confidence, 0.3),
            reasoning: m.ref
              ? `Referenced unknown node "${m.ref.nodeId}"; left unmapped.`
              : 'Reference was missing a target; left unmapped.',
          };
        }
        const resolves = pathResolves(node.response, m.ref.path);
        return {
          argument,
          decision: 'reference',
          ref: { nodeId: m.ref.nodeId, path: m.ref.path },
          confidence: m.confidence,
          reasoning: m.reasoning,
          pathResolves: resolves,
        };
      }

      if (m.decision === 'literal') {
        return {
          argument,
          decision: 'literal',
          value: m.value,
          confidence: m.confidence,
          reasoning: m.reasoning,
        };
      }

      return {
        argument,
        decision: 'unmapped',
        confidence: m.confidence,
        reasoning: m.reasoning,
      };
    });

    const args = buildArgs(mappings);

    return {
      tool: currentNode.tool,
      mappings,
      args,
      model: this.llm.model,
    };
  }
}

/** Convenience one-shot helper for callers that don't want to hold an instance. */
export async function recommendArgumentMappings(
  input: ArgumentMappingInput,
  config?: Partial<AiConfig>,
): Promise<ArgumentMappingResult> {
  return new ArgumentMapper(config).recommend(input);
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

export class InvalidInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidInputError';
  }
}

export class LlmOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LlmOutputError';
  }
}

function validateInput(input: ArgumentMappingInput): void {
  if (!input?.currentNode?.tool) {
    throw new InvalidInputError('currentNode.tool is required');
  }
  if (
    !input.currentNode.inputSchema ||
    typeof input.currentNode.inputSchema !== 'object'
  ) {
    throw new InvalidInputError('currentNode.inputSchema must be a JSON Schema object');
  }
  if (!Array.isArray(input.previousNodes) || input.previousNodes.length === 0) {
    throw new InvalidInputError('previousNodes must contain at least one node');
  }
  const seen = new Set<string>();
  for (const node of input.previousNodes) {
    if (!node.nodeId) throw new InvalidInputError('every previous node needs a nodeId');
    if (seen.has(node.nodeId)) {
      throw new InvalidInputError(`duplicate previous node id "${node.nodeId}"`);
    }
    seen.add(node.nodeId);
  }
}

function argumentNames(inputSchema: Record<string, unknown>): string[] {
  const props = inputSchema.properties;
  if (!props || typeof props !== 'object') return [];
  return Object.keys(props as Record<string, unknown>);
}

/**
 * Parse the model's text into our validated shape. Tolerates the common
 * failure modes (markdown code fences, leading prose) by extracting the first
 * balanced JSON object before parsing.
 */
function parseLlmResponse(raw: string): LlmResponse {
  const jsonText = extractJsonObject(raw);
  let data: unknown;
  try {
    data = JSON.parse(jsonText);
  } catch (err) {
    throw new LlmOutputError(
      `Model did not return valid JSON: ${(err as Error).message}\n--- raw ---\n${raw}`,
    );
  }
  const result = LlmResponseSchema.safeParse(data);
  if (!result.success) {
    throw new LlmOutputError(
      `Model JSON did not match the expected shape:\n${result.error.issues
        .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('\n')}`,
    );
  }
  return result.data;
}

/**
 * Strip any inline `<think>…</think>` block and ```json fences, then grab the
 * outermost {...} block. The think-stripper is a safety net for thinking models
 * that emit their trace into `content` instead of a separate field.
 */
function extractJsonObject(raw: string): string {
  let s = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  // An unterminated <think> (truncated trace) — drop everything up to the
  // first '{' below handles it, but clear a dangling open tag too.
  s = s.replace(/<\/?think>/gi, '').trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim();
  }
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    return s.slice(start, end + 1);
  }
  return s;
}

/** Assemble a backend-compatible `args` object from the resolved mappings. */
function buildArgs(mappings: ArgumentMapping[]): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const m of mappings) {
    if (m.decision === 'reference' && m.ref) {
      args[m.argument] = { $ref: { nodeId: m.ref.nodeId, path: m.ref.path } };
    } else if (m.decision === 'literal') {
      args[m.argument] = m.value;
    }
    // 'unmapped' arguments are intentionally omitted.
  }
  return args;
}
