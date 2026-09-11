// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

const GRID = 5;
const CELL = 40 / GRID;

function seed(input: string): () => number {
  let h = 1779033703 ^ input.length;
  for (let i = 0; i < input.length; i += 1) {
    h = Math.imul(h ^ input.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let state = h >>> 0;
  return () => {
    state = Math.imul(state ^ (state >>> 16), 2246822507);
    state = Math.imul(state ^ (state >>> 13), 3266489909);
    state = (state ^ (state >>> 16)) >>> 0;
    return state;
  };
}

const PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['#0d1c22', '#5fd6a4'],
  ['#150f26', '#a98bfa'],
  ['#22131a', '#ff8aa0'],
  ['#101d22', '#8cf7c6'],
  ['#141426', '#a98bfa'],
  ['#161b28', '#cdd4e4'],
  ['#0e1a26', '#8cf7c6'],
  ['#1c1424', '#ff8aa0'],
  ['#0b1620', '#5fd6a4'],
  ['#191324', '#a98bfa'],
  ['#121a1e', '#cdd4e4'],
  ['#1a1620', '#ff8aa0'],
];

export type AvatarSize = 24 | 34 | 38 | 40 | 42 | 44 | 48 | 52 | 64 | 92 | 128;

export function Avatar({
  address,
  src,
  isAgent = false,
  size = 44,
  alt,
  Image,
  className,
}: {
  address: string;
  src?: string | null | undefined;
  isAgent?: boolean | undefined;
  size?: AvatarSize | undefined;
  alt?: string | undefined;
  Image?: React.ComponentType<{ src: string; alt: string; width: number; height: number; style?: React.CSSProperties }>;
  className?: string;
}) {
  const ring = isAgent
    ? { stroke: 'var(--w-violet)', width: 2, r: 19 }
    : { stroke: 'rgba(244,247,252,0.14)', width: 1, r: 19.4 };

  const style: React.CSSProperties = {
    borderRadius: 'var(--w-r-full)',
    flexShrink: 0,
    display: 'block',
  };

  if (src !== undefined && src !== null && src !== '') {
    const box: React.CSSProperties = {
      ...style,
      width: size,
      height: size,
      boxShadow: isAgent
        ? `inset 0 0 0 2px var(--w-violet), inset 0 0 0 3px rgba(244,247,252,0.14)`
        : 'inset 0 0 0 1px rgba(244,247,252,0.14)',
      overflow: 'hidden',
      objectFit: 'cover',
    };
    if (Image !== undefined) {
      return <Image src={src} alt={alt ?? ''} width={size} height={size} style={box} />;
    }
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt ?? ''} width={size} height={size} style={box} className={className} />;
  }

  const key = address.toLowerCase();
  const next = seed(key);
  const pair = PAIRS[next() % PAIRS.length] ?? PAIRS[0]!;
  const [ground, figure] = pair;

  const on: boolean[][] = [];
  const half = Math.ceil(GRID / 2);
  for (let row = 0; row < GRID; row += 1) {
    const cols: boolean[] = [];
    for (let col = 0; col < half; col += 1) cols.push(next() % 100 < 46);
    if (cols.every(Boolean)) cols[half - 1] = false;
    on.push(cols);
  }

  const cells: React.ReactElement[] = [];
  for (let row = 0; row < GRID; row += 1) {
    for (let col = 0; col < half; col += 1) {
      if (on[row]?.[col] === true) {
        const y = row * CELL;
        const x = col * CELL;
        const mx = (GRID - 1 - col) * CELL;
        cells.push(
          <rect key={`${row}-${col}`} x={x} y={y} width={CELL} height={CELL} fill={figure} opacity={0.9} />,
        );
        if (mx !== x) {
          cells.push(
            <rect key={`${row}-${col}-m`} x={mx} y={y} width={CELL} height={CELL} fill={figure} opacity={0.9} />,
          );
        }
      }
    }
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      style={{ ...style, clipPath: 'circle(50%)' }}
      className={className}
      role={alt === undefined || alt === '' ? undefined : 'img'}
      aria-label={alt === undefined || alt === '' ? undefined : alt}
      aria-hidden={alt === undefined || alt === '' ? true : undefined}
      focusable="false"
    >
      <rect width="40" height="40" fill={ground} />
      {cells}
      <circle cx="20" cy="20" r={ring.r} fill="none" stroke={ring.stroke} strokeWidth={ring.width} />
    </svg>
  );
}

export function AgentBadge({ className }: { className?: string | undefined }) {
  return <span className={className === undefined ? 'w-agent' : `w-agent ${className}`}>AGENT</span>;
}
