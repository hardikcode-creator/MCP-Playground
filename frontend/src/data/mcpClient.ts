// The single backend boundary. Panes and state depend only on these
// interfaces, never on fetch/WebSocket/message shapes. Swapping the mock for
// the real transport is a one-line change in createMcpClient()/
// createWorkflowRunner().

import type { ConnectResult, PlaygroundConfig, ToolResult } from "../types";
import { MockMcpClient } from "./mockMcpClient";
import { WorkflowExecutor } from "../lib/workflow/executor";
import type { PauseHandler, ToolCaller } from "../lib/workflow/executor";
import type { BreakpointContext, EngineEvent, Workflow, WorkflowNode, WorkflowRunResult } from "../lib/workflow/types";
import { getSharedConnection } from "./wsConnection";
import type { WsConnection, WsStatus } from "./wsConnection";

export type CallToolOptions = { signal?: AbortSignal };

// Transport switch: set VITE_MCP_WS_URL (e.g. ws://localhost:8787) to drive the
// real backend; leave it unset to use the in-browser mock. Empty string counts
// as unset so a blank .env line doesn't accidentally force the socket.
const WS_URL: string | undefined =
  (import.meta.env.VITE_MCP_WS_URL as string | undefined) || undefined;

// "mock" when no backend is configured; otherwise the live socket status.
export type TransportStatus = "mock" | WsStatus;

// Subscribe to the active transport's status. No-op (always "mock") when
// VITE_MCP_WS_URL is unset, so UI can render a single indicator either way.
export function subscribeTransportStatus(
  listener: (status: TransportStatus) => void,
): () => void {
  if (!WS_URL) {
    listener("mock");
    return () => {};
  }
  return getSharedConnection(WS_URL).onStatus(listener);
}

export interface McpClient {
  // Upload-time handshake: send the config, get the tool catalog back.
  connect(config: PlaygroundConfig): Promise<ConnectResult>;
  // Invoke a single tool; resolves with the full MCP result envelope. An
  // optional AbortSignal lets the workflow debugger cancel an in-flight call.
  callTool(qualifiedName: string, args: Record<string, unknown>, options?: CallToolOptions): Promise<ToolResult>;
}

// Mock by default; real socket when VITE_MCP_WS_URL is set. Both sides of the
// app depend only on the McpClient interface, so this is the single switch.
export function createMcpClient(): McpClient {
  if (WS_URL) return new WebSocketMcpClient(getSharedConnection(WS_URL));
  return new MockMcpClient();
}

// Real transport over a single shared socket. Protocol (JSON frames):
//   -> { type: "connect",  id, config }
//   <- { type: "connected", id, catalog, skipped, failed }
//   -> { type: "callTool", id, qualifiedName, args }
//   <- { type: "toolResult", id, result } | { type: "error", id, error }
export class WebSocketMcpClient implements McpClient {
  private readonly conn: WsConnection;

  constructor(conn: WsConnection) {
    this.conn = conn;
  }

  async connect(config: PlaygroundConfig): Promise<ConnectResult> {
    const id = this.conn.nextId("connect");
    const res = await this.conn.request({ type: "connect", id, config });
    if (res.type !== "connected") {
      throw new Error(`Unexpected ${res.type} reply to connect`);
    }
    return { catalog: res.catalog, skipped: res.skipped, failed: res.failed };
  }

  // The single-tool path (Pane 3) has no cross-socket cancel in this protocol,
  // so the optional CallToolOptions.signal is intentionally not implemented here.
  async callTool(
    qualifiedName: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const id = this.conn.nextId("call");
    const res = await this.conn.request({ type: "callTool", id, qualifiedName, args });
    if (res.type !== "toolResult") {
      throw new Error(`Unexpected ${res.type} reply to callTool`);
    }
    return res.result as ToolResult;
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
  // Resume: results of nodes that already completed, keyed by node id. Seeded
  // nodes are reported completed and skipped; only the rest re-run.
  seedResults?: Record<string, unknown>;
  // Input gate (local runner only): arg names still needing a value for a node,
  // given its resolved args and CURRENT raw args → pause it with source
  // 'missing-input'. The WebSocket runner ignores this; the backend computes the
  // same gate from its catalog.
  needsInput?: (
    node: WorkflowNode,
    resolvedArgs: Record<string, unknown>,
    rawArgs: Record<string, unknown>,
  ) => string[];
};

export interface WorkflowRunner {
  run(workflow: Workflow, options: WorkflowRunOptions): Promise<WorkflowRunResult>;
  // Arm/clear a runtime breakpoint on the in-flight run (no-op when idle). Lets
  // the UI add a breakpoint on the fly; it's honored before that node starts.
  setBreakpoint(nodeId: string): void;
  clearBreakpoint(nodeId: string): void;
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
  // The executor for the current run, so breakpoints can be armed mid-flight.
  private executor: WorkflowExecutor | null = null;

  constructor(callTool: CallToolFn) {
    this.callTool = callTool;
  }

  run(
    workflow: Workflow,
    { onEvent, pauseHandler, signal, seedResults, needsInput }: WorkflowRunOptions,
  ): Promise<WorkflowRunResult> {
    const toolCaller: ToolCaller = {
      call: (qualifiedName, args, options) => this.callTool(qualifiedName, args, options),
    };
    const executor = new WorkflowExecutor(toolCaller, pauseHandler);
    this.executor = executor;
    const off = executor.on(onEvent);
    return executor.run(workflow, { signal, seedResults, needsInput }).finally(() => {
      off();
      this.executor = null;
    });
  }

  setBreakpoint(nodeId: string): void {
    this.executor?.setBreakpoint(nodeId);
  }

  clearBreakpoint(nodeId: string): void {
    this.executor?.clearBreakpoint(nodeId);
  }
}

// Ships the serialized Workflow to the backend executor and translates the
// streamed frames back into the SAME WorkflowRunOptions the local runner uses,
// so the canvas/inspector/store stay byte-identical across the transport flip:
//   - engineEvent frames -> onEvent(event)
//   - a node.paused event -> ask the local pauseHandler, then send pauseAction
//   - an aborted signal   -> send a cancel frame
export class WebSocketWorkflowRunner implements WorkflowRunner {
  private readonly conn: WsConnection;
  // The active run's id, so breakpoint control frames target the right run.
  private runId: string | null = null;

  constructor(conn: WsConnection) {
    this.conn = conn;
  }

  async run(
    workflow: Workflow,
    { onEvent, pauseHandler, signal, seedResults }: WorkflowRunOptions,
  ): Promise<WorkflowRunResult> {
    const runId = this.conn.nextId("run");
    this.runId = runId;

    const onAbort = () => this.conn.send({ type: "cancel", runId });
    if (signal) {
      if (signal.aborted) this.conn.send({ type: "cancel", runId });
      else signal.addEventListener("abort", onAbort, { once: true });
    }

    const handleEvent = (event: EngineEvent) => {
      onEvent(event);
      if (event.type === "node.paused") {
        // The local pause handler is the source of user intent (Resume / Skip /
        // continue-with-args); ferry its resolution back to the executor.
        const ctx: BreakpointContext = {
          nodeId: event.nodeId,
          tool: "",
          source: event.source,
          args: event.args,
          ...(event.missingArgs ? { missingArgs: event.missingArgs } : {}),
        };
        void Promise.resolve(pauseHandler.onBreakpoint(ctx, signal)).then((action) => {
          this.conn.send({ type: "pauseAction", runId, nodeId: event.nodeId, action });
        });
      }
    };

    try {
      return await this.conn.runWorkflow(runId, workflow, handleEvent, seedResults);
    } finally {
      this.runId = null;
      if (signal) signal.removeEventListener("abort", onAbort);
    }
  }

  setBreakpoint(nodeId: string): void {
    if (this.runId) this.conn.send({ type: "setBreakpoint", runId: this.runId, nodeId });
  }

  clearBreakpoint(nodeId: string): void {
    if (this.runId) this.conn.send({ type: "clearBreakpoint", runId: this.runId, nodeId });
  }
}

// Local (ported executor + mock callTool) unless VITE_MCP_WS_URL points at a
// backend, in which case the run happens server-side over the shared socket.
export function createWorkflowRunner(callTool: CallToolFn): WorkflowRunner {
  if (WS_URL) return new WebSocketWorkflowRunner(getSharedConnection(WS_URL));
  return new LocalWorkflowRunner(callTool);
}
