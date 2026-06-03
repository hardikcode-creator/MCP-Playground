import { z } from 'zod';

/**
 * Workflow and node validation types
 */
const NODE_ID_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
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
  dependsOn: z.array(z.string()).default([]),
  breakpoint: z.boolean().default(false),
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

// ─────────────────────────────────────────────────────────────────────────────
// Runtime state types (filled in by the executor; reported back to callers)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Node-level statuses. NOTE there is no node-level 'cancelled' status —
 * cancellation is a workflow-level concept (see WorkflowStatus). When a
 * workflow is cancelled mid-run, individual nodes stay in whatever
 * non-terminal state they were in: 'pending' if we never launched them,
 * 'running' if the tool call was aborted in flight, 'paused' if we
 * abandoned them at a breakpoint. Combined with workflow.status ===
 * 'cancelled', a UI can show "this one was caught mid-execution".
 */
export type NodeStatus =
  | 'pending'   // declared, not yet ready to run (waiting on deps)
  | 'ready'     // all deps complete; sitting in the ready queue
  | 'running'   // currently executing
  | 'paused'    // at a breakpoint, awaiting user action via PauseHandler
  | 'completed' // succeeded, result captured
  | 'failed'    // tool threw, or ref resolution failed
  | 'skipped';  // an upstream dep failed, OR user skipped at a breakpoint

export type NodeRunState = {
  nodeId: string;
  tool: string;
  status: NodeStatus;
  /**
   * Raw args BEFORE $ref substitution.
   *   - Starts as `node.args` (the form authored in the workflow JSON).
   *   - Overwritten to the user-supplied value if a `continue-with-args`
   *     action was taken at this node's breakpoint. In that case it
   *     reflects what the user typed (potentially with new $refs), not
   *     the originally-authored args.
   */
  typedArgs?: Record<string, unknown>;
  /**
   * Args as actually sent to the tool, AFTER $ref substitution.
   * Always derived from `typedArgs` by running it through resolveArgs;
   * if the user edited args at a breakpoint, this is the re-resolved
   * form of their edit.
   */
  resolvedArgs?: Record<string, unknown>;
  result?: unknown;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
};

export type WorkflowStatus = 'completed' | 'failed' | 'cancelled';

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
  source: 'authored' | 'runtime' | 'missing-input';
  args: Record<string, unknown>;
  /**
   * Only set when `source === 'missing-input'`: the required argument names that
   * are still empty, so the UI can tell the user exactly what to fill in.
   */
  missingArgs?: string[];
};

/**
 * The action returned by the pause handler tells the executor how to proceed:
 *   continue              — keep going with the current args unchanged
 *   continue-with-args    — call the tool with these args instead
 *   skip                  — mark this node as skipped; dependents are transitively skipped
 *   fail                  — mark this node as failed with the given error; dependents skipped
 */
export type PauseAction =
  | { type: 'continue' }
  | { type: 'continue-with-args'; args: Record<string, unknown> }
  | { type: 'skip' }
  | { type: 'fail'; error: string };

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
      type: 'node.paused';
      nodeId: string;
      source: BreakpointContext['source'];
      args: Record<string, unknown>;
      missingArgs?: string[];
    }
  | {
      type: 'node.resumed';
      nodeId: string;
      action: PauseAction['type'];
    }
  | {
      type: 'breakpoint.added';
      nodeId: string;
    }
  | {
      type: 'breakpoint.cleared';
      nodeId: string;
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
      status: WorkflowStatus;
      durationMs: number;
    };
