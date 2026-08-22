'use client';
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * Tabs across the top of a page that has several jobs.
 *
 * A row of links with `aria-current` on the one you are on. Links rather than buttons, so each tab
 * has an address, opens in a new tab, and survives a reload; the current one is announced rather
 * than merely coloured. The sub-rail this replaces rendered three tiles with descriptions inside
 * the page head and nothing else on the site looked like it.
 *
 * `items` come from `lib/site-map.ts` (the creator studio, the account pages) or are built by the
 * page for in-page views (`/feed?view=following`). `match` decides what counts as "here": the
 * default is exact-or-descendant on the path; a page whose tabs differ by query passes its own.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from '@/components/design/icons';
import { isHere, type Destination } from '@/lib/site-map';

export interface Tab extends Pick<Destination, 'href' | 'label'> {
  icon?: Destination['icon'];
  /** A count or short note after the label — "Following · 3". */
  note?: string;
  /** Override the current-page test for this tab. */
  current?: boolean;
}

export function PageTabs({ label, items }: { label: string; items: readonly Tab[] }) {
  const pathname = usePathname() ?? '/';
  return (
    <nav aria-label={label} className="ptabs">
      {items.map((tab) => {
        const here = tab.current ?? isHere(tab.href, pathname);
        return (
          <Link key={tab.href} href={tab.href} className="ptabs__tab" aria-current={here ? 'page' : undefined}>
            {tab.icon !== undefined && <Icon name={tab.icon} size={15} />}
            <span>{tab.label}</span>
            {tab.note !== undefined && <span className="ptabs__note">{tab.note}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
