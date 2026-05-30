import { useMemo, useState } from "react";
import type { RunRecord } from "../../types";
import { KIND_CLASS, expandEmbeddedJson, tokenizeJson } from "../../lib/jsonTokens";
import { ResponseDialog } from "./ResponseDialog";

type Mode = "raw" | "parsed";

function ExpandIcon() {
  return (
    <svg width={11} height={11} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 2H2v4M10 14h4v-4M2 10v4h4M14 6V2h-4" />
    </svg>
  );
}

// Output is raw JSON by default; "Parsed" expands JSON that servers embed as a
// string inside content[].text (Airbnb/Zomato) into a readable tree. Clicking
// the body (or the expand button) opens the full-screen ResponseDialog.
export function ResponseViewer({ run, running }: { run: RunRecord | null; running: boolean }) {
  const [mode, setMode] = useState<Mode>("parsed");
  const [open, setOpen] = useState(false);

  const raw = useMemo(() => (run ? JSON.stringify(run.result, null, 2) : ""), [run]);
  const parsed = useMemo(
    () => (run ? JSON.stringify(expandEmbeddedJson(run.result), null, 2) : ""),
    [run],
  );

  if (running || !run) {
    return (
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border border-zinc-800 bg-zinc-950 p-2.5 font-mono text-xs text-zinc-500">
        {running ? "Calling tool…" : "Run the tool to see the result envelope here."}
      </pre>
    );
  }

  const hasEmbedded = parsed !== raw;
  const effMode: Mode = hasEmbedded ? mode : "raw";
  const text = effMode === "parsed" ? parsed : raw;
  const isError = run.result.isError === true;

  const tab = (value: Mode, label: string) => (
    <button
      type="button"
      onClick={() => setMode(value)}
      className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors ${
        mode === value ? "bg-emerald-600 text-white" : "text-zinc-400 hover:text-zinc-200"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        {hasEmbedded ? (
          <div className="flex items-center gap-0.5 rounded-md bg-zinc-800/60 p-0.5">
            {tab("parsed", "Parsed")}
            {tab("raw", "Raw")}
          </div>
        ) : (
          <span className="text-[10px] text-zinc-600">raw JSON</span>
        )}
        <button
          type="button"
          onClick={() => setOpen(true)}
          title="Expand response"
          aria-label="Expand response"
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-emerald-300"
        >
          <ExpandIcon />
          Expand
        </button>
      </div>

      <pre
        onClick={() => setOpen(true)}
        title="Click to expand"
        className={`max-h-72 cursor-pointer overflow-auto whitespace-pre-wrap break-words rounded-md border p-2.5 font-mono text-xs transition-colors ${
          isError
            ? "border-red-900/60 bg-red-950/20 hover:border-red-700/70"
            : "border-zinc-800 bg-zinc-950 hover:border-zinc-700"
        } text-zinc-300`}
      >
        {tokenizeJson(text).map((t, i) => (
          <span key={i} className={KIND_CLASS[t.kind]}>
            {t.value}
          </span>
        ))}
      </pre>

      {open && (
        <ResponseDialog
          result={run.result}
          initialMode={effMode}
          isError={isError}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
