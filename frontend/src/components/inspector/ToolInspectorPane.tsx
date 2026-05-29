import { useMemo } from "react";
import { useAppState } from "../../state/appState";
import { Chevron, Play, Spinner } from "../../lib/icons";
import { findMissingRequired } from "../../lib/schema";
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

  const { argsError, missingRequired } = useMemo(() => {
    const empty = { argsError: null as string | null, missingRequired: [] as string[] };
    if (!selectedDescriptor) return empty;
    let parsed: unknown;
    try {
      parsed = JSON.parse(argsText || "{}");
    } catch {
      return { ...empty, argsError: "Arguments are not valid JSON." };
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { ...empty, argsError: "Arguments must be a JSON object." };
    }
    return {
      argsError: null as string | null,
      missingRequired: findMissingRequired(selectedDescriptor.inputSchema, parsed as Record<string, unknown>),
    };
  }, [selectedDescriptor, argsText]);

  const blocked = argsError !== null || missingRequired.length > 0;

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
                missingRequired={missingRequired}
              />
              {argsError ? (
                <span className="text-xs text-red-400">{argsError}</span>
              ) : missingRequired.length > 0 ? (
                <span className="text-xs text-red-400">
                  Fill the required field{missingRequired.length === 1 ? "" : "s"} highlighted above to run.
                </span>
              ) : (
                <span className="text-xs text-zinc-500">
                  Params build the args for you · switch to Raw for full control.
                </span>
              )}
            </div>

            <div className="group flex items-center gap-3">
              <button
                type="button"
                disabled={running || blocked}
                onClick={() => {
                  void runTool();
                }}
                aria-label="Run tool"
                title="Run tool"
                className="relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 transition-all duration-200 ease-spring hover:scale-105 hover:border-emerald-400/60 hover:bg-emerald-500/20 hover:text-emerald-200 active:scale-95 disabled:cursor-not-allowed disabled:border-zinc-700 disabled:bg-transparent disabled:text-zinc-600 disabled:hover:scale-100"
              >
                {!running && !blocked && (
                  <span
                    className="animate-pulse-glow absolute -inset-1 rounded-full bg-emerald-500/20 blur-md"
                    aria-hidden="true"
                  />
                )}
                {running ? (
                  <Spinner className="relative h-5 w-5 text-emerald-300" />
                ) : (
                  <Play className="relative ml-0.5 h-4 w-4" />
                )}
              </button>
              <span className="font-mono text-xs text-zinc-500 transition-colors group-hover:text-zinc-300">
                {running
                  ? "Running…"
                  : argsError
                    ? "Fix args to run"
                    : missingRequired.length > 0
                      ? `Fill required: ${missingRequired.join(", ")}`
                      : "Run Tool"}
              </span>
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
