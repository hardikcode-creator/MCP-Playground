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
import { seedArgs, missingInputArgs } from "../lib/schema";
import { serializeWorkflow } from "../lib/workflow/serialize";
import { createWorkflowRunner } from "../data/mcpClient";
import type { CallToolFn, WorkflowRunner } from "../data/mcpClient";
import type { PauseHandler } from "../lib/workflow/executor";
import type { BreakpointContext, EngineEvent, PauseAction, Workflow, WorkflowNode, WorkflowRunResult, WorkflowStatus } from "../lib/workflow/types";

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
  // Why this node is currently paused: 'authored'/'runtime' breakpoint, or
  // 'missing-input' (required args still need a value). Set on node.paused,
  // cleared when it proceeds or finishes. Undefined when not paused.
  pauseSource?: BreakpointContext["source"];
  // For a 'missing-input' pause: the required arg names still needing a value.
  missingArgs?: string[];
};

export type WorkflowState = {
  nodes: Node<ToolNodeData>[];
  edges: Edge[];
  workflowRunning: boolean;
  cycleNodeIds: string[];
  // Run-level error surfaced from the runner: backend validation/cycle rejects
  // (server `error` frame) or a dropped socket. Null while healthy.
  lastRunError: string | null;
  // Terminal status of the most recent finished run, and its full result
  // (steps with each node's output). Both null until a run completes; reset
  // when a new run starts or the canvas is cleared/imported.
  lastRunStatus: WorkflowStatus | null;
  lastRunResult: WorkflowRunResult | null;
  addNode: (tool: ToolDescriptor, position: { x: number; y: number }) => void;
  // Replace the whole canvas with an imported workflow (built by
  // deserializeWorkflow). Resets run state and seeds id counters.
  importWorkflow: (nodes: Node<ToolNodeData>[], edges: Edge[]) => void;
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
  // Resume a failed run: keep results of already-completed nodes and re-run
  // only the failed node and everything downstream of it.
  retryWorkflow: (callTool: CallToolFn) => Promise<void>;
  // True when a prior run left a failed node (so the canvas can offer a retry).
  canRetry: boolean;
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
  const [lastRunStatus, setLastRunStatus] = useState<WorkflowStatus | null>(null);
  const [lastRunResult, setLastRunResult] = useState<WorkflowRunResult | null>(null);
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
  // The runner for the in-flight run, so a breakpoint toggled on the fly can be
  // forwarded to the live executor (local) or sent as a control frame (socket).
  const runnerRef = useRef<WorkflowRunner | null>(null);
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

  const importWorkflow = useCallback((newNodes: Node<ToolNodeData>[], newEdges: Edge[]) => {
    // Stop any in-flight run and clear all run/pause state before swapping.
    abortRef.current?.abort();
    abortRef.current = null;
    pendingPausesRef.current.clear();
    setWorkflowRunning(false);
    setLastRunError(null);
    setLastRunStatus(null);
    setLastRunResult(null);
    setCycleNodeIdsState([]);

    // Seed the per-tool id counter from imported ids that follow addNode's
    // `${qualifiedName}-${n}` pattern, so later drags don't collide.
    const counters: Record<string, number> = {};
    for (const n of newNodes) {
      const prefix = `${n.data.qualifiedName}-`;
      if (n.id.startsWith(prefix)) {
        const rest = n.id.slice(prefix.length);
        if (/^\d+$/.test(rest)) {
          counters[n.data.qualifiedName] = Math.max(counters[n.data.qualifiedName] ?? 0, Number(rest));
        }
      }
    }
    nodeIdCounterByToolRef.current = counters;

    setNodes(newNodes);
    setEdges(newEdges);
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
    setLastRunError(null);
    setLastRunStatus(null);
    setLastRunResult(null);
  }, []);

  const setNodeStatus = useCallback((nodeId: string, status: NodeStatus) => {
    setNodes((nds) => nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, status } } : n)));
  }, []);

  const setNodeArgsText = useCallback((nodeId: string, argsText: string) => {
    setNodes((nds) => nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, argsText } } : n)));
  }, []);

  // Resolve a node currently paused at a breakpoint: apply edited args if the
  // user changed them (continue-with-args), otherwise a plain continue. Shared
  // by the Resume button and by removing a breakpoint on an already-paused node.
  const continuePausedNode = useCallback((nodeId: string) => {
    const entry = pendingPausesRef.current.get(nodeId);
    if (!entry) return;
    pendingPausesRef.current.delete(nodeId);
    const node = nodesRef.current.find((n) => n.id === nodeId);
    const currentText = node?.data.argsText ?? "";
    if (currentText !== entry.argsSnapshot) {
      try {
        const parsed = JSON.parse(currentText || "{}");
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          entry.resolve({ type: "continue-with-args", args: parsed as Record<string, unknown> });
          return;
        }
      } catch {
        // Fall through to a plain continue if the edit isn't valid JSON.
      }
    }
    entry.resolve({ type: "continue" });
  }, []);

  const toggleBreakpoint = useCallback(
    (nodeId: string) => {
      const node = nodesRef.current.find((n) => n.id === nodeId);
      const next = !(node?.data.breakpoint ?? false);
      setNodes((nds) =>
        nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, breakpoint: next } } : n)),
      );
      // Nothing live to mirror unless a run is in flight.
      if (!abortRef.current || !runnerRef.current) return;
      if (next) {
        runnerRef.current.setBreakpoint(nodeId);
        return;
      }
      // Removing a breakpoint must be honored in BOTH cases:
      //  1. node hasn't reached the breakpoint yet -> clear it on the engine so
      //     it won't pause (the authored flag was snapshotted at launch).
      //  2. node is ALREADY paused here -> let it continue now, otherwise it
      //     would sit paused with no breakpoint left to resume.
      runnerRef.current.clearBreakpoint(nodeId);
      if (pendingPausesRef.current.has(nodeId)) continuePausedNode(nodeId);
    },
    [continuePausedNode],
  );

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
        data: { ...n.data, status: "idle" as NodeStatus, lastResult: null, pauseSource: undefined, missingArgs: undefined },
      })),
    );
  }, []);

  // Translate executor events into per-node canvas state.
  const handleEngineEvent = useCallback((event: EngineEvent) => {
    switch (event.type) {
      case "workflow.started":
        // Everything is queued; roots will flip to ready immediately after.
        setNodes((nds) =>
          nds.map((n) => ({
            ...n,
            data: { ...n.data, status: "pending" as NodeStatus, pauseSource: undefined, missingArgs: undefined },
          })),
        );
        break;
      case "node.ready":
        setNodeStatus(event.nodeId, "ready");
        break;
      case "node.started":
        // Clear any pause metadata: the node is now actually running.
        setNodes((nds) =>
          nds.map((n) =>
            n.id === event.nodeId
              ? { ...n, data: { ...n.data, status: "running", pauseSource: undefined, missingArgs: undefined } }
              : n,
          ),
        );
        break;
      case "node.paused":
        setNodes((nds) =>
          nds.map((n) =>
            n.id === event.nodeId
              ? { ...n, data: { ...n.data, status: "paused", pauseSource: event.source, missingArgs: event.missingArgs } }
              : n,
          ),
        );
        break;
      case "node.completed": {
        const result = event.result as ToolResult;
        setNodes((nds) =>
          nds.map((n) =>
            n.id === event.nodeId
              ? { ...n, data: { ...n.data, status: "completed", lastResult: result, pauseSource: undefined, missingArgs: undefined } }
              : n,
          ),
        );
        break;
      }
      case "node.failed":
        setNodes((nds) =>
          nds.map((n) =>
            n.id === event.nodeId
              ? { ...n, data: { ...n.data, status: "failed", lastResult: errorResult(event.error), pauseSource: undefined, missingArgs: undefined } }
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

  // Shared run path for both a fresh run and a resume. When `seedResults` is
  // passed, the already-completed nodes it names are kept (their statuses and
  // results stay on the canvas) and everything else is cleared so it re-runs;
  // the seed also flows to the executor so downstream $refs resolve.
  const beginRun = useCallback(
    async (callTool: CallToolFn, seedResults?: Record<string, unknown>) => {
      // Serialize the current canvas to the backend's Workflow shape BEFORE
      // resetting statuses (reset only clears run state, not args).
      const workflow = serializeWorkflow(nodesRef.current, edgesRef.current);
      if (workflow.nodes.length === 0) return;

      if (seedResults) {
        const seededIds = new Set(Object.keys(seedResults));
        setCycleNodeIdsState([]);
        setNodes((nds) =>
          nds.map((n) =>
            seededIds.has(n.id)
              ? n
              : { ...n, data: { ...n.data, status: "idle" as NodeStatus, lastResult: null, pauseSource: undefined, missingArgs: undefined } },
          ),
        );
      } else {
        resetStatuses();
      }
      setLastRunError(null);
      setLastRunStatus(null);
      setLastRunResult(null);
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

      // Input gate for the local runner: map each node back to its canvas
      // inputSchema so a node whose required args are still blank (or which
      // carries a half-wired $ref) pauses with source 'missing-input'. The
      // WebSocket runner ignores this and the backend computes the same gate.
      const schemaByNodeId = new Map(nodesRef.current.map((n) => [n.id, n.data.inputSchema]));
      const needsInput = (
        node: WorkflowNode,
        resolvedArgs: Record<string, unknown>,
        rawArgs: Record<string, unknown>,
      ): string[] => {
        const schema = schemaByNodeId.get(node.id);
        if (!schema) return [];
        // rawArgs is the node's CURRENT authored args (reflects edits made at a
        // pause), so a manually filled value / AI map clears the gate.
        return missingInputArgs(schema, resolvedArgs, rawArgs);
      };

      const runner = createWorkflowRunner(callTool);
      runnerRef.current = runner;
      try {
        const result = await runner.run(workflow, {
          onEvent: handleEngineEvent,
          pauseHandler,
          signal: controller.signal,
          seedResults,
          needsInput,
        });
        // Capture the finished run so the canvas can show a terminal status
        // chip and offer a "Save response" download.
        setLastRunResult(result);
        setLastRunStatus(result.status);
      } catch (err) {
        // Validation / cycle errors (local or from the backend `error` frame),
        // or a dropped socket — surface to the canvas instead of only logging.
        const message = (err as Error).message;
        console.error("[workflow] run failed:", message);
        setLastRunError(message);
      } finally {
        setWorkflowRunning(false);
        abortRef.current = null;
        runnerRef.current = null;
        pendingPausesRef.current.clear();
      }
    },
    [resetStatuses, handleEngineEvent],
  );

  const runWorkflow = useCallback((callTool: CallToolFn) => beginRun(callTool), [beginRun]);

  // Collect the successful results still on the canvas and re-run only what's
  // left. A failed node's `lastResult` is a synthetic error envelope, so only
  // 'completed' nodes are seeded — the failed node and its (skipped)
  // descendants stay unseeded and execute again with any edited args.
  const retryWorkflow = useCallback(
    (callTool: CallToolFn) => {
      const seed: Record<string, unknown> = {};
      for (const n of nodesRef.current) {
        if (n.data.status === "completed" && n.data.lastResult != null) {
          seed[n.id] = n.data.lastResult;
        }
      }
      return beginRun(callTool, seed);
    },
    [beginRun],
  );

  const canRetry = !workflowRunning && nodes.some((n) => n.data.status === "failed");

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
    (nodeId: string) => continuePausedNode(nodeId),
    [continuePausedNode],
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
    lastRunStatus,
    lastRunResult,
    addNode,
    importWorkflow,
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
    retryWorkflow,
    canRetry,
    cancelWorkflow,
    resumeNode,
    skipNode,
    failNode,
    isNodePaused,
    getWorkflowJson,
  };
}
