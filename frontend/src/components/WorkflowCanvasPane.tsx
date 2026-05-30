import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  BackgroundVariant,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import type { EdgeTypes, NodeTypes } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useAppState } from "../state/appState";
import type { WorkflowState } from "../state/workflowStore";
import { ToolNode } from "./canvas/ToolNode";
import { DeletableEdge } from "./canvas/DeletableEdge";
import { detectCycles } from "../lib/detectCycles";
import { findMissingRequired } from "../lib/schema";
import { collectValueRefNodeIds } from "../lib/workflowRefs";

const NODE_TYPES: NodeTypes = { tool: ToolNode as NodeTypes[string] };
const EDGE_TYPES: EdgeTypes = { deletable: DeletableEdge as EdgeTypes[string] };

const DND_TYPE = "application/mcp-tool";

function PlayIcon() {
  return (
    <svg width={11} height={11} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5.14c0-.86.96-1.37 1.67-.88l9.2 6.86a1.06 1.06 0 0 1 0 1.76l-9.2 6.86c-.71.49-1.67-.02-1.67-.88z" />
    </svg>
  );
}

function Canvas({
  workflow,
  onSelectWorkflowNode,
  onOpenInspector,
}: {
  workflow: WorkflowState;
  onSelectWorkflowNode: (nodeId: string, qualifiedName: string) => void;
  onOpenInspector: () => void;
}) {
  const { catalog, callTool } = useAppState();
  const {
    nodes,
    edges,
    workflowRunning,
    setCycleNodeIds,
    addNode,
    onNodesChange,
    onEdgesChange,
    onConnect,
    resetStatuses,
    runWorkflow,
  } = workflow;
  const { screenToFlowPosition } = useReactFlow();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dismissedCycleKey, setDismissedCycleKey] = useState<string | null>(null);
  const prevCycleRef = useRef<string[]>([]);

  // Derive cycle ids from graph structure only (node ids + edges).
  // We intentionally exclude full node objects to avoid recomputing when
  // data.status changes (which would create an infinite loop).
  const edgeKey = useMemo(
    () => edges.map((e) => `${e.source}->${e.target}`).sort().join("|"),
    [edges],
  );
  const refDependencyEdges = useMemo(() => {
    const existingIds = new Set(nodes.map((n) => n.id));
    const refs: Array<{ source: string; target: string }> = [];
    for (const n of nodes) {
      try {
        const parsed = JSON.parse(n.data.argsText || "{}");
        const nodeIds = collectValueRefNodeIds(parsed);
        for (const sourceId of nodeIds) {
          if (existingIds.has(sourceId)) refs.push({ source: sourceId, target: n.id });
        }
      } catch {
        // Ignore JSON parse issues here; invalid args are handled by run gating/inspector.
      }
    }
    return refs;
  }, [nodes]);
  const refEdgeKey = useMemo(
    () => refDependencyEdges.map((e) => `${e.source}->${e.target}`).sort().join("|"),
    [refDependencyEdges],
  );
  const nodeIdKey = useMemo(
    () => nodes.map((n) => n.id).sort().join("|"),
    [nodes],
  );
  const cycleIds = useMemo(
    () =>
      detectCycles(
        nodes.map((n) => n.id),
        [
          ...edges,
          ...refDependencyEdges.map((e, idx) => ({
            id: `ref-${idx}-${e.source}-${e.target}`,
            source: e.source,
            target: e.target,
          })),
        ],
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nodeIdKey, edgeKey, refEdgeKey],
  );

  // Sync cycle status into node data only when the cycle set content changes,
  // not on every render (prevents the setState→rerender→useMemo→setState loop).
  useEffect(() => {
    const prev = prevCycleRef.current;
    const changed =
      prev.length !== cycleIds.length ||
      cycleIds.some((id, i) => prev[i] !== id);
    if (!changed) return;
    prevCycleRef.current = cycleIds;
    setCycleNodeIds(cycleIds);
  }, [cycleIds, setCycleNodeIds]);

  // Edges whose source node is currently running get animated flowing dashes.
  const runningIds = new Set(
    nodes.filter((n) => n.data.status === "running").map((n) => n.id),
  );
  const displayEdges = edges.map((e) => ({
    ...e,
    type: "deletable",
    animated: runningIds.has(e.source),
    style: runningIds.has(e.source)
      ? { stroke: "#f59e0b", strokeWidth: 2 }
      : undefined,
  }));

  const onDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }, []);

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const qualifiedName = e.dataTransfer.getData(DND_TYPE);
      if (!qualifiedName) return;
      const tool = catalog.find((t) => t.qualifiedName === qualifiedName);
      if (!tool) return;
      const position = screenToFlowPosition({ x: e.clientX, y: e.clientY });
      addNode(tool, position);
    },
    [catalog, screenToFlowPosition, addNode],
  );

  const handleRunWorkflow = useCallback(() => {
    resetStatuses();
    void runWorkflow(callTool);
  }, [resetStatuses, runWorkflow, callTool]);

  // Build a human-readable cycle node name list for the banner.
  const cycleNodeNames = useMemo(() => {
    return cycleIds
      .map((id) => nodes.find((n) => n.id === id)?.data.baseName ?? id)
      .join(", ");
  }, [cycleIds, nodes]);

  const hasCycle = cycleIds.length > 0;
  const hasInvalidArgs = useMemo(() => {
    for (const n of nodes) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(n.data.argsText || "{}");
      } catch {
        return true;
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return true;
      if (findMissingRequired(n.data.inputSchema, parsed as Record<string, unknown>).length > 0) return true;
    }
    return false;
  }, [nodes]);
  const showBanner = hasCycle && dismissedCycleKey !== edgeKey;

  return (
    <>
      {/* Cycle warning banner */}
      {showBanner && (
        <div className="flex items-start justify-between gap-3 border-b border-orange-800/60 bg-orange-950/40 px-3 py-2">
          <div className="flex items-start gap-2">
            <svg
              className="mt-px h-3.5 w-3.5 shrink-0 text-orange-400"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 2L1 10h10L6 2z" />
              <path d="M6 5v3" />
              <circle cx="6" cy="9.5" r="0.5" fill="currentColor" stroke="none" />
            </svg>
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-semibold text-orange-300">
                Cycle detected — break the loop to run.
              </span>
              <span className="font-mono text-[10px] text-orange-500">
                Nodes in cycle: {cycleNodeNames}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setDismissedCycleKey(edgeKey)}
            aria-label="Dismiss warning"
            className="mt-px shrink-0 text-orange-500 hover:text-orange-300"
          >
            <svg width={10} height={10} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
              <path d="M2 2l6 6M8 2l-6 6" />
            </svg>
          </button>
        </div>
      )}

      {/* Per-canvas toolbar strip */}
      <div className="flex items-center justify-between border-b border-zinc-800/60 bg-zinc-950 px-3 py-1.5">
        <div className="flex items-center gap-2">
          {nodes.length > 0 && (
            <span className="font-mono text-[10px] text-zinc-600">
              {nodes.length} node{nodes.length === 1 ? "" : "s"} · {edges.length} edge{edges.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <button
          type="button"
          disabled={nodes.length === 0 || workflowRunning || hasCycle || hasInvalidArgs}
          onClick={handleRunWorkflow}
          title={hasCycle ? "Resolve cycle before running" : hasInvalidArgs ? "Fix invalid node args before running" : undefined}
          className="flex items-center gap-1.5 rounded-md border border-emerald-700/60 bg-emerald-900/40 px-2.5 py-1 text-xs font-medium text-emerald-300 transition-all hover:border-emerald-500 hover:bg-emerald-900/70 hover:text-emerald-200 disabled:cursor-not-allowed disabled:border-zinc-700 disabled:bg-transparent disabled:text-zinc-600"
        >
          <PlayIcon />
          {workflowRunning ? "Running…" : "Run Workflow"}
        </button>
      </div>

      <div ref={containerRef} className="h-full w-full" onDragOver={onDragOver} onDrop={onDrop}>
        <ReactFlow
          nodes={nodes}
          edges={displayEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_, node) => {
            onSelectWorkflowNode(node.id, node.data.qualifiedName);
            onOpenInspector();
          }}
          nodeTypes={NODE_TYPES}
          edgeTypes={EDGE_TYPES}
          defaultViewport={{ x: 0, y: 0, zoom: 0.75 }}
          deleteKeyCode="Backspace"
          colorMode="dark"
          proOptions={{ hideAttribution: false }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#3f3f46" />
          <Controls
            className="[&>button]:border-zinc-700 [&>button]:bg-zinc-900 [&>button]:text-zinc-400 [&>button:hover]:bg-zinc-800 [&>button:hover]:text-zinc-100"
            showInteractive={false}
          />
        </ReactFlow>

        {nodes.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center gap-2 text-center">
              <p className="text-sm text-zinc-500">
                Drag tools from the catalog onto the canvas.
              </p>
              <p className="font-mono text-xs text-zinc-600">
                Connect nodes · press Run Workflow to execute.
              </p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export function WorkflowCanvasPane({
  workflow,
  onSelectWorkflowNode,
  onOpenInspector,
}: {
  workflow: WorkflowState;
  onSelectWorkflowNode: (nodeId: string, qualifiedName: string) => void;
  onOpenInspector: () => void;
}) {
  return (
    <section className="relative flex h-full flex-col bg-zinc-950">
      <header className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Workflow Canvas
        </span>
        <span className="rounded-full border border-zinc-800 px-2 py-0.5 font-mono text-[10px] text-zinc-600">
          preview
        </span>
      </header>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <ReactFlowProvider>
          <Canvas
            workflow={workflow}
            onSelectWorkflowNode={onSelectWorkflowNode}
            onOpenInspector={onOpenInspector}
          />
        </ReactFlowProvider>
      </div>
    </section>
  );
}
