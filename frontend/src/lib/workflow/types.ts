// Plain-TS mirror of the backend workflow contract
// (backend/src/types/workflow.ts). Kept dependency-free so the in-browser
// executor stays small; the shapes are byte-compatible with the backend's
// zod-validated types, so a serialized Workflow can be fed straight to the
// CLI `run-workflow` or the future WebSocket runner without reshaping.

// Node ids must start with a letter and contain only letters, digits,
// underscores, and hyphens — matches the backend regex exactly.
export const NODE_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

export type ValueRef = { $ref: { nodeId: string; path: string } };

export type WorkflowNode = {
  id: string;
  tool: string;
  args: Record<string, unknown>;
  dependsOn: string[];
  breakpoint: boolean;
};

export type Workflow = {
  id: string;
  version: 1;
  name?: string;
  nodes: WorkflowNode[];
};

// ── Runtime state ────────────────────────────────────────────────────────────

// Node-level statuses. There is no node-level 'cancelled': cancellation is a
// workflow-level concept, so a cancelled node just freezes in its last
// non-terminal state ('pending' | 'ready' | 'running' | 'paused').
export type NodeStatus =
  | "pending"
  | "ready"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "skipped";

export type NodeRunState = {
  nodeId: string;
  tool: string;
  status: NodeStatus;
  typedArgs?: Record<string, unknown>;
  resolvedArgs?: Record<string, unknown>;
  result?: unknown;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
};

export type WorkflowStatus = "completed" | "failed" | "cancelled";

export type WorkflowRunResult = {
  workflowId: string;
  runId: string;
  status: WorkflowStatus;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  steps: NodeRunState[];
};

export type BreakpointContext = {
  nodeId: string;
  tool: string;
  source: "authored" | "runtime" | "missing-input";
  args: Record<string, unknown>;
  // Only set when source === 'missing-input': the still-empty required arg names.
  missingArgs?: string[];
};

export type PauseAction =
  | { type: "continue" }
  | { type: "continue-with-args"; args: Record<string, unknown> }
  | { type: "skip" }
  | { type: "fail"; error: string };

// Discriminated union — shaped so it serialises straight to a WebSocket later.
export type EngineEvent =
  | { type: "workflow.started"; runId: string; workflowId: string }
  | { type: "node.ready"; nodeId: string }
  | { type: "node.started"; nodeId: string; tool: string; resolvedArgs: Record<string, unknown> }
  | { type: "node.paused"; nodeId: string; source: BreakpointContext["source"]; args: Record<string, unknown>; missingArgs?: string[] }
  | { type: "node.resumed"; nodeId: string; action: PauseAction["type"] }
  | { type: "breakpoint.added"; nodeId: string }
  | { type: "breakpoint.cleared"; nodeId: string }
  | { type: "node.completed"; nodeId: string; result: unknown; durationMs: number }
  | { type: "node.failed"; nodeId: string; error: string; durationMs: number }
  | { type: "node.skipped"; nodeId: string; reason: string }
  | { type: "workflow.completed"; runId: string; status: WorkflowStatus; durationMs: number };
