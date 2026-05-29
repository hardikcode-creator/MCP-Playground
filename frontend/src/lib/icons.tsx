// App iconography. BrandLogo is the product mark; ServerIcon infers a semantic
// glyph from the server name/description; ToolGlyph marks individual tools.

type ServerIconKind =
  | "folder"
  | "database"
  | "git"
  | "globe"
  | "search"
  | "map"
  | "chat"
  | "mail"
  | "server";

function pickServerIconKind(name: string, description: string): ServerIconKind {
  const h = `${name} ${description}`.toLowerCase();
  if (/(file|fs|directory|folder|disk|storage|drive)/.test(h)) return "folder";
  if (/(db|sql|postgres|mysql|sqlite|mongo|redis|database)/.test(h)) return "database";
  if (/(git|github|gitlab|repo|version)/.test(h)) return "git";
  if (/(http|web|fetch|browser|url|\bapi\b|network)/.test(h)) return "globe";
  if (/(search|brave|google|index|query)/.test(h)) return "search";
  if (/(map|geo|location|place|route)/.test(h)) return "map";
  if (/(chat|slack|discord|message|talk)/.test(h)) return "chat";
  if (/(mail|email|gmail|smtp|inbox)/.test(h)) return "mail";
  return "server";
}

export function BrandLogo({
  size = 28,
  className,
  animated = false,
}: {
  size?: number;
  className?: string;
  animated?: boolean;
}) {
  // transform-box: fill-box keeps each node scaling around its own center.
  const node = (delay: string) =>
    animated
      ? { transformBox: "fill-box" as const, transformOrigin: "center", animationDelay: delay }
      : undefined;
  const pulse = animated ? " animate-node-pulse" : "";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      role="img"
      aria-label="MCP Playground"
    >
      <rect x="1.5" y="1.5" width="29" height="29" rx="8" className="fill-zinc-900 stroke-zinc-700" strokeWidth="1.5" />
      <path
        d="M10.5 11 L15.8 19.5 M21.5 11 L16.2 19.5"
        className="stroke-zinc-700"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      {animated && (
        <path
          d="M10.5 11 L15.8 19.5 M21.5 11 L16.2 19.5"
          className="animate-dash stroke-emerald-400"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeDasharray="2 10"
        />
      )}
      <circle cx="10.5" cy="11" r="2.9" className={`fill-emerald-500${pulse}`} style={node("0s")} />
      <circle
        cx="21.5"
        cy="11"
        r="2.9"
        className={`fill-zinc-900 stroke-emerald-400${pulse}`}
        strokeWidth="1.7"
        style={node("0.45s")}
      />
      <circle
        cx="16"
        cy="21"
        r="2.9"
        className={`fill-zinc-900 stroke-zinc-400${pulse}`}
        strokeWidth="1.7"
        style={node("0.9s")}
      />
    </svg>
  );
}

export function ServerIcon({
  name,
  description = "",
  className,
}: {
  name: string;
  description?: string;
  className?: string;
}) {
  const kind = pickServerIconKind(name, description);
  const common = { stroke: "currentColor", strokeWidth: 1.2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg
      width={15}
      height={15}
      viewBox="0 0 16 16"
      fill="none"
      className={`shrink-0 text-emerald-400 ${className ?? ""}`}
      aria-hidden="true"
    >
      {kind === "folder" && <path d="M2 4.5h4l1.3 1.6H14v7H2z" {...common} />}
      {kind === "database" && (
        <>
          <ellipse cx="8" cy="4" rx="5" ry="2" {...common} />
          <path d="M3 4v8c0 1.1 2.2 2 5 2s5-.9 5-2V4" {...common} />
        </>
      )}
      {kind === "git" && (
        <>
          <circle cx="5" cy="4" r="1.6" {...common} />
          <circle cx="5" cy="12" r="1.6" {...common} />
          <circle cx="11" cy="6.5" r="1.6" {...common} />
          <path d="M5 5.6v4.8M5 8h3.4c.9 0 1.6-.7 1.6-1.6V8" {...common} />
        </>
      )}
      {kind === "globe" && (
        <>
          <circle cx="8" cy="8" r="6" {...common} />
          <path d="M2 8h12M8 2c2 1.8 2 10.2 0 12M8 2c-2 1.8-2 10.2 0 12" {...common} />
        </>
      )}
      {kind === "search" && (
        <>
          <circle cx="7" cy="7" r="4" {...common} />
          <path d="M10 10l4 4" {...common} />
        </>
      )}
      {kind === "map" && <path d="M2 4l4-1.5 4 1.5 4-1.5v9l-4 1.5-4-1.5-4 1.5zM6 2.5v9M10 4v9" {...common} />}
      {kind === "chat" && <path d="M2 3.5h12v7H7l-3 2.5V10.5H2z" {...common} />}
      {kind === "mail" && (
        <>
          <rect x="2" y="4" width="12" height="8" rx="1" {...common} />
          <path d="M2.5 5L8 9l5.5-4" {...common} />
        </>
      )}
      {kind === "server" && (
        <>
          <rect x="2" y="3" width="12" height="4" rx="1" {...common} />
          <rect x="2" y="9" width="12" height="4" rx="1" {...common} />
          <circle cx="5" cy="5" r="0.7" fill="currentColor" stroke="none" />
          <circle cx="5" cy="11" r="0.7" fill="currentColor" stroke="none" />
        </>
      )}
    </svg>
  );
}

export function ToolGlyph({ className }: { className?: string }) {
  // A wrench: reads instantly as "tool", replacing the old `fn` glyph.
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 text-emerald-400 ${className ?? ""}`}
      aria-hidden="true"
    >
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

export function Chevron({ dir = "left", className }: { dir?: "left" | "right"; className?: string }) {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className ?? ""}`}
      aria-hidden="true"
    >
      <path d={dir === "left" ? "M10 4 6 8 10 12" : "M6 4 10 8 6 12"} />
    </svg>
  );
}
