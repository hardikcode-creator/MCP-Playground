import { EventEmitter } from 'node:events';
import {
  type BreakpointContext,
  type EngineEvent,
  type NodeRunState,
  type NodeStatus,
  type PauseAction,
  type Workflow,
  type WorkflowNode,
  type WorkflowRunResult,
  type WorkflowStatus,
} from '../types/workflow.js';
import {
  buildAdjacency,
  type DependencyMap,
  normalizeWorkflow,
  topoSort,
  validateDependsOn,
  validateRefs,
} from './graph.js';
import { RefResolutionError, resolveArgs, walkRefs } from './refs.js';

/**
 * Calls a single MCP tool. The executor depends on this interface rather than
 * the concrete ClientManager so different transports (in-process, WebSocket,
 * tests with mocks) can plug in without touching the executor.
 */
export interface ToolCaller {
  call(
    qualifiedName: string,
    args: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ): Promise<unknown>;
}

/**
 * Handles a breakpoint pause. The executor stays UI-agnostic by calling out
 * to whatever handler was passed in. The CLI's implementation is a
 * stdin-driven "press Enter to continue"; the future WebSocket
 * implementation broadcasts the pause context, awaits a user action over the
 * wire, and resolves the promise with that action.
 *
 * The handler MUST eventually resolve (or reject). The executor also races
 * the handler against the AbortSignal so a stuck handler can't prevent
 * cancellation, but a well-behaved handler should respect the signal itself
 * (e.g. the CLI listens for abort and resolves with 'continue').
 */
export interface PauseHandler {
  onBreakpoint(
    ctx: BreakpointContext,
    signal?: AbortSignal,
  ): Promise<PauseAction>;
}

const DEFAULT_PAUSE_HANDLER: PauseHandler = {
  async onBreakpoint() {
    return { type: 'continue' };
  },
};

export type RunOptions = {
  /**
   * If aborted, the executor stops launching new nodes, cancels in-flight
   * tool calls (via the same signal forwarded to the ToolCaller), and
   * resolves any paused breakpoints with a cancelled status. Pending and
   * ready nodes are marked `cancelled`; the workflow status becomes
   * `'cancelled'`.
   */
  signal?: AbortSignal;
  /**
   * Resume support: results for nodes that already completed in a prior run,
   * keyed by node id. Seeded nodes are marked `completed` up front (not
   * re-run); their cached results feed downstream `$ref` resolution exactly as
   * if this run had produced them, so only the failed/remaining nodes execute.
   */
  seedResults?: Record<string, unknown>;
  /**
   * Optional input gate. Returns the names of arguments that still need a value
   * before the node can run. It receives both the args AFTER `$ref` resolution
   * (`resolvedArgs`, for required/blank checks) and the CURRENT raw/authored
   * args (`rawArgs`, for detecting half-wired `$ref`s). `rawArgs` reflects any
   * edit the user made at a pause (`continue-with-args`), so a field they fill
   * in manually — or AI-map — is no longer flagged. A non-empty result pauses
   * the node with source `'missing-input'` (NOT a breakpoint). Resuming while
   * still-missing re-pauses. Omitted → no input gating (unchanged).
   */
  needsInput?: (
    node: WorkflowNode,
    resolvedArgs: Record<string, unknown>,
    rawArgs: Record<string, unknown>,
  ) => string[];
};

/**
 * Runs a Workflow DAG.
 *
 * Lifecycle per invocation of run():
 *   1. validateRefs       — every $ref points to an existing node, no self-refs
 *   2. validateDependsOn  — every explicit dependsOn entry points to an existing node
 *   3. normalizeWorkflow  — union ref sources into dependsOn so it becomes the
 *                           canonical dependency list (idempotent)
 *   4. topoSort           — throws CycleError if the dep graph isn't a DAG
 *   5. seed `ready` with nodes that have no incoming edges
 *   6. loop:
 *        - if signal aborted: clear `ready` without launching
 *        - else: launch every ready node into `inflight`
 *        - await Promise.race(inflight.values())
 *        - on completion: cache result, unlock dependents whose deps are all done
 *        - on failure / skip: transitively mark dependents as skipped
 *        - on cancellation-caught node (status still 'running' or 'paused'):
 *          do nothing — dependents stay 'pending'
 *      until both `ready` and `inflight` are empty
 *   7. emit workflow.completed; return WorkflowRunResult
 *
 * Cancellation is a workflow-level event. When `options.signal` aborts:
 *   - the workflow's final status is 'cancelled'
 *   - individual nodes are NOT transitioned to a 'cancelled' status
 *   - nodes simply freeze in whatever non-terminal state they were in
 *     ('pending', 'ready', 'running', or 'paused')
 *   - already-terminal nodes ('completed', 'failed', 'skipped') are unchanged
 * Consumers should combine workflow.status === 'cancelled' with each node's
 * status to tell the story ("this one was paused when we killed it").
 *
 * Breakpoint semantics:
 *   A breakpoint pauses ONLY that node's runNode execution. Other nodes
 *   already in flight (parallel branches) keep running because the main loop
 *   awaits via Promise.race — the paused node's promise stays pending while
 *   other promises resolve. The main loop processes those completions,
 *   unlocks their dependents, and keeps the DAG advancing on every branch
 *   that isn't downstream of the paused node.
 *
 *   Breakpoints come from two sources:
 *     - Authored (workflow JSON: `breakpoint: true` on a node)
 *     - Runtime  (executor.setBreakpoint(nodeId) — added by the UI while
 *                 the workflow is already running)
 *   They behave identically. A runtime breakpoint added to a node that has
 *   already passed its breakpoint check is a silent no-op (effectively a
 *   request for "next time this node runs" — which is never, since each
 *   node runs once per workflow invocation).
 */
export class WorkflowExecutor {
  private readonly emitter = new EventEmitter();
  private readonly toolCaller: ToolCaller;
  private readonly pauseHandler: PauseHandler;

  /**
   * Runtime breakpoints. Persistent across runs (set once, debug many) and
   * mutable from outside the executor — UI calls setBreakpoint/clearBreakpoint
   * at any time, even mid-run. Authored breakpoints (in workflow JSON) are
   * NOT mirrored here; they live on the node itself.
   */
  private readonly runtimeBreakpoints = new Set<string>();

  constructor(
    toolCaller: ToolCaller,
    pauseHandler: PauseHandler = DEFAULT_PAUSE_HANDLER,
  ) {
    this.toolCaller = toolCaller;
    this.pauseHandler = pauseHandler;
  }

  on(listener: (event: EngineEvent) => void): () => void {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }

  // ── Runtime breakpoint API ────────────────────────────────────────────────
  // Safe to call at any time, including mid-run, from any thread of control
  // (HTTP/WebSocket handler, CLI side-channel, etc.). Idempotent.

  /**
   * Arm a breakpoint on the given node. Effective from now on for any future
   * invocation of that node's runNode. If the node has already started (i.e.
   * passed the breakpoint check inside runNode), this is a silent no-op for
   * the current invocation — there's no second chance within a single run.
   */
  setBreakpoint(nodeId: string): void {
    if (this.runtimeBreakpoints.has(nodeId)) return;
    this.runtimeBreakpoints.add(nodeId);
    this.emit({ type: 'breakpoint.added', nodeId });
  }

  /** Remove a previously-armed runtime breakpoint. No-op if not set. */
  clearBreakpoint(nodeId: string): void {
    if (!this.runtimeBreakpoints.has(nodeId)) return;
    this.runtimeBreakpoints.delete(nodeId);
    this.emit({ type: 'breakpoint.cleared', nodeId });
  }

  /** Clear every runtime breakpoint at once. */
  clearAllBreakpoints(): void {
    for (const id of [...this.runtimeBreakpoints]) this.clearBreakpoint(id);
  }

  /** Snapshot of currently-armed runtime breakpoints. */
  listRuntimeBreakpoints(): string[] {
    return [...this.runtimeBreakpoints];
  }

  private emit(event: EngineEvent): void {
    this.emitter.emit('event', event);
  }

  async run(
    input: Workflow,
    options: RunOptions = {},
  ): Promise<WorkflowRunResult> {
    const signal = options.signal;

    // Validate against the ORIGINAL workflow so errors mention the user's form.
    const refErrors = validateRefs(input);
    const depErrors = validateDependsOn(input);
    const allErrors = [...refErrors, ...depErrors];
    if (allErrors.length > 0) {
      throw new Error(
        `Workflow has invalid dependencies:\n${allErrors
          .map((e) => `  - ${e}`)
          .join('\n')}`,
      );
    }

    const workflow = normalizeWorkflow(input);
    topoSort(workflow);

    // Seed authored breakpoints (`breakpoint: true`) into the runtime set so the
    // runtime set is the single source of truth for "is this node armed". That
    // lets a breakpoint toggled OFF on the fly be honored — including authored
    // ones — and re-armed via setBreakpoint, all through one mutable set.
    for (const node of workflow.nodes) {
      if (node.breakpoint === true) this.runtimeBreakpoints.add(node.id);
    }

    const { incoming, outgoing } = buildAdjacency(workflow);
    const nodeById = new Map(workflow.nodes.map((n) => [n.id, n]));
    const results = new Map<string, unknown>();
    const states = new Map<string, NodeRunState>();

    for (const node of workflow.nodes) {
      states.set(node.id, {
        nodeId: node.id,
        tool: node.tool,
        status: 'pending',
        typedArgs: node.args,
      });
    }

    const runId = makeRunId();
    const startedAt = Date.now();
    this.emit({
      type: 'workflow.started',
      runId,
      workflowId: workflow.id,
    });

    const ready = new Set<string>();
    const inflight = new Map<string, Promise<{ nodeId: string }>>();

    // Resume: mark seeded nodes 'completed' before scheduling so they don't
    // re-run and their cached results are available to downstream $refs.
    const seed = options.seedResults;
    if (seed) {
      for (const node of workflow.nodes) {
        if (!Object.prototype.hasOwnProperty.call(seed, node.id)) continue;
        const result = seed[node.id];
        const state = states.get(node.id)!;
        results.set(node.id, result);
        state.status = 'completed';
        state.result = result;
        state.startedAt = startedAt;
        state.finishedAt = startedAt;
        state.durationMs = 0;
        this.emit({
          type: 'node.completed',
          nodeId: node.id,
          result,
          durationMs: 0,
        });
      }
    }

    // Ready = every still-pending node whose deps are all completed. With no
    // seed that's exactly the roots; with a seed it also includes nodes
    // unlocked by the seeded completions (e.g. the previously-failed node).
    for (const node of workflow.nodes) {
      const state = states.get(node.id)!;
      if (state.status !== 'pending') continue;
      if (allDepsCompleted(node.id, incoming, states)) {
        state.status = 'ready';
        ready.add(node.id);
        this.emit({ type: 'node.ready', nodeId: node.id });
      }
    }

    while (ready.size > 0 || inflight.size > 0) {
      // Cancellation gate: once aborted, stop launching new work. Ready
      // nodes simply don't start (they keep status 'ready'). In-flight
      // nodes still get awaited so their tool calls can wind down (they
      // observe the same signal — running tools throw abort errors,
      // paused breakpoints resolve via the signal race in handlePause).
      // No per-node status transitions for cancellation — cancellation is
      // a workflow-level event; nodes just freeze where they are.
      if (!signal?.aborted) {
        for (const nodeId of [...ready]) {
          ready.delete(nodeId);
          const node = nodeById.get(nodeId)!;
          inflight.set(
            nodeId,
            this.runNode(node, states, results, signal, options.needsInput),
          );
        }
      } else {
        ready.clear();
      }

      if (inflight.size === 0) break;

      const { nodeId: finished } = await Promise.race(inflight.values());
      inflight.delete(finished);

      const state = states.get(finished)!;
      if (state.status === 'completed') {
        for (const dependentId of outgoing.get(finished) ?? []) {
          const depState = states.get(dependentId);
          if (!depState || depState.status !== 'pending') continue;
          if (allDepsCompleted(dependentId, incoming, states)) {
            depState.status = 'ready';
            ready.add(dependentId);
            this.emit({ type: 'node.ready', nodeId: dependentId });
          }
        }
      } else if (state.status === 'failed' || state.status === 'skipped') {
        this.skipTransitively(
          finished,
          outgoing,
          states,
          reasonForSkip(state),
        );
      }
      // else (status still 'running' or 'paused'): cancellation caught this
      // node mid-execution. Don't touch its status; don't unlock dependents.
      // They'll stay 'pending' and the workflow-level status will be
      // 'cancelled', which together tells the full story.
    }

    const finishedAt = Date.now();
    const status = computeWorkflowStatus(states, signal);
    const durationMs = finishedAt - startedAt;

    this.emit({
      type: 'workflow.completed',
      runId,
      status,
      durationMs,
    });

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

  /**
   * Resolve a raw args record through the $ref pipeline, validate the result
   * is a JSON object, and return it. On any failure (ref resolution error or
   * non-object result), finalize the node as failed and return null so the
   * caller can bail. Used for both the initial resolve from `node.args` and
   * the re-resolve after a `continue-with-args` edit at a breakpoint.
   */
  private tryResolveArgs(
    rawArgs: Record<string, unknown>,
    state: NodeRunState,
    results: Map<string, unknown>,
    startedAt: number,
  ): Record<string, unknown> | null {
    try {
      const resolved = resolveArgs(rawArgs, results);
      if (
        typeof resolved !== 'object' ||
        resolved === null ||
        Array.isArray(resolved)
      ) {
        throw new Error(
          `Resolved args is not a JSON object (got ${describe(resolved)})`,
        );
      }
      return resolved as Record<string, unknown>;
    } catch (err) {
      const message =
        err instanceof RefResolutionError
          ? err.message
          : (err as Error).message;
      this.finalizeFailed(state, startedAt, message);
      return null;
    }
  }

  /**
   * Like `tryResolveArgs` but NEVER finalizes the node as failed: returns the
   * resolved args on success, or `null` on any resolution problem. Used by the
   * input-required gate so a $ref the user/AI wired that doesn't resolve yet
   * re-pauses for a fix instead of killing the node.
   */
  private softResolveArgs(
    rawArgs: Record<string, unknown>,
    results: Map<string, unknown>,
  ): Record<string, unknown> | null {
    try {
      const resolved = resolveArgs(rawArgs, results);
      if (
        typeof resolved !== 'object' ||
        resolved === null ||
        Array.isArray(resolved)
      ) {
        return null;
      }
      return resolved as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  private async runNode(
    node: WorkflowNode,
    states: Map<string, NodeRunState>,
    results: Map<string, unknown>,
    signal: AbortSignal | undefined,
    needsInput?: RunOptions['needsInput'],
  ): Promise<{ nodeId: string }> {
    const state = states.get(node.id)!;
    const startedAt = Date.now();
    state.startedAt = startedAt;

    // 1. Resolve $refs from the authored args.
    let resolvedArgs = this.tryResolveArgs(node.args, state, results, startedAt);
    if (resolvedArgs === null) return { nodeId: node.id };
    state.resolvedArgs = resolvedArgs;

    // 2. BEFORE-call breakpoint (from JSON or set at runtime). Either source
    // pauses the same way — the only difference is what we report to the UI.
    // We re-check the runtime set HERE (not earlier) so a breakpoint added
    // after a node went ready but before it ran still takes effect.
    // Authored breakpoints are seeded into the runtime set at run start, so the
    // set is the single source of truth: a breakpoint cleared on the fly
    // (authored or runtime) won't pause here, and one re-armed will.
    if (this.runtimeBreakpoints.has(node.id)) {
      const source: BreakpointContext['source'] =
        node.breakpoint === true ? 'authored' : 'runtime';
      const outcome = await this.handlePause(
        node,
        state,
        source,
        resolvedArgs,
        signal,
      );
      if (outcome.kind === 'terminal') return { nodeId: node.id };
      if (outcome.kind === 'args') {
        // User overrode the args at the breakpoint. Treat their input as the
        // new "authored" form: store it in typedArgs and run it through the
        // same resolve pipeline, in case they introduced new $refs pointing
        // at other completed nodes. If the new args fail to resolve, the
        // node is finalized as failed inside tryResolveArgs.
        state.typedArgs = outcome.args;
        const reresolved = this.tryResolveArgs(
          outcome.args,
          state,
          results,
          startedAt,
        );
        if (reresolved === null) return { nodeId: node.id };
        resolvedArgs = reresolved;
        state.resolvedArgs = resolvedArgs;
      }
    }

    // 2b. Input-required gate. If a node's args are still missing/blank — or a
    // $ref the user/AI wired doesn't resolve yet — pause WITHOUT a breakpoint and
    // ask the user to provide them (manually or via AI auto-map). We loop so that
    // resuming while values are still missing/unresolvable re-pauses rather than
    // calling the tool with bad args. `rawArgs` tracks the CURRENT authored args
    // (updated by continue-with-args), so a manual edit / AI map clears the gate
    // instead of re-pausing on the original, now-stale args.
    if (needsInput) {
      let rawArgs: Record<string, unknown> = state.typedArgs ?? node.args;
      for (;;) {
        if (signal?.aborted) return { nodeId: node.id };
        // Resolve softly so an edit that introduces an unresolvable $ref re-pauses
        // (lets the user fix it) instead of finalizing the node as failed.
        const resolved = this.softResolveArgs(rawArgs, results);
        let missing: string[];
        if (resolved !== null) {
          resolvedArgs = resolved;
          state.resolvedArgs = resolvedArgs;
          missing = needsInput(node, resolvedArgs, rawArgs);
        } else {
          // Couldn't resolve: blame the $ref-bearing args (fallback: all of them)
          // so the UI highlights what to fix, then re-pause.
          const refArgs = argNamesWithValueRefs(rawArgs);
          missing = refArgs.length > 0 ? refArgs : Object.keys(rawArgs);
        }
        if (missing.length === 0) break;
        const outcome = await this.handlePause(
          node,
          state,
          'missing-input',
          resolvedArgs,
          signal,
          missing,
        );
        if (outcome.kind === 'terminal') return { nodeId: node.id };
        if (outcome.kind === 'args') {
          rawArgs = outcome.args;
          state.typedArgs = outcome.args;
        }
        // A plain 'continue' falls through to the loop's re-check, which
        // re-pauses if the user resumed without fixing the missing values.
      }
    }

    // If cancellation arrived during the pause (or just before), bail out
    // WITHOUT transitioning the status. The node stays in whatever state
    // it was in (typically 'ready' if we returned from handlePause via the
    // signal race). Workflow-level status will be 'cancelled'.
    if (signal?.aborted) return { nodeId: node.id };

    // 3. Call the tool.
    state.status = 'running';
    this.emit({
      type: 'node.started',
      nodeId: node.id,
      tool: node.tool,
      resolvedArgs,
    });

    let result: unknown;
    try {
      result = await this.toolCaller.call(node.tool, resolvedArgs, { signal });
    } catch (err) {
      if (signal?.aborted) {
        // Tool call was aborted by cancellation. Leave status as 'running'
        // to record "this was caught mid-flight"; no node-level finalize.
        return { nodeId: node.id };
      }
      this.finalizeFailed(state, startedAt, (err as Error).message);
      return { nodeId: node.id };
    }

    // Tool returned, but cancellation arrived first. Record the result for
    // the audit trail but don't unlock dependents — status stays 'running'.
    if (signal?.aborted) {
      state.result = result;
      return { nodeId: node.id };
    }

    results.set(node.id, result);
    this.finalizeCompleted(state, startedAt, result);
    return { nodeId: node.id };
  }

  /**
   * Runs the pause-handler protocol for a single breakpoint hit. Returns
   *   - { kind: 'continue' }      — proceed with current args unchanged
   *   - { kind: 'args', args }    — proceed with modified args
   *   - { kind: 'terminal' }      — node was skipped, failed, or cancelled;
   *                                 caller should return immediately
   *
   * The pause is raced against `signal.aborted` so a stuck or signal-ignoring
   * handler can't block cancellation.
   */
  private async handlePause(
    node: WorkflowNode,
    state: NodeRunState,
    source: BreakpointContext['source'],
    args: Record<string, unknown>,
    signal: AbortSignal | undefined,
    missingArgs?: string[],
  ): Promise<
    | { kind: 'continue' }
    | { kind: 'args'; args: Record<string, unknown> }
    | { kind: 'terminal' }
  > {
    // Already cancelled by the time we got here — don't even emit a pause;
    // just return so runNode can bail. Status stays whatever it was (ready).
    if (signal?.aborted) return { kind: 'terminal' };

    const ctx: BreakpointContext = {
      nodeId: node.id,
      tool: node.tool,
      source,
      args,
      ...(missingArgs && missingArgs.length > 0 ? { missingArgs } : {}),
    };

    const previousStatus = state.status;
    state.status = 'paused';
    this.emit({
      type: 'node.paused',
      nodeId: node.id,
      source,
      args,
      ...(missingArgs && missingArgs.length > 0 ? { missingArgs } : {}),
    });

    const action = await raceWithSignal(
      this.pauseHandler.onBreakpoint(ctx, signal),
      signal,
    );

    if (action === 'cancelled') {
      // Pause was forcibly broken by cancellation. Don't emit node.resumed
      // (the user didn't resume anything) and don't transition status —
      // the node stays 'paused' to record "this was abandoned at a
      // breakpoint when the workflow was cancelled".
      return { kind: 'terminal' };
    }

    this.emit({
      type: 'node.resumed',
      nodeId: node.id,
      action: action.type,
    });

    switch (action.type) {
      case 'continue':
        state.status = previousStatus;
        return { kind: 'continue' };
      case 'continue-with-args':
        state.status = previousStatus;
        return { kind: 'args', args: action.args };
      case 'skip':
        this.finalizeSkippedAtBreakpoint(state);
        return { kind: 'terminal' };
      case 'fail':
        this.finalizeFailed(
          state,
          state.startedAt ?? Date.now(),
          action.error,
        );
        return { kind: 'terminal' };
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
      if (!state || state.status !== 'pending') continue;
      state.status = 'skipped';
      state.error = reason;
      this.emit({ type: 'node.skipped', nodeId: next, reason });
      for (const further of outgoing.get(next) ?? []) queue.push(further);
    }
  }

  // ── finalize helpers ──────────────────────────────────────────────────────

  private finalizeCompleted(
    state: NodeRunState,
    startedAt: number,
    result: unknown,
  ): void {
    finalizeBase(state, 'completed', startedAt, result, undefined);
    this.emit({
      type: 'node.completed',
      nodeId: state.nodeId,
      result,
      durationMs: state.durationMs ?? 0,
    });
  }

  private finalizeFailed(
    state: NodeRunState,
    startedAt: number,
    message: string,
  ): void {
    finalizeBase(state, 'failed', startedAt, undefined, message);
    this.emit({
      type: 'node.failed',
      nodeId: state.nodeId,
      error: message,
      durationMs: state.durationMs ?? 0,
    });
  }

  private finalizeSkippedAtBreakpoint(state: NodeRunState): void {
    const reason = 'skipped at breakpoint';
    finalizeBase(
      state,
      'skipped',
      state.startedAt ?? Date.now(),
      undefined,
      reason,
    );
    this.emit({ type: 'node.skipped', nodeId: state.nodeId, reason });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

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
    if (!s || s.status !== 'completed') return false;
  }
  return true;
}

function reasonForSkip(state: NodeRunState): string {
  switch (state.status) {
    case 'skipped':
      return `upstream node "${state.nodeId}" was skipped`;
    case 'failed':
    default:
      return `upstream node "${state.nodeId}" failed`;
  }
}

/**
 * Roll node statuses up into a single workflow status.
 *
 * Precedence:
 *   1. signal aborted → 'cancelled'  (workflow-level; nodes don't have
 *      a 'cancelled' status of their own — they just stay in their
 *      pre-cancel state)
 *   2. any failed node → 'failed'
 *   3. otherwise → 'completed'
 *
 * Note that `skipped` nodes do NOT downgrade the workflow to 'failed':
 *   - the user deliberately chose `skip` at a breakpoint (intent, not failure)
 *   - an upstream dependency failed and we transitively skipped this one
 *     (the causal failure is already captured as an upstream `failed`,
 *      which case 2 picks up)
 * So a workflow whose only skips were user-chosen reports 'completed'.
 */
function computeWorkflowStatus(
  states: Map<string, NodeRunState>,
  signal: AbortSignal | undefined,
): WorkflowStatus {
  if (signal?.aborted) return 'cancelled';
  for (const s of states.values()) {
    if (s.status === 'failed') return 'failed';
  }
  return 'completed';
}

async function raceWithSignal(
  pending: Promise<PauseAction>,
  signal: AbortSignal | undefined,
): Promise<PauseAction | 'cancelled'> {
  if (!signal) return pending;
  if (signal.aborted) return 'cancelled';
  return new Promise<PauseAction | 'cancelled'>((resolve) => {
    let settled = false;
    const settle = (v: PauseAction | 'cancelled') => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      resolve(v);
    };
    const onAbort = () => settle('cancelled');
    signal.addEventListener('abort', onAbort, { once: true });
    pending.then(
      (action) => settle(action),
      () => settle('cancelled'),
    );
  });
}

function makeRunId(): string {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

// Top-level argument names whose value contains a `$ref` (at any depth). Used to
// point the user at the fields to fix when resolution of edited args fails.
function argNamesWithValueRefs(args: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [name, value] of Object.entries(args)) {
    let hasRef = false;
    walkRefs(value, () => {
      hasRef = true;
    });
    if (hasRef) out.push(name);
  }
  return out;
}
