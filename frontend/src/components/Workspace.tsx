import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { useAppState } from "../state/appState";
import { addServerToConfigText, readServerNames } from "../data/config";
import type { NewServerInput } from "../data/config";
import { BrandLogo, Chevron, Home } from "../lib/icons";
import { ServerCatalogPane } from "./catalog/ServerCatalogPane";
import { ToolInspectorPane } from "./inspector/ToolInspectorPane";
import { WorkflowCanvasPane } from "./WorkflowCanvasPane";
import { AddServerModal } from "./AddServerModal";
import { useWorkflowStore } from "../state/workflowStore";

function PlusIcon() {
  return (
    <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

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

// Side-pane resize limits (px) and persistence keys.
const LEFT_MIN = 220;
const LEFT_MAX = 560;
const LEFT_DEFAULT = 288;
const RIGHT_MIN = 300;
const RIGHT_MAX = 720;
const RIGHT_DEFAULT = 384;
const LS_LEFT = "mcp.catalogWidth";
const LS_RIGHT = "mcp.inspectorWidth";

const clampWidth = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

function readStoredWidth(key: string, fallback: number, min: number, max: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const n = Number(raw);
      if (Number.isFinite(n)) return clampWidth(n, min, max);
    }
  } catch {
    // localStorage unavailable (private mode etc.) — fall back to default.
  }
  return fallback;
}

// Draggable vertical splitter between a side pane and the canvas. The visible
// line only appears on hover/drag so the pane's own border stays the resting
// divider. Double-click resets to the default width.
function ResizeHandle({
  side,
  active,
  onStartDrag,
  onReset,
}: {
  side: "left" | "right";
  active: boolean;
  onStartDrag: (side: "left" | "right", e: ReactMouseEvent) => void;
  onReset: () => void;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      title="Drag to resize · double-click to reset"
      onMouseDown={(e) => onStartDrag(side, e)}
      onDoubleClick={onReset}
      className="group relative z-10 w-1.5 shrink-0 cursor-col-resize"
    >
      <span
        className={`pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 transition-colors ${
          active ? "bg-emerald-400" : "bg-transparent group-hover:bg-emerald-500/70"
        }`}
      />
    </div>
  );
}

export function Workspace() {
  const {
    config,
    connectedCount,
    catalog,
    failed,
    skipped,
    goHome,
    selectWorkflowNode,
    configText,
    setConfigText,
    connect,
    connStatus,
  } = useAppState();
  const workflow = useWorkflowStore();
  const total = config?.servers.length ?? 0;
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const existingNames = useMemo(() => readServerNames(configText), [configText]);
  const connecting = connStatus === "connecting";

  // Resizable side panes (drag the splitter between a pane and the canvas).
  const [leftWidth, setLeftWidth] = useState(() => readStoredWidth(LS_LEFT, LEFT_DEFAULT, LEFT_MIN, LEFT_MAX));
  const [rightWidth, setRightWidth] = useState(() => readStoredWidth(LS_RIGHT, RIGHT_DEFAULT, RIGHT_MIN, RIGHT_MAX));
  const [drag, setDrag] = useState<null | "left" | "right">(null);
  const dragRef = useRef({ startX: 0, startW: 0 });

  useEffect(() => {
    try {
      localStorage.setItem(LS_LEFT, String(leftWidth));
    } catch {
      // ignore persistence failures
    }
  }, [leftWidth]);
  useEffect(() => {
    try {
      localStorage.setItem(LS_RIGHT, String(rightWidth));
    } catch {
      // ignore persistence failures
    }
  }, [rightWidth]);

  const beginDrag = (side: "left" | "right", e: ReactMouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startW: side === "left" ? leftWidth : rightWidth };
    setDrag(side);
  };
  const onDragMove = (e: ReactMouseEvent) => {
    if (!drag) return;
    const dx = e.clientX - dragRef.current.startX;
    if (drag === "left") setLeftWidth(clampWidth(dragRef.current.startW + dx, LEFT_MIN, LEFT_MAX));
    else setRightWidth(clampWidth(dragRef.current.startW - dx, RIGHT_MIN, RIGHT_MAX));
  };
  const endDrag = () => setDrag(null);

  // Add a server live: merge it into the config and reconnect so the new
  // server's tools join the catalog (the engine connects the whole config).
  function addServer(server: NewServerInput) {
    const next = addServerToConfigText(configText, server);
    setConfigText(next);
    setAddOpen(false);
    void connect(next);
  }

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
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            disabled={connecting}
            title="Add an MCP server and reconnect"
            className="btn-ghost px-2.5 py-1.5 text-xs disabled:cursor-not-allowed disabled:opacity-50"
          >
            <PlusIcon />
            {connecting ? "Connecting…" : "Add server"}
          </button>
          <button type="button" onClick={goHome} title="Home" className="btn-ghost px-2.5 py-1.5 text-xs">
            <Home />
            Home
          </button>
        </div>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {leftOpen ? (
          <>
            <div style={{ width: leftWidth }} className="shrink-0">
              <ServerCatalogPane onCollapse={() => setLeftOpen(false)} />
            </div>
            <ResizeHandle
              side="left"
              active={drag === "left"}
              onStartDrag={beginDrag}
              onReset={() => setLeftWidth(LEFT_DEFAULT)}
            />
          </>
        ) : (
          <Rail label="Catalog" side="left" onExpand={() => setLeftOpen(true)} />
        )}

        <div className="min-w-0 flex-1">
          <WorkflowCanvasPane
            workflow={workflow}
            onSelectWorkflowNode={selectWorkflowNode}
            onOpenInspector={() => setRightOpen(true)}
          />
        </div>

        {rightOpen ? (
          <>
            <ResizeHandle
              side="right"
              active={drag === "right"}
              onStartDrag={beginDrag}
              onReset={() => setRightWidth(RIGHT_DEFAULT)}
            />
            <div style={{ width: rightWidth }} className="shrink-0">
              <ToolInspectorPane workflow={workflow} onCollapse={() => setRightOpen(false)} />
            </div>
          </>
        ) : (
          <Rail label="Inspector" side="right" onExpand={() => setRightOpen(true)} />
        )}

        {/* Full-screen capture layer so dragging keeps working over the canvas. */}
        {drag && (
          <div
            className="fixed inset-0 z-50 cursor-col-resize select-none"
            onMouseMove={onDragMove}
            onMouseUp={endDrag}
            onMouseLeave={endDrag}
          />
        )}
      </div>

      {addOpen && (
        <AddServerModal
          existingNames={existingNames}
          ctaLabel="Add & reconnect"
          onCancel={() => setAddOpen(false)}
          onAdd={addServer}
        />
      )}
    </div>
  );
}
