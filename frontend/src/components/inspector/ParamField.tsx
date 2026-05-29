import type { ParamRow } from "../../lib/schema";

const inputCls =
  "w-full rounded-md border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none";

// A single typed control. Cleared inputs keep their key (empty string for
// text/enum, null for number) so the args object stays stable and in schema
// order instead of losing fields when emptied.
export function ParamField({
  def,
  value,
  onChange,
}: {
  def: ParamRow;
  value: unknown;
  onChange: (next: unknown) => void;
}) {
  if (def.enum && def.enum.length > 0) {
    return (
      <select
        className={inputCls}
        value={value == null ? "" : String(value)}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Select…</option>
        {def.enum.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    );
  }

  if (def.type === "boolean") {
    return (
      <label className="inline-flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          className="h-4 w-4 accent-emerald-500"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="font-mono text-xs text-zinc-400">{value === true ? "true" : "false"}</span>
      </label>
    );
  }

  if (def.type === "number" || def.type === "integer") {
    return (
      <input
        type="number"
        className={inputCls}
        value={value == null ? "" : String(value)}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        placeholder="0"
      />
    );
  }

  if (def.type === "object" || def.type === "array") {
    const text =
      typeof value === "string" ? value : JSON.stringify(value ?? (def.type === "array" ? [] : {}));
    return (
      <textarea
        rows={3}
        className={`${inputCls} font-mono`}
        value={text}
        onChange={(e) => {
          try {
            onChange(JSON.parse(e.target.value));
          } catch {
            onChange(e.target.value);
          }
        }}
      />
    );
  }

  return (
    <input
      className={inputCls}
      value={value == null ? "" : String(value)}
      onChange={(e) => onChange(e.target.value)}
      placeholder="text"
    />
  );
}
