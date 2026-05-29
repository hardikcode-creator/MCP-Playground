import type { Workflow, WorkflowNode } from '../types/workflow.js';
import { walkRefs } from './refs.js';

/**
 * Adjacency representation. For a workflow with nodes A → B → C:
 *   incoming.get('C') = { 'B' }    (C depends on B)
 *   outgoing.get('B') = { 'C' }    (B unlocks C when it finishes)
 */
export type DependencyMap = Map<string, Set<string>>;

export type AdjacencyResult = {
  incoming: DependencyMap;
  outgoing: DependencyMap;
};

/**
 * Scan a node's args for $refs and return the set of source node IDs.
 * This is used at LOAD TIME by `normalizeWorkflow` to derive ordering edges
 * from data refs. The executor itself never calls this — it reads only
 * from `dependsOn` (which is canonical after normalization).
 */
export function refSourcesOf(node: WorkflowNode): Set<string> {
  const sources = new Set<string>();
  walkRefs(node.args, (ref) => sources.add(ref.$ref.nodeId));
  return sources;
}

/**
 * The dependency contract for a NORMALIZED workflow: just read `dependsOn`.
 *
 * This is the runtime spine of the engine. Every consumer (cycle detection,
 * topo sort, adjacency, the executor's ready/inflight/done loop) calls this
 * one function. By making it trivial — and concentrating the "derive from
 * refs" logic into `normalizeWorkflow` — the rest of the codebase stays small
 * and obviously correct.
 *
 * Calling this on a non-normalized workflow is safe but may underreport deps
 * (specifically, ref-based deps that haven't been unioned into dependsOn).
 * Always go through `normalizeWorkflow` first.
 */
export function dependenciesOf(node: WorkflowNode): Set<string> {
  return new Set(node.dependsOn);
}

export function buildAdjacency(workflow: Workflow): AdjacencyResult {
  const incoming: DependencyMap = new Map();
  const outgoing: DependencyMap = new Map();

  for (const node of workflow.nodes) {
    incoming.set(node.id, new Set());
    outgoing.set(node.id, new Set());
  }
  for (const node of workflow.nodes) {
    for (const dep of dependenciesOf(node)) {
      incoming.get(node.id)!.add(dep);
      const outSet = outgoing.get(dep);
      if (outSet) outSet.add(node.id);
    }
  }
  return { incoming, outgoing };
}

/**
 * Validate that every $ref in `args` points to an existing node and never to
 * itself. Reports $ref-specific errors so the user gets a clear message
 * (e.g. "Node X has $ref to unknown node Y", not the more generic
 * "dependsOn includes Y").
 *
 * This runs on the ORIGINAL (pre-normalized) workflow because normalization
 * silently dedupes; running this first surfaces typos in $refs before they
 * get smeared into dependsOn.
 */
export function validateRefs(workflow: Workflow): string[] {
  const errors: string[] = [];
  const known = new Set(workflow.nodes.map((n) => n.id));
  for (const node of workflow.nodes) {
    walkRefs(node.args, (ref) => {
      const target = ref.$ref.nodeId;
      if (!known.has(target)) {
        errors.push(`Node "${node.id}" has $ref to unknown node "${target}"`);
      } else if (target === node.id) {
        errors.push(`Node "${node.id}" has a $ref to itself (self-cycle)`);
      }
    });
  }
  return errors;
}

/**
 * Validate the user-written `dependsOn` entries: every id must reference an
 * existing node, no node may list itself. Mirrors validateRefs but for
 * explicit ordering edges.
 */
export function validateDependsOn(workflow: Workflow): string[] {
  const errors: string[] = [];
  const known = new Set(workflow.nodes.map((n) => n.id));
  for (const node of workflow.nodes) {
    for (const dep of node.dependsOn) {
      if (!known.has(dep)) {
        errors.push(
          `Node "${node.id}" has dependsOn entry "${dep}" which is not a node in this workflow`,
        );
      } else if (dep === node.id) {
        errors.push(
          `Node "${node.id}" lists itself in dependsOn (self-cycle)`,
        );
      }
    }
  }
  return errors;
}

/**
 * Returns a new Workflow where each node's `dependsOn` is the union of:
 *   1. the user's explicit `dependsOn` entries (control edges)
 *   2. every node referenced by a $ref anywhere in this node's args (data edges)
 *
 * Throws `WorkflowNormalizationError` if any node ends up depending on itself
 * (via either a self-`$ref` or a self-entry in `dependsOn`). We do NOT silently
 * strip self-references: silent stripping would hide real bugs. The validators
 * (`validateRefs` / `validateDependsOn`) catch this earlier when called, but
 * normalize is defensive and also throws if invoked directly (e.g. by the
 * loader, or by a programmatic caller that bypassed the validators).
 *
 * After this transform, the rest of the engine doesn't need to know that
 * refs exist at all for the purposes of ordering — `dependsOn` IS the graph.
 * Refs still drive value substitution at runtime (resolveArgs).
 *
 * Idempotent on well-formed input: normalizing an already-normalized workflow
 * is a no-op.
 */
export function normalizeWorkflow(workflow: Workflow): Workflow {
  const selfCycles: string[] = [];
  const nodes = workflow.nodes.map((node) => {
    const refSources = refSourcesOf(node);
    const refSelf = refSources.has(node.id);
    const dependsSelf = node.dependsOn.includes(node.id);
    if (refSelf || dependsSelf) {
      const via: string[] = [];
      if (refSelf) via.push('$ref');
      if (dependsSelf) via.push('dependsOn');
      selfCycles.push(
        `Node "${node.id}" depends on itself (via ${via.join(' and ')})`,
      );
    }
    const merged = new Set<string>(node.dependsOn);
    for (const src of refSources) merged.add(src);
    return { ...node, dependsOn: [...merged] };
  });
  if (selfCycles.length > 0) {
    throw new WorkflowNormalizationError(selfCycles);
  }
  return { ...workflow, nodes };
}

export class WorkflowNormalizationError extends Error {
  constructor(public readonly issues: string[]) {
    const lines = issues.map((i) => `  - ${i}`);
    super(
      `Workflow normalization failed (self-cycles found):\n${lines.join('\n')}`,
    );
    this.name = 'WorkflowNormalizationError';
  }
}

/**
 * Kahn's algorithm. Produces a topological order, OR throws CycleError if
 * the graph contains a cycle. Even though the executor runs in parallel
 * (not strictly in topo order), this is the canonical way to detect cycles.
 */
export function topoSort(workflow: Workflow): string[] {
  const { incoming, outgoing } = buildAdjacency(workflow);

  const indegree = new Map<string, number>();
  for (const [id, deps] of incoming) indegree.set(id, deps.size);

  const queue: string[] = [];
  for (const [id, n] of indegree) {
    if (n === 0) queue.push(id);
  }

  const order: string[] = [];
  while (queue.length > 0) {
    const next = queue.shift()!;
    order.push(next);
    for (const dependent of outgoing.get(next) ?? []) {
      const remaining = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, remaining);
      if (remaining === 0) queue.push(dependent);
    }
  }

  if (order.length !== workflow.nodes.length) {
    const stuck = workflow.nodes
      .map((n) => n.id)
      .filter((id) => !order.includes(id));
    const cyclePath = findCycle(stuck, outgoing);
    throw new CycleError(stuck, cyclePath);
  }
  return order;
}

/**
 * Given a set of nodes known to be tangled in (or fed by) a cycle, return
 * one concrete cycle as an ordered list of node IDs that closes back to the
 * first. DFS along outgoing edges, restricted to the stuck set, until we
 * revisit a node currently on the path.
 */
function findCycle(
  stuckIds: string[],
  outgoing: DependencyMap,
): string[] {
  if (stuckIds.length === 0) return [];
  const stuck = new Set(stuckIds);
  const path: string[] = [];
  const onPath = new Set<string>();

  function dfs(node: string): string[] | null {
    if (onPath.has(node)) {
      const idx = path.indexOf(node);
      return path.slice(idx).concat(node);
    }
    onPath.add(node);
    path.push(node);
    for (const next of outgoing.get(node) ?? []) {
      if (!stuck.has(next)) continue;
      const found = dfs(next);
      if (found) return found;
    }
    path.pop();
    onPath.delete(node);
    return null;
  }

  for (const start of stuckIds) {
    const found = dfs(start);
    if (found) return found;
  }
  return [];
}

export class CycleError extends Error {
  constructor(
    public readonly stuckNodes: string[],
    public readonly cyclePath: string[],
  ) {
    const detail =
      cyclePath.length > 0
        ? `cycle path: ${cyclePath.join(' -> ')}`
        : `nodes involved: ${stuckNodes.join(', ')}`;
    super(`Workflow contains a cycle (${detail})`);
    this.name = 'CycleError';
  }
}
