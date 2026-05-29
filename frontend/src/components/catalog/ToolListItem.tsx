import type { ToolDescriptor } from "../../types";
import { ToolGlyph } from "../../lib/icons";

export function ToolListItem({
  tool,
  selected,
  onSelect,
}: {
  tool: ToolDescriptor;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-md border-l-2 px-2 py-1.5 text-left transition-colors ${
        selected ? "border-emerald-500 bg-zinc-800/70" : "border-transparent hover:bg-zinc-800/40"
      }`}
    >
      <div className="flex items-center gap-1.5">
        <ToolGlyph />
        <span className={`font-mono text-[12.5px] ${selected ? "text-emerald-300" : "text-zinc-100"}`}>
          {tool.baseName}
        </span>
      </div>
      <div className="truncate pl-[22px] text-xs text-zinc-500">{tool.description}</div>
    </button>
  );
}
