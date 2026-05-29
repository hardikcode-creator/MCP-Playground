// Pane 2 (the workflow canvas). It reads from the same AppState as Panes 1 and
// 3, so the real graph engine can drop in here without touching them.

// Faint node-graph motif: static edges with travelling "packets" + nodes.
function NodeGraphMotif() {
  return (
    <svg width={236} height={150} viewBox="0 0 236 150" fill="none" aria-hidden="true">
      <g className="stroke-zinc-700" strokeWidth="1.5">
        <path d="M40 42 L118 75" />
        <path d="M196 42 L118 75" />
        <path d="M118 75 L118 124" />
      </g>
      <g className="animate-dash stroke-emerald-500/70" strokeWidth="1.6" strokeDasharray="3 9" fill="none">
        <path d="M40 42 L118 75" />
        <path d="M196 42 L118 75" />
        <path d="M118 75 L118 124" />
      </g>
      <g strokeWidth="1.5">
        <rect x="22" y="30" width="36" height="24" rx="6" className="fill-zinc-900 stroke-zinc-700" />
        <rect x="178" y="30" width="36" height="24" rx="6" className="fill-zinc-900 stroke-zinc-700" />
        <rect x="100" y="63" width="36" height="24" rx="6" className="fill-zinc-900 stroke-emerald-600" />
        <rect x="100" y="112" width="36" height="24" rx="6" className="fill-zinc-900 stroke-zinc-700" />
      </g>
    </svg>
  );
}

export function WorkflowCanvasPane() {
  return (
    <section className="flex h-full flex-col bg-zinc-950">
      <header className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Workflow Canvas</span>
        <span className="rounded-full border border-zinc-800 px-2 py-0.5 font-mono text-[10px] text-zinc-600">
          preview
        </span>
      </header>

      <div className="flex flex-1 items-center justify-center bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.025)_1px,transparent_1px)] [background-size:22px_22px] p-6">
        <div className="flex max-w-xs flex-col items-center gap-5 text-center">
          <div className="animate-float opacity-90">
            <NodeGraphMotif />
          </div>
          <div className="flex flex-col gap-1.5">
            <h2 className="font-display text-base font-semibold tracking-tight text-zinc-200">Workflow canvas</h2>
            <p className="text-sm leading-relaxed text-zinc-500">
              Chain tool calls into reusable workflows. Coming soon.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
