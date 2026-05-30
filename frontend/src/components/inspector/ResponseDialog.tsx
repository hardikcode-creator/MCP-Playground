import { useEffect, useMemo, useState } from "react";
import type { ToolResult } from "../../types";
import { KIND_CLASS, expandEmbeddedJson, tokenizeJson } from "../../lib/jsonTokens";

type Mode = "raw" | "parsed";

// Full-screen view of a tool response. "Parsed" expands JSON that servers
// embed as a string inside content[].text (Airbnb/Zomato) into a real, readable
// tree; "Raw" shows the literal envelope. Opened by clicking the inline viewer.
export function ResponseDialog({
  result,
  initialMode = "parsed",
  isError = false,
  onClose,
}: {
  result: ToolResult;
  initialMode?: Mode;
  isError?: boolean;
  onClose: () => void;
}) {
  const raw = useMemo(() => JSON.stringify(result, null, 2), [result]);
  const parsed = useMemo(() => JSON.stringify(expandEmbeddedJson(result), null, 2), [result]);
  const hasEmbedded = parsed !== raw;
  const [mode, setMode] = useState<Mode>(hasEmbedded ? initialMode : "raw");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const text = mode === "parsed" && hasEmbedded ? parsed : raw;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  const tab = (value: Mode, label: string) => (
    <button
      type="button"
      onClick={() => setMode(value)}
      className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
        mode === value ? "bg-emerald-600 text-white" : "text-zinc-400 hover:text-zinc-200"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-3xl flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="font-display text-sm font-semibold text-zinc-100">Response</h2>
            {isError && (
              <span className="rounded bg-red-950 px-1.5 py-0.5 text-[10px] font-medium text-red-300">isError</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {hasEmbedded && (
              <div className="flex items-center gap-0.5 rounded-md bg-zinc-800/60 p-0.5">
                {tab("parsed", "Parsed")}
                {tab("raw", "Raw")}
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                void copy();
              }}
              className="rounded-md border border-zinc-700 px-2 py-1 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-500 hover:bg-zinc-800"
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-2 py-1 text-sm text-zinc-400 hover:bg-zinc-800"
              aria-label="Close response"
            >
              Close
            </button>
          </div>
        </div>

        {mode === "parsed" && hasEmbedded && (
          <p className="text-[11px] text-zinc-500">
            Showing JSON that the server embedded as text (<span className="font-mono text-zinc-400">content[].text</span>)
            expanded into a tree. Switch to <span className="font-mono text-zinc-400">Raw</span> for the literal envelope.
          </p>
        )}

        <pre
          className={`m-0 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-md border p-3 font-mono text-xs leading-5 ${
            isError ? "border-red-900/60 bg-red-950/20" : "border-zinc-800 bg-zinc-950"
          }`}
        >
          {tokenizeJson(text).map((t, i) => (
            <span key={i} className={KIND_CLASS[t.kind]}>
              {t.value}
            </span>
          ))}
        </pre>
      </div>
    </div>
  );
}
