// Owns the single browser->backend WebSocket. Two responsibilities:
//   1. request/response: send a frame with a correlation `id`, resolve when the
//      matching `connected` / `toolResult` / `error` frame comes back.
//   2. run streaming: register per-`runId` handlers so `engineEvent` frames are
//      delivered live and `workflowResult` / `error` settle the run.
//
// The socket opens lazily on first use and reconnects lazily after a drop (a
// closed socket rejects all in-flight work, and the next request reopens it).
// Both WebSocketMcpClient and WebSocketWorkflowRunner share one instance so the
// catalog handshake and workflow runs travel over the same connection.

import type { EngineEvent, Workflow, WorkflowRunResult } from "../lib/workflow/types";
import type { ClientMessage, ServerMessage } from "./protocol";

type Pending = {
  resolve: (msg: ServerMessage) => void;
  reject: (err: Error) => void;
};

type RunHandlers = {
  onEvent: (event: EngineEvent) => void;
  resolve: (result: WorkflowRunResult) => void;
  reject: (err: Error) => void;
};

export type WsStatus = "idle" | "connecting" | "open" | "closed";

export class WsConnection {
  private socket: WebSocket | null = null;
  private openPromise: Promise<void> | null = null;
  private readonly byId = new Map<string, Pending>();
  private readonly byRun = new Map<string, RunHandlers>();
  private seq = 0;
  private statusListeners = new Set<(status: WsStatus) => void>();
  private status: WsStatus = "idle";
  private readonly url: string;

  constructor(url: string) {
    this.url = url;
  }

  getStatus(): WsStatus {
    return this.status;
  }

  onStatus(listener: (status: WsStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  private setStatus(status: WsStatus): void {
    this.status = status;
    for (const l of this.statusListeners) l(status);
  }

  nextId(prefix = "req"): string {
    this.seq += 1;
    return `${prefix}_${Date.now().toString(36)}_${this.seq.toString(36)}`;
  }

  private ensureOpen(): Promise<void> {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) return Promise.resolve();
    if (this.openPromise) return this.openPromise;

    this.setStatus("connecting");
    this.openPromise = new Promise<void>((resolve, reject) => {
      let opened = false;
      const socket = new WebSocket(this.url);
      this.socket = socket;

      socket.addEventListener("open", () => {
        opened = true;
        this.setStatus("open");
        resolve();
      });
      socket.addEventListener("message", (ev: MessageEvent) => this.onMessage(ev.data));
      socket.addEventListener("close", () => {
        this.socket = null;
        this.openPromise = null;
        this.setStatus("closed");
        const err = new Error("WebSocket connection closed");
        if (!opened) reject(err);
        this.failAll(err);
      });
      // `error` is always followed by `close`; let close own the rejection so we
      // don't double-settle.
    });
    return this.openPromise;
  }

  private onMessage(data: unknown): void {
    let msg: ServerMessage;
    try {
      msg = JSON.parse(String(data)) as ServerMessage;
    } catch {
      return;
    }
    switch (msg.type) {
      case "connected":
      case "toolResult": {
        const pending = this.byId.get(msg.id);
        if (pending) {
          this.byId.delete(msg.id);
          pending.resolve(msg);
        }
        break;
      }
      case "engineEvent": {
        this.byRun.get(msg.runId)?.onEvent(msg.event);
        break;
      }
      case "workflowResult": {
        const run = this.byRun.get(msg.runId);
        if (run) {
          this.byRun.delete(msg.runId);
          run.resolve(msg.result);
        }
        break;
      }
      case "error": {
        if (msg.id && this.byId.has(msg.id)) {
          const pending = this.byId.get(msg.id)!;
          this.byId.delete(msg.id);
          pending.reject(new Error(msg.error));
        } else if (msg.runId && this.byRun.has(msg.runId)) {
          const run = this.byRun.get(msg.runId)!;
          this.byRun.delete(msg.runId);
          run.reject(new Error(msg.error));
        } else {
          console.error("[ws] server error:", msg.error);
        }
        break;
      }
    }
  }

  private failAll(err: Error): void {
    for (const p of this.byId.values()) p.reject(err);
    this.byId.clear();
    for (const r of this.byRun.values()) r.reject(err);
    this.byRun.clear();
  }

  /** Send an id-correlated request and await the matching reply. */
  async request(message: ClientMessage & { id: string }): Promise<ServerMessage> {
    await this.ensureOpen();
    return new Promise<ServerMessage>((resolve, reject) => {
      this.byId.set(message.id, { resolve, reject });
      this.socket!.send(JSON.stringify(message));
    });
  }

  /** Start a workflow run; resolves on workflowResult, rejects on error/close. */
  async runWorkflow(
    runId: string,
    workflow: Workflow,
    onEvent: (event: EngineEvent) => void,
    seedResults?: Record<string, unknown>,
  ): Promise<WorkflowRunResult> {
    await this.ensureOpen();
    return new Promise<WorkflowRunResult>((resolve, reject) => {
      this.byRun.set(runId, { onEvent, resolve, reject });
      const frame: ClientMessage = { type: "runWorkflow", runId, workflow, seedResults };
      this.socket!.send(JSON.stringify(frame));
    });
  }

  /** Fire-and-forget control frame (pauseAction / cancel / breakpoints). */
  send(message: ClientMessage): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }
}

// One shared connection per URL for the app's lifetime.
let shared: WsConnection | null = null;
let sharedUrl: string | null = null;

export function getSharedConnection(url: string): WsConnection {
  if (!shared || sharedUrl !== url) {
    shared = new WsConnection(url);
    sharedUrl = url;
  }
  return shared;
}
