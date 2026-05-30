import { useEffect } from "react";
import type { JsonSchema } from "../../types";
import { validateArgs } from "../../lib/schema";
import { CodeEditor } from "../common/CodeEditor";

function isParseableJson(text: string): boolean {
  if (text.trim().length === 0) return false;
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

// A roomy pop-out editor for a tool's arguments as JSON, validated live against
// the tool's inputSchema. It is *live-bound*: edits call onChange (setArgsText)
// directly, so the Params form and Raw editor reflect them on the fly — there
// is no separate draft or Apply step. Mirrors the homepage PasteModal.
export function ArgsJsonDialog({
  schema,
  value,
  onChange,
  onClose,
  title = "Edit arguments as JSON",
}: {
  schema: JsonSchema;
  value: string;
  onChange: (text: string) => void;
  onClose: () => void;
  title?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const v = validateArgs(schema, value);
  const canFormat = isParseableJson(value);

  const format = () => {
    try {
      onChange(JSON.stringify(JSON.parse(value.trim() || "{}"), null, 2));
    } catch {
      // Not parseable — Format is disabled in this state, so this is unreachable.
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
          <h2 className="font-display text-sm font-semibold text-zinc-100">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-zinc-400 hover:bg-zinc-800"
          >
            Close
          </button>
        </div>

        <p className="text-xs text-zinc-500">
          Edits apply instantly — the Params form and Raw view stay in sync as you type.
        </p>

        <CodeEditor
          value={value}
          onChange={onChange}
          autoFocus
          ariaLabel="Edit arguments as JSON"
          minHeight={320}
          placeholder={'{\n  "key": "value"\n}'}
        />

        {v.ok ? (
          <p className="flex items-center gap-1.5 text-xs text-emerald-400">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Arguments are valid and match the schema.
          </p>
        ) : (
          <ul className="flex max-h-28 flex-col gap-1 overflow-y-auto">
            {v.errors.map((e, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs text-red-400">
                <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" />
                <span>
                  <span className="font-mono text-zinc-500">{e.path}</span> {e.message}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={format}
            disabled={!canFormat}
            className="btn-ghost disabled:cursor-not-allowed disabled:opacity-40"
          >
            Format
          </button>
          <button type="button" onClick={onClose} className="btn-primary">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
