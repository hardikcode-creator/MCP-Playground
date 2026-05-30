import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, ClipboardEvent } from "react";
import type { Edge, Node } from "@xyflow/react";
import type { ToolDescriptor } from "../../types";
import type { ToolNodeData } from "../../state/workflowStore";
import { deserializeWorkflow } from "../../lib/workflow/serialize";
import { formatJson } from "../../lib/jsonTokens";
import { CodeEditor } from "../common/CodeEditor";

// Paste (or load) a saved workflow JSON and drop it onto the canvas. The JSON
// is the same shape produced by "Export JSON" / the backend Workflow contract.
export function ImportWorkflowModal({
  catalog,
  hasExisting,
  onImport,
  onClose,
}: {
  catalog: ToolDescriptor[];
  hasExisting: boolean;
  onImport: (nodes: Node<ToolNodeData>[], edges: Edge[]) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const result = useMemo(
    () => (text.trim().length > 0 ? deserializeWorkflow(text, catalog) : null),
    [text, catalog],
  );

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const content = typeof reader.result === "string" ? reader.result : "";
      setText(formatJson(content) ?? content);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  // Auto-format pasted JSON, mirroring the homepage config paste box.
  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = e.clipboardData.getData("text");
    if (!pasted) return;
    e.preventDefault();
    const el = e.currentTarget;
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const next = text.slice(0, start) + pasted + text.slice(end);
    setText(formatJson(next) ?? next);
  };

  const doImport = () => {
    if (result?.ok) {
      onImport(result.nodes, result.edges);
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-2xl flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-sm font-semibold text-zinc-100">Import workflow JSON</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-zinc-400 hover:bg-zinc-800"
          >
            Close
          </button>
        </div>

        <p className="text-xs text-zinc-500">
          Paste a saved workflow (the shape produced by{" "}
          <span className="font-mono text-zinc-400">Export JSON</span>) or load a{" "}
          <span className="font-mono text-zinc-400">.json</span> file. Nodes are auto-arranged from
          their <span className="font-mono text-zinc-400">dependsOn</span> links.
        </p>

        <CodeEditor
          value={text}
          onChange={setText}
          onPaste={handlePaste}
          autoFocus
          ariaLabel="Workflow JSON"
          minHeight={300}
          placeholder={'{\n  "version": 1,\n  "nodes": [\n    { "id": "n1", "tool": "server__tool", "args": {}, "dependsOn": [] }\n  ]\n}'}
        />

        {result &&
          (result.ok ? (
            <div className="flex flex-col gap-1">
              <p className="flex items-center gap-1.5 text-xs text-emerald-400">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
                Ready to import {result.nodes.length} node{result.nodes.length === 1 ? "" : "s"} ·{" "}
                {result.edges.length} link{result.edges.length === 1 ? "" : "s"}.
              </p>
              {result.warnings.map((w, i) => (
                <p key={i} className="flex items-start gap-1.5 text-[11px] text-amber-400">
                  <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                  <span>{w}</span>
                </p>
              ))}
            </div>
          ) : (
            <ul className="flex max-h-28 flex-col gap-1 overflow-y-auto">
              {result.errors.map((e, i) => (
                <li key={i} className="flex items-start gap-1.5 text-xs text-red-400">
                  <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" />
                  <span>{e}</span>
                </li>
              ))}
            </ul>
          ))}

        {hasExisting && (
          <p className="text-[11px] text-amber-300/80">Importing replaces the current canvas.</p>
        )}

        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={() => fileRef.current?.click()} className="btn-ghost">
            Load .json file
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={onFile}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button type="button" disabled={!result?.ok} onClick={doImport} className="btn-primary">
              Import
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
