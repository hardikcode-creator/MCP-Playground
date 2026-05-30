// Byte-faithful port of backend/src/workflow/graph.ts: adjacency, ref/dep
// validation, normalization (ref sources union into dependsOn), and a
// Kahn topological sort that throws on cycles.

import type { Workflow, WorkflowNode } from "./types";
import { walkRefs } from "./refs";

export type DependencyMap = Map<string, Set<string>>;

export type AdjacencyResult = {
  incoming: DependencyMap;
  outgoing: DependencyMap;
};

export function refSourcesOf(node: WorkflowNode): Set<string> {
  const sources = new Set<string>();
  walkRefs(node.args, (ref) => sources.add(ref.$ref.nodeId));
  return sources;
}

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
        errors.push(`Node "${node.id}" lists itself in dependsOn (self-cycle)`);
      }
    }
  }
  return errors;
}

export function normalizeWorkflow(workflow: Workflow): Workflow {
  const selfCycles: string[] = [];
  const nodes = workflow.nodes.map((node) => {
    const refSources = refSourcesOf(node);
    const refSelf = refSources.has(node.id);
    const dependsSelf = node.dependsOn.includes(node.id);
    if (refSelf || dependsSelf) {
      const via: string[] = [];
      if (refSelf) via.push("$ref");
      if (dependsSelf) via.push("dependsOn");
      selfCycles.push(`Node "${node.id}" depends on itself (via ${via.join(" and ")})`);
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
  readonly issues: string[];
  constructor(issues: string[]) {
    const lines = issues.map((i) => `  - ${i}`);
    super(`Workflow normalization failed (self-cycles found):\n${lines.join("\n")}`);
    this.name = "WorkflowNormalizationError";
    this.issues = issues;
  }
}

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
    const stuck = workflow.nodes.map((n) => n.id).filter((id) => !order.includes(id));
    const cyclePath = findCycle(stuck, outgoing);
    throw new CycleError(stuck, cyclePath);
  }
  return order;
}

function findCycle(stuckIds: string[], outgoing: DependencyMap): string[] {
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
  readonly stuckNodes: string[];
  readonly cyclePath: string[];
  constructor(stuckNodes: string[], cyclePath: string[]) {
    const detail =
      cyclePath.length > 0
        ? `cycle path: ${cyclePath.join(" -> ")}`
        : `nodes involved: ${stuckNodes.join(", ")}`;
    super(`Workflow contains a cycle (${detail})`);
    this.name = "CycleError";
    this.stuckNodes = stuckNodes;
    this.cyclePath = cyclePath;
  }
}
