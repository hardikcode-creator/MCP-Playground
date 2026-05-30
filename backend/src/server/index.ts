import { pathToFileURL } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import type { ServerMessage } from './protocol.js';
import { Session } from './session.js';

const DEFAULT_PORT = Number(process.env.MCP_WS_PORT ?? process.env.PORT ?? 8787);

/** Wire a fresh Session to a connected socket. */
function attachSession(socket: WebSocket): void {
  const send = (msg: ServerMessage): void => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg));
  };
  const session = new Session(send);
  console.error('[mcp-playground] client connected');

  socket.on('message', (data) => {
    void session.handleRaw(data.toString());
  });
  socket.on('close', () => {
    console.error('[mcp-playground] client disconnected');
    void session.dispose();
  });
  socket.on('error', (err) => {
    console.error('[mcp-playground] socket error:', err.message);
  });
}

export type RunningServer = {
  wss: WebSocketServer;
  port: number;
  close: () => Promise<void>;
};

/**
 * Boot the WebSocket server. Pass port 0 for an ephemeral port (tests read the
 * resolved port back). Resolves once the server is listening.
 */
export function startServer(port: number = DEFAULT_PORT): Promise<RunningServer> {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ port });
    wss.once('error', reject);
    wss.once('listening', () => {
      wss.removeListener('error', reject);
      const address = wss.address();
      const resolvedPort = typeof address === 'object' && address ? address.port : port;
      resolve({
        wss,
        port: resolvedPort,
        close: () => new Promise<void>((res) => wss.close(() => res())),
      });
    });
    wss.on('connection', attachSession);
  });
}

async function main(): Promise<void> {
  const server = await startServer(DEFAULT_PORT);
  console.error(
    `[mcp-playground] WebSocket server listening on ws://localhost:${server.port}`,
  );

  const shutdown = (signal: string) => {
    console.error(`\n[mcp-playground] Received ${signal}, closing server...`);
    void server.close().then(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// Only auto-start when run directly (e.g. `tsx src/server/index.ts`), not when
// imported by tests that call startServer() themselves.
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error('[mcp-playground] Fatal error:', err);
    process.exit(1);
  });
}
