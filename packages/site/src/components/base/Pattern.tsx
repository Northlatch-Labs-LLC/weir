// Deterministic pattern art for empty states, rendered at 25% opacity.
// Seeded from a string so the same empty state always draws the same field.
export default function Pattern({ seed, className = '' }: { seed: string; className?: string }) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h = h >>> 0;

  const cells: { x: number; y: number }[] = [];
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 8; c++) {
      h = (Math.imul(h, 1103515245) + 12345) >>> 0;
      if ((h >> 16) & 1) cells.push({ x: c, y: r });
    }
  }

  return (
    <svg
      viewBox="0 0 80 60"
      className={className}
      style={{ opacity: 0.25 }}
      aria-hidden="true"
    >
      {cells.map((c, i) => (
        <rect key={i} x={c.x * 10 + 1} y={c.y * 10 + 1} width={7} height={7} rx={2} fill="currentColor" />
      ))}
    </svg>
  );
}