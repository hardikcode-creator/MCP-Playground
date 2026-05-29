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
