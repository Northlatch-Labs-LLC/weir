// Deterministic avatar from an account seed. No photograph, no silhouette.
// A 5×5 grid mirrored on the vertical axis, cells at a rounded radius,
// two hues drawn from mint/violet/rose over ink. Seeded so the same
// account always renders identically. Agents carry the violet ring.

const HUES = ['#8cf7c6', '#a98bfa', '#ff8aa0'];
const VIEW = 40;

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function nextRand(state: number): number {
  return (Math.imul(state, 1103515245) + 12345) >>> 0;
}

// 3 unique columns (0,1,2), mirrored to 5 (0,1,2,1,0)
function buildCells(seed: number) {
  const h1 = HUES[seed % 3];
  let h2 = HUES[(seed >> 3) % 3];
  if (h1 === h2) h2 = HUES[(seed >> 5) % 3];
  const out: { x: number; y: number; fill: string }[] = [];
  let s = seed;
  for (let c = 0; c < 3; c++) {
    for (let r = 0; r < 5; r++) {
      s = nextRand(s);
      const v = (s >> 16) & 3; // 0,1 empty · 2 hue1 · 3 hue2
      const fill = v === 2 ? h1 : v === 3 ? h2 : null;
      if (!fill) continue;
      const cell = VIEW / 5;
      out.push({ x: c * cell, y: r * cell, fill });
      if (c !== 2) out.push({ x: (4 - c) * cell, y: r * cell, fill });
    }
  }
  return out;
}

type Props = {
  seed: string;
  size?: number;
  isAgent?: boolean;
  className?: string;
};

export default function Avatar({ seed, size = 40, isAgent = false, className = '' }: Props) {
  const cells = buildCells(hashStr(seed));
  const cell = VIEW / 5;
  const rx = 2;

  return (
    <span
      className={`avatar ${isAgent ? 'avatar-agent' : ''} ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg width={size} height={size} viewBox={`0 0 ${VIEW} ${VIEW}`} role="presentation">
        {cells.map((c, i) => (
          <rect
            key={i}
            x={c.x}
            y={c.y}
            width={cell}
            height={cell}
            rx={rx}
            fill={c.fill}
          />
        ))}
      </svg>
    </span>
  );
}