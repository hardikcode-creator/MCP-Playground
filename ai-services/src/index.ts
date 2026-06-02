/**
 * Public API for the MCP Playground AI services.
 *
 * Today this exposes argument mapping: given a current node (tool + input
 * schema) and one or more upstream nodes (tool + response), recommend which
 * argument should be wired to which key of an upstream response. The result
 * is backend-workflow-compatible (`$ref` objects), so it can be dropped
 * straight into a node's `args`.
 */

export { loadAiConfig } from './config.js';
export type { AiConfig } from './config.js';

export {
  ArgumentMapper,
  recommendArgumentMappings,
  InvalidInputError,
  LlmOutputError,
} from './mapper/argument-mapper.js';

export { LlmClient, LlmError } from './llm/client.js';
export type { ChatMessage } from './llm/client.js';

export { startHttpServer } from './server/http.js';
export type { RunningHttpServer } from './server/http.js';

export {
  enumeratePaths,
  getAtPath,
  pathResolves,
  PathResolutionError,
} from './json-paths.js';
export type { PathCandidate } from './json-paths.js';

export type {
  JsonSchema,
  CurrentNodeContext,
  PreviousNodeContext,
  ArgumentMappingInput,
  ArgumentMapping,
  ArgumentMappingResult,
  MappingDecision,
} from './types.js';
