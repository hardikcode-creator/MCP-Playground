import type { RunRecord } from "../../types";
import { KIND_CLASS, tokenizeJson } from "../../lib/jsonTokens";

// Output is intentionally raw JSON only: MCP tool results vary wildly
// (text, structured, images), so parsing per-tool isn't worth it here.
// Actual result envelopes get syntax-colored; the idle/loading hints stay muted.
export function ResponseViewer({ run, running }: { run: RunRecord | null; running: boolean }) {
  let body: string;
  let muted = false;

  if (running) {
    body = "Calling tool…";
    muted = true;
  } else if (run) {
    body = JSON.stringify(run.result, null, 2);
  } else {
    body = "Run the tool to see the result envelope here.";
    muted = true;
  }

  const isError = !running && run?.result.isError === true;

  return (
    <pre
      className={`max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border p-2.5 font-mono text-xs ${
        isError ? "border-red-900/60 bg-red-950/20" : "border-zinc-800 bg-zinc-950"
      } ${muted ? "text-zinc-500" : "text-zinc-300"}`}
    >
      {muted
        ? body
        : tokenizeJson(body).map((t, i) => (
            <span key={i} className={KIND_CLASS[t.kind]}>
              {t.value}
            </span>
          ))}
    </pre>
  );
}
