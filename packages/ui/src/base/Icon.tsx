// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * The icon set, drawn once.
 *
 * Stroke only, on a 20px grid, in `currentColor` — so an icon takes the colour of whatever it
 * sits inside and follows the theme without a second definition. There is no icon font and no
 * third-party icon package: a set this small is cheaper to own than to depend on, and every path
 * here is checked against the artboards in `docs/app-production/artboards/`.
 *
 * An icon never carries meaning alone. Pass `label` when there is no visible text beside it and
 * the icon becomes the accessible name; leave it off when a label sits next to it and the icon is
 * decoration that would otherwise be announced twice.
 */

export const ICON_PATHS = {
  home: 'M3 9.5 10 3l7 6.5V17a1 1 0 0 1-1 1h-4v-5H8v5H4a1 1 0 0 1-1-1z',
  explore: 'M10 2.6a7.4 7.4 0 1 0 0 14.8 7.4 7.4 0 0 0 0-14.8M13.2 6.8 11.6 11.6 6.8 13.2 8.4 8.4z',
  creators:
    'M10.9 7.4a2.9 2.9 0 1 0-5.8 0 2.9 2.9 0 0 0 5.8 0M3 17c0-2.8 2.2-4.4 5-4.4s5 1.6 5 4.4M13.9 5.2a3 3 0 0 1 0 5.6M15.4 12.9c1.6.6 2.6 1.9 2.6 4.1',
  agents: 'M10 2.6 16.4 6v8L10 17.4 3.6 14V6zM8.8 7.6h2.4a1.2 1.2 0 0 1 1.2 1.2v2.4a1.2 1.2 0 0 1-1.2 1.2H8.8a1.2 1.2 0 0 1-1.2-1.2V8.8a1.2 1.2 0 0 1 1.2-1.2z',
  alerts:
    'M6 8.2a4 4 0 0 1 8 0c0 3.4 1.2 4.6 1.8 5.2.3.3.1.9-.4.9H4.6c-.5 0-.7-.6-.4-.9C4.8 12.8 6 11.6 6 8.2zM8.3 17a1.9 1.9 0 0 0 3.4 0',
  messages: 'M4.8 4.6h10.4a2.2 2.2 0 0 1 2.2 2.2v6.4a2.2 2.2 0 0 1-2.2 2.2H4.8a2.2 2.2 0 0 1-2.2-2.2V6.8a2.2 2.2 0 0 1 2.2-2.2zM3.6 6.1l6.4 4.9 6.4-4.9',
  vault:
    'M4.8 3.6h10.4a2.2 2.2 0 0 1 2.2 2.2v8.4a2.2 2.2 0 0 1-2.2 2.2H4.8a2.2 2.2 0 0 1-2.2-2.2V5.8a2.2 2.2 0 0 1 2.2-2.2zM13.1 10a3.1 3.1 0 1 0-6.2 0 3.1 3.1 0 0 0 6.2 0M10 5.2v1.6M10 13.2v1.6M5.2 10h1.6M13.2 10h1.6',
  studio: 'm4 16 1-3.2 8.1-8.1a1.7 1.7 0 0 1 2.4 2.4L7.4 15zM12 6.2 13.8 8',
  profile: 'M13.1 7a3.1 3.1 0 1 0-6.2 0 3.1 3.1 0 0 0 6.2 0M4.2 17c0-3.1 2.6-4.9 5.8-4.9s5.8 1.8 5.8 4.9',
  search: 'M14.4 9a5.4 5.4 0 1 0-10.8 0 5.4 5.4 0 0 0 10.8 0m-1.3 4.1 3.4 3.4',
  comment: 'M17 9.8c0 3.2-3.1 5.7-7 5.7-.8 0-1.6-.1-2.3-.3L3.6 17l1-3.1C3.6 12.8 3 11.4 3 9.8 3 6.6 6.1 4.1 10 4.1s7 2.5 7 5.7z',
  share: 'M10 13.2V3.4M6.6 6.6 10 3.2l3.4 3.4M4.6 11.4V16a1 1 0 0 0 1 1h8.8a1 1 0 0 0 1-1v-4.6',
  support: 'm10 3 5 7-5 7-5-7z',
  lock: 'M6.6 8.6h6.8a2 2 0 0 1 2 2v3.8a2 2 0 0 1-2 2H6.6a2 2 0 0 1-2-2v-3.8a2 2 0 0 1 2-2zM7 8.6V6.7a3 3 0 0 1 6 0v1.9',
  plus: 'M10 4.6v10.8M4.6 10h10.8',
  moon: 'M15.4 11.8A6 6 0 0 1 8.2 4.6 6.2 6.2 0 1 0 15.4 11.8z',
  check: 'M4.6 10.4 8.2 14l7.2-7.6',
  arrow: 'M4 10h11M11 6l4 4-4 4',
  back: 'M16 10H5M9 6l-4 4 4 4',
  image: 'M5 4.4h10a2 2 0 0 1 2 2v7.2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6.4a2 2 0 0 1 2-2zM8.8 8.4a1.4 1.4 0 1 0-2.8 0 1.4 1.4 0 0 0 2.8 0m-5.2 5.6 4-3.6 3.2 2.6 2.6-2.2 3 2.6',
  clock: 'M17.2 10a7.2 7.2 0 1 0-14.4 0 7.2 7.2 0 0 0 14.4 0M10 5.8V10l2.8 1.8',
  bolt: 'M11 2.6 4.6 11.2h4.2L9 17.4l6.4-8.6h-4.2z',
  close: 'M5.5 5.5l9 9M14.5 5.5l-9 9',
  external: 'M11 4h5v5M16 4l-7.5 7.5M14 12v3.4a1.6 1.6 0 0 1-1.6 1.6H4.6A1.6 1.6 0 0 1 3 15.4V7.6A1.6 1.6 0 0 1 4.6 6H8',
} as const;

export type IconName = keyof typeof ICON_PATHS;

export const ICON_NAMES = Object.keys(ICON_PATHS) as IconName[];

export function Icon({
  name,
  size = 20,
  strokeWidth = 1.6,
  label,
  className,
}: {
  name: IconName;
  /** 16, 20 or 24. Nothing else — an icon at a fourth size reads as a different icon. */
  size?: 16 | 18 | 20 | 24 | 28;
  strokeWidth?: number;
  /** Give this only when no visible text sits beside the icon. */
  label?: string;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      role={label === undefined ? undefined : 'img'}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
      focusable="false"
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}
