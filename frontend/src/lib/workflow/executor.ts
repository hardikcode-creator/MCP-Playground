// Port of backend/src/workflow/executor.ts. The ONLY substantive change from
// the backend is the event sink: node:events' EventEmitter is replaced with a
// tiny listener set so this runs in the browser with zero deps. Breakpoint /
// pause / skip / fail / cancel semantics are preserved exactly.

import type {
  BreakpointContext,
  EngineEvent,
  NodeRunState,
  NodeStatus,
  PauseAction,
  Workflow,
  WorkflowNode,
  WorkflowRunResult,
  WorkflowStatus,
} from "./types";
import {
  buildAdjacency,
  type DependencyMap,
  normalizeWorkflow,
  topoSort,
  validateDependsOn,
  validateRefs,
} from "./graph";
import { RefResolutionError, resolveArgs } from "./refs";

// Calls a single MCP tool. The executor depends on this interface rather than
// a concrete client so the mock (now) and the WebSocket transport (later) can
// plug in without touching the executor.
export interface ToolCaller {
  call(
    qualifiedName: string,
    args: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ): Promise<unknown>;
}

// Handles a breakpoint pause. The executor stays UI-agnostic by calling out to
// whatever handler was passed in. The React implementation stashes a resolver
// and surfaces the pause in the inspector; the user's action resolves it.
export interface PauseHandler {
  onBreakpoint(ctx: BreakpointContext, signal?: AbortSignal): Promise<PauseAction>;
}

const DEFAULT_PAUSE_HANDLER: PauseHandler = {
  async onBreakpoint() {
    return { type: "continue" };
  },
};

export type RunOptions = {
  // If aborted, the executor stops launching new nodes, cancels in-flight tool
  // calls (same signal forwarded to the ToolCaller), and resolves paused
  // breakpoints as cancelled. The workflow status becomes 'cancelled'.
  signal?: AbortSignal;
};

export class WorkflowExecutor {
  private readonly listeners = new Set<(event: EngineEvent) => void>();
  private readonly toolCaller: ToolCaller;
  private readonly pauseHandler: PauseHandler;

  // Runtime breakpoints — mutable from outside, even mid-run. Authored
  // breakpoints (on the node) are NOT mirrored here; they live on the node.
  private readonly runtimeBreakpoints = new Set<string>();

  constructor(toolCaller: ToolCaller, pauseHandler: PauseHandler = DEFAULT_PAUSE_HANDLER) {
    this.toolCaller = toolCaller;
    this.pauseHandler = pauseHandler;
  }

  on(listener: (event: EngineEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ── Runtime breakpoint API (idempotent, safe any time) ─────────────────────

  setBreakpoint(nodeId: string): void {
    if (this.runtimeBreakpoints.has(nodeId)) return;
    this.runtimeBreakpoints.add(nodeId);
    this.emit({ type: "breakpoint.added", nodeId });
  }

  clearBreakpoint(nodeId: string): void {
    if (!this.runtimeBreakpoints.has(nodeId)) return;
    this.runtimeBreakpoints.delete(nodeId);
    this.emit({ type: "breakpoint.cleared", nodeId });
  }

  clearAllBreakpoints(): void {
    for (const id of [...this.runtimeBreakpoints]) this.clearBreakpoint(id);
  }

  listRuntimeBreakpoints(): string[] {
    return [...this.runtimeBreakpoints];
  }

  private emit(event: EngineEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }

  async run(input: Workflow, options: RunOptions = {}): Promise<WorkflowRunResult> {
    const signal = options.signal;

    const refErrors = validateRefs(input);
    const depErrors = validateDependsOn(input);
    const allErrors = [...refErrors, ...depErrors];
    if (allErrors.length > 0) {
      throw new Error(
        `Workflow has invalid dependencies:\n${allErrors.map((e) => `  - ${e}`).join("\n")}`,
      );
    }

    const workflow = normalizeWorkflow(input);
    topoSort(workflow);

    const { incoming, outgoing } = buildAdjacency(workflow);
    const nodeById = new Map(workflow.nodes.map((n) => [n.id, n]));
    const results = new Map<string, unknown>();
    const states = new Map<string, NodeRunState>();

    for (const node of workflow.nodes) {
      states.set(node.id, {
        nodeId: node.id,
        tool: node.tool,
        status: "pending",
        typedArgs: node.args,
      });
    }

    const runId = makeRunId();
    const startedAt = Date.now();
    this.emit({ type: "workflow.started", runId, workflowId: workflow.id });

    const ready = new Set<string>();
    const inflight = new Map<string, Promise<{ nodeId: string }>>();

    for (const [nodeId, deps] of incoming) {
      if (deps.size === 0) {
        states.get(nodeId)!.status = "ready";
        ready.add(nodeId);
        this.emit({ type: "node.ready", nodeId });
      }
    }

    while (ready.size > 0 || inflight.size > 0) {
      if (!signal?.aborted) {
        for (const nodeId of [...ready]) {
          ready.delete(nodeId);
          const node = nodeById.get(nodeId)!;
          inflight.set(nodeId, this.runNode(node, states, results, signal));
        }
      } else {
        ready.clear();
      }

      if (inflight.size === 0) break;

      const { nodeId: finished } = await Promise.race(inflight.values());
      inflight.delete(finished);

      const state = states.get(finished)!;
      if (state.status === "completed") {
        for (const dependentId of outgoing.get(finished) ?? []) {
          const depState = states.get(dependentId);
          if (!depState || depState.status !== "pending") continue;
          if (allDepsCompleted(dependentId, incoming, states)) {
            depState.status = "ready";
            ready.add(dependentId);
            this.emit({ type: "node.ready", nodeId: dependentId });
          }
        }
      } else if (state.status === "failed" || state.status === "skipped") {
        this.skipTransitively(finished, outgoing, states, reasonForSkip(state));
      }
      // else (status still 'running' or 'paused'): cancellation caught this
      // node mid-execution. Don't touch its status; don't unlock dependents.
    }

    const finishedAt = Date.now();
    const status = computeWorkflowStatus(states, signal);
    const durationMs = finishedAt - startedAt;

    this.emit({ type: "workflow.completed", runId, status, durationMs });

    return {
      workflowId: workflow.id,
      runId,
      status,
      startedAt,
      finishedAt,
      durationMs,
      steps: workflow.nodes.map((n) => states.get(n.id)!),
    };
  }

  private tryResolveArgs(
    rawArgs: Record<string, unknown>,
    state: NodeRunState,
    results: Map<string, unknown>,
    startedAt: number,
  ): Record<string, unknown> | null {
    try {
      const resolved = resolveArgs(rawArgs, results);
      if (typeof resolved !== "object" || resolved === null || Array.isArray(resolved)) {
        throw new Error(`Resolved args is not a JSON object (got ${describe(resolved)})`);
      }
      return resolved as Record<string, unknown>;
    } catch (err) {
      const message = err instanceof RefResolutionError ? err.message : (err as Error).message;
      this.finalizeFailed(state, startedAt, message);
      return null;
    }
  }

  private async runNode(
    node: WorkflowNode,
    states: Map<string, NodeRunState>,
    results: Map<string, unknown>,
    signal: AbortSignal | undefined,
  ): Promise<{ nodeId: string }> {
    const state = states.get(node.id)!;
    const startedAt = Date.now();
    state.startedAt = startedAt;

    // 1. Resolve $refs from the authored args.
    let resolvedArgs = this.tryResolveArgs(node.args, state, results, startedAt);
    if (resolvedArgs === null) return { nodeId: node.id };
    state.resolvedArgs = resolvedArgs;

    // 2. BEFORE-call breakpoint (authored on the node, or armed at runtime).
    const runtimeBp = this.runtimeBreakpoints.has(node.id);
    const authoredBp = node.breakpoint === true;
    if (authoredBp || runtimeBp) {
      const source: BreakpointContext["source"] = authoredBp ? "authored" : "runtime";
      const outcome = await this.handlePause(node, state, source, resolvedArgs, signal);
      if (outcome.kind === "terminal") return { nodeId: node.id };
      if (outcome.kind === "args") {
        state.typedArgs = outcome.args;
        const reresolved = this.tryResolveArgs(outcome.args, state, results, startedAt);
        if (reresolved === null) return { nodeId: node.id };
        resolvedArgs = reresolved;
        state.resolvedArgs = resolvedArgs;
      }
    }

    if (signal?.aborted) return { nodeId: node.id };

    // 3. Call the tool.
    state.status = "running";
    this.emit({ type: "node.started", nodeId: node.id, tool: node.tool, resolvedArgs });

    let result: unknown;
    try {
      result = await this.toolCaller.call(node.tool, resolvedArgs, { signal });
    } catch (err) {
      if (signal?.aborted) return { nodeId: node.id };
      this.finalizeFailed(state, startedAt, (err as Error).message);
      return { nodeId: node.id };
    }

    if (signal?.aborted) {
      state.result = result;
      return { nodeId: node.id };
    }

    results.set(node.id, result);
    this.finalizeCompleted(state, startedAt, result);
    return { nodeId: node.id };
  }

  private async handlePause(
    node: WorkflowNode,
    state: NodeRunState,
    source: BreakpointContext["source"],
    args: Record<string, unknown>,
    signal: AbortSignal | undefined,
  ): Promise<
    | { kind: "continue" }
    | { kind: "args"; args: Record<string, unknown> }
    | { kind: "terminal" }
  > {
    if (signal?.aborted) return { kind: "terminal" };

    const ctx: BreakpointContext = { nodeId: node.id, tool: node.tool, source, args };

    const previousStatus = state.status;
    state.status = "paused";
    this.emit({ type: "node.paused", nodeId: node.id, source, args });

    const action = await raceWithSignal(this.pauseHandler.onBreakpoint(ctx, signal), signal);

    if (action === "cancelled") {
      // Pause forcibly broken by cancellation. Don't emit node.resumed and
      // don't transition status — the node stays 'paused'.
      return { kind: "terminal" };
    }

    this.emit({ type: "node.resumed", nodeId: node.id, action: action.type });

    switch (action.type) {
      case "continue":
        state.status = previousStatus;
        return { kind: "continue" };
      case "continue-with-args":
        state.status = previousStatus;
        return { kind: "args", args: action.args };
      case "skip":
        this.finalizeSkippedAtBreakpoint(state);
        return { kind: "terminal" };
      case "fail":
        this.finalizeFailed(state, state.startedAt ?? Date.now(), action.error);
        return { kind: "terminal" };
    }
  }

  private skipTransitively(
    parentId: string,
    outgoing: DependencyMap,
    states: Map<string, NodeRunState>,
    reason: string,
  ): void {
    const queue = [...(outgoing.get(parentId) ?? [])];
    while (queue.length > 0) {
      const next = queue.shift()!;
      const state = states.get(next);
      if (!state || state.status !== "pending") continue;
      state.status = "skipped";
      state.error = reason;
      this.emit({ type: "node.skipped", nodeId: next, reason });
      for (const further of outgoing.get(next) ?? []) queue.push(further);
    }
  }

  // ── finalize helpers ────────────────────────────────────────────────────

  private finalizeCompleted(state: NodeRunState, startedAt: number, result: unknown): void {
    finalizeBase(state, "completed", startedAt, result, undefined);
    this.emit({
      type: "node.completed",
      nodeId: state.nodeId,
      result,
      durationMs: state.durationMs ?? 0,
    });
  }

  private finalizeFailed(state: NodeRunState, startedAt: number, message: string): void {
    finalizeBase(state, "failed", startedAt, undefined, message);
    this.emit({
      type: "node.failed",
      nodeId: state.nodeId,
      error: message,
      durationMs: state.durationMs ?? 0,
    });
  }

  private finalizeSkippedAtBreakpoint(state: NodeRunState): void {
    const reason = "skipped at breakpoint";
    finalizeBase(state, "skipped", state.startedAt ?? Date.now(), undefined, reason);
    this.emit({ type: "node.skipped", nodeId: state.nodeId, reason });
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function finalizeBase(
  state: NodeRunState,
  status: NodeStatus,
  startedAt: number,
  result: unknown,
  error: string | undefined,
): void {
  const finishedAt = Date.now();
  state.status = status;
  state.finishedAt = finishedAt;
  state.durationMs = finishedAt - startedAt;
  if (result !== undefined) state.result = result;
  if (error !== undefined) state.error = error;
}

function allDepsCompleted(
  nodeId: string,
  incoming: DependencyMap,
  states: Map<string, NodeRunState>,
): boolean {
  for (const dep of incoming.get(nodeId) ?? []) {
    const s = states.get(dep);
    if (!s || s.status !== "completed") return false;
  }
  return true;
}

function reasonForSkip(state: NodeRunState): string {
  switch (state.status) {
    case "skipped":
      return `upstream node "${state.nodeId}" was skipped`;
    case "failed":
    default:
      return `upstream node "${state.nodeId}" failed`;
  }
}

function computeWorkflowStatus(
  states: Map<string, NodeRunState>,
  signal: AbortSignal | undefined,
): WorkflowStatus {
  if (signal?.aborted) return "cancelled";
  for (const s of states.values()) {
    if (s.status === "failed") return "failed";
  }
  return "completed";
}

async function raceWithSignal(
  pending: Promise<PauseAction>,
  signal: AbortSignal | undefined,
): Promise<PauseAction | "cancelled"> {
  if (!signal) return pending;
  if (signal.aborted) return "cancelled";
  return new Promise<PauseAction | "cancelled">((resolve) => {
    let settled = false;
    const settle = (v: PauseAction | "cancelled") => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      resolve(v);
    };
    const onAbort = () => settle("cancelled");
    signal.addEventListener("abort", onAbort, { once: true });
    pending.then(
      (action) => settle(action),
      () => settle("cancelled"),
    );
  });
}

function makeRunId(): string {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function describe(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}
