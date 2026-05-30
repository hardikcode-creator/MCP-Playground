import { useState, useCallback } from "react";
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

export type ToolNodeData = {
  qualifiedName: string;
  baseName: string;
  serverName: string;
  description: string;
  status: NodeStatus;
};

export type CallToolFn = (
  qualifiedName: string,
  args: Record<string, unknown>,
) => Promise<ToolResult>;

export type WorkflowState = {
  nodes: Node<ToolNodeData>[];
  edges: Edge[];
  workflowRunning: boolean;
  cycleNodeIds: string[];
  addNode: (tool: ToolDescriptor, position: { x: number; y: number }) => void;
  onNodesChange: OnNodesChange<Node<ToolNodeData>>;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  clearCanvas: () => void;
  setNodeStatus: (nodeId: string, status: NodeStatus) => void;
  setCycleNodeIds: (ids: string[]) => void;
  resetStatuses: () => void;
  runWorkflow: (callTool: CallToolFn) => Promise<void>;
};

export function useWorkflowStore(): WorkflowState {
  const [nodes, setNodes] = useState<Node<ToolNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [workflowRunning, setWorkflowRunning] = useState(false);
  const [cycleNodeIds, setCycleNodeIdsState] = useState<string[]>([]);

  const addNode = useCallback((tool: ToolDescriptor, position: { x: number; y: number }) => {
    const newNode: Node<ToolNodeData> = {
      id: `${tool.qualifiedName}-${Date.now()}`,
      type: "tool",
      position,
      data: {
        qualifiedName: tool.qualifiedName,
        baseName: tool.baseName,
        serverName: tool.serverName,
        description: tool.description,
        status: "idle",
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
  }, []);

  const setNodeStatus = useCallback((nodeId: string, status: NodeStatus) => {
    setNodes((nds) =>
      nds.map((n) =>
        n.id === nodeId ? { ...n, data: { ...n.data, status } } : n,
      ),
    );
  }, []);

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
      nds.map((n) => ({ ...n, data: { ...n.data, status: "idle" as NodeStatus } })),
    );
  }, []);

  const runWorkflow = useCallback(
    async (callTool: CallToolFn) => {
      setWorkflowRunning(true);

      // Capture a stable snapshot of nodes/edges at the moment of execution.
      // We use a promise-based approach to read current state once.
      const snapshot = await new Promise<{ nodes: Node<ToolNodeData>[]; edges: Edge[] }>(
        (resolve) => {
          setNodes((nds) => {
            setEdges((eds) => {
              resolve({ nodes: nds, edges: eds });
              return eds;
            });
            return nds;
          });
        },
      );

      const { nodes: snapNodes, edges: snapEdges } = snapshot;

      // Build adjacency: nodeId → set of predecessor nodeIds
      const predecessors = new Map<string, Set<string>>();
      for (const n of snapNodes) predecessors.set(n.id, new Set());
      for (const e of snapEdges) {
        if (e.target && predecessors.has(e.target)) {
          predecessors.get(e.target)!.add(e.source);
        }
      }

      // Track completed statuses so downstream nodes can check them.
      const finalStatus = new Map<string, NodeStatus>();

      // Process waves until all nodes are resolved.
      const resolved = new Set<string>();

      const isReady = (nodeId: string): boolean => {
        const preds = predecessors.get(nodeId) ?? new Set();
        for (const pid of preds) {
          if (!resolved.has(pid)) return false;
        }
        return true;
      };

      const hasFailedPredecessor = (nodeId: string): boolean => {
        const preds = predecessors.get(nodeId) ?? new Set();
        for (const pid of preds) {
          const s = finalStatus.get(pid);
          if (s === "error" || s === "skipped") return true;
        }
        return false;
      };

      let remaining = snapNodes.map((n) => n.id);

      while (remaining.length > 0) {
        const wave = remaining.filter((id) => isReady(id));

        if (wave.length === 0) {
          // Pre-flight cycle detection should have blocked this path.
          // Bail defensively without running anything.
          break;
        }

        // Run the entire wave in parallel.
        await Promise.all(
          wave.map(async (nodeId) => {
            const node = snapNodes.find((n) => n.id === nodeId);
            if (!node) return;

            if (hasFailedPredecessor(nodeId)) {
              setNodeStatus(nodeId, "skipped");
              finalStatus.set(nodeId, "skipped");
              resolved.add(nodeId);
              return;
            }

            setNodeStatus(nodeId, "running");
            try {
              const result = await callTool(node.data.qualifiedName, {});
              const status: NodeStatus = result.isError ? "error" : "success";
              setNodeStatus(nodeId, status);
              finalStatus.set(nodeId, status);
            } catch {
              setNodeStatus(nodeId, "error");
              finalStatus.set(nodeId, "error");
            } finally {
              resolved.add(nodeId);
            }
          }),
        );

        remaining = remaining.filter((id) => !resolved.has(id));
      }

      setWorkflowRunning(false);
    },
    [setNodeStatus],
  );

  return {
    nodes,
    edges,
    workflowRunning,
    cycleNodeIds,
    addNode,
    onNodesChange,
    onEdgesChange,
    onConnect,
    clearCanvas,
    setNodeStatus,
    setCycleNodeIds,
    resetStatuses,
    runWorkflow,
  };
}
