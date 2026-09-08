import type { ReactNode } from 'react';

// One icon set, drawn inline. 24×24 viewBox, 2px stroke, round caps/joins.
// No icon library. Geometry sits on a 2px grid, exterior corners 2px radius.

export type IconName =
  | 'creator' | 'support' | 'comments' | 'share' | 'vault' | 'lock' | 'unlock'
  | 'upload' | 'crop' | 'check' | 'close' | 'chevron-down' | 'chevron-left'
  | 'search' | 'settings' | 'external' | 'alert' | 'plus' | 'wallet';

const paths: Record<IconName, ReactNode> = {
  creator: (
    <>
      <circle cx="12" cy="7.5" r="3.5" />
      <path d="M4.5 20c0-4.14 3.36-7.5 7.5-7.5s7.5 3.36 7.5 7.5" />
    </>
  ),
  support: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8.5v7" />
      <path d="M8.5 12h7" />
    </>
  ),
  comments: (
    <path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-6l-5 4v-4H6a2 2 0 0 1-2-2V6z" />
  ),
  share: (
    <>
      <circle cx="18" cy="5" r="2.5" />
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="19" r="2.5" />
      <path d="M8.2 10.7l7.6-4.4" />
      <path d="M8.2 13.3l7.6 4.4" />
    </>
  ),
  vault: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <circle cx="12" cy="13.5" r="2.5" />
      <path d="M12 11v.5" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  unlock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 7.3-2.5" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V6" />
      <path d="M7 11l5-5 5 5" />
      <path d="M4 19h16" />
    </>
  ),
  crop: (
    <>
      <path d="M6 2v14a2 2 0 0 0 2 2h14" />
      <path d="M18 22V8a2 2 0 0 0-2-2H2" />
    </>
  ),
  check: <path d="M5 12l4.5 4.5L19 7" />,
  close: (
    <>
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </>
  ),
  'chevron-down': <path d="M6 9l6 6 6-6" />,
  'chevron-left': <path d="M15 6l-6 6 6 6" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" />
    </>
  ),
  external: (
    <>
      <path d="M15 3h6v6" />
      <path d="M10 14L21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3L2 20h20L12 3z" />
      <path d="M12 10v4" />
      <path d="M12 17h.01" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  wallet: (
    <>
      <rect x="3" y="6" width="18" height="14" rx="2" />
      <path d="M3 11h18" />
      <path d="M16.5 15.5h.01" />
    </>
  ),
};

type Props = {
  name: IconName;
  size?: number;
  className?: string;
};

export default function Icon({ name, size = 24, className = '' }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}