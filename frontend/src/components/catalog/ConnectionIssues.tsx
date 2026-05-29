import type { FailedServer, SkippedServer } from "../../types";

export function ConnectionIssues({
  skipped,
  failed,
}: {
  skipped: SkippedServer[];
  failed: FailedServer[];
}) {
  if (skipped.length === 0 && failed.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {failed.length > 0 && (
        <div className="rounded-lg border border-red-900/60 bg-red-950/40 p-2.5">
          <div className="text-xs font-semibold text-red-300">
            {failed.length} server{failed.length === 1 ? "" : "s"} failed to start
          </div>
          <ul className="mt-1 flex flex-col gap-0.5">
            {failed.map((s) => (
              <li key={s.name} className="text-xs text-zinc-400">
                <span className="font-mono text-zinc-300">{s.name}</span> — {s.error}
              </li>
            ))}
          </ul>
        </div>
      )}
      {skipped.length > 0 && (
        <div className="rounded-lg border border-amber-900/60 bg-amber-950/40 p-2.5">
          <div className="text-xs font-semibold text-amber-300">
            {skipped.length} server{skipped.length === 1 ? "" : "s"} skipped
          </div>
          <ul className="mt-1 flex flex-col gap-0.5">
            {skipped.map((s) => (
              <li key={s.name} className="text-xs text-zinc-400">
                <span className="font-mono text-zinc-300">{s.name}</span> — missing env:{" "}
                {s.missingEnv.join(", ")}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
