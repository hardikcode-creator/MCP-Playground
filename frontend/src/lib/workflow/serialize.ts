import type { Edge, Node } from "@xyflow/react";
import type { ToolNodeData } from "../../state/workflowStore";
import type { Workflow } from "./types";

function safeParseArgs(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Run-gating prevents reaching here with invalid JSON; fall back to {}.
  }
  return {};
}

// Turn the canvas (nodes + manual edges) into the backend's exact Workflow
// JSON. `dependsOn` carries only the MANUAL edges; the executor's
// normalizeWorkflow unions $ref sources into dependsOn at run time, so we
// don't duplicate them here. $ref objects already sit in the node args in the
// backend shape ({ "$ref": { nodeId, path } }).
export function serializeWorkflow(
  nodes: Node<ToolNodeData>[],
  edges: Edge[],
  opts?: { id?: string; name?: string },
): Workflow {
  const incoming = new Map<string, Set<string>>();
  for (const n of nodes) incoming.set(n.id, new Set());
  for (const e of edges) {
    if (e.source && e.target && incoming.has(e.target)) {
      incoming.get(e.target)!.add(e.source);
    }
  }

  return {
    id: opts?.id ?? `wf-${Date.now().toString(36)}`,
    version: 1,
    ...(opts?.name ? { name: opts.name } : {}),
    nodes: nodes.map((n) => ({
      id: n.id,
      tool: n.data.qualifiedName,
      args: safeParseArgs(n.data.argsText),
      dependsOn: [...(incoming.get(n.id) ?? [])],
      breakpoint: Boolean(n.data.breakpoint),
    })),
  };
}
