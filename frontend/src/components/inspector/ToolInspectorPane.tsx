import { useMemo } from "react";
import { useAppState } from "../../state/appState";
import { Chevron } from "../../lib/icons";
import { ArgsInput } from "./ArgsInput";
import { ResponseViewer } from "./ResponseViewer";

export function ToolInspectorPane({ onCollapse }: { onCollapse?: () => void }) {
  const {
    selectedDescriptor,
    argsText,
    setArgsText,
    argMode,
    setArgMode,
    running,
    runTool,
    latestRunForSelected,
  } = useAppState();

  const argsError = useMemo(() => {
    if (!selectedDescriptor) return null;
    try {
      const parsed = JSON.parse(argsText || "{}");
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return "Arguments must be a JSON object.";
      }
      return null;
    } catch {
      return "Arguments are not valid JSON.";
    }
  }, [selectedDescriptor, argsText]);

  return (
    <section className="flex h-full flex-col border-l border-zinc-800 bg-zinc-900">
      <header className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Tool Inspector</span>
        {onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            title="Collapse panel"
            aria-label="Collapse inspector"
            className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
          >
            <Chevron dir="right" />
          </button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto p-3">
        {!selectedDescriptor ? (
          <p className="text-sm text-zinc-400">Select a tool from the catalog to inspect and run it.</p>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <span className="font-mono text-sm font-semibold text-zinc-100">
                {selectedDescriptor.qualifiedName}
              </span>
              <span className="text-xs text-zinc-400">{selectedDescriptor.description}</span>
            </div>

            <div className="h-px bg-zinc-800" />

            <div className="flex flex-col gap-1.5">
              <ArgsInput
                schema={selectedDescriptor.inputSchema}
                argsText={argsText}
                setArgsText={setArgsText}
                mode={argMode}
                setMode={setArgMode}
              />
              {argsError ? (
                <span className="text-xs text-red-400">{argsError}</span>
              ) : (
                <span className="text-xs text-zinc-500">
                  Params build the args for you · switch to Raw for full control.
                </span>
              )}
            </div>

            <div>
              <button
                type="button"
                disabled={running || argsError !== null}
                onClick={() => {
                  void runTool();
                }}
                className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white shadow-lg shadow-emerald-900/30 transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
              >
                {running ? "Running…" : "Run"}
              </button>
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Response</span>
                <div className="flex items-center gap-2">
                  {latestRunForSelected?.result.isError && !running ? (
                    <span className="rounded bg-red-950 px-1.5 py-0.5 text-[10px] font-medium text-red-300">
                      isError
                    </span>
                  ) : null}
                  {latestRunForSelected && !running ? (
                    <span className="text-[10px] text-zinc-600">{latestRunForSelected.durationMs}ms</span>
                  ) : null}
                  <span className="text-[10px] text-zinc-600">raw JSON</span>
                </div>
              </div>
              <ResponseViewer run={latestRunForSelected} running={running} />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
