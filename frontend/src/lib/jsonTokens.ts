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
