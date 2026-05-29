import { EventEmitter } from 'node:events';
import {
  type EngineEvent,
  type NodeRunState,
  type NodeStatus,
  type Workflow,
  type WorkflowNode,
  type WorkflowRunResult,
} from '../types/workflow.js';
import {
  buildAdjacency,
  type DependencyMap,
  topoSort,
  validateRefs,
} from './graph.js';
import { RefResolutionError, resolveArgs } from './refs.js';

/**
 * The executor depends on a ToolCaller, not on the concrete ClientManager.
 * This is the dependency-inversion seam: any future surface (WebSocket,
 * MCP-server adapter, in-process tests with mocks) can provide its own
 * implementation without the executor changing.
 */
export interface ToolCaller {
  call(qualifiedName: string, args: Record<string, unknown>): Promise<unknown>;
}

/**
 * Runs a Workflow DAG.
 *
 * Lifecycle per invocation of run():
 *   1. validateRefs   — every $ref points to an existing node, no self-refs
 *   2. topoSort       — throws CycleError if the dep graph isn't a DAG
 *   3. seed `ready` with nodes that have no incoming edges
 *   4. loop:
 *        - move every ready node into `inflight`, launch its promise
 *        - await Promise.race(inflight.values())
 *        - on completion: cache result, unlock dependents whose deps are all done
 *        - on failure: transitively mark dependents as `skipped`
 *      until both `ready` and `inflight` are empty
 *   5. emit workflow.completed; return WorkflowRunResult
 *
 * The executor emits an EngineEvent for every state transition. CLI subscribes
 * and prints them; future WebSocket subscriber will broadcast them — identical
 * payloads, different transports.
 */
export class WorkflowExecutor {
  private readonly emitter = new EventEmitter();

  constructor(private readonly toolCaller: ToolCaller) {}

  on(listener: (event: EngineEvent) => void): () => void {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }

  private emit(event: EngineEvent): void {
    this.emitter.emit('event', event);
  }

  async run(workflow: Workflow): Promise<WorkflowRunResult> {
    const refErrors = validateRefs(workflow);
    if (refErrors.length > 0) {
      throw new Error(
        `Workflow has invalid references:\n${refErrors
          .map((e) => `  - ${e}`)
          .join('\n')}`,
      );
    }
    topoSort(workflow); // for its side effect: throws CycleError if any cycle exists

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

    for (const [nodeId, deps] of incoming) {
      if (deps.size === 0) {
        states.get(nodeId)!.status = 'ready';
        ready.add(nodeId);
        this.emit({ type: 'node.ready', nodeId });
      }
    }

    while (ready.size > 0 || inflight.size > 0) {
      for (const nodeId of [...ready]) {
        ready.delete(nodeId);
        const node = nodeById.get(nodeId)!;
        inflight.set(
          nodeId,
          this.runNode(node, states, results),
        );
      }

      // Wait for ANY inflight to finish. The promise resolves with its own
      // nodeId so we know which entry to remove from the map.
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
      } else if (state.status === 'failed') {
        this.skipTransitively(
          finished,
          outgoing,
          states,
          `upstream node "${finished}" failed`,
        );
      }
    }

    const finishedAt = Date.now();
    const anyBad = [...states.values()].some(
      (s) => s.status === 'failed' || s.status === 'skipped',
    );
    const status: 'completed' | 'failed' = anyBad ? 'failed' : 'completed';
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

  private async runNode(
    node: WorkflowNode,
    states: Map<string, NodeRunState>,
    results: Map<string, unknown>,
  ): Promise<{ nodeId: string }> {
    const state = states.get(node.id)!;
    const startedAt = Date.now();
    state.startedAt = startedAt;

    let resolvedArgs: Record<string, unknown>;
    try {
      const resolved = resolveArgs(node.args, results);
      if (
        typeof resolved !== 'object' ||
        resolved === null ||
        Array.isArray(resolved)
      ) {
        throw new Error(
          `Resolved args is not a JSON object (got ${describe(resolved)})`,
        );
      }
      resolvedArgs = resolved as Record<string, unknown>;
    } catch (err) {
      const message =
        err instanceof RefResolutionError
          ? err.message
          : (err as Error).message;
      finalize(state, 'failed', startedAt, undefined, message);
      this.emit({
        type: 'node.failed',
        nodeId: node.id,
        error: message,
        durationMs: state.durationMs ?? 0,
      });
      return { nodeId: node.id };
    }

    state.resolvedArgs = resolvedArgs;
    state.status = 'running';
    this.emit({
      type: 'node.started',
      nodeId: node.id,
      tool: node.tool,
      resolvedArgs,
    });

    try {
      const result = await this.toolCaller.call(node.tool, resolvedArgs);
      results.set(node.id, result);
      finalize(state, 'completed', startedAt, result);
      this.emit({
        type: 'node.completed',
        nodeId: node.id,
        result,
        durationMs: state.durationMs ?? 0,
      });
    } catch (err) {
      const message = (err as Error).message;
      finalize(state, 'failed', startedAt, undefined, message);
      this.emit({
        type: 'node.failed',
        nodeId: node.id,
        error: message,
        durationMs: state.durationMs ?? 0,
      });
    }
    return { nodeId: node.id };
  }

  private skipTransitively(
    failedNodeId: string,
    outgoing: DependencyMap,
    states: Map<string, NodeRunState>,
    reason: string,
  ): void {
    const queue = [...(outgoing.get(failedNodeId) ?? [])];
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
}

function finalize(
  state: NodeRunState,
  status: NodeStatus,
  startedAt: number,
  result?: unknown,
  error?: string,
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

function makeRunId(): string {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}
