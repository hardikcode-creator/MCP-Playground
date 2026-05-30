import { useState, useCallback, useEffect, useRef } from "react";
import {
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
} from "@xyflow/react";
import type {
  Node,
  Edge,
  OnNodesChange,
  OnEdgesChange,
  OnConnect,
  Connection,
} from "@xyflow/react";
import type { NodeStatus, ToolDescriptor, ToolResult } from "../types";
import { seedArgs } from "../lib/schema";
import { serializeWorkflow } from "../lib/workflow/serialize";
import { createWorkflowRunner } from "../data/mcpClient";
import type { CallToolFn } from "../data/mcpClient";
import type { PauseHandler } from "../lib/workflow/executor";
import type { EngineEvent, PauseAction, Workflow } from "../lib/workflow/types";

export type ToolNodeData = {
  qualifiedName: string;
  baseName: string;
  serverName: string;
  description: string;
  inputSchema: ToolDescriptor["inputSchema"];
  argsText: string;
  lastResult: ToolResult | null;
  status: NodeStatus;
  // Authored breakpoint — serialized into the Workflow JSON and checked by the
  // executor before the node's tool call (matches backend `breakpoint: true`).
  breakpoint: boolean;
};

export type WorkflowState = {
  nodes: Node<ToolNodeData>[];
  edges: Edge[];
  workflowRunning: boolean;
  cycleNodeIds: string[];
  // Run-level error surfaced from the runner: backend validation/cycle rejects
  // (server `error` frame) or a dropped socket. Null while healthy.
  lastRunError: string | null;
  addNode: (tool: ToolDescriptor, position: { x: number; y: number }) => void;
  onNodesChange: OnNodesChange<Node<ToolNodeData>>;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  clearCanvas: () => void;
  setNodeStatus: (nodeId: string, status: NodeStatus) => void;
  setNodeArgsText: (nodeId: string, argsText: string) => void;
  toggleBreakpoint: (nodeId: string) => void;
  getNodeById: (nodeId: string) => Node<ToolNodeData> | undefined;
  setCycleNodeIds: (ids: string[]) => void;
  resetStatuses: () => void;
  runWorkflow: (callTool: CallToolFn) => Promise<void>;
  cancelWorkflow: () => void;
  // Debugger actions for a node paused at a breakpoint.
  resumeNode: (nodeId: string) => void;
  skipNode: (nodeId: string) => void;
  failNode: (nodeId: string, error?: string) => void;
  isNodePaused: (nodeId: string) => boolean;
  getWorkflowJson: () => Workflow;
};

function errorResult(message: string): ToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

export function useWorkflowStore(): WorkflowState {
  const [nodes, setNodes] = useState<Node<ToolNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [workflowRunning, setWorkflowRunning] = useState(false);
  const [cycleNodeIds, setCycleNodeIdsState] = useState<string[]>([]);
  const [lastRunError, setLastRunError] = useState<string | null>(null);
  const nodeIdCounterByToolRef = useRef<Record<string, number>>({});

  // Mirrors of the latest state, read inside callbacks/event handlers (which
  // always fire after commit) without re-subscribing or stale closures.
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);
  useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  // Cancel handle for the in-flight run, and the resolvers for nodes currently
  // paused at a breakpoint (keyed by nodeId), each with a snapshot of the args
  // at pause time so we can tell continue from continue-with-args.
  const abortRef = useRef<AbortController | null>(null);
  const pendingPausesRef = useRef<Map<string, { resolve: (a: PauseAction) => void; argsSnapshot: string }>>(
    new Map(),
  );

  const addNode = useCallback((tool: ToolDescriptor, position: { x: number; y: number }) => {
    const nextForTool = (nodeIdCounterByToolRef.current[tool.qualifiedName] ?? 0) + 1;
    nodeIdCounterByToolRef.current[tool.qualifiedName] = nextForTool;
    const uniqueNodeId = `${tool.qualifiedName}-${nextForTool}`;
    const newNode: Node<ToolNodeData> = {
      id: uniqueNodeId,
      type: "tool",
      position,
      data: {
        qualifiedName: tool.qualifiedName,
        baseName: tool.baseName,
        serverName: tool.serverName,
        description: tool.description,
        inputSchema: tool.inputSchema,
        argsText: seedArgs(tool.inputSchema),
        lastResult: null,
        status: "idle",
        breakpoint: false,
      },
    };
    setNodes((nds) => [...nds, newNode]);
  }, []);

  const onNodesChange: OnNodesChange<Node<ToolNodeData>> = useCallback(
    (changes) => setNodes((nds) => applyNodeChanges(changes, nds)),
    [],
  );

  const onEdgesChange: OnEdgesChange = useCallback(
    (changes) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    [],
  );

  const onConnect: OnConnect = useCallback(
    (connection: Connection) => setEdges((eds) => addEdge({ ...connection, animated: false }, eds)),
    [],
  );

  const clearCanvas = useCallback(() => {
    setNodes([]);
    setEdges([]);
    nodeIdCounterByToolRef.current = {};
  }, []);

  const setNodeStatus = useCallback((nodeId: string, status: NodeStatus) => {
    setNodes((nds) => nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, status } } : n)));
  }, []);

  const setNodeArgsText = useCallback((nodeId: string, argsText: string) => {
    setNodes((nds) => nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, argsText } } : n)));
  }, []);

  const toggleBreakpoint = useCallback((nodeId: string) => {
    setNodes((nds) =>
      nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, breakpoint: !n.data.breakpoint } } : n)),
    );
  }, []);

  const getNodeById = useCallback((nodeId: string) => nodes.find((n) => n.id === nodeId), [nodes]);

  const setCycleNodeIds = useCallback((ids: string[]) => {
    setCycleNodeIdsState(ids);
    const cycleSet = new Set(ids);
    setNodes((nds) =>
      nds.map((n) => {
        const inCycle = cycleSet.has(n.id);
        // Only touch nodes whose status needs changing to avoid thrashing renders.
        if (inCycle && n.data.status !== "cycle") {
          return { ...n, data: { ...n.data, status: "cycle" as NodeStatus } };
        }
        if (!inCycle && n.data.status === "cycle") {
          return { ...n, data: { ...n.data, status: "idle" as NodeStatus } };
        }
        return n;
      }),
    );
  }, []);

  const resetStatuses = useCallback(() => {
    setCycleNodeIdsState([]);
    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        data: { ...n.data, status: "idle" as NodeStatus, lastResult: null },
      })),
    );
  }, []);

  // Translate executor events into per-node canvas state.
  const handleEngineEvent = useCallback((event: EngineEvent) => {
    switch (event.type) {
      case "workflow.started":
        // Everything is queued; roots will flip to ready immediately after.
        setNodes((nds) => nds.map((n) => ({ ...n, data: { ...n.data, status: "pending" as NodeStatus } })));
        break;
      case "node.ready":
        setNodeStatus(event.nodeId, "ready");
        break;
      case "node.started":
        setNodeStatus(event.nodeId, "running");
        break;
      case "node.paused":
        setNodeStatus(event.nodeId, "paused");
        break;
      case "node.completed": {
        const result = event.result as ToolResult;
        setNodes((nds) =>
          nds.map((n) =>
            n.id === event.nodeId ? { ...n, data: { ...n.data, status: "completed", lastResult: result } } : n,
          ),
        );
        break;
      }
      case "node.failed":
        setNodes((nds) =>
          nds.map((n) =>
            n.id === event.nodeId
              ? { ...n, data: { ...n.data, status: "failed", lastResult: errorResult(event.error) } }
              : n,
          ),
        );
        break;
      case "node.skipped":
        setNodeStatus(event.nodeId, "skipped");
        break;
      case "node.resumed":
      case "breakpoint.added":
      case "breakpoint.cleared":
      case "workflow.completed":
        break;
    }
  }, [setNodeStatus]);

  const runWorkflow = useCallback(
    async (callTool: CallToolFn) => {
      // Serialize the current canvas to the backend's Workflow shape BEFORE
      // resetting statuses (reset only clears run state, not args).
      const workflow = serializeWorkflow(nodesRef.current, edgesRef.current);
      if (workflow.nodes.length === 0) return;

      resetStatuses();
      setLastRunError(null);
      pendingPausesRef.current.clear();
      const controller = new AbortController();
      abortRef.current = controller;
      setWorkflowRunning(true);

      const pauseHandler: PauseHandler = {
        onBreakpoint: (ctx) =>
          new Promise<PauseAction>((resolve) => {
            const node = nodesRef.current.find((n) => n.id === ctx.nodeId);
            pendingPausesRef.current.set(ctx.nodeId, {
              resolve,
              argsSnapshot: node?.data.argsText ?? "",
            });
          }),
      };

      const runner = createWorkflowRunner(callTool);
      try {
        await runner.run(workflow, { onEvent: handleEngineEvent, pauseHandler, signal: controller.signal });
      } catch (err) {
        // Validation / cycle errors (local or from the backend `error` frame),
        // or a dropped socket — surface to the canvas instead of only logging.
        const message = (err as Error).message;
        console.error("[workflow] run failed:", message);
        setLastRunError(message);
      } finally {
        setWorkflowRunning(false);
        abortRef.current = null;
        pendingPausesRef.current.clear();
      }
    },
    [resetStatuses, handleEngineEvent],
  );

  const cancelWorkflow = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  // ── Breakpoint pause actions ──────────────────────────────────────────────

  const applyPauseAction = useCallback((nodeId: string, action: PauseAction) => {
    const entry = pendingPausesRef.current.get(nodeId);
    if (!entry) return;
    pendingPausesRef.current.delete(nodeId);
    entry.resolve(action);
  }, []);

  const resumeNode = useCallback(
    (nodeId: string) => {
      const entry = pendingPausesRef.current.get(nodeId);
      if (!entry) return;
      const node = nodesRef.current.find((n) => n.id === nodeId);
      const currentText = node?.data.argsText ?? "";
      // If the user edited the paused node's args, re-resolve them
      // (continue-with-args); otherwise continue with the original args.
      if (currentText !== entry.argsSnapshot) {
        try {
          const parsed = JSON.parse(currentText || "{}");
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            applyPauseAction(nodeId, { type: "continue-with-args", args: parsed as Record<string, unknown> });
            return;
          }
        } catch {
          // Fall through to a plain continue if the edit isn't valid JSON.
        }
      }
      applyPauseAction(nodeId, { type: "continue" });
    },
    [applyPauseAction],
  );

  const skipNode = useCallback(
    (nodeId: string) => applyPauseAction(nodeId, { type: "skip" }),
    [applyPauseAction],
  );

  const failNode = useCallback(
    (nodeId: string, error?: string) =>
      applyPauseAction(nodeId, { type: "fail", error: error?.trim() || "failed at breakpoint" }),
    [applyPauseAction],
  );

  const isNodePaused = useCallback((nodeId: string) => pendingPausesRef.current.has(nodeId), []);

  const getWorkflowJson = useCallback(() => serializeWorkflow(nodesRef.current, edgesRef.current), []);

  return {
    nodes,
    edges,
    workflowRunning,
    cycleNodeIds,
    lastRunError,
    addNode,
    onNodesChange,
    onEdgesChange,
    onConnect,
    clearCanvas,
    setNodeStatus,
    setNodeArgsText,
    toggleBreakpoint,
    getNodeById,
    setCycleNodeIds,
    resetStatuses,
    runWorkflow,
    cancelWorkflow,
    resumeNode,
    skipNode,
    failNode,
    isNodePaused,
    getWorkflowJson,
  };
}
