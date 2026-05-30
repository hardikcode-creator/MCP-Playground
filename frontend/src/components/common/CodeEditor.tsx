import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ClipboardEvent, KeyboardEvent } from "react";
import type { TokenKind } from "../../lib/jsonTokens";
import {
  KIND_CLASS,
  computeBracketPairs,
  findBracketMatch,
  formatJson,
  tokenizeJson,
} from "../../lib/jsonTokens";

type Snapshot = { value: string; selStart: number; selEnd: number };

// Group keystrokes typed within this window into a single undo step.
const COALESCE_MS = 300;

const MATCH_CLASS =
  "rounded-[2px] bg-emerald-500/25 text-emerald-100 ring-1 ring-inset ring-emerald-400/60";

// A syntax-highlighted text editor: a transparent <textarea> layered over an
// aria-hidden <pre> that renders the colored tokens. The textarea owns input,
// selection, and the caret (emerald); the pre shows the colors. Both share the
// exact same font metrics, padding, and wrapping so they stay pixel-aligned,
// and the pre's scroll is synced to the textarea.
//
// On top of that it behaves like a small IDE editor:
//   • Cmd/Ctrl+Z undo, Cmd/Ctrl+Shift+Z (or Ctrl+Y) redo — a self-managed
//     history, because a controlled <textarea> loses the browser's native undo
//     stack whenever React re-sets `value` (e.g. Format, Params↔Raw sync).
//   • Shift+Alt+F formats the JSON in place.
//   • The bracket adjacent to the caret and its partner are highlighted.
//
// `historyKey` resets the undo history when the editor is reused for a
// different logical document (e.g. switching the inspected tool/node).
export function CodeEditor({
  value,
  onChange,
  onPaste,
  placeholder,
  minHeight = 160,
  autoFocus = false,
  ariaLabel,
  className,
  historyKey,
}: {
  value: string;
  onChange: (value: string) => void;
  onPaste?: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  minHeight?: number;
  autoFocus?: boolean;
  ariaLabel?: string;
  className?: string;
  historyKey?: string | number;
}) {
  const preRef = useRef<HTMLPreElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [caret, setCaret] = useState<number | null>(null);

  const historyRef = useRef<{ stack: Snapshot[]; index: number }>({
    stack: [{ value, selStart: value.length, selEnd: value.length }],
    index: 0,
  });
  const lastKeyRef = useRef(historyKey);
  const isUndoRedoRef = useRef(false);
  const breakCoalesceRef = useRef(false);
  const lastEditRef = useRef(0);
  const pendingSelRef = useRef<Snapshot | null>(null);

  // Record every value change (typed or programmatic) into the undo history,
  // and reset that history when the editor is pointed at a different document
  // (historyKey changes). Both live here so the ref writes happen in an
  // effect, never during render.
  useLayoutEffect(() => {
    const h = historyRef.current;
    if (lastKeyRef.current !== historyKey) {
      lastKeyRef.current = historyKey;
      historyRef.current = {
        stack: [{ value, selStart: value.length, selEnd: value.length }],
        index: 0,
      };
      isUndoRedoRef.current = false;
      pendingSelRef.current = null;
      lastEditRef.current = 0;
      return;
    }
    if (isUndoRedoRef.current) {
      isUndoRedoRef.current = false;
      return;
    }
    const cur = h.stack[h.index];
    if (cur && cur.value === value) return;

    const el = textareaRef.current;
    const snap: Snapshot = {
      value,
      selStart: el?.selectionStart ?? value.length,
      selEnd: el?.selectionEnd ?? value.length,
    };
    const now = Date.now();
    const coalesce =
      !breakCoalesceRef.current &&
      h.index > 0 &&
      h.index === h.stack.length - 1 &&
      now - lastEditRef.current < COALESCE_MS;
    if (coalesce) {
      h.stack[h.index] = snap;
    } else {
      h.stack = h.stack.slice(0, h.index + 1);
      h.stack.push(snap);
      h.index = h.stack.length - 1;
    }
    breakCoalesceRef.current = false;
    lastEditRef.current = now;
  }, [value, historyKey]);

  // After undo/redo/format re-render, restore the intended caret/selection.
  useLayoutEffect(() => {
    const sel = pendingSelRef.current;
    if (!sel || sel.value !== value) return;
    pendingSelRef.current = null;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(sel.selStart, sel.selEnd);
    setCaret(sel.selStart === sel.selEnd ? sel.selStart : null);
  }, [value]);

  const restore = (snap: Snapshot) => {
    isUndoRedoRef.current = true;
    pendingSelRef.current = snap;
    onChange(snap.value);
  };
  const undo = () => {
    const h = historyRef.current!;
    if (h.index <= 0) return;
    h.index -= 1;
    restore(h.stack[h.index]);
  };
  const redo = () => {
    const h = historyRef.current!;
    if (h.index >= h.stack.length - 1) return;
    h.index += 1;
    restore(h.stack[h.index]);
  };
  const doFormat = () => {
    const formatted = formatJson(value);
    if (formatted === null || formatted === value) return;
    breakCoalesceRef.current = true;
    pendingSelRef.current = {
      value: formatted,
      selStart: formatted.length,
      selEnd: formatted.length,
    };
    onChange(formatted);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.altKey && e.code === "KeyZ") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && !e.altKey && e.code === "KeyY") {
      e.preventDefault();
      redo();
      return;
    }
    // Shift+Alt+F — format (e.code is layout-independent; Alt+F is a dead key
    // that mangles e.key on macOS).
    if (e.altKey && e.shiftKey && e.code === "KeyF") {
      e.preventDefault();
      doFormat();
    }
  };

  const syncCaret = (el: HTMLTextAreaElement) => {
    setCaret(el.selectionStart === el.selectionEnd ? el.selectionStart : null);
  };

  // Tokens carry their absolute start offset so the overlay can highlight an
  // exact bracket character. Built with reduce (no reassigned accumulator) to
  // satisfy the render-phase immutability lint.
  const tokens = useMemo(() => {
    const out: Array<{ value: string; kind: TokenKind; start: number }> = [];
    tokenizeJson(value).reduce((pos, t) => {
      out.push({ value: t.value, kind: t.kind, start: pos });
      return pos + t.value.length;
    }, 0);
    return out;
  }, [value]);
  const pairs = useMemo(() => computeBracketPairs(value), [value]);
  const match = useMemo(
    () => (caret === null ? null : findBracketMatch(value, caret, pairs)),
    [value, caret, pairs],
  );

  const shared = "m-0 whitespace-pre-wrap break-words p-2.5 font-mono text-xs leading-5";

  return (
    <div
      className={`relative rounded-md border border-zinc-700 bg-zinc-950 transition-colors focus-within:border-emerald-500 ${className ?? ""}`}
    >
      <pre
        ref={preRef}
        aria-hidden="true"
        className={`${shared} pointer-events-none absolute inset-0 overflow-hidden text-zinc-300`}
      >
        {tokens.map((t, i) => {
          const matched =
            match !== null && t.value.length === 1 && (t.start === match[0] || t.start === match[1]);
          return (
            <span key={i} className={matched ? MATCH_CLASS : KIND_CLASS[t.kind]}>
              {t.value}
            </span>
          );
        })}
        {"\n"}
      </pre>
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          syncCaret(e.currentTarget);
        }}
        onPaste={onPaste}
        onKeyDown={onKeyDown}
        onKeyUp={(e) => syncCaret(e.currentTarget)}
        onClick={(e) => syncCaret(e.currentTarget)}
        onSelect={(e) => syncCaret(e.currentTarget)}
        onBlur={() => setCaret(null)}
        onScroll={(e) => {
          const el = preRef.current;
          if (!el) return;
          el.scrollTop = e.currentTarget.scrollTop;
          el.scrollLeft = e.currentTarget.scrollLeft;
        }}
        spellCheck={false}
        autoFocus={autoFocus}
        placeholder={placeholder}
        aria-label={ariaLabel}
        style={{ minHeight }}
        className={`${shared} relative block w-full resize-y overflow-auto bg-transparent text-transparent caret-emerald-400 outline-none placeholder:text-zinc-600 selection:bg-emerald-500/30`}
      />
    </div>
  );
}
