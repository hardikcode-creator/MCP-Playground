// Wire protocol for the single-socket backend transport. Mirrors
// backend/src/server/protocol.ts exactly. All frames are JSON objects with a
// `type` discriminator. Request/response frames carry a correlation `id`;
// workflow frames carry a `runId`.
//
// Client -> server:
//   connect        — upload the config; expect `connected`
//   callTool       — invoke one tool (Pane 3); expect `toolResult` | `error`
//   runWorkflow    — start a run; expect a stream of `engineEvent` then `workflowResult`
//   pauseAction    — resolve a paused node (continue / continue-with-args / skip / fail)
//   cancel         — abort the run (workflow-level)
//   setBreakpoint  — arm a runtime breakpoint mid-run
//   clearBreakpoint— clear a runtime breakpoint
//
// Server -> client:
//   connected      — tool catalog + skipped/failed servers
//   toolResult     — single tool envelope
//   engineEvent    — one executor EngineEvent (streamed during a run)
//   workflowResult — the final WorkflowRunResult for a run
//   error          — a request (`id`) or run (`runId`) failed

import type { ConnectResult, PlaygroundConfig, ToolResult } from "../types";
import type { EngineEvent, PauseAction, Workflow, WorkflowRunResult } from "../lib/workflow/types";

export const PROTOCOL_VERSION = 1;

// Optional per-server secrets supplied at connect time. Mirrors the backend's
// ProvidedEnv (server name -> { ENV_VAR -> value }).
export type ProvidedEnv = Record<string, Record<string, string>>;

export type ClientMessage =
  | { type: "connect"; id: string; config: PlaygroundConfig; providedEnv?: ProvidedEnv }
  | { type: "callTool"; id: string; qualifiedName: string; args: Record<string, unknown> }
  | { type: "runWorkflow"; runId: string; workflow: Workflow }
  | { type: "pauseAction"; runId: string; nodeId: string; action: PauseAction }
  | { type: "cancel"; runId: string }
  | { type: "setBreakpoint"; runId: string; nodeId: string }
  | { type: "clearBreakpoint"; runId: string; nodeId: string };

export type ServerMessage =
  | {
      type: "connected";
      id: string;
      catalog: ConnectResult["catalog"];
      skipped: ConnectResult["skipped"];
      failed: ConnectResult["failed"];
    }
  | { type: "toolResult"; id: string; result: ToolResult }
  | { type: "engineEvent"; runId: string; event: EngineEvent }
  | { type: "workflowResult"; runId: string; result: WorkflowRunResult }
  | { type: "error"; id?: string; runId?: string; error: string };

export type ClientMessageType = ClientMessage["type"];
export type ServerMessageType = ServerMessage["type"];
