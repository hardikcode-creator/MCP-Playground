// Dependency-free JSON tokenizer shared by every JSON surface (the read-only
// response viewer and the editable code boxes). It always covers the input
// character-for-character — unmatched gaps become "plain" tokens — so an
// overlay <pre> rendered from these tokens lines up exactly with a <textarea>
// holding the same text.

export type TokenKind = "key" | "string" | "number" | "keyword" | "punct" | "plain";

export type JsonToken = { value: string; kind: TokenKind };

// Tailwind text-color classes per token kind (tuned for the zinc-950 surfaces).
export const KIND_CLASS: Record<TokenKind, string> = {
  key: "text-emerald-300",
  string: "text-amber-300",
  number: "text-cyan-300",
  keyword: "text-violet-300",
  punct: "text-zinc-500",
  plain: "text-zinc-300",
};

// Strings (terminated), numbers, the three literals, and structural punctuation.
// Whitespace and anything else falls into the gaps and is emitted as "plain".
const TOKEN_RE =
  /"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\b(?:true|false|null)\b|[{}[\]:,]/g;

export function tokenizeJson(text: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  let last = 0;

  const push = (value: string, kind: TokenKind) => {
    if (value.length > 0) tokens.push({ value, kind });
  };

  for (const m of text.matchAll(TOKEN_RE)) {
    const start = m.index ?? 0;
    if (start > last) push(text.slice(last, start), "plain");

    const raw = m[0];
    let kind: TokenKind;
    if (raw[0] === '"') {
      // A string immediately followed by ':' is an object key.
      kind = /^\s*:/.test(text.slice(start + raw.length)) ? "key" : "string";
    } else if (raw === "true" || raw === "false" || raw === "null") {
      kind = "keyword";
    } else if (/^-?\d/.test(raw)) {
      kind = "number";
    } else {
      kind = "punct";
    }
    push(raw, kind);
    last = start + raw.length;
  }

  if (last < text.length) push(text.slice(last), "plain");
  return tokens;
}

// Pretty-print `text` with 2-space indentation if it parses as JSON; otherwise
// return null so callers can leave the input untouched. Centralized so every
// JSON surface (homepage paste, args dialog, raw args editor) formats the same.
export function formatJson(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return null;
  }
}

// Find the first balanced JSON object/array span in `text`, respecting string
// literals (so brackets inside "…" don't throw off the depth count). Returns the
// [start, end] indices (inclusive) of the span, or null if there isn't one.
// Only the outer bracket type is tracked, which is enough to locate the span.
function firstJsonSpan(text: string): [number, number] | null {
  const open = text.search(/[[{]/);
  if (open < 0) return null;
  const openCh = text[open];
  const closeCh = openCh === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === openCh) depth++;
    else if (ch === closeCh) {
      depth--;
      if (depth === 0) return [open, i];
    }
  }
  return null;
}

// Recursively replace JSON-encoded strings (objects/arrays serialized as text —
// e.g. an MCP result's `content[].text`, which is how Airbnb/Zomato return their
// payloads) with their parsed form, so a response can be displayed fully
// expanded. Two forms are recognized:
//   1. The whole string is JSON ("{…}" / "[…]") — the common success case.
//   2. A "label: {json}" string — how tool errors are stored
//      (e.g. `Tool "x" reported error: {…}`); the trailing JSON body is parsed
//      and wrapped as { message, data } so error responses get the same Parsed
//      view as successful ones. The label guard ('…:' / '…=') keeps us from
//      mangling ordinary prose that merely contains braces mid-sentence.
// Primitive-looking strings ("40", "true", a plain sentence) are left untouched.
// Bounded depth guards against pathological nesting.
export function expandEmbeddedJson(value: unknown, depth = 0): unknown {
  if (depth > 12) return value;
  if (typeof value === "string") {
    const t = value.trim();
    if (t.length >= 2 && (t[0] === "{" || t[0] === "[")) {
      try {
        const parsed = JSON.parse(t);
        if (parsed && typeof parsed === "object") return expandEmbeddedJson(parsed, depth + 1);
      } catch {
        // Not actually JSON — keep the original string.
      }
    }
    // "label: {json}" — a JSON body that follows a short label (errors).
    const span = firstJsonSpan(t);
    if (span && span[0] > 0) {
      const prefix = t.slice(0, span[0]).replace(/\s+$/, "");
      if (/[:=]$/.test(prefix)) {
        try {
          const parsed = JSON.parse(t.slice(span[0], span[1] + 1));
          if (parsed && typeof parsed === "object") {
            return { message: prefix.replace(/[:=]$/, "").trim(), data: expandEmbeddedJson(parsed, depth + 1) };
          }
        } catch {
          // The trailing text wasn't valid JSON — keep the original string.
        }
      }
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((v) => expandEmbeddedJson(v, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = expandEmbeddedJson(v, depth + 1);
    }
    return out;
  }
  return value;
}

// ── Bracket matching (IDE-style) ─────────────────────────────────────────────
// Only JSON's structural brackets; these line up 1:1 with single-char "punct"
// tokens above, so the editor overlay can highlight an exact character.
const BRACKET_PAIR: Record<string, string> = { "{": "}", "[": "]" };
const OPENERS = "{[";
const CLOSERS = "}]";

// Map every matched bracket index to its partner's index (both directions),
// skipping brackets that live inside JSON strings. Unbalanced brackets are
// simply left out of the map.
export function computeBracketPairs(text: string): Map<number, number> {
  const pairs = new Map<number, number>();
  const stack: Array<{ ch: string; idx: number }> = [];
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (OPENERS.includes(ch)) {
      stack.push({ ch, idx: i });
    } else if (CLOSERS.includes(ch)) {
      const top = stack[stack.length - 1];
      if (top && BRACKET_PAIR[top.ch] === ch) {
        stack.pop();
        pairs.set(top.idx, i);
        pairs.set(i, top.idx);
      }
    }
  }
  return pairs;
}

// Given a collapsed caret position, return the [open, close] indices of the
// bracket pair to highlight, or null. Prefers the bracket immediately to the
// LEFT of the caret (the one you just typed/passed), then the one at the caret.
export function findBracketMatch(
  text: string,
  caret: number,
  pairs: Map<number, number>,
): [number, number] | null {
  for (const idx of [caret - 1, caret]) {
    if (idx < 0 || idx >= text.length) continue;
    const ch = text[idx];
    if (!OPENERS.includes(ch) && !CLOSERS.includes(ch)) continue;
    const match = pairs.get(idx);
    if (match !== undefined) return idx < match ? [idx, match] : [match, idx];
  }
  return null;
}
