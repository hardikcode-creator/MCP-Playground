// Pure helpers for turning a tool's JSON Schema into UI rows + seed args.
// These carry over unchanged when the real backend is wired in.

import type { JsonSchema } from "../types";

export type ParamRow = {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  enum?: string[];
};

export function toParamRows(schema: JsonSchema): ParamRow[] {
  const props = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  return Object.entries(props)
    .map(([name, def]) => ({
      name,
      type: def.type ?? "any",
      required: required.has(name),
      description: def.description,
      enum: Array.isArray(def.enum) ? def.enum : undefined,
    }))
    .sort((a, b) => Number(b.required) - Number(a.required));
}

// Build a starter args object (as pretty JSON) from a schema's properties.
export function seedArgs(schema: JsonSchema): string {
  const props = schema.properties ?? {};
  if (Object.keys(props).length === 0) return "{}";
  const obj: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(props)) {
    obj[key] =
      def.type === "number" || def.type === "integer"
        ? 0
        : def.type === "boolean"
          ? false
          : def.type === "array"
            ? []
              : def.type === "object"
                ? {}
                : "";
  }
  return JSON.stringify(obj, null, 2);
}

// Merge a single param value into the args object WITHOUT dropping keys, and
// re-serialize in schema (row) order. This keeps required fields present and
// stably ordered even when a field is cleared, and preserves any extra
// raw-only keys the user typed. (Fixes Params/Raw losing/reordering args.)
export function applyParamValue(
  current: Record<string, unknown>,
  rows: ParamRow[],
  name: string,
  next: unknown,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...current, [name]: next };
  const ordered: Record<string, unknown> = {};
  for (const r of rows) if (r.name in merged) ordered[r.name] = merged[r.name];
  for (const k of Object.keys(merged)) if (!(k in ordered)) ordered[k] = merged[k];
  return ordered;
}

// Names of required fields whose value is absent or blank (undefined/null/"").
// Booleans (false), numbers (0), and empty arrays/objects count as provided.
export function findMissingRequired(schema: JsonSchema, args: Record<string, unknown>): string[] {
  return (schema.required ?? []).filter((name) => {
    const v = args[name];
    return v === undefined || v === null || v === "";
  });
}

// --- Args validation against a tool's inputSchema -------------------------

export type ArgIssue = { path: string; message: string };
export type ArgsValidation =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; errors: ArgIssue[] };

// A `{ "$ref": { nodeId, path } }` value is a workflow wire-up, not a literal.
// It resolves to the referenced node's output at run time, so we can't (and
// shouldn't) type-check it against the field's declared schema type here.
export function isValueRef(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return "$ref" in (value as Record<string, unknown>);
}

function matchesType(value: unknown, type: string): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    default:
      return true; // unknown / "any" — accept anything
  }
}

export function validateArgs(schema: JsonSchema, text: string): ArgsValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim() || "{}");
  } catch (e) {
    return { ok: false, errors: [{ path: "(root)", message: `Invalid JSON: ${(e as Error).message}` }] };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, errors: [{ path: "(root)", message: "Arguments must be a JSON object." }] };
  }

  const obj = parsed as Record<string, unknown>;
  const props = schema.properties ?? {};
  const errors: ArgIssue[] = [];

  for (const name of schema.required ?? []) {
    const v = obj[name];
    if (v === undefined || v === null || v === "") errors.push({ path: name, message: "is required" });
  }

  for (const [name, def] of Object.entries(props)) {
    const v = obj[name];
    if (!(name in obj) || v === undefined || v === null || v === "") continue;
    if (isValueRef(v)) continue; // resolved at run time; skip schema-type checks
    if (def.type && !matchesType(v, def.type)) {
      errors.push({ path: name, message: `must be of type ${def.type}` });
    }
    if (Array.isArray(def.enum) && def.enum.length > 0 && !def.enum.includes(v as string)) {
      errors.push({ path: name, message: `must be one of: ${def.enum.join(", ")}` });
    }
  }

  return errors.length ? { ok: false, errors } : { ok: true, value: obj };
}
