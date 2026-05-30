import { useMemo, useRef, useState } from "react";
import type { ClipboardEvent, DragEvent, MouseEvent, ReactNode } from "react";
import { useAppState } from "../state/appState";
import { validateConfig } from "../data/config";
import { CodeEditor } from "./common/CodeEditor";
import { FootballPitch } from "./home/FootballPitch";

// Pill-shaped brand badge: small glowing emerald dot + bold wordmark on a
// dark, faintly emerald-tinted background with a 1px emerald rule. Replaces
// the old icon+text mark in the nav.
function BrandPill() {
  return (
    <div className="inline-flex items-center gap-2.5 rounded-full border border-emerald-400/45 bg-emerald-950/40 px-4 py-1.5 shadow-[0_0_24px_-12px_rgba(52,211,153,0.6)] backdrop-blur-sm">
      <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.85)]" />
      <span className="font-display text-sm font-bold tracking-tight text-emerald-100">
        MCP Playground
      </span>
    </div>
  );
}

// The page now uses flat solid colours per the design spec, so the previous
// radial-gradient backdrop is gone. A very subtle dotted grid is kept as the
// only atmospheric layer — small enough that it doesn't read as decoration.
function HomeBackground() {
  return (
    <div
      className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,255,255,0.025)_1px,transparent_1px)] [background-size:28px_28px] opacity-50"
      aria-hidden="true"
    />
  );
}

function UploadGlyph() {
  return (
    <svg
      width={32}
      height={32}
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
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500/25 to-emerald-400/10 text-emerald-300 ring-1 ring-inset ring-emerald-400/25 transition-transform duration-300 ease-spring group-hover:-rotate-6 group-hover:scale-110">
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

// Pretty-print if the text is valid JSON; otherwise return null (leave as-is).
function prettyJson(text: string): string | null {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return null;
  }
}

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
  const formatted = prettyJson(draft);
  const canFormat = formatted !== null && formatted !== draft;

  // Auto-format on paste: splice the pasted text into the current selection,
  // then pretty-print the whole thing if it parses as JSON.
  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = e.clipboardData.getData("text");
    if (!pasted) return;
    e.preventDefault();
    const el = e.currentTarget;
    const start = el.selectionStart ?? draft.length;
    const end = el.selectionEnd ?? draft.length;
    const next = draft.slice(0, start) + pasted + draft.slice(end);
    setDraft(prettyJson(next) ?? next);
  };
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
          onPaste={handlePaste}
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
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            disabled={!canFormat}
            onClick={() => formatted && setDraft(formatted)}
            title="Pretty-print the JSON"
            className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:border-zinc-500 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          >
            Format JSON
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800">
              Cancel
            </button>
            <button type="button" disabled={!result.ok} onClick={() => onUse(draft)} className="btn-primary">
              Open Workspace →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function HomePage() {
  const { configText, setConfigText, connect, connStatus, connectError, goWorkspace, reset } =
    useAppState();
  const [pasteOpen, setPasteOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const hasConfig = configText.trim().length > 0;
  const result = validateConfig(configText);
  const connecting = connStatus === "connecting";

  // Pitch swaps from marketing mode (demo names + balls + badges) to a clean
  // "lineup" of the user's real servers as soon as we have a valid config.
  // Anything past the six slots becomes a "+N more" pill at midfield so
  // nothing is silently hidden.
  const pitchProps = useMemo(() => {
    if (!result.ok) return { animated: true };
    const names = result.config.servers.map((s) => s.name);
    const overflowCount = Math.max(0, names.length - 6);
    return { animated: false, names: names.slice(0, 6), overflowCount };
  }, [result]);

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

  // The dropzone is a click target itself (opens the file picker), so the
  // inline "paste JSON" affordance has to swallow the click before it bubbles
  // up to the parent. Same for keyboard activation.
  function openPaste(e: MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    setPasteOpen(true);
  }

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-[#0d1f14] text-zinc-100">
      <HomeBackground />

      {/* No nav chrome — the brand pill sits directly on the page background.
          Right-side workspace controls only appear once a connection exists,
          otherwise this row is just the brand. */}
      <div className="relative z-10 flex items-center justify-between px-6 pt-3 pb-1">
        <BrandPill />
        {connStatus === "connected" && (
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
        )}
      </div>

      <main className="relative z-10 mx-auto flex w-full max-w-4xl flex-1 flex-col gap-4 px-6 pt-2 pb-4">
        {/* Editorial tagline — widely-tracked lowercase, constant bright
            white. Rises in once on mount; no looping shine. */}
        <p className="animate-rise text-center font-sans text-[11px] font-medium uppercase tracking-[0.32em] text-white sm:text-xs">
          inspect · connect · orchestrate · run live
        </p>

        {/* Pitch + upload share a single panel. The 12-px radius and white
            hairline keep the chrome neutral so the green stays concentrated
            inside the pitch SVG itself. The upload area sits underneath the
            pitch separated only by a matching divider. */}
        <section
          style={{ animationDelay: "60ms" }}
          className="animate-rise overflow-hidden rounded-xl border border-white/[0.07] bg-[#103d24]"
        >
          <FootballPitch {...pitchProps} />

          <div className="border-t border-white/[0.07] bg-[#0f2a1b] p-4 sm:p-5">
            <div
              role="button"
              tabIndex={0}
              aria-label="Upload mcp-config.json: click to browse, drop a file, or paste JSON"
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
              className={`group flex cursor-pointer flex-col items-center gap-2.5 rounded-xl border-2 border-dashed p-5 text-center transition-all duration-300 ease-spring focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60 ${
                dragOver
                  ? "scale-[1.005] border-emerald-400 bg-emerald-500/10 shadow-lg shadow-emerald-900/40"
                  : "border-zinc-700 bg-zinc-950/50 hover:border-emerald-500/50 hover:bg-zinc-900/40"
              }`}
            >
              <div className={dragOver ? "scale-110 transition-transform" : "transition-transform duration-300 ease-spring group-hover:-translate-y-0.5"}>
                <UploadGlyph />
              </div>
              <p className="text-sm text-zinc-300">
                Drag and drop your <span className="font-mono text-emerald-300">mcp-config.json</span>,{" "}
                <span className="font-medium text-emerald-300">click to browse</span>, or{" "}
                <button
                  type="button"
                  onClick={openPaste}
                  className="font-medium text-emerald-300 underline decoration-emerald-500/60 decoration-dotted underline-offset-2 transition-colors hover:text-emerald-200 hover:decoration-emerald-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
                >
                  paste JSON
                </button>
                .
              </p>
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

            {hasConfig && (
              <div className="mt-4 flex flex-col gap-3">
                {result.ok ? (
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-900/60 bg-emerald-950/30 px-3.5 py-2.5 text-sm">
                    <span className="flex items-center gap-2 font-medium text-emerald-300">
                      <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.7)]" />
                      {result.config.servers.length} server{result.config.servers.length === 1 ? "" : "s"} ready to
                      connect
                    </span>
                    <button
                      type="button"
                      onClick={() => setConfigText("")}
                      className="rounded-md px-2 py-1 text-xs text-zinc-400 transition-colors hover:bg-zinc-800/70 hover:text-zinc-200"
                    >
                      Clear
                    </button>
                  </div>
                ) : (
                  <div className="rounded-xl border border-red-900/60 bg-red-950/30 p-3.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-sm font-semibold text-red-300">
                        <span className="inline-block h-2 w-2 rounded-full bg-red-400" />
                        {result.errors.length} issue{result.errors.length === 1 ? "" : "s"} to fix
                      </div>
                      <button
                        type="button"
                        onClick={() => setConfigText("")}
                        className="rounded-md px-2 py-1 text-xs text-zinc-400 transition-colors hover:bg-zinc-800/70 hover:text-zinc-200"
                      >
                        Clear
                      </button>
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
        </section>

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
