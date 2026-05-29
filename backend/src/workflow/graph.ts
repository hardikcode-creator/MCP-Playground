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
 * Returns the set of upstream node IDs this node depends on. Derived purely
 * from $refs inside the node's args — there is no separate "edges" array in
 * the workflow JSON. This makes the visual graph and the executable graph
 * trivially consistent.
 */
export function dependenciesOf(node: WorkflowNode): Set<string> {
  const deps = new Set<string>();
  walkRefs(node.args, (ref) => deps.add(ref.$ref.nodeId));
  return deps;
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
 * Validate that:
 *   - every $ref.nodeId references a node that actually exists
 *   - no node references itself (trivial 1-cycle)
 * Returns a list of human-readable error strings (empty if clean).
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
