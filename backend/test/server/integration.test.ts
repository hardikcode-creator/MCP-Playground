import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer, type RunningServer } from '../../src/server/index.js';
import type { ServerMessage } from '../../src/server/protocol.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const stubPath = path.join(here, '..', 'fixtures', 'stub-mcp-server.ts');
const tsxBin = path.join(here, '..', '..', 'node_modules', '.bin', 'tsx');
const workflow = JSON.parse(
  readFileSync(
    path.join(here, '..', '..', '..', 'examples', 'workflow-with-breakpoint.json'),
    'utf8',
  ),
) as unknown;

const config = {
  servers: [{ name: 'everything', command: tsxBin, args: [stubPath] }],
};

// A live WebSocket client that records every server frame and lets the test
// await a specific one.
class Client {
  private readonly ws: WebSocket;
  frames: ServerMessage[] = [];
  private waiters: Array<{ pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void; timer: ReturnType<typeof setTimeout> }> = [];

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.on('message', (data) => {
      const msg = JSON.parse(data.toString()) as ServerMessage;
      this.frames.push(msg);
      for (const w of [...this.waiters]) {
        if (w.pred(msg)) {
          clearTimeout(w.timer);
          this.waiters = this.waiters.filter((x) => x !== w);
          w.resolve(msg);
        }
      }
    });
  }

  ready(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws.on('open', () => resolve());
      this.ws.on('error', reject);
    });
  }

  send(obj: unknown): void {
    this.ws.send(JSON.stringify(obj));
  }

  waitFor(pred: (m: ServerMessage) => boolean, ms = 20_000): Promise<ServerMessage> {
    const found = this.frames.find(pred);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('waitFor timed out')), ms);
      this.waiters.push({ pred, resolve, timer });
    });
  }

  hasEngineEvent(type: string, nodeId?: string): boolean {
    return this.frames.some(
      (f) =>
        f.type === 'engineEvent' &&
        f.event.type === type &&
        (nodeId === undefined || (f.event as { nodeId?: string }).nodeId === nodeId),
    );
  }

  close(): void {
    this.ws.close();
  }
}

describe('WebSocket integration (real server + stub MCP)', () => {
  let server: RunningServer;
  let client: Client;

  beforeAll(async () => {
    server = await startServer(0);
    client = new Client(`ws://localhost:${server.port}`);
    await client.ready();
  });

  afterAll(async () => {
    client.close();
    await server.close();
  });

  it('connects to the stub and lists its tools', async () => {
    client.send({ type: 'connect', id: 'c1', config });
    const connected = await client.waitFor((f) => f.type === 'connected' && f.id === 'c1');
    if (connected.type !== 'connected') throw new Error('expected connected');
    const names = connected.catalog.map((t) => t.qualifiedName);
    expect(names).toContain('everything__echo');
  });

  it('keeps branchB running while branchA is paused, then resumes to completion with $ref resolved', async () => {
    const runId = 'run-bp';
    client.send({ type: 'runWorkflow', runId, workflow });

    // branchA_echo hits its authored breakpoint.
    await client.waitFor(
      (f) => f.type === 'engineEvent' && f.event.type === 'node.paused' && (f.event as { nodeId: string }).nodeId === 'branchA_echo',
    );

    // branchB runs to completion independently while branchA is parked.
    await client.waitFor(
      (f) => f.type === 'engineEvent' && f.event.type === 'node.completed' && (f.event as { nodeId: string }).nodeId === 'branchB_followup',
    );

    // Proof of independence: branchA has NOT completed (still paused, awaiting us).
    expect(client.hasEngineEvent('node.completed', 'branchA_echo')).toBe(false);

    // $ref resolution on branchB: its followup should have received branchB_echo's echoed text.
    const bFollowupStarted = client.frames.find(
      (f) => f.type === 'engineEvent' && f.event.type === 'node.started' && (f.event as { nodeId: string }).nodeId === 'branchB_followup',
    );
    if (bFollowupStarted?.type === 'engineEvent' && bFollowupStarted.event.type === 'node.started') {
      expect(bFollowupStarted.event.resolvedArgs).toMatchObject({ message: 'Echo: This is Node B' });
    } else {
      throw new Error('expected branchB_followup node.started');
    }

    // Resume branchA.
    client.send({ type: 'pauseAction', runId, nodeId: 'branchA_echo', action: { type: 'continue' } });

    const result = await client.waitFor((f) => f.type === 'workflowResult' && f.runId === runId);
    if (result.type !== 'workflowResult') throw new Error('expected workflowResult');
    expect(result.result.status).toBe('completed');

    const byId = new Map(result.result.steps.map((s) => [s.nodeId, s]));
    expect(byId.get('branchA_echo')?.status).toBe('completed');
    expect(byId.get('branchA_followup')?.status).toBe('completed');
    expect(byId.get('branchB_echo')?.status).toBe('completed');
    expect(byId.get('branchB_followup')?.status).toBe('completed');

    // branchA's followup resolved its $ref against branchA_echo's runtime output.
    expect(byId.get('branchA_followup')?.resolvedArgs).toMatchObject({
      message: 'Echo: This is Node A',
    });
  });
});
