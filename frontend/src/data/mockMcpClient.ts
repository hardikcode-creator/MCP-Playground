// Mock implementation of McpClient. Stands in for the future WebSocket client:
// connect() returns { catalog, skipped, failed } mirroring the backend
// StartResult, and callTool() resolves a plausible MCP result envelope.

import type {
  ConnectResult,
  FailedServer,
  PlaygroundConfig,
  SkippedServer,
  ToolDescriptor,
  ToolResult,
} from "../types";
import type { CallToolOptions, McpClient } from "./mcpClient";

type MockTool = ToolDescriptor & {
  run: (args: Record<string, unknown>) => { text: string; structured?: unknown };
};

type KnownTool = Omit<MockTool, "serverName" | "qualifiedName">;

const str = (v: unknown, fallback = ""): string =>
  typeof v === "string" && v.length > 0 ? v : fallback;
const num = (v: unknown, fallback = 0): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

const KNOWN_TOOLS: Record<string, KnownTool[]> = {
  filesystem: [
    {
      baseName: "read_file",
      description: "Read the complete contents of a file from the file system.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute path to the file" },
          encoding: {
            type: "string",
            description: "How to decode the file",
            enum: ["utf-8", "base64", "hex"],
          },
        },
        required: ["path"],
      },
      run: (a) => ({ text: `Contents of ${str(a.path, "/tmp/notes.txt")}:\n\nhello, world\n` }),
    },
    {
      baseName: "list_directory",
      description: "List files and directories under a given path.",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string", description: "Directory to list" } },
        required: ["path"],
      },
      run: (a) => ({
        text: `Listing of ${str(a.path, "/tmp")}:\n[DIR]  logs\n[FILE] notes.txt\n[FILE] config.json`,
      }),
    },
    {
      baseName: "write_file",
      description: "Create a new file or overwrite an existing one with the given contents.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Destination path" },
          content: { type: "string", description: "File contents" },
          append: { type: "boolean", description: "Append instead of overwriting" },
        },
        required: ["path", "content"],
      },
      run: (a) => ({ text: `Wrote ${str(a.content).length} bytes to ${str(a.path, "/tmp/out.txt")}` }),
    },
  ],
  everything: [
    {
      baseName: "echo",
      description: "Echoes back the provided message. Useful for testing wiring.",
      inputSchema: {
        type: "object",
        properties: { message: { type: "string", description: "Text to echo" } },
        required: ["message"],
      },
      run: (a) => ({ text: `Echo: ${str(a.message, "hello from mcp")}` }),
    },
    {
      baseName: "add",
      description: "Adds two numbers and returns the sum.",
      inputSchema: {
        type: "object",
        properties: { a: { type: "number" }, b: { type: "number" } },
        required: ["a", "b"],
      },
      run: (a) => {
        const sum = num(a.a) + num(a.b);
        return { text: String(sum), structured: { sum } };
      },
    },
    {
      baseName: "printEnv",
      description: "Prints a few environment variables as structured JSON.",
      inputSchema: { type: "object", properties: {} },
      run: () => ({
        text: "NODE_ENV=development\nMCP_TRANSPORT=stdio",
        structured: { NODE_ENV: "development", MCP_TRANSPORT: "stdio" },
      }),
    },
  ],
};

function buildMockTools(serverNames: string[]): MockTool[] {
  const out: MockTool[] = [];
  for (const name of serverNames) {
    const known = KNOWN_TOOLS[name];
    if (known) {
      for (const t of known) out.push({ ...t, serverName: name, qualifiedName: `${name}__${t.baseName}` });
    } else {
      // Unknown server: a couple of generic tools so the catalog still populates.
      out.push({
        serverName: name,
        baseName: "ping",
        qualifiedName: `${name}__ping`,
        description: "Health check; returns pong.",
        inputSchema: { type: "object", properties: {} },
        run: () => ({ text: "pong" }),
      });
      out.push({
        serverName: name,
        baseName: "info",
        qualifiedName: `${name}__info`,
        description: "Returns basic server metadata.",
        inputSchema: { type: "object", properties: {} },
        run: () => ({ text: `server ${name}`, structured: { server: name, version: "0.1.0" } }),
      });
    }
  }
  return out;
}

// Mock-only heuristics so the connection states are demonstrable:
//   - a server with a `null` env value is "skipped" (required secret not provided)
//   - a server whose command isn't a known runner "fails" to spawn
//   - everything else connects and contributes its tools
const RUNNABLE_COMMANDS = new Set([
  "npx",
  "node",
  "uvx",
  "python",
  "python3",
  "bun",
  "bunx",
  "deno",
  "pnpm",
  "yarn",
]);

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Like delay, but rejects with an AbortError if the signal fires first — so the
// workflow debugger's "Cancel" can interrupt an in-flight tool call mid-delay.
function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export class MockMcpClient implements McpClient {
  private tools = new Map<string, MockTool>();

  async connect(config: PlaygroundConfig): Promise<ConnectResult> {
    await delay(350);

    const skipped: SkippedServer[] = [];
    const failed: FailedServer[] = [];
    const connected: string[] = [];

    for (const s of config.servers) {
      const missingEnv = s.env
        ? Object.entries(s.env)
            .filter(([, v]) => v === null)
            .map(([k]) => k)
        : [];
      if (missingEnv.length > 0) {
        skipped.push({ name: s.name, missingEnv });
        continue;
      }
      if (!RUNNABLE_COMMANDS.has(s.command)) {
        failed.push({ name: s.name, error: `Failed to spawn "${s.command}": command not found` });
        continue;
      }
      connected.push(s.name);
    }

    const mockTools = buildMockTools(connected);
    this.tools = new Map(mockTools.map((t) => [t.qualifiedName, t]));

    const catalog: ToolDescriptor[] = mockTools.map((t) => ({
      serverName: t.serverName,
      qualifiedName: t.qualifiedName,
      baseName: t.baseName,
      description: t.description,
      inputSchema: t.inputSchema,
      outputSchema: t.outputSchema,
    }));

    return { catalog, skipped, failed };
  }

  async callTool(
    qualifiedName: string,
    args: Record<string, unknown>,
    options?: CallToolOptions,
  ): Promise<ToolResult> {
    await abortableDelay(450, options?.signal);
    const tool = this.tools.get(qualifiedName);
    if (!tool) {
      return { content: [{ type: "text", text: `Unknown tool "${qualifiedName}"` }], isError: true };
    }
    const { text, structured } = tool.run(args);
    const result: ToolResult = { content: [{ type: "text", text }], isError: false };
    if (structured !== undefined) result.structuredContent = structured;
    return result;
  }
}
