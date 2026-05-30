import type { ValueRef } from "../types";

const REF_SHAPE_ERROR = "Invalid $ref shape: expected {$ref:{nodeId:string,path:string}}";

function parsePath(path: string): string[] {
  return path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);
}

export function getByPath(value: unknown, path: string): unknown {
  if (!path) return value;
  const parts = parsePath(path);
  let current: unknown = value;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const idx = Number(part);
      if (!Number.isInteger(idx)) return undefined;
      current = current[idx];
      continue;
    }
    if (typeof current === "object") {
      current = (current as Record<string, unknown>)[part];
      continue;
    }
    return undefined;
  }
  return current;
}

export function resolveValueRefs(
  value: unknown,
  getOutput: (nodeId: string) => unknown,
): { value: unknown; errors: string[] } {
  const errors: string[] = [];
  const walk = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(walk);
    if (!input || typeof input !== "object") return input;
    const maybeRef = input as Record<string, unknown>;
    if ("$ref" in maybeRef && maybeRef.$ref && typeof maybeRef.$ref === "object" && !Array.isArray(maybeRef.$ref)) {
      const ref = maybeRef.$ref as ValueRef["$ref"];
      if (typeof ref.nodeId !== "string" || typeof ref.path !== "string") {
        errors.push(REF_SHAPE_ERROR);
        return null;
      }
      const source = getOutput(ref.nodeId);
      if (source === undefined) {
        errors.push(`$ref source node not found in outputs: ${ref.nodeId}`);
        return null;
      }
      const resolved = getByPath(source, ref.path);
      if (resolved === undefined) {
        errors.push(`$ref path not found: ${ref.nodeId}.${ref.path}`);
        return null;
      }
      return resolved;
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(maybeRef)) out[k] = walk(v);
    return out;
  };
  return { value: walk(value), errors };
}
