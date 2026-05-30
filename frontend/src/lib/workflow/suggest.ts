// Derive a clickable list of JSONPaths from a sample value (a node's raw tool
// result), so the user can pick a $ref path instead of typing it. Uses the same
// path grammar as the ported jsonPath resolver:
//   $  $.foo  $.foo[0]  $["weird.key"]
//
// Recurses deeply through nested objects (and a few elements of each array) so
// values buried inside structuredContent/results[i].items[j]... are all
// offered, and tags each path with the runtime type of its value so callers can
// filter to the type a given arg expects.

export type ValueType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "object"
  | "array"
  | "null";

export type PathSuggestion = { path: string; type: ValueType };

function keyToken(parent: string, key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}

export function valueType(v: unknown): ValueType {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  if (typeof v === "boolean") return "boolean";
  if (typeof v === "object") return "object";
  return "string";
}

// Does a value of runtime type `actual` satisfy a field whose schema type is
// `expected`? Integers count as numbers; unknown/"any" matches everything.
export function typeMatches(expected: string | undefined, actual: ValueType): boolean {
  if (!expected || expected === "any") return true;
  if (expected === "number") return actual === "number" || actual === "integer";
  return expected === actual;
}

export function suggestJsonPaths(
  value: unknown,
  opts: { maxPaths?: number; maxDepth?: number; arraySample?: number } = {},
): PathSuggestion[] {
  const maxPaths = opts.maxPaths ?? 400;
  const maxDepth = opts.maxDepth ?? 12;
  const arraySample = opts.arraySample ?? 5;

  const out: PathSuggestion[] = [];
  const seen = new Set<string>();
  const push = (p: string, v: unknown) => {
    if (seen.has(p)) return;
    seen.add(p);
    out.push({ path: p, type: valueType(v) });
  };

  push("$", value);

  const walk = (v: unknown, path: string, depth: number): void => {
    if (out.length >= maxPaths || depth >= maxDepth) return;
    if (Array.isArray(v)) {
      const limit = Math.min(v.length, arraySample);
      for (let i = 0; i < limit; i++) {
        const p = `${path}[${i}]`;
        push(p, v[i]);
        walk(v[i], p, depth + 1);
        if (out.length >= maxPaths) return;
      }
      return;
    }
    if (v && typeof v === "object") {
      for (const key of Object.keys(v as Record<string, unknown>)) {
        const child = (v as Record<string, unknown>)[key];
        const p = keyToken(path, key);
        push(p, child);
        walk(child, p, depth + 1);
        if (out.length >= maxPaths) return;
      }
    }
  };

  walk(value, "$", 0);
  return out.slice(0, maxPaths);
}
