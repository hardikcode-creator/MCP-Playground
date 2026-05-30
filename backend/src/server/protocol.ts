/**
 * Wire protocol for the single-socket frontend transport. Mirrors
 * frontend/src/data/protocol.ts exactly. All frames are JSON objects with a
 * `type` discriminator. Request/response frames carry a correlation `id`;
 * workflow frames carry a `runId`.
 *
 * The EngineEvent / Workflow / PauseAction shapes are reused verbatim from the
 * executor's types, so events serialise straight onto the socket with no
 * reshaping (see types/workflow.ts).
 */

import type { PlaygroundConfig } from '../config.js';
import type { ProvidedEnv, StartResult, ToolDescriptor } from '../mcp/client-manager.js';
import type {
  EngineEvent,
  PauseAction,
  Workflow,
  WorkflowRunResult,
} from '../types/workflow.js';

export const PROTOCOL_VERSION = 1;

export type ClientMessage =
  | { type: 'connect'; id: string; config: PlaygroundConfig; providedEnv?: ProvidedEnv }
  | { type: 'callTool'; id: string; qualifiedName: string; args: Record<string, unknown> }
  | { type: 'runWorkflow'; runId: string; workflow: Workflow; seedResults?: Record<string, unknown> }
  | { type: 'pauseAction'; runId: string; nodeId: string; action: PauseAction }
  | { type: 'cancel'; runId: string }
  | { type: 'setBreakpoint'; runId: string; nodeId: string }
  | { type: 'clearBreakpoint'; runId: string; nodeId: string };

export type ServerMessage =
  | {
      type: 'connected';
      id: string;
      catalog: ToolDescriptor[];
      skipped: StartResult['skipped'];
      failed: StartResult['failed'];
    }
  | { type: 'toolResult'; id: string; result: unknown }
  | { type: 'engineEvent'; runId: string; event: EngineEvent }
  | { type: 'workflowResult'; runId: string; result: WorkflowRunResult }
  | { type: 'error'; id?: string; runId?: string; error: string };

export type ClientMessageType = ClientMessage['type'];
export type ServerMessageType = ServerMessage['type'];
