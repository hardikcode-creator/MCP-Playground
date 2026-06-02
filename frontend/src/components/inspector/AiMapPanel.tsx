import { Sparkles, Spinner } from "../../lib/icons";
import { suggestMappings, AiServiceError } from "../../data/aiClient";
import type { AiCurrentNode, AiMapping, AiMappingResult, AiPreviousNode } from "../../data/aiClient";

// The panel's transient result state is owned by the parent (keyed per node) so
// that switching between nodes preserves each node's own suggestions instead of
// either sharing one node's result across all nodes or wiping it on every switch.
export type AiMapPanelState = {
  status: "idle" | "loading" | "error" | "done";
  error: string | null;
  result: AiMappingResult | null;
  appliedCount: number;
};

export const initialAiMapPanelState: AiMapPanelState = {
  status: "idle",
  error: null,
  result: null,
  appliedCount: 0,
};

// "Auto-map with AI": given the current workflow node and the responses of its
// upstream nodes, ask the AI service which argument should be wired to which
// key of an upstream response. By default it ONLY fills arguments that are
// still empty (the "mappings aren't available yet" case); every suggestion is
// also listed so the user can apply one explicitly, even over a filled field.

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

// A field counts as "empty" (safe to auto-fill) when it has no value, or it's a
// $ref placeholder missing its node or path.
function isFieldEmpty(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true;
  const ref = readRef(value);
  if (ref) return !ref.nodeId || !ref.path.trim();
  return false;
}

function valueForMapping(m: AiMapping): unknown | undefined {
  if (m.decision === "reference" && m.ref) {
    return { $ref: { nodeId: m.ref.nodeId, path: m.ref.path } };
  }
  if (m.decision === "literal") return m.value;
  return undefined;
}

function parseArgs(argsText: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(argsText || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through
  }
  return {};
}

export function AiMapPanel({
  currentNode,
  previousNodes,
  argsText,
  onChangeArgs,
  state,
  onStateChange,
}: {
  currentNode: AiCurrentNode;
  previousNodes: AiPreviousNode[];
  argsText: string;
  onChangeArgs: (text: string) => void;
  state: AiMapPanelState;
  onStateChange: (next: AiMapPanelState) => void;
}) {
  const { status, error, result, appliedCount } = state;

  const disabled = previousNodes.length === 0 || status === "loading";

  const applyMappings = (mappings: AiMapping[], onlyEmpty: boolean): number => {
    const obj = parseArgs(argsText);
    let applied = 0;
    for (const m of mappings) {
      const next = valueForMapping(m);
      if (next === undefined) continue;
      if (onlyEmpty && !isFieldEmpty(obj[m.argument])) continue;
      // Auto-fill never writes a reference whose path didn't resolve against the
      // upstream response — that would only fail at run time. The suggestion is
      // still listed so the user can apply it explicitly if they really want to.
      if (onlyEmpty && m.decision === "reference" && m.pathResolves === false) continue;
      obj[m.argument] = next;
      applied++;
    }
    if (applied > 0) onChangeArgs(JSON.stringify(obj, null, 2));
    return applied;
  };

  const run = async () => {
    onStateChange({ status: "loading", error: null, result: null, appliedCount: 0 });
    try {
      const res = await suggestMappings({ currentNode, previousNodes });
      // Auto-fill only the still-empty fields, so a user's existing wiring is
      // never clobbered. Everything else stays available to apply manually.
      const applied = applyMappings(res.mappings, true);
      onStateChange({ status: "done", error: null, result: res, appliedCount: applied });
    } catch (err) {
      const message = err instanceof AiServiceError ? err.message : (err as Error).message;
      onStateChange({ status: "error", error: message, result: null, appliedCount: 0 });
    }
  };

  const applyOne = (m: AiMapping) => {
    const next = valueForMapping(m);
    if (next === undefined) return;
    const obj = parseArgs(argsText);
    obj[m.argument] = next;
    onChangeArgs(JSON.stringify(obj, null, 2));
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-violet-800/40 bg-violet-950/20 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Sparkles className="text-violet-300" />
          <span className="text-xs font-semibold text-violet-200">AI argument mapping</span>
        </div>
        <button
          type="button"
          onClick={() => {
            void run();
          }}
          disabled={disabled}
          title={
            previousNodes.length === 0
              ? "Connect a previous node and run it so the AI has its response to map from"
              : "Suggest argument mappings from the previous node's response"
          }
          className="inline-flex items-center gap-1.5 rounded-md border border-violet-600/60 bg-violet-900/40 px-2.5 py-1 text-xs font-medium text-violet-100 transition-colors hover:border-violet-400 hover:bg-violet-900/70 disabled:cursor-not-allowed disabled:border-zinc-700 disabled:bg-transparent disabled:text-zinc-600"
        >
          {status === "loading" ? <Spinner className="h-3.5 w-3.5" /> : <Sparkles />}
          {status === "loading" ? "Mapping…" : result ? "Re-map" : "Auto-map"}
        </button>
      </div>

      {previousNodes.length === 0 ? (
        <p className="text-[11px] text-zinc-500">
          No previous-node output to map from. Connect a previous node and run the workflow so AI mapping can use its
          response. You can always fill the arguments in manually.
        </p>
      ) : (
        <p className="text-[11px] text-violet-200/60">
          Suggests how to wire each argument from{" "}
          {previousNodes.length === 1 ? "the previous node" : `${previousNodes.length} previous nodes`}. Empty fields
          are filled automatically.
        </p>
      )}

      {status === "error" && error && (
        <p className="rounded border border-red-800/60 bg-red-950/40 px-2 py-1.5 text-[11px] text-red-300">{error}</p>
      )}

      {result && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wide text-zinc-500">
              {appliedCount > 0 ? `Filled ${appliedCount} empty field${appliedCount === 1 ? "" : "s"}` : "Suggestions"}
            </span>
            <span className="text-[10px] text-zinc-600">{result.model}</span>
          </div>
          <ul className="flex flex-col gap-1.5">
            {result.mappings.map((m) => (
              <li
                key={m.argument}
                className="flex items-start justify-between gap-2 rounded border border-zinc-800 bg-zinc-950/60 px-2 py-1.5"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[11px] text-zinc-200">{m.argument}</span>
                    <span className="text-[10px] text-zinc-600">{Math.round(m.confidence * 100)}%</span>
                    {m.decision === "reference" && m.pathResolves === false && (
                      <span className="text-[10px] text-amber-400" title="This path did not resolve against the response">
                        path not found
                      </span>
                    )}
                  </div>
                  {m.decision === "reference" && m.ref ? (
                    <code className="truncate font-mono text-[10px] text-emerald-300/90">
                      {m.ref.nodeId}.{m.ref.path}
                    </code>
                  ) : m.decision === "literal" ? (
                    <code className="truncate font-mono text-[10px] text-sky-300/90">{JSON.stringify(m.value)}</code>
                  ) : (
                    <span className="text-[10px] text-zinc-600">no confident mapping</span>
                  )}
                  {m.reasoning && <span className="text-[10px] leading-snug text-zinc-500">{m.reasoning}</span>}
                </div>
                {m.decision !== "unmapped" && (
                  <button
                    type="button"
                    onClick={() => applyOne(m)}
                    className="shrink-0 rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] font-medium text-zinc-300 transition-colors hover:border-violet-500 hover:text-violet-200"
                  >
                    Apply
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
