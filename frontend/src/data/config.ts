// Hand-rolled MCP-config validation. Mirrors the backend zod rules + messages
// in backend/src/config.ts so the frontend and backend reject the same things.

import type { PlaygroundConfig, ServerConfig } from "../types";

const SERVER_NAME_RE = /^[a-z][a-z0-9_-]*$/i;

export type ConfigIssue = { path: string; message: string };

export type ValidateResult =
  | { ok: true; config: PlaygroundConfig }
  | { ok: false; errors: ConfigIssue[] };

export function validateConfig(text: string): ValidateResult {
  if (text.trim().length === 0) {
    return { ok: false, errors: [{ path: "(root)", message: "Paste or load an MCP config to begin." }] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [{ path: "(root)", message: `Invalid JSON: ${(e as Error).message}` }] };
  }
  return validateConfigValue(parsed);
}

export function validateConfigValue(value: unknown): ValidateResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {
      ok: false,
      errors: [{ path: "(root)", message: "Config must be a JSON object with a `servers` array." }],
    };
  }

  const servers = (value as { servers?: unknown }).servers;
  if (!Array.isArray(servers)) {
    return { ok: false, errors: [{ path: "servers", message: "`servers` must be an array." }] };
  }

  const errors: ConfigIssue[] = [];
  if (servers.length === 0) {
    errors.push({ path: "servers", message: "At least one MCP server must be configured." });
  }

  const seen = new Set<string>();
  const normalized: ServerConfig[] = [];

  servers.forEach((raw, i) => {
    const base = `servers.${i}`;
    const s = raw as {
      name?: unknown;
      command?: unknown;
      args?: unknown;
      env?: unknown;
      cwd?: unknown;
    };

    const name = typeof s.name === "string" ? s.name : "";
    if (!name) {
      errors.push({ path: `${base}.name`, message: "Server name cannot be empty" });
    } else if (!SERVER_NAME_RE.test(name)) {
      errors.push({
        path: `${base}.name`,
        message:
          "Server name must start with a letter and contain only letters, digits, underscores, and hyphens",
      });
    } else if (seen.has(name)) {
      errors.push({
        path: `${base}.name`,
        message: `Duplicate server name "${name}". Names must be unique.`,
      });
    }
    if (name) seen.add(name);

    const command = typeof s.command === "string" ? s.command : "";
    if (!command) errors.push({ path: `${base}.command`, message: "Command is required" });

    let args: string[] = [];
    if (s.args === undefined) {
      args = [];
    } else if (Array.isArray(s.args) && s.args.every((a) => typeof a === "string")) {
      args = s.args as string[];
    } else {
      errors.push({ path: `${base}.args`, message: "args must be an array of strings" });
    }

    let env: Record<string, string | null> | undefined;
    if (s.env !== undefined) {
      const ok =
        typeof s.env === "object" &&
        s.env !== null &&
        !Array.isArray(s.env) &&
        Object.values(s.env as Record<string, unknown>).every((v) => typeof v === "string" || v === null);
      if (ok) {
        env = s.env as Record<string, string | null>;
      } else {
        errors.push({ path: `${base}.env`, message: "env must be an object of string or null values" });
      }
    }

    let cwd: string | undefined;
    if (s.cwd !== undefined) {
      if (typeof s.cwd === "string") cwd = s.cwd;
      else errors.push({ path: `${base}.cwd`, message: "cwd must be a string" });
    }

    normalized.push({ name, command, args, env, cwd });
  });

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, config: { servers: normalized } };
}

// Example config used by the homepage "Load example" button. It deliberately
// exercises every connection state in the mock: filesystem + everything connect,
// github is skipped (missing GITHUB_TOKEN), sqlite fails (docker not runnable).
export const EXAMPLE_CONFIG = `{
  "servers": [
    {
      "name": "filesystem",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
    },
    {
      "name": "everything",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-everything"]
    },
    {
      "name": "github",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": null }
    },
    {
      "name": "sqlite",
      "command": "docker",
      "args": ["run", "-i", "--rm", "mcp/sqlite"]
    }
  ]
}`;
