import { useRef } from "react";
import type { ClipboardEvent } from "react";
import { KIND_CLASS, tokenizeJson } from "../../lib/jsonTokens";

// A syntax-highlighted text editor: a transparent <textarea> layered over an
// aria-hidden <pre> that renders the colored tokens. The textarea owns input,
// selection, and the caret (emerald); the pre shows the colors. Both share the
// exact same font metrics, padding, and wrapping so they stay pixel-aligned,
// and the pre's scroll is synced to the textarea.
export function CodeEditor({
  value,
  onChange,
  onPaste,
  placeholder,
  minHeight = 160,
  autoFocus = false,
  ariaLabel,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  onPaste?: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  minHeight?: number;
  autoFocus?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  const preRef = useRef<HTMLPreElement>(null);

  const shared = "m-0 whitespace-pre-wrap break-words p-2.5 font-mono text-xs leading-5";

  return (
    <div
      className={`relative rounded-md border border-zinc-700 bg-zinc-950 transition-colors focus-within:border-emerald-500 ${className ?? ""}`}
    >
      <pre ref={preRef} aria-hidden="true" className={`${shared} pointer-events-none absolute inset-0 overflow-hidden text-zinc-300`}>
        {tokenizeJson(value).map((t, i) => (
          <span key={i} className={KIND_CLASS[t.kind]}>
            {t.value}
          </span>
        ))}
        {"\n"}
      </pre>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onPaste={onPaste}
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
