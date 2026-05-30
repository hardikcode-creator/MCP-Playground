import { useMemo, useState } from "react";
import { useAppState } from "../../state/appState";
import { Chevron, Play, Spinner } from "../../lib/icons";
import { validateArgs } from "../../lib/schema";
import { resolveValueRefsDetailed } from "../../lib/workflowRefs";
import { ArgsInput } from "./ArgsInput";
import { ResponseViewer } from "./ResponseViewer";
import type { WorkflowState } from "../../state/workflowStore";
import type { RunStatus } from "../../types";

export function ToolInspectorPane({
  workflow,
  onCollapse,
}: {
  workflow?: WorkflowState;
  onCollapse?: () => void;
}) {
  const [copyState, setCopyState] = useState<"idle" | "ok" | "error">("idle");
  const {
    inspectorSource,
    selectedWorkflowNodeId,
    selectedDescriptor,
    argsText,
    setArgsText,
    argMode,
    setArgMode,
    running,
    runTool,
    latestRunForSelected,
  } = useAppState();

  const selectedWorkflowNode =
    inspectorSource === "workflow" && selectedWorkflowNodeId && workflow
      ? workflow.getNodeById(selectedWorkflowNodeId)
      : undefined;

  const effectiveArgsText = selectedWorkflowNode?.data.argsText ?? argsText;
  const setEffectiveArgsText = (text: string) => {
    if (selectedWorkflowNode && workflow) {
      workflow.setNodeArgsText(selectedWorkflowNode.id, text);
      return;
    }
    setArgsText(text);
  };

  const { blocked, invalidFields, issueText } = useMemo(() => {
    if (!selectedDescriptor) {
      return { blocked: false, invalidFields: [] as string[], issueText: null as string | null };
    }
    const v = validateArgs(selectedDescriptor.inputSchema, effectiveArgsText);
    if (v.ok) return { blocked: false, invalidFields: [] as string[], issueText: null as string | null };
    const invalidFields = v.errors.map((e) => e.path).filter((p) => p !== "(root)");
    const first = v.errors[0];
    const head = first.path === "(root)" ? first.message : `${first.path} ${first.message}`;
    const issueText = v.errors.length === 1 ? head : `Fix ${v.errors.length} issues — ${head}`;
    return { blocked: true, invalidFields, issueText };
  }, [selectedDescriptor, effectiveArgsText]);

  const liveResolvedPreview = useMemo(() => {
    if (!selectedWorkflowNode || !workflow) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(selectedWorkflowNode.data.argsText || "{}");
    } catch {
      return null;
    }
    return resolveValueRefsDetailed(
      parsed,
      (nodeId) => workflow.getNodeOutputById(nodeId),
      (nodeId) => Boolean(workflow.getNodeById(nodeId)),
    );
  }, [selectedWorkflowNode, workflow]);
  const refNodeOptions = useMemo(() => {
    if (!workflow) return [];
    return workflow.nodes.map((n) => ({ id: n.id, label: n.id }));
  }, [workflow]);

  const runningState = selectedWorkflowNode ? selectedWorkflowNode.data.status === "running" : running;
  const latestRun = selectedWorkflowNode
    ? selectedWorkflowNode.data.lastResult
      ? {
          qualifiedName: selectedWorkflowNode.data.qualifiedName,
          args: {},
          result: selectedWorkflowNode.data.lastResult,
          status: (selectedWorkflowNode.data.lastResult.isError ? "error" : "success") as RunStatus,
          durationMs: 0,
          at: 0,
        }
      : null
    : latestRunForSelected;

  const copyNodeId = async () => {
    if (!selectedWorkflowNode) return;
    try {
      await navigator.clipboard.writeText(selectedWorkflowNode.id);
      setCopyState("ok");
    } catch {
      setCopyState("error");
    } finally {
      setTimeout(() => setCopyState("idle"), 1500);
    }
  };

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

            {selectedWorkflowNode && (
              <div className="flex flex-col gap-1 rounded-md border border-zinc-800 bg-zinc-950/60 p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Node ID</span>
                  <button
                    type="button"
                    onClick={() => {
                      void copyNodeId();
                    }}
                    className="rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-medium text-zinc-300 transition-colors hover:border-zinc-500 hover:bg-zinc-800"
                    aria-label="Copy node id"
                    title="Copy node id"
                  >
                    {copyState === "ok" ? "Copied" : copyState === "error" ? "Copy failed" : "Copy"}
                  </button>
                </div>
                <code className="break-all font-mono text-[10px] text-zinc-300">{selectedWorkflowNode.id}</code>
              </div>
            )}

            <div className="h-px bg-zinc-800" />

            <div className="flex flex-col gap-1.5">
              <ArgsInput
                schema={selectedDescriptor.inputSchema}
                argsText={effectiveArgsText}
                setArgsText={setEffectiveArgsText}
                mode={argMode}
                setMode={setArgMode}
                invalidFields={invalidFields}
                enableRefs={Boolean(selectedWorkflowNode)}
                refNodeOptions={refNodeOptions}
                currentNodeId={selectedWorkflowNode?.id}
              />
              {issueText ? (
                <span className="text-xs text-red-400">{issueText}</span>
              ) : selectedWorkflowNode ? (
                <span className="text-xs text-zinc-500">
                  Wire a field to another node with “Use reference”, or run the whole graph from the canvas.
                </span>
              ) : (
                <span className="text-xs text-zinc-500">
                  Params build the args for you · switch to Raw or JSON for full control.
                </span>
              )}
            </div>

            {selectedWorkflowNode && liveResolvedPreview && (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                    Live Resolved Args
                  </span>
                  {liveResolvedPreview.errors.length > 0 ? (
                    <span className="text-[10px] text-red-400">ref errors</span>
                  ) : (
                    <span className="text-[10px] text-zinc-600">preview</span>
                  )}
                </div>
                <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-md border border-zinc-800 bg-zinc-950 p-2.5 font-mono text-xs text-zinc-300">
                  {liveResolvedPreview.errors.length > 0
                    ? liveResolvedPreview.errors.map((e) => e.message).join("\n")
                    : JSON.stringify(liveResolvedPreview.value, null, 2)}
                </pre>
              </div>
            )}

            <div className="group flex items-center gap-3">
              <button
                type="button"
                disabled={runningState || blocked || !!selectedWorkflowNode}
                onClick={() => {
                  void runTool();
                }}
                aria-label="Run tool"
                title={selectedWorkflowNode ? "Run from workflow canvas toolbar" : "Run tool"}
                className="relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 transition-all duration-200 ease-spring hover:scale-105 hover:border-emerald-400/60 hover:bg-emerald-500/20 hover:text-emerald-200 active:scale-95 disabled:cursor-not-allowed disabled:border-zinc-700 disabled:bg-transparent disabled:text-zinc-600 disabled:hover:scale-100"
              >
                {!runningState && !blocked && !selectedWorkflowNode && (
                  <span
                    className="animate-pulse-glow absolute -inset-1 rounded-full bg-emerald-500/20 blur-md"
                    aria-hidden="true"
                  />
                )}
                {runningState ? (
                  <Spinner className="relative h-5 w-5 text-emerald-300" />
                ) : (
                  <Play className="relative ml-0.5 h-4 w-4" />
                )}
              </button>
              <span className="font-mono text-xs text-zinc-500 transition-colors group-hover:text-zinc-300">
                {runningState
                  ? "Running…"
                  : selectedWorkflowNode
                    ? "Run from canvas toolbar"
                    : blocked
                      ? "Fix args to run"
                      : "Run Tool"}
              </span>
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Response</span>
                <div className="flex items-center gap-2">
                  {latestRun?.result.isError && !runningState ? (
                    <span className="rounded bg-red-950 px-1.5 py-0.5 text-[10px] font-medium text-red-300">
                      isError
                    </span>
                  ) : null}
                  {latestRun && !runningState && !selectedWorkflowNode ? (
                    <span className="text-[10px] text-zinc-600">{latestRun.durationMs}ms</span>
                  ) : null}
                  <span className="text-[10px] text-zinc-600">raw JSON</span>
                </div>
              </div>
              <ResponseViewer run={latestRun} running={runningState} />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
