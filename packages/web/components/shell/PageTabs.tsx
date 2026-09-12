'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from '@/components/app/icons';
import { isHere, type Destination } from '@/lib/site-map';

export interface Tab extends Pick<Destination, 'href' | 'label'> {
  icon?: Destination['icon'];
  note?: string;
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
