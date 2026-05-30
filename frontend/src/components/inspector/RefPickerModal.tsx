import { useEffect, useMemo, useState } from "react";
import type { ToolResult } from "../../types";
import { KIND_CLASS, tokenizeJson } from "../../lib/jsonTokens";
import { jsonPath } from "../../lib/workflow/refs";
import { suggestJsonPaths, typeMatches } from "../../lib/workflow/suggest";
import type { ValueType } from "../../lib/workflow/suggest";

const TYPE_BADGE: Record<ValueType, string> = {
  string: "text-amber-300",
  number: "text-cyan-300",
  integer: "text-cyan-300",
  boolean: "text-violet-300",
  object: "text-zinc-400",
  array: "text-zinc-400",
  null: "text-zinc-500",
};

function previewValue(root: unknown, path: string): string {
  let v: unknown;
  try {
    v = jsonPath(root, path || "$");
  } catch {
    return "—";
  }
  if (v === undefined) return "—";
  if (typeof v === "string") return v.length > 40 ? `"${v.slice(0, 39)}…"` : `"${v}"`;
  if (v === null || typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return `array(${v.length})`;
  return "object";
}

// "Pick from response": shows the SOURCE node's saved raw tool result and a
// clickable list of JSONPaths derived from it. The result is the node's OWN
// run output when it has executed in a workflow (so paths match reality),
// falling back to a standalone tool sample otherwise. Clicking a path wires it
// into the $ref; if there's no saved response yet, the user can still type a
// path by hand.
export function RefPickerModal({
  sourceNodeId,
  sourceTool,
  result,
  currentPath,
  expectedType,
  onPick,
  onClose,
}: {
  sourceNodeId: string;
  sourceTool?: string;
  result: ToolResult | null;
  currentPath: string;
  expectedType?: string;
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  const canFilter = Boolean(expectedType) && expectedType !== "any";
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const all = useMemo(() => (result ? suggestJsonPaths(result) : []), [result]);
  const matching = useMemo(
    () => (canFilter ? all.filter((s) => typeMatches(expectedType, s.type)) : all),
    [all, canFilter, expectedType],
  );
  // Filter to the expected type by default, but fall back to everything when
  // nothing matches (so the picker never looks empty) and let the user override.
  const noMatches = canFilter && matching.length === 0;
  const shown = !canFilter || showAll || noMatches ? all : matching;
  const pretty = useMemo(() => (result ? JSON.stringify(result, null, 2) : ""), [result]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <h2 className="font-display text-sm font-semibold text-zinc-100">Pick a value from the response</h2>
            <span className="font-mono text-[11px] text-zinc-500">
              source node: <span className="text-emerald-300">{sourceNodeId || "—"}</span>
              {sourceTool ? <span className="text-zinc-600"> · {sourceTool}</span> : null}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-zinc-400 hover:bg-zinc-800"
          >
            Close
          </button>
        </div>

        {!result ? (
          <p className="rounded-md border border-amber-800/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
            No saved response for {sourceTool ? <span className="font-mono text-amber-200">{sourceTool}</span> : "this tool"} yet.
            Run the workflow (or run this tool once from the catalog) to capture its response, then pick a path here.
            You can still type a JSONPath manually.
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                  Suggested paths
                  <span className="ml-1.5 font-normal normal-case text-zinc-600">({shown.length})</span>
                </span>
                {canFilter && (
                  <button
                    type="button"
                    onClick={() => setShowAll((s) => !s)}
                    disabled={noMatches}
                    title={noMatches ? `No ${expectedType} values in this response` : undefined}
                    className="rounded border border-zinc-700 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300 transition-colors hover:border-emerald-600 hover:text-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {noMatches
                      ? `no ${expectedType} · all`
                      : showAll
                        ? "all types"
                        : `only ${expectedType}`}
                  </button>
                )}
              </div>
              <div className="flex max-h-52 flex-col gap-1 overflow-y-auto">
                {shown.map((s) => {
                  const active = s.path === currentPath;
                  return (
                    <button
                      key={s.path}
                      type="button"
                      onClick={() => onPick(s.path)}
                      className={`flex items-center justify-between gap-3 rounded-md border px-2 py-1 text-left transition-colors ${
                        active
                          ? "border-emerald-600 bg-emerald-950/40"
                          : "border-zinc-800 hover:border-zinc-600 hover:bg-zinc-800/60"
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className={`shrink-0 font-mono text-[9px] uppercase ${TYPE_BADGE[s.type]}`}>{s.type}</span>
                        <code className="truncate font-mono text-[11px] text-emerald-300">{s.path}</code>
                      </span>
                      <span className="shrink-0 font-mono text-[10px] text-zinc-500">{previewValue(result, s.path)}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Raw result</span>
              <pre className="m-0 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-md border border-zinc-800 bg-zinc-950 p-2.5 font-mono text-xs leading-5">
                {tokenizeJson(pretty).map((t, i) => (
                  <span key={i} className={KIND_CLASS[t.kind]}>
                    {t.value}
                  </span>
                ))}
              </pre>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
