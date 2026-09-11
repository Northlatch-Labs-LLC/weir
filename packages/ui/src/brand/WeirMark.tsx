// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

/**
 * The mark, the wordmark and the lockup.
 *
 * The geometry here is the one in `packages/web/public/brand/weir-mark.svg` and its fourteen
 * siblings, which is the drawn brand. Until 2026-09-11 the application rendered a different mark
 * entirely — an outlined circle with two wave paths — and the fifteen brand files were referenced
 * by no code at all.
 *
 * Everything draws in `currentColor`, so a mark inherits the colour of whatever it sits in and
 * there is no light/dark pair to keep in step. The `-on-deep` and `-ink-light` files exist for
 * places outside this application that cannot set a colour: email, app stores, an OG card.
 */

/** The basin, and the water backing up behind it. */
export function WeirMark({
  size = 30,
  title,
}: {
  size?: number;
  /** Give this only where the mark is the sole name of the thing it labels. */
  title?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role={title === undefined ? undefined : 'img'}
      aria-label={title}
      aria-hidden={title === undefined ? true : undefined}
      focusable="false"
    >
      <path d="M 0.356 9.1 A 12.0 12.0 0 1 0 23.644 9.1 Z" fill="currentColor" />
      <line x1="5" y1="7.5" x2="19" y2="7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="7" y1="5" x2="17" y2="5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="9" y1="2.5" x2="15" y2="2.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The name, as drawn type.
 *
 * Outlines rather than a font, so it renders identically wherever it appears and does not wait on
 * a webfont. Taken from `weir-wordmark.svg`.
 */
const WORDMARK =
  'M227.0 16 29.0 -444Q19.0 -468 2.0 -482.5Q-15.0 -497 -44.0 -498V-508H237.0V-498Q202.0 -494 191.0'
  + ' -467.0Q180.0 -440 198.0 -399L301.0 -158L379.0 -339L338.0 -444Q329.0 -467 314.0 -482.0Q299.0'
  + ' -497 273.0 -498V-508H525.0V-498Q493.0 -494 483.5 -467.0Q474.0 -440 490.0 -399L582.0 -158L674.0'
  + ' -393Q679.0 -406 681.0 -417.0Q683.0 -428 683.0 -438Q683.0 -463 670.0 -479.0Q657.0 -495 632.0'
  + ' -498V-508H774.0V-498Q751.0 -492 729.0 -468.0Q707.0 -444 690.0 -402L525.0 16H517.0L385.0'
  + ' -322L237.0 16Z M989.0 12Q920.0 12 866.5 -22.0Q813.0 -56 783.0 -116.5Q753.0 -177 753.0'
  + ' -255Q753.0 -335 786.0 -395.0Q819.0 -455 876.5 -488.5Q934.0 -522 1007.0 -522Q1068.0 -522 1115.5'
  + ' -498.0Q1163.0 -474 1191.5 -430.5Q1220.0 -387 1224.0 -330L1225.0 -315H889.0V-310Q889.0 -204'
  + ' 936.0 -140.5Q983.0 -77 1062.0 -77Q1110.0 -77 1153.5 -100.5Q1197.0 -124 1224.0 -164L1233.0'
  + ' -161Q1216.0 -110 1180.0 -71.0Q1144.0 -32 1095.0 -10.0Q1046.0 12 989.0 12ZM890.0 -330H1093.0Q1093.0'
  + ' -409 1067.5 -458.0Q1042.0 -507 996.0 -507Q952.0 -507 923.0 -459.0Q894.0 -411 890.0 -330Z'
  + ' M1254.0 0V-10H1255.0Q1291.0 -10 1313.0 -32.0Q1335.0 -54 1335.0 -90V-418Q1335.0 -456 1319.5'
  + ' -477.0Q1304.0 -498 1254.0 -498V-508H1356.0Q1407.0 -508 1434.0 -519Q1459.0 -530 1469.0'
  + ' -546H1479.0V-90Q1479.0 -54 1501.0 -32.0Q1523.0 -10 1559.0 -10H1560.0V0ZM1406.0 -609Q1370.0'
  + ' -609 1346.5 -632.5Q1323.0 -656 1323.0 -692Q1323.0 -728 1346.5 -751.5Q1370.0 -775 1406.0'
  + ' -775Q1441.0 -775 1464.5 -751.0Q1488.0 -727 1488.0 -692Q1488.0 -657 1464.5 -633.0Q1441.0 -609'
  + ' 1406.0 -609Z M1540 0V-10H1541Q1577 -10 1599 -32.0Q1621 -54 1621 -90V-418Q1621 -456 1605.5'
  + ' -477.0Q1590 -498 1540 -498V-508H1639Q1692 -508 1719 -518.5Q1746 -529 1757 -546H1762L1763'
  + ' -382Q1776 -412 1796.5 -445.0Q1817 -478 1848.5 -500.5Q1880 -523 1924 -523Q1939 -523 1956'
  + ' -520.0Q1973 -517 1992 -509L1953 -392Q1917 -412 1890.5 -420.0Q1864 -428 1844 -428Q1810 -428'
  + ' 1793.5 -407.0Q1777 -386 1765 -357V-90Q1765 -54 1787 -32.0Q1809 -10 1845 -10H1846V0Z';

export function WeirWordmark({ height = 22, title }: { height?: number; title?: string }) {
  return (
    <svg
      height={height}
      viewBox="0 0 205.6 120"
      role={title === undefined ? undefined : 'img'}
      aria-label={title}
      aria-hidden={title === undefined ? true : undefined}
      focusable="false"
    >
      <g transform="translate(0,97.5) scale(0.1)">
        <path d={WORDMARK} fill="currentColor" />
      </g>
    </svg>
  );
}

/**
 * Mark and wordmark, in the one relationship they are allowed to have.
 *
 * A lockup exists so the pair is never re-spaced by hand. The gap and the optical size difference
 * are the drawn ones; a caller sets `height` and nothing else.
 */
export function WeirLockup({ height = 26, title = 'Weir' }: { height?: number; title?: string }) {
  return (
    <span className="w-lockup" role="img" aria-label={title}>
      <WeirMark size={Math.round(height * 1.18)} />
      <WeirWordmark height={height} />
    </span>
  );
}
