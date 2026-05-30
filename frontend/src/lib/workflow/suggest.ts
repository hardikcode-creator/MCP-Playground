// Derive a short, clickable list of JSONPaths from a sample value (a node's
// raw tool result), so the user can pick a $ref path instead of typing it.
// Uses the same path grammar as the ported jsonPath resolver:
//   $  $.foo  $.foo[0]  $["weird.key"]

function keyToken(parent: string, key: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}

export function suggestJsonPaths(value: unknown, maxPaths = 48, maxDepth = 4): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (p: string) => {
    if (seen.has(p)) return;
    seen.add(p);
    out.push(p);
  };

  push("$");

  const walk = (v: unknown, path: string, depth: number): void => {
    if (out.length >= maxPaths || depth >= maxDepth) return;
    if (Array.isArray(v)) {
      const limit = Math.min(v.length, 3);
      for (let i = 0; i < limit; i++) {
        const p = `${path}[${i}]`;
        push(p);
        walk(v[i], p, depth + 1);
        if (out.length >= maxPaths) return;
      }
      return;
    }
    if (v && typeof v === "object") {
      for (const key of Object.keys(v as Record<string, unknown>)) {
        const p = keyToken(path, key);
        push(p);
        walk((v as Record<string, unknown>)[key], p, depth + 1);
        if (out.length >= maxPaths) return;
      }
    }
  };

  walk(value, "$", 0);
  return out.slice(0, maxPaths);
}
