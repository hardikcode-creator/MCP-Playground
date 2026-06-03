import { ConfigValidationError, parseConfig } from '../config.js';
import { ClientManager, type JsonSchema } from '../mcp/client-manager.js';
import { WorkflowExecutor } from '../workflow/executor.js';
import { parseWorkflow, WorkflowValidationError } from '../workflow/loader.js';
import type { WorkflowNode } from '../types/workflow.js';
import type { ClientMessage, ServerMessage } from './protocol.js';
import { WsPauseHandler } from './ws-pause-handler.js';

type ActiveRun = {
  executor: WorkflowExecutor;
  abort: AbortController;
  pauseHandler: WsPauseHandler;
};

/**
 * One Session per WebSocket connection. Owns a private ClientManager (each
 * browser tab uploads its own config and gets its own spawned MCP servers) and
 * the set of in-flight workflow runs.
 *
 * Transport-agnostic by design: it takes a `send(frame)` callback rather than a
 * socket, so unit tests can drive it with a fake sink and assert the exact
 * frame sequence. The index.ts bootstrap is the only place that knows about
 * `ws`.
 */
export class Session {
  private readonly manager: ClientManager;
  private readonly runs = new Map<string, ActiveRun>();
  private disposed = false;

  // `manager` is injectable so unit tests can drive the protocol with a fake
  // MCP layer (no spawned processes); production/integration pass nothing.
  constructor(
    private readonly send: (msg: ServerMessage) => void,
    manager?: ClientManager,
  ) {
    this.manager = manager ?? new ClientManager();
  }

  /** Entry point for a raw socket frame. Never throws — always replies. */
  async handleRaw(raw: string): Promise<void> {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      this.send({ type: 'error', error: 'Invalid JSON frame' });
      return;
    }
    try {
      await this.dispatch(msg);
    } catch (err) {
      // Defensive catch-all; specific handlers send targeted errors already.
      this.send({ type: 'error', error: (err as Error).message });
    }
  }

  private async dispatch(msg: ClientMessage): Promise<void> {
    switch (msg.type) {
      case 'connect':
        await this.handleConnect(msg);
        break;
      case 'callTool':
        await this.handleCallTool(msg);
        break;
      case 'runWorkflow':
        await this.handleRunWorkflow(msg);
        break;
      case 'pauseAction':
        this.handlePauseAction(msg);
        break;
      case 'cancel':
        this.handleCancel(msg);
        break;
      case 'setBreakpoint':
        this.handleSetBreakpoint(msg);
        break;
      case 'clearBreakpoint':
        this.handleClearBreakpoint(msg);
        break;
      default: {
        const _exhaustive: never = msg;
        void _exhaustive;
        this.send({ type: 'error', error: 'Unknown message type' });
      }
    }
  }

  // ── connect ─────────────────────────────────────────────────────────────

  private async handleConnect(
    msg: Extract<ClientMessage, { type: 'connect' }>,
  ): Promise<void> {
    let config;
    try {
      config = parseConfig(msg.config);
    } catch (err) {
      const message =
        err instanceof ConfigValidationError ? err.message : (err as Error).message;
      this.send({ type: 'error', id: msg.id, error: message });
      return;
    }

    // Re-connecting on the same session replaces the previous server set.
    await this.manager.shutdown();
    const result = await this.manager.start(config, msg.providedEnv ?? {});
    this.send({
      type: 'connected',
      id: msg.id,
      catalog: this.manager.getCatalog(),
      skipped: result.skipped,
      failed: result.failed,
    });
  }

  // ── single tool call (Pane 3) ─────────────────────────────────────────────

  private async handleCallTool(
    msg: Extract<ClientMessage, { type: 'callTool' }>,
  ): Promise<void> {
    try {
      const result = await this.manager.callTool(msg.qualifiedName, msg.args);
      this.send({ type: 'toolResult', id: msg.id, result });
    } catch (err) {
      this.send({ type: 'error', id: msg.id, error: (err as Error).message });
    }
  }

  // ── workflow run ──────────────────────────────────────────────────────────

  private async handleRunWorkflow(
    msg: Extract<ClientMessage, { type: 'runWorkflow' }>,
  ): Promise<void> {
    let workflow;
    try {
      workflow = parseWorkflow(msg.workflow);
    } catch (err) {
      const message =
        err instanceof WorkflowValidationError ? err.message : (err as Error).message;
      this.send({ type: 'error', runId: msg.runId, error: message });
      return;
    }

    if (this.runs.has(msg.runId)) {
      this.send({ type: 'error', runId: msg.runId, error: `Run "${msg.runId}" is already active` });
      return;
    }

    const abort = new AbortController();
    const pauseHandler = new WsPauseHandler(abort.signal);
    const executor = new WorkflowExecutor(
      {
        call: (qualifiedName, args, options) =>
          this.manager.callTool(qualifiedName, args, options),
      },
      pauseHandler,
    );

    // Build the input gate from the live tool catalog: a node whose required
    // args are still blank (or which carries a half-wired $ref) pauses with
    // source 'missing-input' so the user can fill them in / AI-map and resume.
    const schemaByTool = new Map(
      this.manager.getCatalog().map((t) => [t.qualifiedName, t.inputSchema]),
    );
    const needsInput = (
      node: WorkflowNode,
      resolvedArgs: Record<string, unknown>,
      rawArgs: Record<string, unknown>,
    ): string[] => {
      const schema = schemaByTool.get(node.tool);
      if (!schema) return [];
      // `rawArgs` is the node's CURRENT authored args (updated when the user
      // resumes with continue-with-args), so a manually filled value or AI map
      // clears the gate instead of re-pausing on the original incomplete ref.
      return missingRequiredArgs(schema, resolvedArgs, rawArgs);
    };

    // Stream every EngineEvent straight onto the socket under the client's runId.
    const off = executor.on((event) =>
      this.send({ type: 'engineEvent', runId: msg.runId, event }),
    );
    this.runs.set(msg.runId, { executor, abort, pauseHandler });

    try {
      const result = await executor.run(workflow, {
        signal: abort.signal,
        seedResults: msg.seedResults,
        needsInput,
      });
      this.send({ type: 'workflowResult', runId: msg.runId, result });
    } catch (err) {
      // Thrown before any node runs (cycle / invalid dependency graph).
      this.send({ type: 'error', runId: msg.runId, error: (err as Error).message });
    } finally {
      off();
      this.runs.delete(msg.runId);
    }
  }

  // ── debugger side-channel (processed concurrently with a running run) ──────

  private handlePauseAction(
    msg: Extract<ClientMessage, { type: 'pauseAction' }>,
  ): void {
    const run = this.runs.get(msg.runId);
    if (!run) {
      this.send({ type: 'error', runId: msg.runId, error: `No active run "${msg.runId}"` });
      return;
    }
    // No-op if the node isn't actually paused (e.g. a stale frame after cancel).
    run.pauseHandler.resolve(msg.nodeId, msg.action);
  }

  private handleCancel(msg: Extract<ClientMessage, { type: 'cancel' }>): void {
    this.runs.get(msg.runId)?.abort.abort();
  }

  private handleSetBreakpoint(
    msg: Extract<ClientMessage, { type: 'setBreakpoint' }>,
  ): void {
    this.runs.get(msg.runId)?.executor.setBreakpoint(msg.nodeId);
  }

  private handleClearBreakpoint(
    msg: Extract<ClientMessage, { type: 'clearBreakpoint' }>,
  ): void {
    this.runs.get(msg.runId)?.executor.clearBreakpoint(msg.nodeId);
  }

  // ── teardown ────────────────────────────────────────────────────────────

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (const run of this.runs.values()) run.abort.abort();
    this.runs.clear();
    await this.manager.shutdown();
  }
}

// ── input-gate helpers ──────────────────────────────────────────────────────

/**
 * Required argument names that still need a value before the tool can run:
 *   - a required field that resolved to undefined/null/"" (no value provided), or
 *   - any field carrying a half-wired `$ref` (missing nodeId or path).
 * Mirrors the frontend's run-gate checks (findMissingRequired + hasIncompleteRef)
 * so the executor pauses on exactly the cases the UI would have blocked.
 */
function missingRequiredArgs(
  schema: JsonSchema,
  resolvedArgs: Record<string, unknown>,
  rawArgs: Record<string, unknown>,
): string[] {
  const out = new Set<string>();
  const required = Array.isArray(schema.required)
    ? (schema.required as string[])
    : [];
  for (const name of required) {
    const v = resolvedArgs[name];
    if (v === undefined || v === null || v === '') out.add(name);
  }
  for (const [name, raw] of Object.entries(rawArgs)) {
    if (isIncompleteRef(raw)) out.add(name);
  }
  return [...out];
}

/** A `{ $ref: { nodeId, path } }` value that is missing its node or path. */
function isIncompleteRef(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const wrapped = value as Record<string, unknown>;
  if (
    !wrapped.$ref ||
    typeof wrapped.$ref !== 'object' ||
    Array.isArray(wrapped.$ref)
  ) {
    return false;
  }
  const ref = wrapped.$ref as Record<string, unknown>;
  const nodeId = typeof ref.nodeId === 'string' ? ref.nodeId : '';
  const path = typeof ref.path === 'string' ? ref.path : '';
  return !nodeId || !path.trim();
}
