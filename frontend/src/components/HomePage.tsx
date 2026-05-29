import { useRef, useState } from "react";
import type { DragEvent, ReactNode } from "react";
import { useAppState } from "../state/appState";
import { validateConfig } from "../data/config";
import { BrandLogo } from "../lib/icons";
import { CodeEditor } from "./common/CodeEditor";

// Decorative, non-interactive backdrop: drifting emerald/cyan/lime glow + dotted grid.
function HomeBackground() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:26px_26px] opacity-50" />
      <div className="animate-drift absolute -top-44 left-1/2 h-[34rem] w-[34rem] -translate-x-1/2 rounded-full bg-emerald-500/20 blur-3xl" />
      <div className="animate-drift absolute -left-32 top-1/3 h-80 w-80 rounded-full bg-cyan-500/15 blur-3xl" />
      <div className="animate-drift absolute bottom-[-12rem] right-[-8rem] h-96 w-96 rounded-full bg-lime-500/10 blur-3xl" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-emerald-500/40 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-zinc-950 to-transparent" />
    </div>
  );
}

function UploadGlyph() {
  return (
    <svg
      width={36}
      height={36}
      viewBox="0 0 48 48"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-emerald-300"
      aria-hidden="true"
    >
      <path d="M24 30V8M15 17l9-9 9 9" />
      <path d="M8 30v6a4 4 0 0 0 4 4h24a4 4 0 0 0 4-4v-6" />
    </svg>
  );
}

function Feature({ icon, title, desc }: { icon: ReactNode; title: string; desc: string }) {
  return (
    <div className="group flex flex-col items-start gap-2 rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-4 text-left transition-all duration-200 ease-spring hover:-translate-y-0.5 hover:border-emerald-500/40 hover:bg-zinc-900/70">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500/20 to-cyan-500/20 text-emerald-300 ring-1 ring-inset ring-emerald-400/25 transition-transform duration-300 ease-spring group-hover:-rotate-6 group-hover:scale-110">
        {icon}
      </div>
      <div className="font-display text-sm font-semibold text-zinc-100">{title}</div>
      <div className="text-xs leading-relaxed text-zinc-500">{desc}</div>
    </div>
  );
}

const FEATURE_ICON = "shrink-0";
const FEATURES = [
  {
    title: "Connect",
    desc: "List your servers once and they all launch together in a single click.",
    icon: (
      <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={FEATURE_ICON}>
        <path d="M9 17H7A5 5 0 0 1 7 7h2M15 7h2a5 5 0 0 1 0 10h-2M8 12h8" />
      </svg>
    ),
  },
  {
    title: "Inspect",
    desc: "Every tool's input schema becomes a typed form automatically, so you always know what a call expects.",
    icon: (
      <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={FEATURE_ICON}>
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.3-4.3" />
      </svg>
    ),
  },
  {
    title: "Run",
    desc: "Send real calls to any tool and read the raw response instantly - no glue code required.",
    icon: (
      <svg width={18} height={18} viewBox="0 0 24 24" fill="currentColor" className={FEATURE_ICON}>
        <path d="M8 5.14c0-.86.96-1.37 1.67-.88l9.2 6.86a1.06 1.06 0 0 1 0 1.76l-9.2 6.86c-.71.49-1.67-.02-1.67-.88z" />
      </svg>
    ),
  },
];

function PasteModal({
  initial,
  onCancel,
  onUse,
}: {
  initial: string;
  onCancel: () => void;
  onUse: (text: string) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const result = validateConfig(draft);
  const hasText = draft.trim().length > 0;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onCancel}>
      <div
        className="flex w-full max-w-2xl flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-sm font-semibold text-zinc-100">Paste mcp-config.json</h2>
          <button type="button" onClick={onCancel} className="rounded-md px-2 py-1 text-sm text-zinc-400 hover:bg-zinc-800">
            Close
          </button>
        </div>
        <CodeEditor
          value={draft}
          onChange={setDraft}
          autoFocus
          ariaLabel="Paste mcp-config.json"
          minHeight={288}
          placeholder={'{\n  "servers": [\n    { "name": "filesystem", "command": "npx", "args": ["..."] }\n  ]\n}'}
        />
        {hasText &&
          (result.ok ? (
            <p className="flex items-center gap-1.5 text-xs text-emerald-400">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
              {result.config.servers.length} server{result.config.servers.length === 1 ? "" : "s"} ready to connect.
            </p>
          ) : (
            <p className="flex items-center gap-1.5 text-xs text-red-400">
              <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" />
              <span>
                <span className="font-mono text-zinc-500">{result.errors[0].path}</span> {result.errors[0].message}
              </span>
            </p>
          ))}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800">
            Cancel
          </button>
          <button type="button" disabled={!result.ok} onClick={() => onUse(draft)} className="btn-primary">
            Open Workspace →
          </button>
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  const { configText, setConfigText, connect, connStatus, connectError, loadExample, goWorkspace, reset } =
    useAppState();
  const [pasteOpen, setPasteOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const hasConfig = configText.trim().length > 0;
  const result = validateConfig(configText);
  const connecting = connStatus === "connecting";

  function readFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => setConfigText(String(reader.result ?? ""));
    reader.readAsText(file);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) readFile(file);
  }

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-zinc-950 text-zinc-100">
      <HomeBackground />

      <nav className="relative z-10 flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2">
          <BrandLogo size={24} />
          <span className="font-display text-sm font-semibold tracking-tight">MCP Playground</span>
        </div>
        {connStatus === "connected" ? (
          <div className="flex items-center gap-2">
            <button type="button" onClick={goWorkspace} className="btn-primary px-3 py-1.5 text-xs">
              Back to workspace →
            </button>
            <button
              type="button"
              onClick={reset}
              className="rounded-lg px-2.5 py-1.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            >
              Start over
            </button>
          </div>
        ) : (
          <span className="rounded-full border border-zinc-800 bg-zinc-900/60 px-2.5 py-1 font-mono text-[11px] text-zinc-500">
            Local preview · mock data
          </span>
        )}
      </nav>

      <main className="relative z-10 mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center gap-10 px-6 py-10">
        <header className="flex animate-rise flex-col items-center gap-6 text-center">
          <div className="relative">
            <div className="animate-pulse-glow absolute -inset-3 rounded-3xl bg-gradient-to-br from-emerald-500/30 via-cyan-500/20 to-lime-500/20 blur-2xl" />
            <div className="animate-float relative rounded-2xl bg-gradient-to-br from-emerald-400/60 via-cyan-400/40 to-lime-300/40 p-[1.5px] shadow-xl shadow-emerald-950/40">
              <div className="rounded-2xl bg-zinc-900/90 p-3 backdrop-blur">
                <BrandLogo size={56} animated />
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <h1 className="text-grad font-display text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl">
              Every MCP tool,
              <br />
              one playground.
            </h1>
            <p className="mx-auto max-w-xl text-[15px] leading-relaxed text-zinc-400">
              Point MCP Playground at a single config file and it connects every server you list. From there you can
              browse each tool, inspect its inputs, and run it live - without writing any code.
            </p>
          </div>
        </header>

        <div
          style={{ animationDelay: "80ms" }}
          className="animate-rise rounded-2xl bg-gradient-to-br from-emerald-500/30 via-zinc-700/30 to-cyan-500/30 p-px shadow-2xl shadow-black/40"
        >
          <div className="flex flex-col gap-4 rounded-2xl bg-zinc-900/70 p-5 backdrop-blur-md sm:p-6">
            <div
              role="button"
              tabIndex={0}
              aria-label="Upload mcp-config.json: click to browse, or drop a file here"
              onClick={() => fileRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  fileRef.current?.click();
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
              }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className={`group flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed p-8 text-center transition-all duration-300 ease-spring focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${
                dragOver
                  ? "scale-[1.01] border-emerald-400 bg-emerald-500/10 shadow-lg shadow-emerald-900/40"
                  : "border-zinc-700 bg-zinc-950/40 hover:border-emerald-500/50 hover:bg-zinc-900/40"
              }`}
            >
              <div className={dragOver ? "scale-110 transition-transform" : "transition-transform duration-300 ease-spring group-hover:-translate-y-1"}>
                <UploadGlyph />
              </div>
              <p className="text-sm text-zinc-300">
                Drag and drop your mcp-config.json here, or{" "}
                <span className="font-medium text-emerald-300">click to browse</span>.
              </p>
              <p className="font-mono text-xs text-zinc-500">Expects a JSON file with a top-level "servers" array.</p>
              <input
                ref={fileRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) readFile(file);
                  e.target.value = "";
                }}
              />
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2">
              <button type="button" onClick={() => setPasteOpen(true)} className="btn-ghost">
                Paste JSON
              </button>
              <button type="button" onClick={loadExample} className="btn-ghost">
                Load example
              </button>
              {hasConfig && (
                <button
                  type="button"
                  onClick={() => setConfigText("")}
                  className="rounded-xl px-3 py-2 text-sm text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
                >
                  Clear
                </button>
              )}
            </div>

            {hasConfig && (
              <div className="flex flex-col gap-3 border-t border-zinc-800 pt-4">
                {result.ok ? (
                  <div className="rounded-xl border border-emerald-900/60 bg-emerald-950/30 p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-emerald-300">
                      <span className="inline-block h-2 w-2 rounded-full bg-emerald-400" />
                      {result.config.servers.length} server{result.config.servers.length === 1 ? "" : "s"} ready to
                      connect
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {result.config.servers.map((s) => (
                        <span key={s.name} className="rounded bg-zinc-800 px-2 py-0.5 font-mono text-xs text-zinc-300">
                          {s.name}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-red-900/60 bg-red-950/30 p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-red-300">
                      <span className="inline-block h-2 w-2 rounded-full bg-red-400" />
                      {result.errors.length} issue{result.errors.length === 1 ? "" : "s"} to fix
                    </div>
                    <ul className="mt-2 flex flex-col gap-1">
                      {result.errors.map((err, i) => (
                        <li key={i} className="text-xs text-zinc-400">
                          <span className="font-mono text-zinc-500">{err.path}</span> - {err.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <button
                  type="button"
                  disabled={!result.ok || connecting}
                  onClick={() => {
                    void connect();
                  }}
                  className="btn-primary w-full justify-center py-3 text-base"
                >
                  {connecting ? "Connecting…" : "Open Workspace →"}
                </button>
                {connStatus === "error" && connectError && (
                  <p className="text-center text-xs text-red-400">{connectError}</p>
                )}
              </div>
            )}
          </div>
        </div>

        <div style={{ animationDelay: "160ms" }} className="grid animate-rise grid-cols-1 gap-3 sm:grid-cols-3">
          {FEATURES.map((f) => (
            <Feature key={f.title} icon={f.icon} title={f.title} desc={f.desc} />
          ))}
        </div>
      </main>

      <footer className="relative z-10 px-6 pb-6 text-center">
        <p className="font-mono text-[11px] text-zinc-600">
          Everything runs against the MCP servers on your own machine, so nothing ever leaves it.
        </p>
      </footer>

      {pasteOpen && (
        <PasteModal
          initial={configText}
          onCancel={() => setPasteOpen(false)}
          onUse={(text) => {
            setConfigText(text);
            setPasteOpen(false);
            void connect(text);
          }}
        />
      )}
    </div>
  );
}
