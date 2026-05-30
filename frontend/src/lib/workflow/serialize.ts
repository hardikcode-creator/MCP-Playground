import type { Edge, Node } from "@xyflow/react";
import type { ToolDescriptor } from "../../types";
import type { ToolNodeData } from "../../state/workflowStore";
import type { Workflow } from "./types";
import { NODE_ID_PATTERN } from "./types";

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

// ── Import (inverse of serializeWorkflow) ────────────────────────────────────

export type WorkflowImportResult =
  | { ok: true; nodes: Node<ToolNodeData>[]; edges: Edge[]; warnings: string[] }
  | { ok: false; errors: string[] };

const X_GAP = 240;
const Y_GAP = 150;

// Backend Workflow JSON carries no layout, so lay nodes out top-down by
// dependency depth (sources above the nodes that depend on them, matching the
// node handles: target on top, source on bottom). Cycle-safe.
function layoutByDeps(
  nodes: Array<{ id: string; dependsOn: string[] }>,
): Map<string, { x: number; y: number }> {
  const ids = new Set(nodes.map((n) => n.id));
  const deps = new Map(nodes.map((n) => [n.id, n.dependsOn.filter((d) => ids.has(d) && d !== n.id)]));
  const layer = new Map<string, number>();
  const visiting = new Set<string>();
  const depth = (id: string): number => {
    const cached = layer.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0; // guard against malformed cyclic input
    visiting.add(id);
    const ds = deps.get(id) ?? [];
    const d = ds.length === 0 ? 0 : Math.max(...ds.map(depth)) + 1;
    visiting.delete(id);
    layer.set(id, d);
    return d;
  };
  for (const n of nodes) depth(n.id);

  const byLayer = new Map<number, string[]>();
  for (const n of nodes) {
    const l = layer.get(n.id) ?? 0;
    const row = byLayer.get(l);
    if (row) row.push(n.id);
    else byLayer.set(l, [n.id]);
  }
  const pos = new Map<string, { x: number; y: number }>();
  for (const [l, row] of byLayer) {
    row.forEach((id, i) => pos.set(id, { x: i * X_GAP, y: l * Y_GAP }));
  }
  return pos;
}

// Parse + validate a saved Workflow JSON and rebuild canvas nodes/edges. Every
// tool referenced by the workflow must exist in the live catalog (i.e. the
// matching mcp-config is connected) — otherwise the import fails with an error
// naming the missing tools, since a node with no real tool can't run. Tools are
// resolved against the catalog for their schema/labels. Unknown dependsOn
// targets are dropped (with a warning).
export function deserializeWorkflow(text: string, catalog: ToolDescriptor[]): WorkflowImportResult {
  if (text.trim().length === 0) {
    return { ok: false, errors: ["Paste a saved workflow JSON to import."] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`Invalid JSON: ${(e as Error).message}`] };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, errors: ["Workflow must be a JSON object with a `nodes` array."] };
  }
  const rawNodes = (parsed as { nodes?: unknown }).nodes;
  if (!Array.isArray(rawNodes)) {
    return { ok: false, errors: ["Workflow must have a `nodes` array."] };
  }
  if (rawNodes.length === 0) {
    return { ok: false, errors: ["Workflow has no nodes."] };
  }

  type ParsedNode = {
    id: string;
    tool: string;
    args: Record<string, unknown>;
    dependsOn: string[];
    breakpoint: boolean;
  };
  const errors: string[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  const parsedNodes: ParsedNode[] = [];

  rawNodes.forEach((raw, i) => {
    const n = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const where = `nodes[${i}]`;

    const id = typeof n.id === "string" ? n.id : "";
    if (!id) errors.push(`${where}.id is required.`);
    else if (!NODE_ID_PATTERN.test(id))
      errors.push(
        `${where}.id "${id}" must start with a letter and use only letters, digits, underscores, and hyphens.`,
      );
    else if (seen.has(id)) errors.push(`Duplicate node id "${id}".`);
    if (id) seen.add(id);

    const tool = typeof n.tool === "string" ? n.tool : "";
    if (!tool) errors.push(`${where}.tool is required.`);

    let args: Record<string, unknown> = {};
    if (n.args !== undefined) {
      if (n.args && typeof n.args === "object" && !Array.isArray(n.args)) {
        args = n.args as Record<string, unknown>;
      } else {
        errors.push(`${where}.args must be an object.`);
      }
    }

    let dependsOn: string[] = [];
    if (n.dependsOn !== undefined) {
      if (Array.isArray(n.dependsOn) && n.dependsOn.every((d) => typeof d === "string")) {
        dependsOn = n.dependsOn as string[];
      } else {
        errors.push(`${where}.dependsOn must be an array of node ids.`);
      }
    }

    const breakpoint = n.breakpoint === undefined ? false : Boolean(n.breakpoint);
    parsedNodes.push({ id, tool, args, dependsOn, breakpoint });
  });

  if (errors.length > 0) return { ok: false, errors };

  // Drop dependsOn entries that don't point at a real node so edges stay valid.
  const idSet = new Set(parsedNodes.map((n) => n.id));
  for (const n of parsedNodes) {
    const missing = n.dependsOn.filter((d) => !idSet.has(d));
    if (missing.length > 0) {
      warnings.push(`Node "${n.id}" depends on unknown node(s) ${missing.join(", ")} — those links were dropped.`);
      n.dependsOn = n.dependsOn.filter((d) => idSet.has(d));
    }
  }

  const byName = new Map(catalog.map((t) => [t.qualifiedName, t]));

  // Every tool must resolve against the connected catalog. If the mcp-config
  // that exposes these tools isn't loaded, fail with a clear, actionable error
  // instead of importing dead nodes that can't run.
  const missingNodes = parsedNodes.filter((n) => !byName.has(n.tool));
  if (missingNodes.length > 0) {
    const errs: string[] = [];
    if (catalog.length === 0) {
      errs.push(
        "No MCP servers are connected. Load an mcp-config that provides this workflow's tools, then import.",
      );
    }
    const uniqueMissing = [...new Set(missingNodes.map((n) => n.tool))];
    for (const t of uniqueMissing) {
      const server = t.split("__")[0] || "unknown";
      const usedBy = missingNodes
        .filter((n) => n.tool === t)
        .map((n) => `"${n.id}"`)
        .join(", ");
      errs.push(
        `Tool "${t}" (server "${server}") used by node ${usedBy} isn't in the connected catalog. Load the mcp-config that exposes it, then import.`,
      );
    }
    return { ok: false, errors: errs };
  }

  const pos = layoutByDeps(parsedNodes);

  const nodes: Node<ToolNodeData>[] = parsedNodes.map((n) => {
    const tool = byName.get(n.tool);
    const [server, ...rest] = n.tool.split("__");
    return {
      id: n.id,
      type: "tool",
      position: pos.get(n.id) ?? { x: 0, y: 0 },
      data: {
        qualifiedName: n.tool,
        baseName: tool?.baseName ?? (rest.join("__") || n.tool),
        serverName: tool?.serverName ?? (server || "unknown"),
        description: tool?.description ?? "Imported tool — not in the current catalog.",
        inputSchema: tool?.inputSchema ?? { type: "object", properties: {} },
        argsText: JSON.stringify(n.args, null, 2),
        lastResult: null,
        status: "idle",
        breakpoint: n.breakpoint,
      },
    };
  });

  const edges: Edge[] = [];
  for (const n of parsedNodes) {
    for (const dep of n.dependsOn) {
      edges.push({ id: `${dep}->${n.id}`, source: dep, target: n.id, type: "deletable" });
    }
  }

  return { ok: true, nodes, edges, warnings };
}
