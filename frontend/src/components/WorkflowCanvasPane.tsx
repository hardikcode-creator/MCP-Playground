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
import { ImportWorkflowModal } from "./canvas/ImportWorkflowModal";
import { CanvasActionsContext } from "./canvas/canvasActions";
import { detectCycles } from "../lib/detectCycles";
import { findMissingRequired } from "../lib/schema";
import { collectValueRefNodeIds } from "../lib/workflowRefs";
import { subscribeTransportStatus } from "../data/mcpClient";
import type { TransportStatus } from "../data/mcpClient";

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

function StopIcon() {
  return (
    <svg width={10} height={10} viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
      <rect x="1.5" y="1.5" width="9" height="9" rx="1.5" />
    </svg>
  );
}

// Empty-canvas motif: a small node graph with emerald "packets" travelling
// along its edges. Hints at what the canvas is for before any nodes exist.
function NodeGraphMotif() {
  return (
    <svg width={236} height={150} viewBox="0 0 236 150" fill="none" aria-hidden="true">
      <g className="stroke-zinc-700" strokeWidth="1.5">
        <path d="M40 42 L118 75" />
        <path d="M196 42 L118 75" />
        <path d="M118 75 L118 124" />
      </g>
      <g className="animate-dash stroke-emerald-500/70" strokeWidth="1.6" strokeDasharray="3 9" fill="none">
        <path d="M40 42 L118 75" />
        <path d="M196 42 L118 75" />
        <path d="M118 75 L118 124" />
      </g>
      <g strokeWidth="1.5">
        <rect x="22" y="30" width="36" height="24" rx="6" className="fill-zinc-900 stroke-zinc-700" />
        <rect x="178" y="30" width="36" height="24" rx="6" className="fill-zinc-900 stroke-zinc-700" />
        <rect x="100" y="63" width="36" height="24" rx="6" className="fill-zinc-900 stroke-emerald-600" />
        <rect x="100" y="112" width="36" height="24" rx="6" className="fill-zinc-900 stroke-zinc-700" />
      </g>
    </svg>
  );
}

// Small transport indicator: shows which backend the canvas is talking to and
// the live socket state when VITE_MCP_WS_URL is configured.
function TransportChip({ status }: { status: TransportStatus }) {
  const map: Record<TransportStatus, { label: string; dot: string; cls: string }> = {
    mock: { label: "mock", dot: "bg-zinc-500", cls: "border-zinc-700 text-zinc-500" },
    idle: { label: "backend", dot: "bg-zinc-500", cls: "border-zinc-700 text-zinc-400" },
    connecting: { label: "connecting", dot: "bg-amber-400 animate-pulse", cls: "border-amber-700/60 text-amber-300" },
    open: { label: "Live", dot: "bg-emerald-400", cls: "border-emerald-700/60 text-emerald-300" },
    closed: { label: "backend offline", dot: "bg-red-400", cls: "border-red-800/60 text-red-300" },
  };
  const s = map[status];
  return (
    <span
      title={status === "mock" ? "In-browser mock client (no backend)" : `WebSocket backend: ${status}`}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border bg-zinc-950/40 px-2 py-0.5 font-mono text-[10px] ${s.cls}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

function DownloadIcon() {
  return (
    <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12" />
      <path d="M8 11l4 4 4-4" />
      <path d="M5 21h14" />
    </svg>
  );
}

// Run lifecycle phases shown by the status chip during/after a workflow run.
type RunPhase = "running" | "paused" | "completed" | "failed" | "cancelled";

// Combined status chip: while a run is active or just finished, it reflects the
// run phase (animated); when idle it falls back to the transport indicator so
// "Live"/offline/mock connectivity is never hidden.
function StatusChip({ phase, transport }: { phase: RunPhase | null; transport: TransportStatus }) {
  if (!phase) return <TransportChip status={transport} />;

  const map: Record<RunPhase, { label: string; cls: string; title: string }> = {
    running: { label: "Running", cls: "border-amber-600/60 bg-amber-950/30 text-amber-300", title: "Workflow is running" },
    paused: { label: "Paused", cls: "border-amber-500/70 bg-amber-950/50 text-amber-200", title: "Paused at a breakpoint" },
    completed: { label: "Completed", cls: "border-emerald-600/60 bg-emerald-950/40 text-emerald-300", title: "Run completed successfully" },
    failed: { label: "Failed", cls: "border-red-800/60 bg-red-950/40 text-red-300", title: "Run finished with a failed node" },
    cancelled: { label: "Cancelled", cls: "border-zinc-600 bg-zinc-900 text-zinc-300", title: "Run was cancelled" },
  };
  const s = map[phase];

  return (
    <span
      title={s.title}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10px] transition-all duration-300 ${s.cls}`}
    >
      {phase === "running" ? (
        <svg className="h-2.5 w-2.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round">
          <path d="M12 3a9 9 0 1 0 9 9" />
        </svg>
      ) : phase === "paused" ? (
        <span className="flex items-center gap-[2px]">
          <span className="h-2 w-[2px] animate-pulse rounded-full bg-amber-300" />
          <span className="h-2 w-[2px] animate-pulse rounded-full bg-amber-300" />
        </span>
      ) : phase === "completed" ? (
        <svg className="h-2.5 w-2.5" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 6.5l2.5 2.5L10 3.2" />
        </svg>
      ) : (
        <span className={`h-1.5 w-1.5 rounded-full ${phase === "failed" ? "bg-red-400" : "bg-zinc-400"}`} />
      )}
      {s.label}
    </span>
  );
}

// A node arg with a $ref that is missing its source node or path can't run.
function hasIncompleteRef(value: Record<string, unknown>): boolean {
  for (const v of Object.values(value)) {
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const wrapped = v as Record<string, unknown>;
    if (!wrapped.$ref || typeof wrapped.$ref !== "object" || Array.isArray(wrapped.$ref)) continue;
    const ref = wrapped.$ref as Record<string, unknown>;
    const nodeId = typeof ref.nodeId === "string" ? ref.nodeId : "";
    const path = typeof ref.path === "string" ? ref.path : "";
    if (!nodeId || !path.trim()) return true;
  }
  return false;
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
  const { catalog, callTool, clearSelection } = useAppState();
  const {
    nodes,
    edges,
    workflowRunning,
    lastRunError,
    lastRunStatus,
    lastRunResult,
    setCycleNodeIds,
    addNode,
    onNodesChange,
    onEdgesChange,
    onConnect,
    runWorkflow,
    retryWorkflow,
    canRetry,
    cancelWorkflow,
    toggleBreakpoint,
    getWorkflowJson,
    importWorkflow,
    clearCanvas,
  } = workflow;
  const [exportState, setExportState] = useState<"idle" | "ok" | "error">("idle");
  const [saveState, setSaveState] = useState<"idle" | "ok" | "error">("idle");
  const [importOpen, setImportOpen] = useState(false);
  const [transport, setTransport] = useState<TransportStatus>("mock");
  useEffect(() => subscribeTransportStatus(setTransport), []);
  const { screenToFlowPosition, fitView } = useReactFlow();
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
    void runWorkflow(callTool);
  }, [runWorkflow, callTool]);

  const handleRetryWorkflow = useCallback(() => {
    void retryWorkflow(callTool);
  }, [retryWorkflow, callTool]);

  // Download the workflow as a backend-shaped JSON file (named after its id).
  const handleExport = useCallback(() => {
    try {
      const wf = getWorkflowJson();
      const blob = new Blob([JSON.stringify(wf, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${wf.id || "workflow"}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setExportState("ok");
    } catch {
      setExportState("error");
    } finally {
      setTimeout(() => setExportState("idle"), 1500);
    }
  }, [getWorkflowJson]);

  const handleClear = useCallback(() => {
    if (nodes.length === 0) return;
    if (!window.confirm("Clear the workflow canvas? This removes all nodes and links.")) return;
    clearCanvas();
    clearSelection();
  }, [nodes.length, clearCanvas, clearSelection]);

  // Download the finished run's result (every node's resolved args + output) as
  // a JSON file. Distinct from "Export JSON" which saves the workflow itself.
  const handleSaveResponse = useCallback(() => {
    if (!lastRunResult) return;
    try {
      const blob = new Blob([JSON.stringify(lastRunResult, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${lastRunResult.workflowId || "workflow"}-response.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setSaveState("ok");
    } catch {
      setSaveState("error");
    } finally {
      setTimeout(() => setSaveState("idle"), 1500);
    }
  }, [lastRunResult]);

  const pausedCount = useMemo(() => nodes.filter((n) => n.data.status === "paused").length, [nodes]);

  // Auto-focus a node that pauses for input: when a NEW 'missing-input' pause
  // appears, select it and open the inspector so the user is prompted to fill
  // the args (manually or via Auto-map) without hunting for the node.
  const focusedMissingRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const current = nodes.filter(
      (n) => n.data.status === "paused" && n.data.pauseSource === "missing-input",
    );
    const newlyPaused = current.find((n) => !focusedMissingRef.current.has(n.id));
    focusedMissingRef.current = new Set(current.map((n) => n.id));
    if (newlyPaused) {
      onSelectWorkflowNode(newlyPaused.id, newlyPaused.data.qualifiedName);
      onOpenInspector();
    }
  }, [nodes, onSelectWorkflowNode, onOpenInspector]);

  // Drive the status chip: a live run shows running/paused; a finished run keeps
  // its terminal status until the next run, clear, or import.
  const runPhase: RunPhase | null = workflowRunning
    ? pausedCount > 0
      ? "paused"
      : "running"
    : lastRunStatus === "completed" || lastRunStatus === "failed" || lastRunStatus === "cancelled"
      ? lastRunStatus
      : null;

  // Build a human-readable cycle node name list for the banner.
  const cycleNodeNames = useMemo(() => {
    return cycleIds
      .map((id) => nodes.find((n) => n.id === id)?.data.baseName ?? id)
      .join(", ");
  }, [cycleIds, nodes]);

  const hasCycle = cycleIds.length > 0;
  // Only structural problems block the run: invalid JSON or a non-object args
  // body. Missing required values / half-wired $refs no longer block — the run
  // starts and pauses on those nodes to prompt the user (manual or AI auto-map).
  const hasBlockingError = useMemo(() => {
    for (const n of nodes) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(n.data.argsText || "{}");
      } catch {
        return true;
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return true;
    }
    return false;
  }, [nodes]);
  // How many nodes will pause for input during the run (informational hint only).
  const needsInputCount = useMemo(() => {
    let count = 0;
    for (const n of nodes) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(n.data.argsText || "{}");
      } catch {
        continue; // a JSON error is a blocking error, counted separately.
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      const obj = parsed as Record<string, unknown>;
      if (findMissingRequired(n.data.inputSchema, obj).length > 0 || hasIncompleteRef(obj)) count += 1;
    }
    return count;
  }, [nodes]);
  const showBanner = hasCycle && dismissedCycleKey !== edgeKey;

  // A node-level retry is allowed when a prior run left a failure and the graph
  // is currently runnable (not running, no cycle, no blocking JSON error).
  const retryEnabled = canRetry && !hasCycle && !hasBlockingError;
  const canvasActions = useMemo(
    () => ({ toggleBreakpoint, retry: handleRetryWorkflow, retryEnabled }),
    [toggleBreakpoint, handleRetryWorkflow, retryEnabled],
  );

  return (
    <CanvasActionsContext.Provider value={canvasActions}>
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
        <div className="flex min-w-0 items-center gap-2">
          <StatusChip phase={runPhase} transport={transport} />
          {nodes.length > 0 && (
            <span className="font-mono text-[10px] text-zinc-600">
              {nodes.length} node{nodes.length === 1 ? "" : "s"} · {edges.length} edge{edges.length === 1 ? "" : "s"}
            </span>
          )}
          {workflowRunning && pausedCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-700/60 bg-amber-950/40 px-2 py-0.5 font-mono text-[10px] text-amber-300">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
              paused ({pausedCount})
            </span>
          )}
          {lastRunError && !workflowRunning && (
            <span
              title={lastRunError}
              className="inline-flex min-w-0 items-center gap-1 rounded-full border border-red-800/60 bg-red-950/40 px-2 py-0.5 font-mono text-[10px] text-red-300"
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" />
              <span className="truncate max-w-[260px]">run failed: {lastRunError}</span>
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={workflowRunning}
            onClick={() => setImportOpen(true)}
            title="Import a saved workflow JSON onto the canvas"
            className="flex items-center gap-1.5 rounded-md border border-zinc-700 px-2.5 py-1 text-xs font-medium text-zinc-300 transition-all hover:border-zinc-500 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:text-zinc-600"
          >
            Import JSON
          </button>
          <button
            type="button"
            disabled={nodes.length === 0}
            onClick={handleExport}
            title="Download this workflow as a backend-shaped JSON file"
            className="flex items-center gap-1.5 rounded-md border border-zinc-700 px-2.5 py-1 text-xs font-medium text-zinc-300 transition-all hover:border-zinc-500 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:text-zinc-600"
          >
            {exportState === "ok" ? "Saved" : exportState === "error" ? "Export failed" : "Export JSON"}
          </button>
          {lastRunResult && !workflowRunning && (
            <button
              type="button"
              onClick={handleSaveResponse}
              title="Download the run result — every node's resolved args and output — as JSON"
              className="flex items-center gap-1.5 rounded-md border border-emerald-700/50 bg-emerald-950/30 px-2.5 py-1 text-xs font-medium text-emerald-300 transition-all hover:border-emerald-500 hover:bg-emerald-900/50 hover:text-emerald-200"
            >
              <DownloadIcon />
              {saveState === "ok" ? "Saved" : saveState === "error" ? "Save failed" : "Save response"}
            </button>
          )}
          <button
            type="button"
            disabled={nodes.length === 0 || workflowRunning}
            onClick={handleClear}
            title="Remove all nodes and links from the canvas"
            className="flex items-center gap-1.5 rounded-md border border-zinc-700 px-2.5 py-1 text-xs font-medium text-zinc-300 transition-all hover:border-red-600/70 hover:bg-red-950/30 hover:text-red-300 disabled:cursor-not-allowed disabled:border-zinc-800 disabled:text-zinc-600 disabled:hover:bg-transparent"
          >
            Clear
          </button>
          {workflowRunning ? (
            <button
              type="button"
              onClick={cancelWorkflow}
              title="Cancel the running workflow"
              className="flex items-center gap-1.5 rounded-md border border-red-700/60 bg-red-900/40 px-2.5 py-1 text-xs font-medium text-red-300 transition-all hover:border-red-500 hover:bg-red-900/70 hover:text-red-200"
            >
              <StopIcon />
              Cancel
            </button>
          ) : (
            <>
              {needsInputCount > 0 && !hasCycle && !hasBlockingError && (
                <span
                  title="These nodes are missing required values or have an incomplete reference. The run will pause on each so you can fill them in or Auto-map with AI."
                  className="flex items-center gap-1 rounded-md border border-amber-700/50 bg-amber-950/30 px-2 py-1 text-[11px] font-medium text-amber-300"
                >
                  {needsInputCount} node{needsInputCount === 1 ? "" : "s"} need input
                </span>
              )}
              <button
                type="button"
                disabled={nodes.length === 0 || hasCycle || hasBlockingError}
                onClick={handleRunWorkflow}
                title={
                  hasCycle
                    ? "Resolve cycle before running"
                    : hasBlockingError
                      ? "Fix invalid node args (JSON) before running"
                      : needsInputCount > 0
                        ? `${needsInputCount} node(s) need input — you'll be prompted during the run`
                        : undefined
                }
                className="flex items-center gap-1.5 rounded-md border border-emerald-700/60 bg-emerald-900/40 px-2.5 py-1 text-xs font-medium text-emerald-300 transition-all hover:border-emerald-500 hover:bg-emerald-900/70 hover:text-emerald-200 disabled:cursor-not-allowed disabled:border-zinc-700 disabled:bg-transparent disabled:text-zinc-600"
              >
                <PlayIcon />
                Run Workflow
              </button>
            </>
          )}
        </div>
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
            <div className="flex flex-col items-center gap-5 text-center">
              <div className="animate-float opacity-90">
                <NodeGraphMotif />
              </div>
              <div className="flex flex-col gap-2">
                <p className="text-sm text-zinc-500">
                  Drag tools from the catalog onto the canvas.
                </p>
                <p className="font-mono text-xs text-zinc-600">
                  Connect nodes · press Run Workflow to execute — or Import JSON.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {importOpen && (
        <ImportWorkflowModal
          catalog={catalog}
          hasExisting={nodes.length > 0}
          onImport={(ns, es) => {
            importWorkflow(ns, es);
            // The previous selection may point at a node that no longer exists;
            // reset Pane 3 so every pane reflects the imported workflow.
            clearSelection();
            // Frame the imported graph once it has rendered.
            setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 0);
          }}
          onClose={() => setImportOpen(false)}
        />
      )}
    </CanvasActionsContext.Provider>
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
