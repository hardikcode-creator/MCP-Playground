// Shared frontend types. These mirror the backend shapes so the future
// WebSocket client (data/mcpClient.ts) is a drop-in replacement for the mock.

export type JsonSchemaProperty = {
  type?: string;
  description?: string;
  enum?: string[];
  [key: string]: unknown;
};

export type JsonSchema = {
  type?: string;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  [key: string]: unknown;
};

// Mirrors backend ToolDescriptor (backend/src/mcp/client-manager.ts).
export type ToolDescriptor = {
  serverName: string;
  qualifiedName: string;
  baseName: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
};

// MCP tool-result envelope (what callTool resolves with).
export type ToolContentPart =
  | { type: "text"; text: string }
  | { type: string; [key: string]: unknown };

export type ToolResult = {
  content?: ToolContentPart[];
  structuredContent?: unknown;
  isError?: boolean;
  [key: string]: unknown;
};

// Mirrors backend config schema (backend/src/config.ts).
export type ServerConfig = {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string | null>;
  cwd?: string;
};

export type PlaygroundConfig = {
  servers: ServerConfig[];
};

// Mirrors backend StartResult, plus the tool catalog returned on connect.
export type SkippedServer = { name: string; missingEnv: string[] };
export type FailedServer = { name: string; error: string };

export type ConnectResult = {
  catalog: ToolDescriptor[];
  skipped: SkippedServer[];
  failed: FailedServer[];
};

// Frontend-only record of a single tool invocation (Pane 3).
export type RunStatus = "success" | "error";

// Workflow canvas node execution status. Mirrors the backend executor's node
// statuses (pending|ready|running|paused|completed|failed|skipped) plus two
// frontend-only states: "idle" (resting, before any run) and "cycle" (a
// pre-run lint state from the cycle detector).
export type NodeStatus =
  | "idle"
  | "pending"
  | "ready"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "skipped"
  | "cycle";

export type RunRecord = {
  qualifiedName: string;
  args: Record<string, unknown>;
  result: ToolResult;
  status: RunStatus;
  durationMs: number;
  at: number;
};

// Workflow types (Pane 2 / later) — included so the contract is shared early.
export type ValueRef = { $ref: { nodeId: string; path: string } };

export type WorkflowNode = {
  id: string;
  tool: string;
  args: Record<string, unknown>;
};
