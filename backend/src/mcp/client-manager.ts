import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { PlaygroundConfig, ServerConfig } from '../config.js';

export type JsonSchema = Record<string, unknown>;

export type ToolDescriptor = {
  serverName: string;
  qualifiedName: string;
  baseName: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema?: JsonSchema;
};

/**
 *Schema for clients and typescript types
 */
export type ProvidedEnv = Record<string, Record<string, string>>;

export type StartResult = {
  /** Servers that failed to spawn or connect, with the error message. */
  failed: { name: string; error: string }[];
  /** Servers that were skipped because required env vars were not provided. */
  skipped: { name: string; missingEnv: string[] }[];
};

type ManagedClient = {
  serverName: string;
  client: Client;
  transport: StdioClientTransport;
  tools: ToolDescriptor[];
};

const CLIENT_INFO = {
  name: 'mcp-playground',
  version: '0.0.1',
};

const CONNECT_TIMEOUT_MS = 300_000;

/**
 * ClientManager handles connection parsing and listing of tools from MCP servers.
 */
export class ClientManager {
  private clients = new Map<string, ManagedClient>();

  /**
   * Spawn and connect to every server in the config in parallel.
   *
   * @param config       Validated playground config.
   * @param providedEnv  Optional per-server env values (typically from the UI).
   *                     For each server, values here override `server.env`,
   *                     which itself overrides inherited `process.env`.
   */
  async start(
    config: PlaygroundConfig,
    providedEnv: ProvidedEnv = {},
  ): Promise<StartResult> {
    const failed: { name: string; error: string }[] = [];
    const skipped: { name: string; missingEnv: string[] }[] = [];

    await Promise.all(
      config.servers.map(async (server) => {
        const overrides = providedEnv[server.name] ?? {};

        const missing = findMissingRequiredEnv(server, overrides);
        if (missing.length > 0) {
          skipped.push({ name: server.name, missingEnv: missing });
          console.error(
            `[ClientManager] Skipping "${server.name}": missing required env var(s): ${missing.join(', ')}`,
          );
          return;
        }

        try {
          await this.spawnAndConnect(server, overrides);
        } catch (err) {
          const message = (err as Error).message;
          failed.push({ name: server.name, error: message });
          console.error(
            `[ClientManager] Failed to connect "${server.name}": ${message}`,
          );
        }
      }),
    );

    return { failed, skipped };
  }

  private async spawnAndConnect(
    server: ServerConfig,
    providedForServer: Record<string, string>,
  ): Promise<void> {
    const env = mergeEnv(server.env, providedForServer);

    const transport = new StdioClientTransport({
      command: server.command,
      args: server.args,
      env,
      cwd: server.cwd,
    });

    const client = new Client(CLIENT_INFO, { capabilities: {} });

    await withTimeout(
      client.connect(transport),
      CONNECT_TIMEOUT_MS,
      `Connection to MCP server "${server.name}" timed out after ${CONNECT_TIMEOUT_MS}ms`,
    );

    const tools = await this.fetchTools(server.name, client);

    this.clients.set(server.name, {
      serverName: server.name,
      client,
      transport,
      tools,
    });
    console.error(
      `[ClientManager] Connected to "${server.name}" with ${tools.length} tool(s)`,
    );
  }

  private async fetchTools(
    serverName: string,
    client: Client,
  ): Promise<ToolDescriptor[]> {
    const response = await client.listTools();
    return response.tools.map((tool: Tool) => ({
      serverName,
      qualifiedName: `${serverName}__${tool.name}`,
      baseName: tool.name,
      description: tool.description ?? '',
      inputSchema: (tool.inputSchema ?? { type: 'object' }) as JsonSchema,
      outputSchema: (tool as Tool & { outputSchema?: JsonSchema })
        .outputSchema,
    }));
  }

  /** Flat, namespaced tool catalog across all connected servers. */
  getCatalog(): ToolDescriptor[] {
    return [...this.clients.values()].flatMap((c) => c.tools);
  }

  getServerNames(): string[] {
    return [...this.clients.keys()];
  }


  /**
   * This functions are for handling tool calls and list of tools from MCP servers.
   */


  /** Look up which server owns a qualified tool name. */
  findToolOwner(
    qualifiedName: string,
  ): { serverName: string; baseName: string } | undefined {
    for (const managed of this.clients.values()) {
      const tool = managed.tools.find((t) => t.qualifiedName === qualifiedName);
      if (tool) {
        return { serverName: tool.serverName, baseName: tool.baseName };
      }
    }
    return undefined;
  }

  /** Re-fetch tools/list on every server (some servers expose a dynamic toolset). */
  async refresh(): Promise<void> {
    for (const managed of this.clients.values()) {
      try {
        managed.tools = await this.fetchTools(
          managed.serverName,
          managed.client,
        );
      } catch (err) {
        console.error(
          `[ClientManager] Failed to refresh "${managed.serverName}": ${(err as Error).message}`,
        );
      }
    }
  }

  /** Cleanly disconnect every client (this also terminates the child process). */
  async shutdown(): Promise<void> {
    const tasks = [...this.clients.values()].map(
      async ({ serverName, client }) => {
        try {
          await client.close();
        } catch (err) {
          console.error(
            `[ClientManager] Error closing "${serverName}": ${(err as Error).message}`,
          );
        }
      },
    );
    await Promise.allSettled(tasks);
    this.clients.clear();
  }
  
  async callTool(
    qualifiedName: string,
    args: Record<string, unknown>,
    options: { signal?: AbortSignal } = {},
  ): Promise<unknown> {
    const owner = this.findToolOwner(qualifiedName);
    if (!owner) {
      throw new Error(
        `Unknown tool "${qualifiedName}". Check that the MCP server is connected ` +
          `and the name is namespaced as "server__tool".`,
      );
    }
    const managed = this.clients.get(owner.serverName);
    if (!managed) {
      throw new Error(
        `Server "${owner.serverName}" owns "${qualifiedName}" but is not connected`,
      );
    }
    // Pre-check: if already aborted, fail fast without dispatching.
    if (options.signal?.aborted) {
      throw new Error(`Tool "${qualifiedName}" was cancelled before dispatch`);
    }
    const result = await managed.client.callTool(
      { name: owner.baseName, arguments: args },
      undefined,
      options.signal ? { signal: options.signal } : undefined,
    );
    if (result.isError === true) {
      const message = extractErrorMessage(result);
      throw new Error(`Tool "${qualifiedName}" reported error: ${message}`);
    }
    return enrichWithStructuredContent(result);
  }
}

/**
 * Server-agnostic result enrichment.
 *
 * Many MCP servers (the deprecated GitHub server, older community servers,
 * anything predating the structured-output spec) return their payload as a
 * JSON string in the first text content block and DO NOT populate the
 * optional `structuredContent` field. Workflow `$ref`s resolve via JSONPath
 * over the raw tool result, so without structured data a ref can only ever
 * reach the whole text blob (a single string) — never a nested field like
 * `$.structuredContent.number`.
 *
 * This lifts that first text block into `structuredContent` when it is a JSON
 * object or array, so refs into structured fields work uniformly across every
 * server. It is intentionally conservative and safe to apply to all servers:
 *   - servers that already provide `structuredContent` are left untouched
 *     (no double-parsing, their richer output wins)
 *   - only JSON objects/arrays are lifted; plain prose and bare primitives
 *     (e.g. "8", "ok", "true") stay text-only, so nothing is misinterpreted
 *   - parse failures are swallowed and the original result is returned as-is
 */
export function enrichWithStructuredContent(result: unknown): unknown {
  if (typeof result !== 'object' || result === null) return result;
  const r = result as Record<string, unknown>;

  // Respect servers that already emit structured output.
  if (r.structuredContent !== undefined) return result;

  const content = r.content;
  if (!Array.isArray(content) || content.length === 0) return result;

  const first = content[0] as { type?: unknown; text?: unknown } | null;
  if (!first || first.type !== 'text' || typeof first.text !== 'string') {
    return result;
  }

  const text = first.text.trim();
  // Cheap guard: only attempt a parse for things that look like JSON
  // objects/arrays. Skips prose and primitives without paying for a throw.
  if (text[0] !== '{' && text[0] !== '[') return result;

  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed !== null && typeof parsed === 'object') {
      return { ...r, structuredContent: parsed };
    }
  } catch {
    // Not valid JSON — leave the text-only result untouched.
  }
  return result;
}

function extractErrorMessage(result: unknown): string {
  if (typeof result !== 'object' || result === null) return 'unknown error';
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return 'unknown error';
  for (const item of content) {
    if (
      typeof item === 'object' &&
      item !== null &&
      (item as { type?: unknown }).type === 'text' &&
      typeof (item as { text?: unknown }).text === 'string'
    ) {
      return (item as { text: string }).text;
    }
  }
  return 'unknown error';
}


/**
 * Any env var declared with a `null` value in `server.env` is a placeholder.
 * Returns the names of placeholders that are NOT satisfied by either
 * the runtime overrides or the current process environment.
 */
function findMissingRequiredEnv(
  server: ServerConfig,
  providedForServer: Record<string, string>,
): string[] {
  if (!server.env) return [];
  const missing: string[] = [];
  for (const [name, declared] of Object.entries(server.env)) {
    if (declared !== null) continue; // literal value present, nothing to check
    const fromProvided = providedForServer[name];
    const fromProcess = process.env[name];
    const value = fromProvided ?? fromProcess;
    if (value === undefined || value === '') {
      missing.push(name);
    }
  }
  return missing;
}

/**
 * Build the env passed to the spawned child process.
 * Layering (later wins):
 *   1. process.env  (everything the user's shell has)
 *   2. server.env   (literal string values only; `null` placeholders are skipped)
 *   3. providedForServer (UI-supplied at runtime; usually secrets)
 *
 * For each `null` placeholder in server.env, the final value comes from
 * providedForServer (preferred) or process.env (fallback).
 */
function mergeEnv(
  literal?: Record<string, string | null>,
  providedForServer?: Record<string, string>,
): Record<string, string> {
  const merged: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined) merged[k] = v;
  }
  if (literal) {
    for (const [k, v] of Object.entries(literal)) {
      if (v !== null) merged[k] = v;
    }
  }
  if (providedForServer) Object.assign(merged, providedForServer);
  return merged;
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
