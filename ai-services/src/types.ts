import { z } from 'zod';

/**
 * Shapes here are deliberately aligned with the backend workflow model
 * (see backend/src/types/workflow.ts). A recommended mapping can be dropped
 * straight into a workflow node's `args` as a `$ref`:
 *
 *   { "message": { "$ref": { "nodeId": "sum", "path": "$.content[0].text" } } }
 *
 * The JSONPath subset matches backend/src/workflow/refs.ts exactly
 * ($, $.foo, $.foo[0], $["weird.key"], $.foo[0].bar).
 */

export type JsonSchema = Record<string, unknown>;

/** The node we are trying to fill arguments for. */
export type CurrentNodeContext = {
  /** Qualified tool name, e.g. "everything__echo". */
  tool: string;
  /** Human/LLM-authored description of what the tool does. */
  description?: string;
  /** JSON Schema describing the arguments this tool accepts. */
  inputSchema: JsonSchema;
};

/**
 * An upstream node whose response is available to be referenced. There may be
 * more than one (a node can depend on several upstream nodes), but the common
 * case is a single immediately-preceding tool.
 */
export type PreviousNodeContext = {
  /** The id this node has in the workflow; used to build the `$ref.nodeId`. */
  nodeId: string;
  /** Qualified tool name, e.g. "everything__get-sum". */
  tool: string;
  /** What the upstream tool does — helps the LLM judge semantic fit. */
  description?: string;
  /** The actual response object the upstream tool produced. */
  response: unknown;
};

export type ArgumentMappingInput = {
  currentNode: CurrentNodeContext;
  /** One or more upstream nodes whose responses can feed the current node. */
  previousNodes: PreviousNodeContext[];
};

/** How a single argument should be filled. */
export type MappingDecision = 'reference' | 'literal' | 'unmapped';

export type ArgumentMapping = {
  /** The argument key on the current node's input schema. */
  argument: string;
  /** Whether to wire it from an upstream response, use a literal, or leave it. */
  decision: MappingDecision;
  /** Present when `decision === 'reference'`. Backend-compatible `$ref` body. */
  ref?: { nodeId: string; path: string };
  /** Present when `decision === 'literal'`. A concrete value to hardcode. */
  value?: unknown;
  /** Model confidence in [0, 1]. */
  confidence: number;
  /** Short rationale for the choice (surfaced as "why this mapping?"). */
  reasoning: string;
  /**
   * Set by post-processing: whether `ref.path` actually resolves against the
   * referenced node's response. A reference the LLM hallucinated will be
   * `false`, letting the UI flag it instead of silently producing a bad arg.
   */
  pathResolves?: boolean;
};

export type ArgumentMappingResult = {
  /** Echo of the current node's tool, for convenience. */
  tool: string;
  /** One entry per argument the model considered. */
  mappings: ArgumentMapping[];
  /**
   * Ready-to-use `args` object for the workflow node, assembled from the
   * `reference` and `literal` mappings. Drop this directly into a node's
   * `args` field. `unmapped` arguments are omitted.
   */
  args: Record<string, unknown>;
  /** The model that produced this recommendation. */
  model: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Zod schema for the RAW LLM output. Kept permissive on purpose: the model is
// asked for exactly this shape, but we re-validate, repair, and enrich it in
// the mapper rather than trusting it blindly.
// ─────────────────────────────────────────────────────────────────────────────

export const LlmMappingSchema = z.object({
  argument: z.string().min(1),
  decision: z.enum(['reference', 'literal', 'unmapped']),
  ref: z
    .object({
      nodeId: z.string().min(1),
      path: z.string().default('$'),
    })
    .optional(),
  value: z.unknown().optional(),
  confidence: z.number().min(0).max(1).default(0.5),
  reasoning: z.string().default(''),
});

export const LlmResponseSchema = z.object({
  mappings: z.array(LlmMappingSchema).default([]),
});

export type LlmResponse = z.infer<typeof LlmResponseSchema>;
