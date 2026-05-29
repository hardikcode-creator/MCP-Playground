import { z } from 'zod';

const NODE_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

/**
 * A ValueRef is the runtime contract for "wiring" between nodes.
 * Anywhere a literal JSON value could appear inside a node's args, a ValueRef
 * may appear instead. At execution time the executor replaces every ValueRef
 * with the JSONPath lookup `done.get(ref.$ref.nodeId)[ref.$ref.path]`.
 *
 * Example:
 *   { "$ref": { "nodeId": "list_clusters", "path": "$.clusters[0].uuid" } }
 *
 * `path` defaults to "$" (the whole upstream result).
 */
export const ValueRefSchema = z.object({
  $ref: z.object({
    nodeId: z.string().min(1, 'nodeId is required'),
    path: z.string().default('$'),
  }),
});

export type ValueRef = z.infer<typeof ValueRefSchema>;

const ArgPrimitiveSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

/**
 * Any JSON value that can sit inside a node's args tree.
 * Literals and ValueRefs are interchangeable at any depth.
 * The executor walks this tree and only substitutes shapes that match ValueRef.
 */
export const ArgValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    ArgPrimitiveSchema,
    ValueRefSchema,
    z.array(ArgValueSchema),
    z.record(ArgValueSchema),
  ]),
);

export const WorkflowNodeSchema = z.object({
  id: z
    .string()
    .min(1, 'Node id cannot be empty')
    .regex(
      NODE_ID_PATTERN,
      'Node id must start with a letter and contain only letters, digits, underscores, and hyphens',
    ),
  tool: z.string().min(1, 'Tool qualifiedName is required'),
  args: z.record(ArgValueSchema).default({}),
});

export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;

export const WorkflowSchema = z
  .object({
    id: z.string().min(1, 'Workflow id is required'),
    version: z.literal(1),
    name: z.string().optional(),
    nodes: z
      .array(WorkflowNodeSchema)
      .min(1, 'Workflow must have at least one node'),
  })
  .superRefine((wf, ctx) => {
    const seen = new Set<string>();
    for (const [i, node] of wf.nodes.entries()) {
      if (seen.has(node.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['nodes', i, 'id'],
          message: `Duplicate node id "${node.id}". Node ids must be unique within a workflow.`,
        });
      }
      seen.add(node.id);
    }
  });

export type Workflow = z.infer<typeof WorkflowSchema>;

export class WorkflowValidationError extends Error {
  constructor(public readonly issues: z.ZodIssue[]) {
    const lines = issues.map(
      (i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`,
    );
    super(`Workflow validation failed:\n${lines.join('\n')}`);
    this.name = 'WorkflowValidationError';
  }
}

export function parseWorkflow(value: unknown): Workflow {
  const result = WorkflowSchema.safeParse(value);
  if (!result.success) {
    throw new WorkflowValidationError(result.error.issues);
  }
  return result.data;
}

// ─────────────────────────────────────────────────────────────────────────────
// Runtime state types (filled in by the executor; reported back to callers)
// ─────────────────────────────────────────────────────────────────────────────

export type NodeStatus =
  | 'pending'   // declared, not yet ready to run (waiting on deps)
  | 'ready'     // all deps complete; sitting in the ready queue
  | 'running'   // currently executing
  | 'completed' // succeeded, result captured
  | 'failed'    // tool threw, or ref resolution failed
  | 'skipped';  // an upstream dep failed; this node never ran

export type NodeRunState = {
  nodeId: string;
  tool: string;
  status: NodeStatus;
  /** Args as authored, BEFORE $ref substitution. */
  typedArgs?: Record<string, unknown>;
  /** Args as actually sent to the tool, AFTER $ref substitution. */
  resolvedArgs?: Record<string, unknown>;
  result?: unknown;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
};

export type WorkflowRunResult = {
  workflowId: string;
  runId: string;
  status: 'completed' | 'failed';
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  steps: NodeRunState[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Events emitted by the executor.
// Deliberately shaped as a discriminated union so they can be serialised
// straight to a WebSocket later without any reshaping.
// ─────────────────────────────────────────────────────────────────────────────

export type EngineEvent =
  | { type: 'workflow.started'; runId: string; workflowId: string }
  | { type: 'node.ready'; nodeId: string }
  | {
      type: 'node.started';
      nodeId: string;
      tool: string;
      resolvedArgs: Record<string, unknown>;
    }
  | {
      type: 'node.completed';
      nodeId: string;
      result: unknown;
      durationMs: number;
    }
  | {
      type: 'node.failed';
      nodeId: string;
      error: string;
      durationMs: number;
    }
  | { type: 'node.skipped'; nodeId: string; reason: string }
  | {
      type: 'workflow.completed';
      runId: string;
      status: 'completed' | 'failed';
      durationMs: number;
    };
