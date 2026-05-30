// The home-page hero. A stylised top-down soccer pitch with six "player" chips
// that double as MCP-server labels.
//
//   - In **demo mode** (no config uploaded) the chips show suggestive server
//     names, dashed passing arrows connect them, soccer balls slide along the
//     arrows (one per arrow, looping pitch→pitch) and a few result badges
//     ("200 OK", "rows: 42", …) float on the passes to hint at real workflow
//     output. This is the marketing illustration the visitor sees first.
//
//   - Once a config is parsed, the same pitch is reused but stripped down:
//     no arrows, no balls, no badges. The chips now display the user's actual
//     server names. Extras beyond six are surfaced as a "+N more" pill at
//     midfield so nothing is silently hidden.
//
// All positions live in a single `SLOTS` table (viewBox 800×400) and the
// label overlay is HTML positioned in percent over the SVG, so chips can
// truncate / wrap without fighting SVG text metrics.

const VIEW_W = 800;
const VIEW_H = 340;

// Slot positions chosen for the 800×340 viewBox — kept clear of the centre
// circle and the two penalty boxes so chips don't visually overlap the field
// markings. The shorter pitch height means the home page fits above the fold
// without the feature cards getting clipped.
const SLOTS: ReadonlyArray<{ x: number; y: number }> = [
  { x: 180, y: 95 }, // upper-left wing
  { x: 560, y: 95 }, // upper-right wing
  { x: 95, y: 245 }, // far-left back
  { x: 320, y: 250 }, // left mid
  { x: 520, y: 250 }, // right mid
  { x: 700, y: 245 }, // far-right back
];

const DEMO_NAMES = [
  "filesystem",
  "postgres",
  "github",
  "brave-search",
  "slack",
  "maps",
];

type Tone = "emerald" | "amber" | "violet";

type EdgeDef = {
  from: number;
  to: number;
  badge?: { text: string; tone: Tone };
};

// Edges form a small connected pass network. The badges are deliberately
// varied so the eye reads them as different kinds of tool output.
const EDGES: ReadonlyArray<EdgeDef> = [
  { from: 0, to: 1, badge: { text: "200 OK", tone: "emerald" } },
  { from: 0, to: 3, badge: { text: "rows: 42", tone: "amber" } },
  { from: 1, to: 4, badge: { text: "hits: 8", tone: "violet" } },
  { from: 3, to: 4, badge: { text: "msg sent", tone: "emerald" } },
  { from: 2, to: 3 },
  { from: 4, to: 5 },
];

const TONE_BADGE: Record<Tone, string> = {
  emerald: "bg-emerald-500/20 text-emerald-100 ring-emerald-300/50",
  amber: "bg-amber-500/20 text-amber-100 ring-amber-300/50",
  violet: "bg-violet-500/25 text-violet-100 ring-violet-300/50",
};

export type FootballPitchProps = {
  // When provided, replaces the demo names slot-by-slot. Empty/missing entries
  // leave that slot blank — the field still reads as a coherent illustration.
  names?: ReadonlyArray<string>;
  // Show the live decoration (arrows, balls, badges). Off when a real config
  // is loaded so the pitch becomes a clean "lineup" view.
  animated?: boolean;
  // When the uploaded config has more servers than slots, surface the rest
  // as a pill at midfield instead of dropping them silently.
  overflowCount?: number;
};

export function FootballPitch({
  names,
  animated = false,
  overflowCount = 0,
}: FootballPitchProps) {
  const labels = SLOTS.map((_, i) => (names ?? DEMO_NAMES)[i] ?? "");

  return (
    <div className="relative w-full overflow-hidden">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="block h-auto w-full"
        role="img"
        aria-label="MCP Playground tool field"
      >
        <defs>
          {/* Classic black-and-white soccer ball: a central black pentagon
              with five short seams radiating to the rim. At 14 px the eye
              fills in the surrounding hexagons and reads it as the standard
              Telstar pattern. */}
          <symbol id="ball" viewBox="-8 -8 16 16">
            <circle r="6.5" fill="#fafafa" stroke="#0a0a0a" strokeWidth="1.1" />
            <polygon
              points="0,-2.4 2.28,-0.74 1.41,1.94 -1.41,1.94 -2.28,-0.74"
              fill="#0a0a0a"
            />
            <g stroke="#0a0a0a" strokeWidth="0.85" strokeLinecap="round">
              <line x1="0" y1="-2.4" x2="0" y2="-6" />
              <line x1="2.28" y1="-0.74" x2="5.7" y2="-1.85" />
              <line x1="1.41" y1="1.94" x2="3.53" y2="4.85" />
              <line x1="-1.41" y1="1.94" x2="-3.53" y2="4.85" />
              <line x1="-2.28" y1="-0.74" x2="-5.7" y2="-1.85" />
            </g>
          </symbol>

          {/* Motion paths: each ball travels source → target → source so the
              loop is a continuous back-and-forth pass instead of a teleport. */}
          {EDGES.map((e, i) => {
            const a = SLOTS[e.from];
            const b = SLOTS[e.to];
            return (
              <path
                key={i}
                id={`motion-${i}`}
                d={`M${a.x},${a.y} L${b.x},${b.y} L${a.x},${a.y}`}
                fill="none"
              />
            );
          })}
        </defs>

        {/* Flat turf — a richer pitch green than the surrounding chrome so the
            field reads as the focal element on the muted page. Matches the
            panel container colour so the SVG flows into it edge-to-edge. */}
        <rect x="0" y="0" width={VIEW_W} height={VIEW_H} fill="#103d24" />

        {/* Subtle mowing stripes — barely-there vertical bands give the turf
            depth without distracting from the labels and passes on top. */}
        {Array.from({ length: 8 }).map((_, i) => (
          <rect
            key={i}
            x={i * 100}
            y="0"
            width="50"
            height={VIEW_H}
            fill="white"
            fillOpacity="0.02"
          />
        ))}

        {/* Classic football pitch markings — crisp white at low opacity so
            they read as a proper broadcast pitch rather than another wash of
            green. All grouped so any future tweak is one place. */}
        <g stroke="rgba(255,255,255,0.55)" strokeWidth="2" fill="none">
          <rect x="24" y="24" width="752" height="292" />
          <line x1="400" y1="24" x2="400" y2="316" />
          <circle cx="400" cy="170" r="52" />
          <rect x="24" y="90" width="120" height="160" />
          <rect x="24" y="135" width="50" height="70" />
          <rect x="656" y="90" width="120" height="160" />
          <rect x="726" y="135" width="50" height="70" />
        </g>

        {/* Centre spot + goals — same white, bumped opacity so they read as
            filled marks rather than line work. */}
        <circle cx="400" cy="170" r="3" fill="rgba(255,255,255,0.75)" />
        <rect x="14" y="155" width="10" height="30" fill="rgba(255,255,255,0.75)" />
        <rect x="776" y="155" width="10" height="30" fill="rgba(255,255,255,0.75)" />

        {/* Passing arrows (demo mode only). */}
        {animated &&
          EDGES.map((e, i) => {
            const a = SLOTS[e.from];
            const b = SLOTS[e.to];
            return (
              <line
                key={i}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="rgba(167,243,208,0.55)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray="6 6"
                className="animate-dash"
              />
            );
          })}

        {/* One ball per edge, riding the precomputed motion path. The staggered
            duration keeps the field alive instead of pulsing in unison.
            Translation and rotation live on separate <g> wrappers so the two
            animations don't fight over the same transform: the outer <g>
            travels along the dotted line, the inner <g> spins the ball about
            its own centre — 0→720→0 over the same cycle, so the spin
            reverses on the return leg exactly when the motion reverses.
            That's what makes the ball read as "rolling" instead of "sliding". */}
        {animated &&
          EDGES.map((_, i) => {
            // Slowed from the original ~3.4–4.4 s so the ball reads as a
            // deliberate roll rather than a dart. The (i % 3) stagger is
            // kept so the field doesn't pulse in unison.
            const dur = 6.5 + (i % 3) * 1;
            return (
              <g key={i}>
                <animateMotion dur={`${dur}s`} repeatCount="indefinite">
                  <mpath href={`#motion-${i}`} />
                </animateMotion>
                <g>
                  <animateTransform
                    attributeName="transform"
                    type="rotate"
                    values="0;720;0"
                    keyTimes="0;0.5;1"
                    dur={`${dur}s`}
                    repeatCount="indefinite"
                    calcMode="linear"
                  />
                  <use href="#ball" width="14" height="14" x="-7" y="-7" />
                </g>
              </g>
            );
          })}
      </svg>

      {/* HTML overlay: server name chips. Anchored in percent so they track the
          SVG perfectly when the container is resized. */}
      {labels.map((name, i) => {
        if (!name) return null;
        const s = SLOTS[i];
        return (
          <div
            key={i}
            style={{
              left: `${(s.x / VIEW_W) * 100}%`,
              top: `${(s.y / VIEW_H) * 100}%`,
            }}
            className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
          >
            <NodeChip name={name} />
          </div>
        );
      })}

      {/* HTML overlay: result badges along passes (demo mode only). */}
      {animated &&
        EDGES.map((e, i) => {
          if (!e.badge) return null;
          const a = SLOTS[e.from];
          const b = SLOTS[e.to];
          const mx = (a.x + b.x) / 2;
          const my = (a.y + b.y) / 2;
          return (
            <div
              key={i}
              style={{
                left: `${(mx / VIEW_W) * 100}%`,
                top: `${(my / VIEW_H) * 100}%`,
              }}
              className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
            >
              <span
                className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-medium ring-1 ring-inset backdrop-blur-sm ${TONE_BADGE[e.badge.tone]}`}
              >
                {e.badge.text}
              </span>
            </div>
          );
        })}

      {/* Overflow pill at midfield when the user's config has more servers
          than the pitch has slots. */}
      {overflowCount > 0 && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <span className="rounded-full bg-zinc-950/80 px-3 py-1 font-mono text-[11px] font-semibold text-emerald-100 ring-1 ring-inset ring-emerald-300/50 shadow-lg shadow-black/40 backdrop-blur-sm">
            +{overflowCount} more
          </span>
        </div>
      )}
    </div>
  );
}

function NodeChip({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-full border border-emerald-300/40 bg-zinc-950/80 px-2.5 py-1 shadow-lg shadow-black/50 backdrop-blur-sm">
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_8px_rgba(110,231,183,0.7)]" />
      <span className="max-w-[10rem] truncate font-mono text-[11px] font-medium text-zinc-100">
        {name}
      </span>
    </div>
  );
}
