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

// Stable demo account login used across the mock github tools so cross-node
// $refs (owner/repo) resolve to consistent values.
const GH_OWNER = "octo-demo";

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
      baseName: "get-sum",
      description: "Returns the sum of two numbers.",
      inputSchema: {
        type: "object",
        properties: {
          a: { type: "number", description: "First number" },
          b: { type: "number", description: "Second number" },
        },
        required: ["a", "b"],
      },
      run: (a) => {
        const sum = num(a.a) + num(a.b);
        return { text: String(sum), structured: { sum } };
      },
    },
    {
      baseName: "get-env",
      description: "Returns environment variables, helpful for debugging MCP server configuration.",
      inputSchema: { type: "object", properties: {} },
      run: () => ({
        text: "NODE_ENV=development\nMCP_TRANSPORT=stdio",
        structured: { NODE_ENV: "development", MCP_TRANSPORT: "stdio" },
      }),
    },
  ],
  github: [
    {
      baseName: "create_repository",
      description: "Create a new GitHub repository in your account.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Repository name" },
          description: { type: "string", description: "Repository description" },
          private: { type: "boolean", description: "Whether the repository should be private" },
          autoInit: { type: "boolean", description: "Initialize with README.md" },
        },
        required: ["name"],
      },
      run: (a) => {
        const name = str(a.name, "demo-repo");
        const repo = {
          id: 987654321,
          name,
          full_name: `${GH_OWNER}/${name}`,
          private: Boolean(a.private),
          owner: { login: GH_OWNER, id: 42, type: "User" },
          default_branch: "main",
          html_url: `https://github.com/${GH_OWNER}/${name}`,
          stargazers_count: 0,
          forks_count: 0,
          open_issues_count: 0,
        };
        return { text: `Created repository ${repo.full_name} (id ${repo.id})`, structured: repo };
      },
    },
    {
      baseName: "search_repositories",
      description: "Search for GitHub repositories.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query (GitHub search syntax)" },
          page: { type: "number", description: "Page number for pagination" },
          perPage: { type: "number", description: "Results per page (max 100)" },
        },
        required: ["query"],
      },
      run: (a) => {
        const query = str(a.query, "mcp");
        const items = [
          { id: 987654321, full_name: `${GH_OWNER}/mcp-playground-demo`, stargazers_count: 3, open_issues_count: 1 },
          { id: 13371337, full_name: "modelcontextprotocol/servers", stargazers_count: 12000, open_issues_count: 87 },
          { id: 24682468, full_name: "modelcontextprotocol/typescript-sdk", stargazers_count: 6000, open_issues_count: 41 },
        ];
        return {
          text: `Found ${items.length} repositories for "${query}":\n${items.map((i) => `- ${i.full_name} (★${i.stargazers_count})`).join("\n")}`,
          structured: { total_count: items.length, incomplete_results: false, items },
        };
      },
    },
    {
      baseName: "search_code",
      description: "Search for code across GitHub repositories.",
      inputSchema: {
        type: "object",
        properties: {
          q: { type: "string", description: "Search query" },
          per_page: { type: "number", description: "Results per page (max 100)" },
        },
        required: ["q"],
      },
      run: (a) => {
        const q = str(a.q, "StdioClientTransport");
        return {
          text: `Code matches for "${q}":\n- modelcontextprotocol/typescript-sdk › src/client/stdio.ts`,
          structured: { total_count: 1, items: [{ path: "src/client/stdio.ts", repository: "modelcontextprotocol/typescript-sdk" }] },
        };
      },
    },
    {
      baseName: "create_branch",
      description: "Create a new branch in a GitHub repository.",
      inputSchema: {
        type: "object",
        properties: {
          owner: { type: "string", description: "Repository owner" },
          repo: { type: "string", description: "Repository name" },
          branch: { type: "string", description: "Name for the new branch" },
          from_branch: { type: "string", description: "Source branch (defaults to the default branch)" },
        },
        required: ["owner", "repo", "branch"],
      },
      run: (a) => {
        const branch = str(a.branch, "feature/new");
        // Mirror the real GitHub server: a created ref has no plain `name`,
        // only the full `ref` (refs/heads/<branch>). Downstream nodes should
        // use the literal branch name rather than referencing this output.
        return {
          text: `Created branch ${branch} from ${str(a.from_branch, "main")}`,
          structured: { ref: `refs/heads/${branch}`, object: { sha: "a1b2c3d4e5", type: "commit" } },
        };
      },
    },
    {
      baseName: "create_or_update_file",
      description: "Create or update a single file in a GitHub repository (a commit).",
      inputSchema: {
        type: "object",
        properties: {
          owner: { type: "string", description: "Repository owner" },
          repo: { type: "string", description: "Repository name" },
          path: { type: "string", description: "Path to create/update the file" },
          content: { type: "string", description: "File content" },
          message: { type: "string", description: "Commit message" },
          branch: { type: "string", description: "Branch to commit to" },
          sha: { type: "string", description: "SHA of the file being replaced (when updating)" },
        },
        required: ["owner", "repo", "path", "content", "message", "branch"],
      },
      run: (a) => {
        const path = str(a.path, "FILE.md");
        const size = str(a.content).length;
        return {
          text: `Committed ${path} (${size} bytes) on ${str(a.branch, "main")}`,
          structured: {
            commit: { sha: "c0ffee0123", message: str(a.message, "update"), html_url: `https://github.com/${str(a.owner, GH_OWNER)}/${str(a.repo, "repo")}/commit/c0ffee0123` },
            content: { path, size, sha: "b10b00b1e5" },
          },
        };
      },
    },
    {
      baseName: "list_commits",
      description: "Get the list of commits of a branch in a GitHub repository.",
      inputSchema: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          sha: { type: "string" },
          page: { type: "number" },
          perPage: { type: "number" },
        },
        required: ["owner", "repo"],
      },
      run: (a) => {
        const commits = [
          { sha: "c0ffee0123", commit: { message: "Add WELCOME.md via MCP Playground" } },
          { sha: "1n1t000001", commit: { message: "Initial commit" } },
        ];
        return {
          text: `${commits.length} commits on ${str(a.repo, "repo")}`,
          structured: { total_count: commits.length, commits },
        };
      },
    },
    {
      baseName: "create_pull_request",
      description: "Create a new pull request in a GitHub repository.",
      inputSchema: {
        type: "object",
        properties: {
          owner: { type: "string", description: "Repository owner" },
          repo: { type: "string", description: "Repository name" },
          title: { type: "string", description: "Pull request title" },
          body: { type: "string", description: "Pull request body" },
          head: { type: "string", description: "Branch with your changes" },
          base: { type: "string", description: "Branch to merge into" },
          draft: { type: "boolean", description: "Create as draft" },
        },
        required: ["owner", "repo", "title", "head", "base"],
      },
      run: (a) => {
        const pr = {
          number: 1,
          id: 1122334455,
          state: "open",
          title: str(a.title, "Pull request"),
          head: { ref: str(a.head, "feature") },
          base: { ref: str(a.base, "main") },
          html_url: `https://github.com/${str(a.owner, GH_OWNER)}/${str(a.repo, "repo")}/pull/1`,
          commits: 1,
          additions: 12,
          deletions: 3,
          changed_files: 1,
          mergeable: true,
          draft: Boolean(a.draft),
        };
        return { text: `Opened PR #${pr.number}: ${pr.title}`, structured: pr };
      },
    },
    {
      baseName: "get_pull_request",
      description: "Get details of a specific pull request.",
      inputSchema: {
        type: "object",
        properties: {
          owner: { type: "string", description: "Repository owner" },
          repo: { type: "string", description: "Repository name" },
          pull_number: { type: "number", description: "Pull request number" },
        },
        required: ["owner", "repo", "pull_number"],
      },
      run: (a) => {
        const number = num(a.pull_number, 1);
        return {
          text: `PR #${number} is open and mergeable`,
          structured: {
            number,
            state: "open",
            mergeable: true,
            mergeable_state: "clean",
            commits: 1,
            additions: 12,
            deletions: 3,
            changed_files: 1,
            review_comments: 0,
          },
        };
      },
    },
    {
      baseName: "merge_pull_request",
      description: "Merge a pull request.",
      inputSchema: {
        type: "object",
        properties: {
          owner: { type: "string", description: "Repository owner" },
          repo: { type: "string", description: "Repository name" },
          pull_number: { type: "number", description: "Pull request number" },
          merge_method: { type: "string", description: "merge | squash | rebase" },
          commit_title: { type: "string", description: "Title for the merge commit" },
        },
        required: ["owner", "repo", "pull_number"],
      },
      run: (a) => {
        const number = num(a.pull_number, 1);
        return {
          text: `Merged PR #${number} via ${str(a.merge_method, "merge")}`,
          structured: { merged: true, sha: "merge789abc", message: "Pull Request successfully merged" },
        };
      },
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
