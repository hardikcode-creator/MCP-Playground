// The single backend boundary. Panes and state depend only on these
// interfaces, never on fetch/WebSocket/message shapes. Swapping the mock for
// the real transport is a one-line change in createMcpClient()/
// createWorkflowRunner().

import type { ConnectResult, PlaygroundConfig, ToolResult } from "../types";
import { MockMcpClient } from "./mockMcpClient";
import { WorkflowExecutor } from "../lib/workflow/executor";
import type { PauseHandler, ToolCaller } from "../lib/workflow/executor";
import type { EngineEvent, Workflow, WorkflowRunResult } from "../lib/workflow/types";

export type CallToolOptions = { signal?: AbortSignal };

export interface McpClient {
  // Upload-time handshake: send the config, get the tool catalog back.
  connect(config: PlaygroundConfig): Promise<ConnectResult>;
  // Invoke a single tool; resolves with the full MCP result envelope. An
  // optional AbortSignal lets the workflow debugger cancel an in-flight call.
  callTool(qualifiedName: string, args: Record<string, unknown>, options?: CallToolOptions): Promise<ToolResult>;
}

// now:   createMcpClient() -> new MockMcpClient()
// later: createMcpClient() -> new WebSocketMcpClient(import.meta.env.VITE_MCP_WS_URL)
export function createMcpClient(): McpClient {
  return new MockMcpClient();
}

// Stub for the future transport. Protocol sketch over a single socket (JSON):
//   -> { id, type: "connect",  config }
//   <- { id, type: "connected", catalog, skipped, failed }
//   -> { id, type: "callTool", qualifiedName, args }
//   <- { id, type: "toolResult", result } | { id, type: "error", error }
export class WebSocketMcpClient implements McpClient {
  private readonly url: string;

  constructor(url: string) {
    this.url = url;
  }

  async connect(): Promise<ConnectResult> {
    throw new Error(`WebSocketMcpClient(${this.url}) is not implemented yet`);
  }

  async callTool(): Promise<ToolResult> {
    throw new Error(`WebSocketMcpClient(${this.url}) is not implemented yet`);
  }
}

// ── Workflow execution seam ──────────────────────────────────────────────────
// The canvas serializes to a backend-shaped Workflow and hands it to a
// WorkflowRunner. Today that's LocalWorkflowRunner (the ported executor driving
// the mock callTool); later it becomes a WebSocketWorkflowRunner that ships the
// same Workflow to the backend's WorkflowExecutor and streams EngineEvents back.

export type WorkflowRunOptions = {
  onEvent: (event: EngineEvent) => void;
  pauseHandler: PauseHandler;
  signal?: AbortSignal;
};

export interface WorkflowRunner {
  run(workflow: Workflow, options: WorkflowRunOptions): Promise<WorkflowRunResult>;
}

export type CallToolFn = (
  qualifiedName: string,
  args: Record<string, unknown>,
  options?: CallToolOptions,
) => Promise<ToolResult>;

// Runs the workflow entirely in the browser using the ported executor, with the
// mock client's callTool as the ToolCaller. Honors the abort signal end-to-end.
export class LocalWorkflowRunner implements WorkflowRunner {
  private readonly callTool: CallToolFn;

  constructor(callTool: CallToolFn) {
    this.callTool = callTool;
  }

  run(workflow: Workflow, { onEvent, pauseHandler, signal }: WorkflowRunOptions): Promise<WorkflowRunResult> {
    const toolCaller: ToolCaller = {
      call: (qualifiedName, args, options) => this.callTool(qualifiedName, args, options),
    };
    const executor = new WorkflowExecutor(toolCaller, pauseHandler);
    const off = executor.on(onEvent);
    return executor.run(workflow, { signal }).finally(off);
  }
}

// later: serialize the Workflow, send it over the socket, and translate the
// streamed { type: "engineEvent", event } / pause-request frames into the same
// EngineEvent callbacks + PauseHandler protocol used here — so the canvas and
// inspector code stay identical when the transport flips.
export class WebSocketWorkflowRunner implements WorkflowRunner {
  private readonly url: string;

  constructor(url: string) {
    this.url = url;
  }

  async run(): Promise<WorkflowRunResult> {
    throw new Error(`WebSocketWorkflowRunner(${this.url}) is not implemented yet`);
  }
}

export function createWorkflowRunner(callTool: CallToolFn): WorkflowRunner {
  return new LocalWorkflowRunner(callTool);
}
