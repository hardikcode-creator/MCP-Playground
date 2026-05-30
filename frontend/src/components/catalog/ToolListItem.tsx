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
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("application/mcp-tool", tool.qualifiedName);
        e.dataTransfer.effectAllowed = "copy";
      }}
      className={`group w-full cursor-grab rounded-md border-l-2 px-2 py-1.5 text-left transition-all duration-150 ease-spring active:cursor-grabbing ${
        selected
          ? "border-emerald-400 bg-gradient-to-r from-emerald-500/15 to-transparent"
          : "border-transparent hover:translate-x-0.5 hover:bg-zinc-800/40"
      }`}
    >
      <div className="flex items-center gap-1.5">
        <ToolGlyph className="group-hover:animate-wiggle" />
        <span className={`font-mono text-[12.5px] ${selected ? "text-emerald-300" : "text-zinc-100"}`}>
          {tool.baseName}
        </span>
      </div>
      <div className="truncate pl-[22px] text-xs text-zinc-500">{tool.description}</div>
    </button>
  );
}
