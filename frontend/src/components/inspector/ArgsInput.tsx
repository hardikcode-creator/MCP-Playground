import { useMemo } from "react";
import type { JsonSchema } from "../../types";
import type { ArgMode } from "../../state/appState";
import { applyParamValue, toParamRows } from "../../lib/schema";
import { ParamField } from "./ParamField";

// Postman-style args editor. Params and Raw are two views of the SAME args
// object: editing either one rewrites argsText so they stay in sync.
export function ArgsInput({
  schema,
  argsText,
  setArgsText,
  mode,
  setMode,
}: {
  schema: JsonSchema;
  argsText: string;
  setArgsText: (text: string) => void;
  mode: ArgMode;
  setMode: (mode: ArgMode) => void;
}) {
  const rows = useMemo(() => toParamRows(schema), [schema]);

  let obj: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(argsText || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      obj = parsed as Record<string, unknown>;
    }
  } catch {
    // Raw text isn't valid JSON yet — the Params view falls back to empty.
  }

  const setField = (name: string, next: unknown) => {
    setArgsText(JSON.stringify(applyParamValue(obj, rows, name, next), null, 2));
  };

  const tab = (value: ArgMode, label: string) => (
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
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Arguments</span>
        <div className="flex items-center gap-0.5 rounded-md bg-zinc-800/60 p-0.5">
          {tab("params", "Params")}
          {tab("raw", "Raw")}
        </div>
      </div>

      {mode === "raw" ? (
        <textarea
          rows={8}
          value={argsText}
          onChange={(e) => setArgsText(e.target.value)}
          spellCheck={false}
          className="w-full resize-y rounded-md border border-zinc-700 bg-zinc-950 p-2.5 font-mono text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
        />
      ) : rows.length === 0 ? (
        <p className="rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-2 text-xs text-zinc-500">
          This tool takes no arguments.
        </p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {rows.map((row) => (
            <div key={row.name} className="flex flex-col gap-1">
              <div className="flex items-baseline gap-1.5">
                <span className="font-mono text-xs text-zinc-200">{row.name}</span>
                <span className="text-[10px] text-zinc-600">{row.type}</span>
                {row.required ? (
                  <span className="text-[10px] font-medium text-red-400">required</span>
                ) : (
                  <span className="text-[10px] text-zinc-600">optional</span>
                )}
              </div>
              {row.description && <p className="text-[11px] text-zinc-500">{row.description}</p>}
              <ParamField def={row} value={obj[row.name]} onChange={(next) => setField(row.name, next)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
