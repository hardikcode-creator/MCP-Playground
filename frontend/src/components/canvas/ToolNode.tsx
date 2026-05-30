import { memo, useCallback } from "react";
import { Handle, Position, useReactFlow } from "@xyflow/react";
import type { Node, NodeProps } from "@xyflow/react";
import type { NodeStatus } from "../../types";
import type { ToolNodeData } from "../../state/workflowStore";

export type ToolNodeType = Node<ToolNodeData, "tool">;

const STATUS_STYLES: Record<
  NodeStatus,
  { border: string; bg: string; opacity: string }
> = {
  idle:    { border: "border-zinc-700",    bg: "",                    opacity: "" },
  running: { border: "border-amber-400",   bg: "bg-amber-950/30",     opacity: "" },
  success: { border: "border-emerald-400", bg: "bg-emerald-950/20",   opacity: "" },
  error:   { border: "border-red-400",     bg: "bg-red-950/20",       opacity: "" },
  skipped: { border: "border-zinc-600",    bg: "",                    opacity: "opacity-50" },
  cycle:   { border: "border-orange-400",  bg: "bg-orange-950/30",    opacity: "" },
};

function StatusIcon({ status }: { status: NodeStatus }) {
  if (status === "idle") return null;

  if (status === "running") {
    return (
      <span className="ml-auto shrink-0">
        <svg
          className="h-3 w-3 animate-spin text-amber-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
        </svg>
      </span>
    );
  }

  if (status === "success") {
    return (
      <span className="ml-auto shrink-0">
        <svg className="h-3 w-3 text-emerald-400" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 6l3 3 5-5" />
        </svg>
      </span>
    );
  }

  if (status === "error") {
    return (
      <span className="ml-auto shrink-0">
        <svg className="h-3 w-3 text-red-400" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <path d="M2 2l6 6M8 2l-6 6" />
        </svg>
      </span>
    );
  }

  if (status === "skipped") {
    return (
      <span className="ml-auto shrink-0">
        <svg className="h-3 w-3 text-zinc-500" viewBox="0 0 10 4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <path d="M1 2h8" />
        </svg>
      </span>
    );
  }

  if (status === "cycle") {
    return (
      <span className="ml-auto shrink-0">
        <svg className="h-3 w-3 text-orange-400" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 2L1 10h10L6 2z" />
          <path d="M6 5v3" />
          <circle cx="6" cy="9.5" r="0.5" fill="currentColor" stroke="none" />
        </svg>
      </span>
    );
  }

  return null;
}

export const ToolNode = memo(function ToolNode({ id, data, selected }: NodeProps<ToolNodeType>) {
  const { deleteElements } = useReactFlow();
  const status = data.status ?? "idle";
  const { border, bg, opacity } = STATUS_STYLES[status];

  const onDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      void deleteElements({ nodes: [{ id }] });
    },
    [id, deleteElements],
  );
  return (
    <div
      className={`group relative flex w-[180px] flex-col gap-1 rounded-lg border p-2 shadow-lg transition-all duration-200 ${border} ${bg} ${opacity} ${
        selected && status === "idle" ? "border-emerald-400 shadow-emerald-900/40" : ""
      } bg-zinc-900`}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!h-2.5 !w-2.5 !rounded-full !border-2 !border-zinc-600 !bg-zinc-800 hover:!border-emerald-400"
      />

      <div className="flex items-center gap-1">
        <span className="rounded bg-emerald-900/60 px-1 py-px font-mono text-[9px] text-emerald-300 ring-1 ring-inset ring-emerald-700/40">
          {data.serverName}
        </span>

        <StatusIcon status={status} />

        <button
          type="button"
          onClick={onDelete}
          title="Delete node"
          aria-label="Delete node"
          className="ml-auto flex h-4 w-4 shrink-0 items-center justify-center rounded border border-transparent text-zinc-600 opacity-0 transition-all duration-150 hover:border-red-700 hover:bg-red-950 hover:text-red-400 group-hover:opacity-100"
        >
          <svg width={8} height={8} viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
            <path d="M2 2l6 6M8 2l-6 6" />
          </svg>
        </button>
      </div>

      <div className="font-mono text-[11px] font-semibold leading-tight text-zinc-100">
        {data.baseName}
      </div>

      <div className="text-[10px] leading-snug text-zinc-500">
        {data.description}
      </div>

      <div
        className="break-all rounded border border-zinc-800 bg-zinc-950/70 px-1.5 py-1 font-mono text-[9px] text-zinc-400"
        title={id}
      >
        {id}
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-2.5 !w-2.5 !rounded-full !border-2 !border-zinc-600 !bg-zinc-800 hover:!border-emerald-400"
      />
    </div>
  );
});
