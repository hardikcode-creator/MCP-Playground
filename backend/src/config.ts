import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';

const SERVER_NAME_PATTERN = /^[a-z][a-z0-9_-]*$/i;

export const ServerConfigSchema = z.object({
  name: z
    .string()
    .min(1, 'Server name cannot be empty')
    .regex(
      SERVER_NAME_PATTERN,
      'Server name must start with a letter and contain only letters, digits, underscores, and hyphens',
    ),
  command: z.string().min(1, 'Command is required'),
  args: z.array(z.string()).default([]),

  env: z.record(z.union([z.string(), z.null()])).optional(),

  cwd: z.string().optional(),
});

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
  const result = PlaygroundConfigSchema.safeParse(value);
  if (!result.success) {
    throw new ConfigValidationError(result.error.issues);
  }
  return result.data;
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
