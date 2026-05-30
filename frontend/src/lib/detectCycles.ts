import type { Edge } from "@xyflow/react";

/**
 * DFS-based cycle detection for a directed graph.
 *
 * Returns the ids of every node that participates in a cycle (i.e. nodes whose
 * DFS path forms a back-edge). Nodes that are merely downstream of a cycle are
 * NOT included — only the nodes actually in the loop.
 *
 * Runs in O(N + E).
 */
export function detectCycles(
  nodeIds: string[],
  edges: Edge[],
): string[] {
  // Build adjacency list: nodeId → outgoing neighbour ids
  const adj = new Map<string, string[]>();
  for (const id of nodeIds) adj.set(id, []);
  for (const e of edges) {
    if (adj.has(e.source)) adj.get(e.source)!.push(e.target);
  }

  const visited = new Set<string>();
  const onStack = new Set<string>(); // nodes in the current DFS path
  const cycleNodes = new Set<string>();

  function dfs(nodeId: string): boolean {
    visited.add(nodeId);
    onStack.add(nodeId);

    for (const neighbour of adj.get(nodeId) ?? []) {
      if (!visited.has(neighbour)) {
        if (dfs(neighbour)) {
          // Back-propagate: if a descendant found a cycle and we're still on
          // the stack, we're part of it too.
          if (onStack.has(nodeId)) cycleNodes.add(nodeId);
        }
      } else if (onStack.has(neighbour)) {
        // Back-edge found — both ends are in the cycle.
        cycleNodes.add(nodeId);
        cycleNodes.add(neighbour);
      }
    }

    onStack.delete(nodeId);
    return cycleNodes.has(nodeId);
  }

  for (const id of nodeIds) {
    if (!visited.has(id)) dfs(id);
  }

  return [...cycleNodes];
}
