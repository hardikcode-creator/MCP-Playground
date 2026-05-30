import { useMemo } from "react";
import type { JsonSchema } from "../../types";
import type { ArgMode } from "../../state/appState";
import { applyParamValue, toParamRows } from "../../lib/schema";
import { CodeEditor } from "../common/CodeEditor";
import { ParamField } from "./ParamField";
import type { ValueRef } from "../../types";

// Postman-style args editor. Params and Raw are two views of the SAME args
// object: editing either one rewrites argsText so they stay in sync.
export function ArgsInput({
  schema,
  argsText,
  setArgsText,
  mode,
  setMode,
  missingRequired = [],
  refNodeOptions = [],
  currentNodeId,
}: {
  schema: JsonSchema;
  argsText: string;
  setArgsText: (text: string) => void;
  mode: ArgMode;
  setMode: (mode: ArgMode) => void;
  missingRequired?: string[];
  refNodeOptions?: Array<{ id: string; label: string }>;
  currentNodeId?: string;
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
  const readRef = (value: unknown): ValueRef["$ref"] | null => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const wrapped = value as Record<string, unknown>;
    if (!wrapped.$ref || typeof wrapped.$ref !== "object" || Array.isArray(wrapped.$ref)) return null;
    const ref = wrapped.$ref as Record<string, unknown>;
    if (typeof ref.nodeId !== "string" || typeof ref.path !== "string") return null;
    return { nodeId: ref.nodeId, path: ref.path };
  };
  const firstAllowedNodeId = refNodeOptions.find((o) => o.id !== currentNodeId)?.id ?? "";

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
        <CodeEditor value={argsText} onChange={setArgsText} ariaLabel="Raw JSON arguments" minHeight={176} />
      ) : rows.length === 0 ? (
        <p className="rounded-md border border-zinc-800 bg-zinc-950 px-2.5 py-2 text-xs text-zinc-500">
          This tool takes no arguments.
        </p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {rows.map((row) => {
            const isMissing = missingRequired.includes(row.name);
            return (
              <div key={row.name} className="flex flex-col gap-1">
                <div className="flex items-baseline gap-1.5">
                  <span className="font-mono text-xs text-zinc-200">{row.name}</span>
                  <span className="text-[10px] text-zinc-600">{row.type}</span>
                  {row.required ? (
                    <span className="text-[10px] font-medium text-red-400">required</span>
                  ) : (
                    <span className="text-[10px] text-zinc-600">optional</span>
                  )}
                  {isMissing && <span className="text-[10px] text-red-400">needs a value</span>}
                </div>
                {row.description && <p className="text-[11px] text-zinc-500">{row.description}</p>}
                {(() => {
                  const fieldValue = obj[row.name];
                  const activeRef = readRef(fieldValue);
                  const useRef = Boolean(activeRef);
                  return (
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (useRef) {
                              setField(row.name, "");
                              return;
                            }
                            setField(row.name, { $ref: { nodeId: firstAllowedNodeId, path: "" } });
                          }}
                          className={`rounded border px-2 py-0.5 text-[10px] font-medium transition-colors ${
                            useRef
                              ? "border-emerald-700 bg-emerald-950/40 text-emerald-300"
                              : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
                          }`}
                        >
                          {useRef ? "Using ref" : "Use reference"}
                        </button>
                        {useRef && (
                          <span className="text-[10px] text-zinc-500">
                            maps value from another node output
                          </span>
                        )}
                      </div>
                      {useRef ? (
                        <div className="flex flex-col gap-1">
                          <span className="text-[10px] uppercase tracking-wide text-zinc-500">Reference Node</span>
                          <select
                            className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
                            value={activeRef?.nodeId ?? ""}
                            onChange={(e) =>
                              setField(row.name, { $ref: { nodeId: e.target.value, path: "" } })
                            }
                          >
                            {refNodeOptions.length === 0 ? (
                              <option value="">No nodes available</option>
                            ) : (
                              <>
                                <option value="">Select node…</option>
                                {refNodeOptions.map((opt) => (
                                  <option key={opt.id} value={opt.id} disabled={opt.id === currentNodeId}>
                                    {opt.label}
                                  </option>
                                ))}
                              </>
                            )}
                          </select>
                        </div>
                      ) : (
                        <ParamField
                          def={row}
                          value={fieldValue}
                          invalid={isMissing}
                          onChange={(next) => setField(row.name, next)}
                        />
                      )}
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
