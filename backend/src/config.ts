import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';

// Parsing logic for MCP servers configs.
//
// Two input formats are accepted; both normalise to the canonical
// `{ servers: ServerConfig[] }` shape the rest of the backend consumes:
//
//   1. Standard MCP format (preferred) — an `mcpServers` object map where each
//      KEY is the server name (matches Claude Desktop / Cursor / mcp-remote):
//        { "mcpServers": { "zomato-mcp": { "command": "npx", "args": [...] } } }
//   2. Legacy array form — a top-level `servers` array, each entry carrying its
//      own `name`:
//        { "servers": [ { "name": "zomato-mcp", "command": "npx", ... } ] }
const SERVER_NAME_PATTERN = /^[a-z][a-z0-9_-]*$/i;
const SERVER_NAME_MESSAGE =
  'Server name must start with a letter and contain only letters, digits, underscores, and hyphens';

// Spawn details shared by both formats. In the standard map the name lives on
// the key, so it isn't part of the entry.
const ServerSpawnSchema = {
  command: z.string().min(1, 'Command is required'),
  args: z.array(z.string()).default([]),
  env: z.record(z.union([z.string(), z.null()])).optional(),
  cwd: z.string().optional(),
};

// Canonical, normalized per-server shape (name + spawn details).
export const ServerConfigSchema = z.object({
  name: z
    .string()
    .min(1, 'Server name cannot be empty')
    .regex(SERVER_NAME_PATTERN, SERVER_NAME_MESSAGE),
  ...ServerSpawnSchema,
});

// One entry in the standard `mcpServers` map (no `name` — that's the key).
const McpServerEntrySchema = z.object(ServerSpawnSchema);

export const PlaygroundConfigSchema = z
  .object({
    servers: z
      .array(ServerConfigSchema)
      .min(1, 'At least one MCP server must be configured'),
  })
  .superRefine((cfg, ctx) => {
    const seen = new Set<string>();
    for (const [i, server] of cfg.servers.entries()) {
      if (seen.has(server.name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['servers', i, 'name'],
          message: `Duplicate server name "${server.name}". Names must be unique.`,
        });
      }
      seen.add(server.name);
    }
  });

// Standard `mcpServers` map → validated, then transformed into the canonical
// `{ servers: [...] }` shape so everything downstream is format-agnostic.
const McpServersConfigSchema = z
  .object({ mcpServers: z.record(McpServerEntrySchema) })
  .superRefine((cfg, ctx) => {
    const names = Object.keys(cfg.mcpServers);
    if (names.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['mcpServers'],
        message: 'At least one MCP server must be configured',
      });
    }
    for (const name of names) {
      if (!SERVER_NAME_PATTERN.test(name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['mcpServers', name],
          message: SERVER_NAME_MESSAGE,
        });
      }
    }
  })
  .transform((cfg) => ({
    servers: Object.entries(cfg.mcpServers).map(([name, entry]) => ({
      name,
      command: entry.command,
      args: entry.args,
      env: entry.env,
      cwd: entry.cwd,
    })),
  }));

export type ServerConfig = z.infer<typeof ServerConfigSchema>;
export type PlaygroundConfig = z.infer<typeof PlaygroundConfigSchema>;

export class ConfigValidationError extends Error {
  constructor(public readonly issues: z.ZodIssue[]) {
    const lines = issues.map(
      (i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`,
    );
    super(`Config validation failed:\n${lines.join('\n')}`);
    this.name = 'ConfigValidationError';
  }
}

export function parseConfig(value: unknown): PlaygroundConfig {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConfigValidationError([
      {
        code: z.ZodIssueCode.custom,
        path: [],
        message:
          'Config must be a JSON object with an "mcpServers" object (standard format) or a "servers" array.',
      },
    ]);
  }

  // Prefer the standard `mcpServers` map; fall back to the legacy array.
  if ('mcpServers' in value) {
    const result = McpServersConfigSchema.safeParse(value);
    if (!result.success) {
      throw new ConfigValidationError(result.error.issues);
    }
    return result.data;
  }
  if ('servers' in value) {
    const result = PlaygroundConfigSchema.safeParse(value);
    if (!result.success) {
      throw new ConfigValidationError(result.error.issues);
    }
    return result.data;
  }

  throw new ConfigValidationError([
    {
      code: z.ZodIssueCode.custom,
      path: [],
      message:
        'Config must have an "mcpServers" object (standard format) or a "servers" array.',
    },
  ]);
}

export async function loadConfigFromFile(
  filePath: string,
): Promise<PlaygroundConfig> {
  const absPath = resolve(filePath);
  let raw: string;
  try {
    raw = await readFile(absPath, 'utf8');
  } catch (err) {
    throw new Error(
      `Failed to read config file at ${absPath}: ${(err as Error).message}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Config file at ${absPath} is not valid JSON: ${(err as Error).message}`,
    );
  }
  return parseConfig(parsed);
}
