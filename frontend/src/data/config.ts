// Hand-rolled MCP-config validation. Mirrors the backend zod rules + messages
// in backend/src/config.ts so the frontend and backend reject the same things.

import type { PlaygroundConfig, ServerConfig } from "../types";

export const SERVER_NAME_RE = /^[a-z][a-z0-9_-]*$/i;

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
      errors: [
        {
          path: "(root)",
          message:
            "Config must be a JSON object with an `mcpServers` object (standard format) or a `servers` array.",
        },
      ],
    };
  }

  const obj = value as { mcpServers?: unknown; servers?: unknown };
  // Prefer the standard `mcpServers` map; fall back to the legacy array.
  if (obj.mcpServers !== undefined) return validateMcpServersMap(obj.mcpServers);
  if (obj.servers !== undefined) return validateServersArray(obj.servers);
  return {
    ok: false,
    errors: [
      {
        path: "(root)",
        message:
          "Config must have an `mcpServers` object (standard format) or a `servers` array.",
      },
    ],
  };
}

// Standard format: { "mcpServers": { "<name>": { command, args, ... } } }.
// The server name is the object key.
function validateMcpServersMap(map: unknown): ValidateResult {
  if (typeof map !== "object" || map === null || Array.isArray(map)) {
    return {
      ok: false,
      errors: [{ path: "mcpServers", message: "`mcpServers` must be an object keyed by server name." }],
    };
  }

  const errors: ConfigIssue[] = [];
  const entries = Object.entries(map as Record<string, unknown>);
  if (entries.length === 0) {
    errors.push({ path: "mcpServers", message: "At least one MCP server must be configured." });
  }

  const normalized: ServerConfig[] = [];
  for (const [name, raw] of entries) {
    const base = `mcpServers.${name}`;
    if (!SERVER_NAME_RE.test(name)) {
      errors.push({
        path: base,
        message:
          "Server name must start with a letter and contain only letters, digits, underscores, and hyphens",
      });
    }
    normalized.push({ name, ...readServerFields(raw, base, errors) });
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, config: { servers: normalized } };
}

// Legacy format: { "servers": [ { "name", "command", ... } ] }.
function validateServersArray(servers: unknown): ValidateResult {
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
    const name = typeof (raw as { name?: unknown })?.name === "string" ? (raw as { name: string }).name : "";
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

    normalized.push({ name, ...readServerFields(raw, base, errors) });
  });

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, config: { servers: normalized } };
}

// Validate the spawn fields shared by both formats; push issues under `base`.
function readServerFields(
  raw: unknown,
  base: string,
  errors: ConfigIssue[],
): { command: string; args: string[]; env?: Record<string, string | null>; cwd?: string } {
  const s = (raw && typeof raw === "object" ? raw : {}) as {
    command?: unknown;
    args?: unknown;
    env?: unknown;
    cwd?: unknown;
  };

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

  return { command, args, env, cwd };
}

// Strip one layer of wrapping quotes a paste might leave on an arg. For double
// quotes we round-trip through JSON.parse so escapes (\", \\) are resolved
// properly; single quotes are stripped literally.
function stripWrappingQuotes(s: string): string {
  if (s.length < 2) return s;
  const first = s[0];
  const last = s[s.length - 1];
  if (first === '"' && last === '"') {
    try {
      const parsed = JSON.parse(s);
      if (typeof parsed === "string") return parsed;
    } catch {
      // not a valid JSON string — fall through and strip literally
    }
    return s.slice(1, -1);
  }
  if (first === "'" && last === "'") return s.slice(1, -1);
  return s;
}

// Parse the add-server form's "Arguments" field into a clean string[]. Tolerant
// of how people actually fill it in, so args never get captured with stray
// JSON punctuation that later gets escaped (\", \\) and breaks the spawn:
//   • a pasted JSON array of strings is used verbatim;
//   • the comma-separated *contents* of an array (with or without the brackets,
//     on one or several lines) — e.g. `"-y", "@scope/pkg"` — parse correctly by
//     wrapping in [] before reading as JSON;
//   • otherwise each line is one arg, with surrounding quotes, trailing commas,
//     and stray brackets stripped;
//   • blank lines are dropped.
export function parseArgsInput(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];

  // Read as JSON — either a real array, or array innards wrapped in []. This is
  // what fixes `"-y", "@scope/pkg"` being captured as a single escaped arg.
  const asArray = trimmed.startsWith("[") ? trimmed : `[${trimmed.replace(/,\s*$/, "")}]`;
  try {
    const arr = JSON.parse(asArray);
    if (Array.isArray(arr) && arr.every((a) => typeof a === "string")) return arr;
  } catch {
    // not JSON-ish — fall back to line parsing
  }

  return trimmed
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && l !== "[" && l !== "]")
    .map((l) => l.replace(/,\s*$/, "").trim())
    .map((l) => stripWrappingQuotes(l).trim())
    .filter((l) => l.length > 0);
}

// A single MCP server collected from the homepage "Add a server" form.
export type NewServerInput = {
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string | null>;
};

// Read the server names already present in a config text (lenient — used only
// for the "Add a server" duplicate check, so it never throws). Supports both
// the `mcpServers` map and the legacy `servers` array.
export function readServerNames(text: string): string[] {
  if (text.trim().length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const obj = parsed as { mcpServers?: unknown; servers?: unknown };
  if (obj.mcpServers && typeof obj.mcpServers === "object" && !Array.isArray(obj.mcpServers)) {
    return Object.keys(obj.mcpServers as Record<string, unknown>);
  }
  if (Array.isArray(obj.servers)) {
    return (obj.servers as Array<{ name?: unknown }>)
      .map((s) => (typeof s?.name === "string" ? s.name : ""))
      .filter((n): n is string => n.length > 0);
  }
  return [];
}

// Merge a new server into an existing config text and return pretty-printed
// JSON. The existing format is preserved (legacy `servers` array is appended
// to in place); everything else normalizes to the standard `mcpServers` map.
// Empty or unparseable text starts a fresh `mcpServers` config so the form
// always produces a valid result.
export function addServerToConfigText(text: string, server: NewServerInput): string {
  const entry: Record<string, unknown> = { command: server.command, args: server.args };
  if (server.env && Object.keys(server.env).length > 0) entry.env = server.env;

  let parsed: unknown = {};
  if (text.trim().length > 0) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = {};
    }
  }
  const obj =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};

  // Legacy array format: append { name, ...entry } and keep other keys.
  if (Array.isArray(obj.servers)) {
    const servers = [...(obj.servers as unknown[]), { name: server.name, ...entry }];
    return JSON.stringify({ ...obj, servers }, null, 2);
  }

  // Standard map format (default): merge under mcpServers, keeping it first.
  const existing =
    obj.mcpServers && typeof obj.mcpServers === "object" && !Array.isArray(obj.mcpServers)
      ? (obj.mcpServers as Record<string, unknown>)
      : {};
  const mcpServers = { ...existing, [server.name]: entry };
  const rest = { ...obj };
  delete rest.mcpServers;
  delete rest.servers;
  return JSON.stringify({ mcpServers, ...rest }, null, 2);
}

// Example config used by the homepage "Load example" button. Uses the standard
// `mcpServers` map (server name = key). It deliberately exercises every
// connection state in the mock: filesystem + everything connect, github is
// skipped (missing GITHUB_TOKEN), sqlite fails (docker not runnable).
export const EXAMPLE_CONFIG = `{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
    },
    "everything": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-everything"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_TOKEN": null }
    },
    "sqlite": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "mcp/sqlite"]
    }
  }
}`;
