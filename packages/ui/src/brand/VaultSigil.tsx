// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

/**
 * A vault's face, drawn from its object id.
 *
 * # Why generated rather than uploaded
 *
 * The same reason `Avatar` is: an id always draws the same mark, everywhere, with nothing stored,
 * nothing uploaded, nothing to moderate and nothing to lose. Two vaults cannot share a sigil
 * because two vaults cannot share an id.
 *
 * It is also the thing only this product can have. A logo can be commissioned by anyone; a mark
 * that *is* the vault — that a reader can check against an explorer — cannot.
 *
 * # The form
 *
 * The brand mark is a basin with water backing up behind it. A sigil is that basin, filled to a
 * level the vault decides, with a ring of marks around it seeded from the id. Where the vault's
 * balance is known the fill is that balance against its own high-water mark; where it is not, the
 * basin draws empty rather than guessing a level — a full-looking vault that holds nothing is the
 * one thing this must never draw.
 */

function seeded(input: string): () => number {
  let h = 2166136261 ^ input.length;
  for (let i = 0; i < input.length; i += 1) {
    h = Math.imul(h ^ input.charCodeAt(i), 16777619);
  }
  let state = h >>> 0;
  return () => {
    state = Math.imul(state ^ (state >>> 15), 2246822507);
    state = Math.imul(state ^ (state >>> 13), 3266489909);
    state = (state ^ (state >>> 16)) >>> 0;
    return state / 4294967296;
  };
}

export function VaultSigil({
  vaultId,
  /**
   * How full the basin draws, 0 to 1.
   *
   * `null` means the balance has not been read, and the basin draws empty. Never pass a computed
   * default: a level nobody measured is a claim about somebody's money.
   */
  fill = null,
  size = 44,
  title,
}: {
  vaultId: string;
  fill?: number | null;
  size?: number;
  title?: string;
}) {
  const random = seeded(vaultId);

  /* Twelve marks around the rim, each either long or short, seeded by the id. */
  const rim = Array.from({ length: 12 }, (_, i) => {
    const angle = (i / 12) * Math.PI * 2 - Math.PI / 2;
    const long = random() > 0.55;
    return {
      angle,
      inner: long ? 13.5 : 14.6,
      outer: 16.4,
      dim: random() > 0.6,
    };
  });

  /* The basin's chord, from the brand mark: a circle cut at y = 9.1 on a 24 grid. */
  const CUT = 9.1;
  const level = fill === null ? 0 : Math.max(0, Math.min(1, fill));
  const surface = 24 - (24 - CUT) * level;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role={title === undefined ? undefined : 'img'}
      aria-label={title}
      aria-hidden={title === undefined ? true : undefined}
      focusable="false"
    >
      <g transform="translate(4,4)">
        <clipPath id={`sigil-basin-${vaultId.slice(2, 10)}`}>
          <path d="M 0.356 9.1 A 12.0 12.0 0 1 0 23.644 9.1 Z" />
        </clipPath>

        {/* The empty basin. Always drawn, so a vault with nothing in it is still a vault. */}
        <path
          d="M 0.356 9.1 A 12.0 12.0 0 1 0 23.644 9.1 Z"
          fill="var(--w-raised)"
          stroke="var(--w-line)"
          strokeWidth="0.8"
        />

        {/* What it holds, clipped to the basin so the level is the only thing that moves. */}
        {level > 0 && (
          <rect
            x="0"
            y={surface}
            width="24"
            height={24 - surface}
            fill="var(--w-mint)"
            fillOpacity="0.85"
            clipPath={`url(#sigil-basin-${vaultId.slice(2, 10)})`}
          />
        )}
      </g>

      {rim.map((mark) => {
        const cx = 16 + Math.cos(mark.angle);
        const cy = 16 + Math.sin(mark.angle);
        return (
          <line
            key={mark.angle}
            x1={cx + Math.cos(mark.angle) * (mark.inner - 1)}
            y1={cy + Math.sin(mark.angle) * (mark.inner - 1)}
            x2={cx + Math.cos(mark.angle) * (mark.outer - 1)}
            y2={cy + Math.sin(mark.angle) * (mark.outer - 1)}
            stroke="var(--w-mint)"
            strokeOpacity={mark.dim ? 0.28 : 0.7}
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        );
      })}
    </svg>
  );
}
