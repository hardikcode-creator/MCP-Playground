import { beforeEach, describe, expect, it } from 'vitest';
import type { ClientManager } from '../../src/mcp/client-manager.js';
import type { ClientMessage, ServerMessage } from '../../src/server/protocol.js';
import { Session } from '../../src/server/session.js';
import type { Workflow } from '../../src/types/workflow.js';

// ── Fakes ────────────────────────────────────────────────────────────────────

// Stands in for the real MCP layer so the protocol/executor wiring can be
// tested with zero spawned processes. The real WorkflowExecutor + WsPauseHandler
// run for real; only the tool transport is faked.
class FakeManager {
  calls: { name: string; args: Record<string, unknown> }[] = [];
  starts = 0;
  shutdowns = 0;

  async start() {
    this.starts += 1;
    return { failed: [], skipped: [] };
  }
  async shutdown() {
    this.shutdowns += 1;
  }
  getCatalog() {
    return [
      {
        serverName: 'everything',
        qualifiedName: 'everything__echo',
        baseName: 'echo',
        description: 'echo',
        inputSchema: { type: 'object' },
      },
    ];
  }
  async callTool(name: string, args: Record<string, unknown>) {
    this.calls.push({ name, args });
    if (name === 'boom__explode') throw new Error('kaboom');
    return { content: [{ type: 'text', text: `ran ${name}` }] };
  }
}

// Captures frames and lets tests await a specific frame without racing the
// executor's async ticks.
class Harness {
  frames: ServerMessage[] = [];
  private waiters: Array<{
    pred: (m: ServerMessage) => boolean;
    resolve: (m: ServerMessage) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  send = (msg: ServerMessage): void => {
    this.frames.push(msg);
    for (const w of [...this.waiters]) {
      if (w.pred(msg)) {
        clearTimeout(w.timer);
        this.waiters = this.waiters.filter((x) => x !== w);
        w.resolve(msg);
      }
    }
  };

  waitFor(pred: (m: ServerMessage) => boolean, ms = 5000): Promise<ServerMessage> {
    const found = this.frames.find(pred);
    if (found) return Promise.resolve(found);
    return new Promise<ServerMessage>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('waitFor timed out')), ms);
      this.waiters.push({ pred, resolve, timer });
    });
  }
}

function makeSession(): { session: Session; harness: Harness; manager: FakeManager } {
  const harness = new Harness();
  const manager = new FakeManager();
  const session = new Session(harness.send, manager as unknown as ClientManager);
  return { session, harness, manager };
}

function singleNode(
  opts: { breakpoint?: boolean; args?: Record<string, unknown>; tool?: string } = {},
): Workflow {
  return {
    id: 'wf-unit',
    version: 1,
    name: 'unit',
    nodes: [
      {
        id: 'n1',
        tool: opts.tool ?? 'everything__echo',
        args: opts.args ?? { message: 'hi' },
        dependsOn: [],
        breakpoint: opts.breakpoint ?? false,
      },
    ],
  };
}

const send = (session: Session, msg: ClientMessage) => session.handleRaw(JSON.stringify(msg));

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Session protocol', () => {
  let h: ReturnType<typeof makeSession>;
  beforeEach(() => {
    h = makeSession();
  });

  it('replies to connect with the catalog', async () => {
    await send(h.session, {
      type: 'connect',
      id: 'c1',
      config: { servers: [{ name: 'everything', command: 'noop', args: [] }] },
    });
    const frame = h.harness.frames.find((f) => f.type === 'connected');
    expect(frame).toBeDefined();
    expect(frame).toMatchObject({ type: 'connected', id: 'c1' });
    if (frame?.type === 'connected') {
      expect(frame.catalog).toHaveLength(1);
      expect(frame.catalog[0]?.qualifiedName).toBe('everything__echo');
    }
    expect(h.manager.starts).toBe(1);
  });

  it('rejects an invalid config with an error frame', async () => {
    await send(h.session, {
      type: 'connect',
      id: 'c2',
      // @ts-expect-error intentionally invalid shape
      config: { servers: [{ name: '' }] },
    });
    const frame = h.harness.frames.at(-1);
    expect(frame).toMatchObject({ type: 'error', id: 'c2' });
  });

  it('returns a tool result for callTool', async () => {
    await send(h.session, {
      type: 'callTool',
      id: 't1',
      qualifiedName: 'everything__echo',
      args: { message: 'yo' },
    });
    const frame = h.harness.frames.find((f) => f.type === 'toolResult');
    expect(frame).toMatchObject({ type: 'toolResult', id: 't1' });
    expect(h.manager.calls).toEqual([{ name: 'everything__echo', args: { message: 'yo' } }]);
  });

  it('surfaces a tool error as an error frame keyed by id', async () => {
    await send(h.session, {
      type: 'callTool',
      id: 't2',
      qualifiedName: 'boom__explode',
      args: {},
    });
    const frame = h.harness.frames.at(-1);
    expect(frame).toMatchObject({ type: 'error', id: 't2' });
    if (frame?.type === 'error') expect(frame.error).toContain('kaboom');
  });

  it('rejects an invalid workflow with an error frame keyed by runId', async () => {
    await send(h.session, {
      type: 'runWorkflow',
      runId: 'r-bad',
      // @ts-expect-error intentionally invalid (no nodes)
      workflow: { id: 'x', version: 1, nodes: [] },
    });
    const frame = h.harness.frames.at(-1);
    expect(frame).toMatchObject({ type: 'error', runId: 'r-bad' });
  });

  it('runs a workflow to completion and streams the event sequence', async () => {
    await send(h.session, { type: 'runWorkflow', runId: 'r1', workflow: singleNode() });
    const result = await h.harness.waitFor(
      (f) => f.type === 'workflowResult' && f.runId === 'r1',
    );
    if (result.type !== 'workflowResult') throw new Error('expected workflowResult');
    expect(result.result.status).toBe('completed');
    expect(result.result.steps[0]?.status).toBe('completed');

    const types = h.harness.frames
      .filter((f) => f.type === 'engineEvent' && f.runId === 'r1')
      .map((f) => (f.type === 'engineEvent' ? f.event.type : ''));
    expect(types).toContain('workflow.started');
    expect(types).toContain('node.completed');
    expect(types).toContain('workflow.completed');
  });

  it('pauses at a breakpoint and resumes on continue', async () => {
    void send(h.session, {
      type: 'runWorkflow',
      runId: 'r2',
      workflow: singleNode({ breakpoint: true }),
    });
    const paused = await h.harness.waitFor(
      (f) => f.type === 'engineEvent' && f.event.type === 'node.paused',
    );
    expect(paused).toBeDefined();
    // The tool must NOT have been called while paused.
    expect(h.manager.calls).toHaveLength(0);

    await send(h.session, {
      type: 'pauseAction',
      runId: 'r2',
      nodeId: 'n1',
      action: { type: 'continue' },
    });
    const result = await h.harness.waitFor(
      (f) => f.type === 'workflowResult' && f.runId === 'r2',
    );
    if (result.type !== 'workflowResult') throw new Error('expected workflowResult');
    expect(result.result.status).toBe('completed');
    expect(h.manager.calls).toHaveLength(1);
  });

  it('skips a node when the pause action is skip (tool never called)', async () => {
    void send(h.session, {
      type: 'runWorkflow',
      runId: 'r3',
      workflow: singleNode({ breakpoint: true }),
    });
    await h.harness.waitFor((f) => f.type === 'engineEvent' && f.event.type === 'node.paused');
    await send(h.session, {
      type: 'pauseAction',
      runId: 'r3',
      nodeId: 'n1',
      action: { type: 'skip' },
    });
    const result = await h.harness.waitFor(
      (f) => f.type === 'workflowResult' && f.runId === 'r3',
    );
    if (result.type !== 'workflowResult') throw new Error('expected workflowResult');
    expect(result.result.status).toBe('completed');
    expect(result.result.steps[0]?.status).toBe('skipped');
    expect(h.manager.calls).toHaveLength(0);
  });

  it('applies continue-with-args edits to the tool call', async () => {
    void send(h.session, {
      type: 'runWorkflow',
      runId: 'r4',
      workflow: singleNode({ breakpoint: true, args: { message: 'original' } }),
    });
    await h.harness.waitFor((f) => f.type === 'engineEvent' && f.event.type === 'node.paused');
    await send(h.session, {
      type: 'pauseAction',
      runId: 'r4',
      nodeId: 'n1',
      action: { type: 'continue-with-args', args: { message: 'edited' } },
    });
    const result = await h.harness.waitFor(
      (f) => f.type === 'workflowResult' && f.runId === 'r4',
    );
    if (result.type !== 'workflowResult') throw new Error('expected workflowResult');
    expect(result.result.status).toBe('completed');
    expect(h.manager.calls).toEqual([
      { name: 'everything__echo', args: { message: 'edited' } },
    ]);
  });

  it('cancels a paused run (workflow status cancelled, tool never called)', async () => {
    void send(h.session, {
      type: 'runWorkflow',
      runId: 'r5',
      workflow: singleNode({ breakpoint: true }),
    });
    await h.harness.waitFor((f) => f.type === 'engineEvent' && f.event.type === 'node.paused');
    await send(h.session, { type: 'cancel', runId: 'r5' });
    const result = await h.harness.waitFor(
      (f) => f.type === 'workflowResult' && f.runId === 'r5',
    );
    if (result.type !== 'workflowResult') throw new Error('expected workflowResult');
    expect(result.result.status).toBe('cancelled');
    expect(result.result.steps[0]?.status).toBe('paused');
    expect(h.manager.calls).toHaveLength(0);
  });

  it('reports an error for a pauseAction on an unknown run', async () => {
    await send(h.session, {
      type: 'pauseAction',
      runId: 'nope',
      nodeId: 'n1',
      action: { type: 'continue' },
    });
    const frame = h.harness.frames.at(-1);
    expect(frame).toMatchObject({ type: 'error', runId: 'nope' });
  });
});
