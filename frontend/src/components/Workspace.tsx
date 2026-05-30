import { useState } from "react";
import type { ReactNode } from "react";
import { useAppState } from "../state/appState";
import { BrandLogo, Chevron, Home } from "../lib/icons";
import { ServerCatalogPane } from "./catalog/ServerCatalogPane";
import { ToolInspectorPane } from "./inspector/ToolInspectorPane";
import { WorkflowCanvasPane } from "./WorkflowCanvasPane";

function StatusPill({ dot, children }: { dot: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-950/60 px-2 py-0.5 font-mono text-[11px] text-zinc-400">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {children}
    </span>
  );
}

// Thin collapsed-state rail with an expand control + vertical label.
function Rail({ label, side, onExpand }: { label: string; side: "left" | "right"; onExpand: () => void }) {
  return (
    <div
      className={`flex h-full w-9 shrink-0 flex-col items-center gap-3 bg-zinc-900 py-2 ${
        side === "left" ? "border-r" : "border-l"
      } border-zinc-800`}
    >
      <button
        type="button"
        onClick={onExpand}
        title={`Expand ${label}`}
        aria-label={`Expand ${label}`}
        className="rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-100"
      >
        <Chevron dir={side === "left" ? "right" : "left"} />
      </button>
      <span className="select-none text-[10px] font-semibold uppercase tracking-widest text-zinc-500 [writing-mode:vertical-rl]">
        {label}
      </span>
    </div>
  );
}

export function Workspace() {
  const { config, connectedCount, catalog, failed, skipped, goHome } = useAppState();
  const total = config?.servers.length ?? 0;
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100">
      <header className="flex items-center gap-3 border-b border-zinc-800 bg-zinc-900 px-3 py-2">
        <button
          type="button"
          onClick={goHome}
          title="Back to home"
          aria-label="Back to home"
          className="-ml-1 flex items-center gap-2 rounded-lg px-1.5 py-1 transition-colors hover:bg-zinc-800/70"
        >
          <BrandLogo size={22} />
          <span className="text-grad font-display text-sm font-bold tracking-tight">MCP Playground</span>
        </button>

        <div className="ml-1 flex flex-wrap items-center gap-1.5">
          <StatusPill dot={total > 0 && connectedCount === total ? "bg-emerald-400" : "bg-amber-400"}>
            {connectedCount}/{total} servers
          </StatusPill>
          <StatusPill dot="bg-emerald-400">{catalog.length} tools</StatusPill>
          {failed.length > 0 && <StatusPill dot="bg-red-400">{failed.length} failed</StatusPill>}
          {skipped.length > 0 && <StatusPill dot="bg-amber-400">{skipped.length} skipped</StatusPill>}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <button type="button" onClick={goHome} title="Home" className="btn-ghost px-2.5 py-1.5 text-xs">
            <Home />
            Home
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {leftOpen ? (
          <div className="w-72 shrink-0 transition-all duration-200">
            <ServerCatalogPane onCollapse={() => setLeftOpen(false)} />
          </div>
        ) : (
          <Rail label="Catalog" side="left" onExpand={() => setLeftOpen(true)} />
        )}

        <div className="min-w-0 flex-1">
          <WorkflowCanvasPane />
        </div>

        {rightOpen ? (
          <div className="w-96 shrink-0 transition-all duration-200">
            <ToolInspectorPane onCollapse={() => setRightOpen(false)} />
          </div>
        ) : (
          <Rail label="Inspector" side="right" onExpand={() => setRightOpen(true)} />
        )}
      </div>
    </div>
  );
}
