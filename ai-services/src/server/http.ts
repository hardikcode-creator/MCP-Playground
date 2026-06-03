import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';
import { loadAiConfig, type AiConfig } from '../config.js';
import {
  ArgumentMapper,
  InvalidInputError,
  LlmOutputError,
} from '../mapper/argument-mapper.js';
import { LlmError } from '../llm/client.js';
import type { ArgumentMappingInput } from '../types.js';

/**
 * Minimal HTTP front-end for the argument mapper so the browser (the playground
 * frontend) can request suggestions. Deliberately dependency-free (Node's
 * built-in http) and CORS-open for local dev.
 *
 * Routes:
 *   GET  /health           → { ok, model }
 *   POST /suggest-mappings → ArgumentMappingResult   (body: ArgumentMappingInput)
 */

const DEFAULT_PORT = Number(process.env.AI_HTTP_PORT ?? process.env.PORT ?? 5174);
const MAX_BODY_BYTES = 5_000_000; // 5 MB — tool responses can be chunky.

function indent(text: string, spaces: number): string {
  const pad = ' '.repeat(spaces);
  return text
    .split('\n')
    .map((l) => pad + l)
    .join('\n');
}

function setCors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(payload);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export type RunningHttpServer = {
  port: number;
  close: () => Promise<void>;
};

/**
 * Boot the HTTP server. Pass port 0 for an ephemeral port. Resolves once the
 * server is listening. A single ArgumentMapper instance (one LLM client) is
 * reused across requests.
 */
export function startHttpServer(
  port: number = DEFAULT_PORT,
  configOverrides: Partial<AiConfig> = {},
): Promise<RunningHttpServer> {
  const config = loadAiConfig(configOverrides);
  const mapper = new ArgumentMapper(config);

  const server = createServer((req, res) => {
    setCors(res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = req.url ?? '/';

    if (req.method === 'GET' && url === '/health') {
      sendJson(res, 200, { ok: true, model: config.model });
      return;
    }

    if (req.method === 'POST' && url === '/suggest-mappings') {
      void handleSuggest(req, res, mapper);
      return;
    }

    sendJson(res, 404, { error: `Not found: ${req.method} ${url}` });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      server.removeListener('error', reject);
      const address = server.address();
      const resolvedPort = typeof address === 'object' && address ? address.port : port;
      resolve({
        port: resolvedPort,
        close: () => new Promise<void>((res) => server.close(() => res())),
      });
    });
  });
}

async function handleSuggest(
  req: IncomingMessage,
  res: ServerResponse,
  mapper: ArgumentMapper,
): Promise<void> {
  let input: ArgumentMappingInput;
  try {
    const raw = await readBody(req);
    input = JSON.parse(raw) as ArgumentMappingInput;
  } catch (err) {
    sendJson(res, 400, { error: `Invalid request body: ${(err as Error).message}` });
    return;
  }

  const startedAt = Date.now();
  console.error(
    `\n[ai-services] ── /suggest-mappings INPUT ──\n` +
      `  current tool : ${input?.currentNode?.tool ?? '(none)'}\n` +
      `  upstream     : ${
        Array.isArray(input?.previousNodes)
          ? input.previousNodes.map((n) => `${n.nodeId} (${n.tool})`).join(', ') || '(none)'
          : '(none)'
      }\n${indent(JSON.stringify(input, null, 2), 2)}`,
  );

  try {
    const result = await mapper.recommend(input);
    console.error(
      `[ai-services] ── /suggest-mappings OUTPUT (${Date.now() - startedAt}ms, model: ${result.model}) ──\n` +
        `${indent(JSON.stringify(result, null, 2), 2)}\n`,
    );
    sendJson(res, 200, result);
  } catch (err) {
    console.error(
      `[ai-services] ── /suggest-mappings FAILED (${Date.now() - startedAt}ms) ── ${(err as Error).message}`,
    );
    if (err instanceof InvalidInputError) {
      sendJson(res, 400, { error: err.message });
      return;
    }
    // The model was unreachable or returned unusable output — it's an upstream
    // (gateway) failure from the frontend's perspective, not a client error.
    if (err instanceof LlmError || err instanceof LlmOutputError) {
      sendJson(res, 502, { error: err.message });
      return;
    }
    console.error('[ai-services] /suggest-mappings failed:', err);
    sendJson(res, 500, { error: (err as Error).message });
  }
}

async function main(): Promise<void> {
  const server = await startHttpServer(DEFAULT_PORT);
  const { model } = loadAiConfig();
  console.error(
    `[ai-services] HTTP server listening on http://localhost:${server.port} (model: ${model})`,
  );

  const shutdown = (signal: string) => {
    console.error(`\n[ai-services] Received ${signal}, closing server...`);
    void server.close().then(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// Only auto-start when run directly (`tsx src/server/http.ts`), not on import.
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error('[ai-services] Fatal error:', err);
    process.exit(1);
  });
}
