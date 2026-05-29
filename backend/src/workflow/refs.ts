import type { ValueRef } from '../types/workflow.js';

export function isValueRef(value: unknown): value is ValueRef {
  if (typeof value !== 'object' || value === null) return false;
  if (!('$ref' in value)) return false;
  const ref = (value as { $ref: unknown }).$ref;
  if (typeof ref !== 'object' || ref === null) return false;
  const nodeId = (ref as { nodeId?: unknown }).nodeId;
  return typeof nodeId === 'string' && nodeId.length > 0;
}

export function walkRefs(
  value: unknown,
  visitor: (ref: ValueRef) => void,
): void {
  if (value === null || value === undefined) return;
  if (isValueRef(value)) {
    visitor(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walkRefs(item, visitor);
    return;
  }
  if (typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) {
      walkRefs(v, visitor);
    }
  }
}

export function resolveArgs(
  args: unknown,
  done: Map<string, unknown>,
): unknown {
  if (args === null || args === undefined) return args;

  if (isValueRef(args)) {
    const { nodeId } = args.$ref;
    const path = args.$ref.path ?? '$';
    if (!done.has(nodeId)) {
      throw new RefResolutionError(
        `Cannot resolve $ref: node "${nodeId}" has not produced a result yet`,
      );
    }
    const source = done.get(nodeId);
    return jsonPath(source, path);
  }

  if (Array.isArray(args)) {
    return args.map((a) => resolveArgs(a, done));
  }

  if (typeof args === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
      out[k] = resolveArgs(v, done);
    }
    return out;
  }

  return args;
}

export class RefResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RefResolutionError';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Minimal JSONPath subset.
//
// Supported syntax:
//   $                    the whole value
//   $.foo                property access
//   $.foo.bar            nested properties
//   $.foo[0]             array index
//   $["foo.bar"]         quoted property (for keys containing . or [)
//   $.foo[0].bar         arbitrary mixing
//
// Deliberately NOT supported in v1:
//   $[*]                 wildcards
//   $..foo               recursive descent
//   $[?(...)]            filter expressions
//
// If these are ever needed, swap this for the `jsonpath-plus` npm package.
// The single entry point is `jsonPath(root, path)`; callers don't care how
// it's implemented.
// ─────────────────────────────────────────────────────────────────────────────

type Token = { kind: 'prop'; value: string } | { kind: 'index'; value: number };

export function jsonPath(root: unknown, path: string): unknown {
  if (path === '' || path === '$') return root;
  const tokens = tokenizePath(path);
  let cur: unknown = root;
  for (const tok of tokens) {
    if (cur === null || cur === undefined) {
      throw new RefResolutionError(
        `Path "${path}" hit ${cur === null ? 'null' : 'undefined'} before token "${tokenLabel(tok)}"`,
      );
    }
    if (tok.kind === 'index') {
      if (!Array.isArray(cur)) {
        throw new RefResolutionError(
          `Path "${path}" expected array at "[${tok.value}]" but found ${describeType(cur)}`,
        );
      }
      cur = cur[tok.value];
    } else {
      if (typeof cur !== 'object' || Array.isArray(cur)) {
        throw new RefResolutionError(
          `Path "${path}" expected object at ".${tok.value}" but found ${describeType(cur)}`,
        );
      }
      cur = (cur as Record<string, unknown>)[tok.value];
    }
  }
  return cur;
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
        throw new RefResolutionError(`Empty property name in path "${path}"`);
      }
      tokens.push({ kind: 'prop', value: path.slice(start, i) });
    } else if (c === '[') {
      i++;
      if (i >= len) {
        throw new RefResolutionError(`Unterminated '[' in path "${path}"`);
      }
      const first = path[i]!;
      if (first === '"' || first === "'") {
        const quote = first;
        i++;
        const start = i;
        while (i < len && path[i] !== quote) i++;
        if (i >= len) {
          throw new RefResolutionError(`Unterminated quoted key in path "${path}"`);
        }
        const key = path.slice(start, i);
        i++; // consume closing quote
        if (i >= len || path[i] !== ']') {
          throw new RefResolutionError(
            `Expected ']' after quoted key in path "${path}"`,
          );
        }
        i++; // consume ']'
        tokens.push({ kind: 'prop', value: key });
      } else {
        const start = i;
        while (i < len && path[i] !== ']') i++;
        if (i >= len) {
          throw new RefResolutionError(`Unterminated '[' in path "${path}"`);
        }
        const inner = path.slice(start, i).trim();
        const n = Number(inner);
        if (!Number.isInteger(n) || inner === '') {
          throw new RefResolutionError(
            `Bracket index must be an integer in path "${path}" (got "${inner}")`,
          );
        }
        i++; // consume ']'
        tokens.push({ kind: 'index', value: n });
      }
    } else {
      throw new RefResolutionError(
        `Unexpected character '${c}' at position ${i} in path "${path}" (expected '.' or '[')`,
      );
    }
  }
  return tokens;
}

function tokenLabel(t: Token): string {
  return t.kind === 'index' ? `[${t.value}]` : `.${t.value}`;
}

function describeType(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}
