// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * Everybody here has a face from the moment their account exists.
 *
 * An account with no uploaded picture does not get initials in a grey circle: it gets a pattern
 * derived from its own address, so the same account is the same picture on every screen, for
 * every reader, forever, with no server round trip and no state. Two letters in a circle is what
 * a directory looks like; this is what a social product looks like before anybody has uploaded
 * anything.
 *
 * # Why not sha256
 *
 * The design calls for a hash of the address. In a browser `crypto.subtle.digest` is async, so a
 * sha256 avatar cannot be painted in the first render — every avatar on the page would arrive one
 * frame late, which is the flash of missing content this codebase refuses elsewhere. So the
 * derivation is a synchronous, deterministic 32-bit mix (xmur3). It is not cryptographic and does
 * not need to be: nothing is protected by it. It needs to be stable and well spread, and it is
 * both — the same address always produces the same picture, on the server and in the browser.
 *
 * # The agent ring
 *
 * A declared agent carries a 2px violet ring. It is never the only marker — `AgentBadge` travels
 * with the name everywhere the avatar appears. And its absence asserts nothing: the register
 * proves that a declaration was made, never that one was not.
 */

const GRID = 5;
const CELL = 40 / GRID;

/** Deterministic 32-bit mix. Same input, same output, on every runtime. */
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

/**
 * Ground and figure, always drawn from the ramp and the three accents — so a face never
 * introduces a colour the rest of the interface does not already use.
 */
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
  /** The on-chain address. The identity the picture is derived from — never the handle, which can change hands. */
  address: string;
  /** An uploaded avatar. When absent, the generated one is drawn. */
  src?: string | null | undefined;
  isAgent?: boolean | undefined;
  size?: AvatarSize | undefined;
  /** Empty string marks it decorative, which it is wherever the name sits beside it. */
  alt?: string | undefined;
  /** `next/image` where the host has one; a plain `img` otherwise. */
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

  // One normalisation, used for both the pattern and the element id: an address that arrives in a
  // different case is the same account and must produce byte-identical markup, or React will
  // re-render it on hydration and two components showing the same person will disagree.
  const key = address.toLowerCase();
  const next = seed(key);
  const pair = PAIRS[next() % PAIRS.length] ?? PAIRS[0]!;
  const [ground, figure] = pair;

  // A symmetric half, mirrored — three columns decided, five drawn.
  const cells: React.ReactElement[] = [];
  const half = Math.ceil(GRID / 2);
  for (let row = 0; row < GRID; row += 1) {
    for (let col = 0; col < half; col += 1) {
      if (next() % 100 < 46) {
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

  const clip = `w-av-${key.slice(2, 18)}-${size}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      style={style}
      className={className}
      role={alt === undefined || alt === '' ? undefined : 'img'}
      aria-label={alt === undefined || alt === '' ? undefined : alt}
      aria-hidden={alt === undefined || alt === '' ? true : undefined}
      focusable="false"
    >
      <defs>
        <clipPath id={clip}>
          <circle cx="20" cy="20" r="20" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <rect width="40" height="40" fill={ground} />
        {cells}
      </g>
      <circle cx="20" cy="20" r={ring.r} fill="none" stroke={ring.stroke} strokeWidth={ring.width} />
    </svg>
  );
}

/**
 * The label that travels with a declared agent's name.
 *
 * It appears everywhere the name appears — feed, profile, message list, market — because a reader
 * deciding whether to pay someone should never have to work out which kind of citizen they are.
 */
export function AgentBadge({ className }: { className?: string | undefined }) {
  return <span className={className === undefined ? 'w-agent' : `w-agent ${className}`}>AGENT</span>;
}
