import { useEffect, useMemo, useState } from "react";
import { parseArgsInput, SERVER_NAME_RE } from "../data/config";
import type { NewServerInput } from "../data/config";
import { KIND_CLASS, tokenizeJson } from "../lib/jsonTokens";

const FIELD_CLASS =
  "w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30";

// Guided "add one server" form. Builds a single mcpServers entry from name +
// command + args (one per line) + optional env (KEY=value per line) and hands
// it back to the caller, which merges it into the current config text. Shared
// by the homepage (before connecting) and the workspace (live, then reconnect).
export function AddServerModal({
  existingNames,
  onCancel,
  onAdd,
  ctaLabel = "Add server",
}: {
  existingNames: string[];
  onCancel: () => void;
  onAdd: (server: NewServerInput) => void;
  ctaLabel?: string;
}) {
  const [name, setName] = useState("");
  const [command, setCommand] = useState("npx");
  const [argsText, setArgsText] = useState("");
  const [envText, setEnvText] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  // Tolerant parse: one arg per line, OR a pasted JSON array. Strips stray
  // quotes/commas so args aren't captured with JSON punctuation that would get
  // escaped (\", \\) and break the server spawn.
  const args = useMemo(() => parseArgsInput(argsText), [argsText]);
  // "KEY=value" per line; a bare KEY (no "=") becomes null, matching how configs
  // mark a variable that must be supplied from the environment.
  const env = useMemo(() => {
    const out: Record<string, string | null> = {};
    for (const line of envText.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      const eq = t.indexOf("=");
      if (eq === -1) out[t] = null;
      else out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
    }
    return out;
  }, [envText]);

  const trimmedName = name.trim();
  const trimmedCommand = command.trim();
  const hasEnv = Object.keys(env).length > 0;

  const nameError =
    trimmedName.length === 0
      ? null
      : !SERVER_NAME_RE.test(trimmedName)
        ? "Start with a letter; use only letters, digits, _ and -."
        : existingNames.includes(trimmedName)
          ? `A server named "${trimmedName}" already exists.`
          : null;
  const valid = trimmedName.length > 0 && !nameError && trimmedCommand.length > 0;

  const preview = useMemo(() => {
    const entry: Record<string, unknown> = { command: trimmedCommand || "…", args };
    if (hasEnv) entry.env = env;
    return JSON.stringify({ [trimmedName || "server-name"]: entry }, null, 2);
  }, [trimmedName, trimmedCommand, args, env, hasEnv]);

  const submit = () => {
    if (!valid) return;
    onAdd({ name: trimmedName, command: trimmedCommand, args, env: hasEnv ? env : undefined });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={onCancel}>
      <div
        className="flex w-full max-w-2xl flex-col gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-sm font-semibold text-zinc-100">Add an MCP server</h2>
          <button type="button" onClick={onCancel} className="rounded-md px-2 py-1 text-sm text-zinc-400 hover:bg-zinc-800">
            Close
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-zinc-400">Name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
                placeholder="zomato-mcp"
                spellCheck={false}
                className={FIELD_CLASS}
              />
              {nameError && <span className="text-[11px] text-red-400">{nameError}</span>}
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-zinc-400">Command</span>
              <input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="npx"
                spellCheck={false}
                className={FIELD_CLASS}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="flex items-center justify-between text-xs font-medium text-zinc-400">
                Arguments <span className="font-normal text-zinc-600">one per line, or paste a JSON array</span>
              </span>
              <textarea
                value={argsText}
                onChange={(e) => setArgsText(e.target.value)}
                rows={4}
                spellCheck={false}
                placeholder={"-y\n@modelcontextprotocol/server-filesystem\n/tmp"}
                className={`${FIELD_CLASS} resize-none font-mono text-xs`}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="flex items-center justify-between text-xs font-medium text-zinc-400">
                Environment <span className="font-normal text-zinc-600">optional · KEY=value</span>
              </span>
              <textarea
                value={envText}
                onChange={(e) => setEnvText(e.target.value)}
                rows={2}
                spellCheck={false}
                placeholder={"GITHUB_TOKEN=ghp_…"}
                className={`${FIELD_CLASS} resize-none font-mono text-xs`}
              />
            </label>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-400">Preview</span>
            <pre className="m-0 max-h-[260px] flex-1 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-zinc-800 bg-zinc-950 p-3 font-mono text-xs leading-5">
              {tokenizeJson(preview).map((t, i) => (
                <span key={i} className={KIND_CLASS[t.kind]}>
                  {t.value}
                </span>
              ))}
            </pre>
            <span className="text-[11px] text-zinc-600">Merged into your config under <span className="font-mono text-zinc-500">mcpServers</span>.</span>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800">
            Cancel
          </button>
          <button type="button" disabled={!valid} onClick={submit} className="btn-primary">
            {ctaLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
