/**
 * A faithful subset of the JSONPath grammar used by the backend
 * (backend/src/workflow/refs.ts) so that any path this service emits resolves
 * identically inside the workflow engine.
 *
 * Supported: $  $.foo  $.foo.bar  $.foo[0]  $["weird.key"]  $.foo[0].bar
 * Not supported: wildcards, recursive descent, filter expressions.
 *
 * Two jobs here:
 *   1. enumeratePaths()  — build the candidate path list we feed the LLM, so
 *      it picks from real paths instead of inventing them.
 *   2. getAtPath()       — resolve a path so we can verify the LLM's choice
 *      actually exists in the response (and mark `pathResolves`).
 */

type Token = { kind: 'prop'; value: string } | { kind: 'index'; value: number };

const SAFE_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

function keyToken(parent: string, key: string): string {
  return SAFE_KEY.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}

export type PathCandidate = {
  /** A concrete JSONPath, e.g. "$.content[0].text". */
  path: string;
  /** "string" | "number" | "boolean" | "null" | "array" | "object". */
  type: string;
  /** Truncated preview of the value at this path, for LLM context. */
  preview: string;
};

function describeType(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function preview(v: unknown, max = 80): string {
  let s: string;
  if (typeof v === 'string') s = JSON.stringify(v);
  else if (Array.isArray(v)) s = `array(${v.length})`;
  else if (v && typeof v === 'object') s = `object{${Object.keys(v as object).join(', ')}}`;
  else s = String(v);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/**
 * Walk a value and produce a flat, de-duplicated list of addressable paths
 * (leaves and the containers along the way). Bounded by `maxPaths`/`maxDepth`
 * so a huge response doesn't blow up the prompt.
 */
export function enumeratePaths(
  value: unknown,
  maxPaths = 60,
  maxDepth = 5,
): PathCandidate[] {
  const out: PathCandidate[] = [];
  const seen = new Set<string>();

  const push = (path: string, v: unknown) => {
    if (seen.has(path)) return;
    seen.add(path);
    out.push({ path, type: describeType(v), preview: preview(v) });
  };

  push('$', value);

  const walk = (v: unknown, path: string, depth: number): void => {
    if (out.length >= maxPaths || depth >= maxDepth) return;
    if (Array.isArray(v)) {
      const limit = Math.min(v.length, 3);
      for (let i = 0; i < limit; i++) {
        const p = `${path}[${i}]`;
        push(p, v[i]);
        walk(v[i], p, depth + 1);
        if (out.length >= maxPaths) return;
      }
      return;
    }
    if (v && typeof v === 'object') {
      for (const key of Object.keys(v as Record<string, unknown>)) {
        const p = keyToken(path, key);
        const child = (v as Record<string, unknown>)[key];
        push(p, child);
        walk(child, p, depth + 1);
        if (out.length >= maxPaths) return;
      }
    }
  };

  walk(value, '$', 0);
  return out.slice(0, maxPaths);
}

export class PathResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathResolutionError';
  }
}

/** Resolve a JSONPath against a root value. Throws if the path is invalid. */
export function getAtPath(root: unknown, path: string): unknown {
  if (path === '' || path === '$') return root;
  const tokens = tokenizePath(path);
  let cur: unknown = root;
  for (const tok of tokens) {
    if (cur === null || cur === undefined) {
      throw new PathResolutionError(
        `Path "${path}" hit ${cur === null ? 'null' : 'undefined'}`,
      );
    }
    if (tok.kind === 'index') {
      if (!Array.isArray(cur)) {
        throw new PathResolutionError(
          `Path "${path}" expected array at "[${tok.value}]"`,
        );
      }
      cur = cur[tok.value];
    } else {
      if (typeof cur !== 'object' || Array.isArray(cur)) {
        throw new PathResolutionError(
          `Path "${path}" expected object at ".${tok.value}"`,
        );
      }
      cur = (cur as Record<string, unknown>)[tok.value];
    }
  }
  return cur;
}

/** Convenience boolean wrapper: does `path` resolve to a defined value? */
export function pathResolves(root: unknown, path: string): boolean {
  try {
    return getAtPath(root, path) !== undefined;
  } catch {
    return false;
  }
}

function tokenizePath(path: string): Token[] {
  const tokens: Token[] = [];
  const len = path.length;
  let i = 0;
  if (i < len && path[i] === '$') i++;

  while (i < len) {
    const c = path[i]!;
    if (c === '.') {
      i++;
      const start = i;
      while (i < len) {
        const ch = path[i]!;
        if (ch === '.' || ch === '[') break;
        i++;
      }
      if (i === start) {
        throw new PathResolutionError(`Empty property name in path "${path}"`);
      }
      tokens.push({ kind: 'prop', value: path.slice(start, i) });
    } else if (c === '[') {
      i++;
      if (i >= len) {
        throw new PathResolutionError(`Unterminated '[' in path "${path}"`);
      }
      const first = path[i]!;
      if (first === '"' || first === "'") {
        const quote = first;
        i++;
        const start = i;
        while (i < len && path[i] !== quote) i++;
        if (i >= len) {
          throw new PathResolutionError(`Unterminated quoted key in path "${path}"`);
        }
        const key = path.slice(start, i);
        i++; // consume closing quote
        if (i >= len || path[i] !== ']') {
          throw new PathResolutionError(`Expected ']' after quoted key in path "${path}"`);
        }
        i++; // consume ']'
        tokens.push({ kind: 'prop', value: key });
      } else {
        const start = i;
        while (i < len && path[i] !== ']') i++;
        if (i >= len) {
          throw new PathResolutionError(`Unterminated '[' in path "${path}"`);
        }
        const inner = path.slice(start, i).trim();
        const n = Number(inner);
        if (!Number.isInteger(n) || inner === '') {
          throw new PathResolutionError(
            `Bracket index must be an integer in path "${path}" (got "${inner}")`,
          );
        }
        i++; // consume ']'
        tokens.push({ kind: 'index', value: n });
      }
    } else {
      throw new PathResolutionError(
        `Unexpected character '${c}' at position ${i} in path "${path}"`,
      );
    }
  }
  return tokens;
}
