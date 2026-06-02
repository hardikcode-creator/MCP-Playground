import { useCallback, useMemo, useState } from "react";
import { useAppState } from "../../state/appState";
import { Chevron, Play, Spinner } from "../../lib/icons";
import { validateArgs } from "../../lib/schema";
import { resolveValueRefsDetailed } from "../../lib/workflowRefs";
import { ArgsInput } from "./ArgsInput";
import { AiMapPanel } from "./AiMapPanel";
import { ResponseViewer } from "./ResponseViewer";
import type { AiPreviousNode } from "../../data/aiClient";
import type { WorkflowState } from "../../state/workflowStore";
import type { RunStatus, ToolResult } from "../../types";

function readRef(value: unknown): { nodeId: string; path: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const wrapped = value as Record<string, unknown>;
  if (!wrapped.$ref || typeof wrapped.$ref !== "object" || Array.isArray(wrapped.$ref)) return null;
  const ref = wrapped.$ref as Record<string, unknown>;
  return {
    nodeId: typeof ref.nodeId === "string" ? ref.nodeId : "",
    path: typeof ref.path === "string" ? ref.path : "",
  };
}

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
    getToolResult,
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

  // For PATH PICKING: prefer the source node's OWN run output (persisted on the
  // node after a workflow run) so suggested paths match exactly what that node
  // actually returned. Only when the node hasn't run yet do we fall back to a
  // standalone tool sample captured in the inspector. Either way, resolved
  // *values* always flow from the node's own output (see live preview below).
  const nodeStructureSample = useCallback(
    (nodeId: string): ToolResult | null => {
      const n = workflow?.getNodeById(nodeId);
      if (!n) return null;
      return n.data.lastResult ?? getToolResult(n.data.qualifiedName);
    },
    [workflow, getToolResult],
  );

  const { blocked, invalidFields, issueText } = useMemo(() => {
    const empty = { blocked: false, invalidFields: [] as string[], issueText: null as string | null };
    if (!selectedDescriptor) return empty;

    const v = validateArgs(selectedDescriptor.inputSchema, effectiveArgsText);
    const issues: Array<{ path: string; message: string }> = v.ok ? [] : [...v.errors];

    // $ref wiring on a workflow node must name a source node AND a path.
    if (selectedWorkflowNode) {
      try {
        const parsed = JSON.parse(effectiveArgsText || "{}");
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
            const ref = readRef(val);
            if (!ref) continue;
            if (!ref.nodeId) issues.push({ path: key, message: "needs a source node" });
            else if (!ref.path.trim()) issues.push({ path: key, message: "needs a reference path" });
          }
        }
      } catch {
        // Invalid JSON is already reported by validateArgs above.
      }
    }

    if (issues.length === 0) return empty;
    const invalidFields = [...new Set(issues.map((e) => e.path).filter((p) => p !== "(root)"))];
    const first = issues[0];
    const head = first.path === "(root)" ? first.message : `${first.path} ${first.message}`;
    const issueText = issues.length === 1 ? head : `Fix ${issues.length} issues — ${head}`;
    return { blocked: true, invalidFields, issueText };
  }, [selectedDescriptor, effectiveArgsText, selectedWorkflowNode]);

  const liveResolvedPreview = useMemo(() => {
    if (!selectedWorkflowNode || !workflow) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(selectedWorkflowNode.data.argsText || "{}");
    } catch {
      return null;
    }
    // Values resolve against the source NODE's own output (its last run result),
    // not the tool's standalone sample — the sample only shapes path picking.
    return resolveValueRefsDetailed(
      parsed,
      (nodeId) => workflow.getNodeById(nodeId)?.data.lastResult ?? undefined,
      (nodeId) => Boolean(workflow.getNodeById(nodeId)),
    );
  }, [selectedWorkflowNode, workflow]);
  const refNodeOptions = useMemo(() => {
    if (!workflow) return [];
    return workflow.nodes.map((n) => ({ id: n.id, label: n.id, tool: n.data.qualifiedName }));
  }, [workflow]);

  // Upstream nodes (with a captured response) the AI can map FROM. Demo scope:
  // map ONLY from this node's direct predecessors — the "previous nodes" wired by
  // an edge into it. There is intentionally NO fallback to arbitrary unconnected
  // nodes, so the Auto-map button is a no-op unless the node actually has a
  // previous-node reference in the workflow (and that node has produced output).
  const aiPreviousNodes = useMemo<AiPreviousNode[]>(() => {
    if (!workflow || !selectedWorkflowNode) return [];
    const currentId = selectedWorkflowNode.id;

    const toEntry = (nodeId: string): AiPreviousNode | null => {
      const n = workflow.getNodeById(nodeId);
      if (!n || n.id === currentId) return null;
      const response = nodeStructureSample(nodeId);
      if (!response) return null;
      return {
        nodeId: n.id,
        tool: n.data.qualifiedName,
        description: n.data.description,
        response,
      };
    };

    const predecessorIds = [
      ...new Set(workflow.edges.filter((e) => e.target === currentId).map((e) => e.source)),
    ];
    return predecessorIds
      .map(toEntry)
      .filter((e): e is AiPreviousNode => e !== null);
  }, [workflow, selectedWorkflowNode, nodeStructureSample]);

  const paused = selectedWorkflowNode?.data.status === "paused";
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
                getNodeResult={nodeStructureSample}
                historyKey={`${selectedWorkflowNode?.id ?? "tool"}::${selectedDescriptor.qualifiedName}`}
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

            {selectedWorkflowNode && (
              <AiMapPanel
                currentNode={{
                  tool: selectedDescriptor.qualifiedName,
                  description: selectedDescriptor.description,
                  inputSchema: selectedDescriptor.inputSchema,
                }}
                previousNodes={aiPreviousNodes}
                argsText={effectiveArgsText}
                onChangeArgs={setEffectiveArgsText}
              />
            )}

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

            {paused && selectedWorkflowNode && workflow ? (
              <div className="flex flex-col gap-2 rounded-lg border border-amber-700/50 bg-amber-950/30 p-2.5">
                {selectedWorkflowNode.data.pauseSource === "missing-input" ? (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-amber-400" />
                      <span className="text-xs font-semibold text-amber-300">
                        Needs input — provide arguments to continue
                      </span>
                    </div>
                    <p className="text-[11px] text-amber-200/70">
                      This node is missing required values. Fill them in the args above, or use
                      “Auto-map with AI”, then Resume. Resuming while values are still empty pauses here again.
                    </p>
                    {(selectedWorkflowNode.data.missingArgs?.length ?? 0) > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {selectedWorkflowNode.data.missingArgs?.map((name) => (
                          <span
                            key={name}
                            className="rounded border border-amber-700/50 bg-amber-900/30 px-1.5 py-0.5 font-mono text-[10px] text-amber-200"
                          >
                            {name}
                          </span>
                        ))}
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex h-2 w-2 animate-pulse rounded-full bg-amber-400" />
                      <span className="text-xs font-semibold text-amber-300">Paused at breakpoint</span>
                    </div>
                    <p className="text-[11px] text-amber-200/70">
                      Edit the arguments above to resume with changes, or skip this node.
                    </p>
                  </>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => workflow.resumeNode(selectedWorkflowNode.id)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-emerald-600/60 bg-emerald-900/40 px-2.5 py-1 text-xs font-medium text-emerald-200 transition-colors hover:border-emerald-400 hover:bg-emerald-900/70"
                  >
                    <Play className="h-3 w-3" />
                    Resume
                  </button>
                  <button
                    type="button"
                    onClick={() => workflow.skipNode(selectedWorkflowNode.id)}
                    className="rounded-md border border-zinc-600 px-2.5 py-1 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-400 hover:bg-zinc-800"
                  >
                    Skip
                  </button>
                </div>
              </div>
            ) : (
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
            )}

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
