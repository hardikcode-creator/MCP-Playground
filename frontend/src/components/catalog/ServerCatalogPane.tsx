import { useMemo, useState } from "react";
import { useAppState } from "../../state/appState";
import { Chevron } from "../../lib/icons";
import { ConnectionIssues } from "./ConnectionIssues";
import { ServerGroup } from "./ServerGroup";

export function ServerCatalogPane({ onCollapse }: { onCollapse?: () => void }) {
  const { catalog, skipped, failed, selectedTool, selectTool } = useAppState();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!q) return catalog;
    return catalog.filter(
      (t) =>
        t.baseName.toLowerCase().includes(q) ||
        t.qualifiedName.toLowerCase().includes(q) ||
        t.serverName.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q),
    );
  }, [catalog, q]);

  const servers = useMemo(() => [...new Set(filtered.map((t) => t.serverName))], [filtered]);

  return (
    <section className="flex h-full flex-col border-r border-zinc-800 bg-zinc-900">
      <header className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Catalog</span>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-zinc-500">
            {catalog.length} tool{catalog.length === 1 ? "" : "s"}
          </span>
          {onCollapse && (
            <button
              type="button"
              onClick={onCollapse}
              title="Collapse panel"
              aria-label="Collapse catalog"
              className="rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
            >
              <Chevron dir="left" />
            </button>
          )}
        </div>
      </header>

      <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter tools…"
          className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500 focus:outline-none"
        />

        <ConnectionIssues skipped={skipped} failed={failed} />

        {catalog.length === 0 ? (
          <p className="text-xs text-zinc-500">
            No servers connected — check the notes above or change your config.
          </p>
        ) : servers.length === 0 ? (
          <p className="text-xs text-zinc-500">No tools match “{query}”.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {servers.map((s) => (
              <ServerGroup
                key={s}
                server={s}
                tools={filtered.filter((t) => t.serverName === s)}
                selectedTool={selectedTool}
                onSelect={selectTool}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
