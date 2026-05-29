import type { ToolDescriptor } from "../../types";
import { ServerIcon } from "../../lib/icons";
import { ToolListItem } from "./ToolListItem";

export function ServerGroup({
  server,
  tools,
  selectedTool,
  onSelect,
}: {
  server: string;
  tools: ToolDescriptor[];
  selectedTool: string | null;
  onSelect: (qualifiedName: string) => void;
}) {
  const blurb = tools.map((t) => t.description).join(" ");
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <ServerIcon name={server} description={blurb} />
        <span className="font-display text-sm font-semibold text-zinc-200">{server}</span>
        <span className="ml-auto text-xs text-zinc-500">
          {tools.length} tool{tools.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        {tools.map((t) => (
          <ToolListItem
            key={t.qualifiedName}
            tool={t}
            selected={selectedTool === t.qualifiedName}
            onSelect={() => onSelect(t.qualifiedName)}
          />
        ))}
      </div>
    </div>
  );
}
