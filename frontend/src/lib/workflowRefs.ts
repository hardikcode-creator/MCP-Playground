import type { ValueRef } from "../types";
import { jsonPath, RefResolutionError as JsonPathError } from "./workflow/refs";

const REF_SHAPE_ERROR = "Invalid $ref shape: expected {$ref:{nodeId:string,path:string}}";
const REF_SOURCE_MISSING_ERROR = "$ref source node not found in workflow:";
const REF_OUTPUT_UNAVAILABLE_ERROR = "$ref source output not available yet:";
const REF_PATH_MISSING_ERROR = "$ref path not found:";

function asRef(input: unknown): ValueRef["$ref"] | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const maybeRef = input as Record<string, unknown>;
  if (!("$ref" in maybeRef) || !maybeRef.$ref || typeof maybeRef.$ref !== "object" || Array.isArray(maybeRef.$ref)) {
    return null;
  }
  return maybeRef.$ref as ValueRef["$ref"];
}

export function collectValueRefNodeIds(value: unknown): string[] {
  const ids = new Set<string>();
  const walk = (input: unknown): void => {
    if (Array.isArray(input)) {
      for (const item of input) walk(item);
      return;
    }
    if (!input || typeof input !== "object") return;
    const ref = asRef(input);
    if (ref) {
      if (typeof ref.nodeId === "string") ids.add(ref.nodeId);
      return;
    }
    for (const v of Object.values(input as Record<string, unknown>)) walk(v);
  };
  walk(value);
  return [...ids];
}

export type RefResolutionErrorCode =
  | "invalid_shape"
  | "source_missing"
  | "output_unavailable"
  | "path_missing";

export type RefResolutionError = {
  code: RefResolutionErrorCode;
  message: string;
  nodeId?: string;
  path?: string;
};

export function resolveValueRefsDetailed(
  value: unknown,
  getOutput: (nodeId: string) => unknown,
  hasNode?: (nodeId: string) => boolean,
): { value: unknown; errors: RefResolutionError[] } {
  const errors: RefResolutionError[] = [];
  const walk = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(walk);
    if (!input || typeof input !== "object") return input;
    const ref = asRef(input);
    if (ref) {
      if (typeof ref.nodeId !== "string" || typeof ref.path !== "string") {
        errors.push({ code: "invalid_shape", message: REF_SHAPE_ERROR });
        return null;
      }
      const source = getOutput(ref.nodeId);
      if (source === undefined) {
        if (hasNode && hasNode(ref.nodeId)) {
          errors.push({
            code: "output_unavailable",
            nodeId: ref.nodeId,
            path: ref.path,
            message: `${REF_OUTPUT_UNAVAILABLE_ERROR} ${ref.nodeId}`,
          });
        } else {
          errors.push({
            code: "source_missing",
            nodeId: ref.nodeId,
            path: ref.path,
            message: `${REF_SOURCE_MISSING_ERROR} ${ref.nodeId}`,
          });
        }
        return null;
      }
      // Resolve via the SAME JSONPath subset the backend uses, against the
      // RAW tool result (so $.content[0].text behaves identically).
      let resolved: unknown;
      try {
        resolved = jsonPath(source, ref.path || "$");
      } catch (e) {
        errors.push({
          code: "path_missing",
          nodeId: ref.nodeId,
          path: ref.path,
          message: e instanceof JsonPathError ? e.message : `${REF_PATH_MISSING_ERROR} ${ref.nodeId}.${ref.path}`,
        });
        return null;
      }
      if (resolved === undefined) {
        errors.push({
          code: "path_missing",
          nodeId: ref.nodeId,
          path: ref.path,
          message: `${REF_PATH_MISSING_ERROR} ${ref.nodeId}.${ref.path}`,
        });
        return null;
      }
      return resolved;
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) out[k] = walk(v);
    return out;
  };
  return { value: walk(value), errors };
}

export function resolveValueRefs(
  value: unknown,
  getOutput: (nodeId: string) => unknown,
): { value: unknown; errors: string[] } {
  const result = resolveValueRefsDetailed(value, getOutput);
  return { value: result.value, errors: result.errors.map((e) => e.message) };
}
