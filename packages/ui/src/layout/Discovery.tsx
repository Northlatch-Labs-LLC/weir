// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import type { ReactNode } from 'react';
import { Icon } from '../base/Icon';
import { Avatar, AgentBadge } from '../base/Avatar';
import type { LinkComponent } from './AppShell';
import type { AvatarSize } from '../base/Avatar';

export function SearchBox({
  action = '/explore',
  query = '',
  hidden,
}: {
  action?: string;
  query?: string;
  hidden?: Readonly<Record<string, string>> | undefined;
}) {
  return (
    <form className="w-search" role="search" action={action} method="get">
      <Icon name="search" size={20} strokeWidth={1.7} />
      <input
        aria-label="Search Weir"
        className="w-search__field"
        type="search"
        name="q"
        defaultValue={query}
        placeholder="Search Weir"
        autoComplete="off"
        spellCheck={false}
      />
      {Object.entries(hidden ?? {}).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
    </form>
  );
}

export type PersonRowView = {
  handle: string;
  address: string;
  displayName: string;
  meta: string;
  isAgent: boolean;
};

export function PersonRow({
  person,
  Link,
  action,
  size = 38,
}: {
  person: PersonRowView;
  Link: LinkComponent;
  action?: ReactNode;
  size?: AvatarSize;
}) {
  return (
    <div className="w-person">
      <Avatar address={person.address} isAgent={person.isAgent} size={size} />
      <span className="w-person__who">
        <Link href={`/c/${person.handle}`} className="w-name">
          {person.displayName}
          {person.isAgent ? <AgentBadge /> : null}
        </Link>
        <span className="w-person__meta">
          @{person.handle}
          {person.meta === '' ? '' : ` · ${person.meta}`}
        </span>
      </span>
      {action === undefined ? null : <span className="w-person__action">{action}</span>}
    </div>
  );
}

export function RailCard({
  title,
  note,
  children,
  more,
  moreLabel = 'See all',
  Link,
  accent,
}: {
  title: string;
  note?: string | undefined;
  children: ReactNode;
  more?: string | undefined;
  moreLabel?: string;
  Link: LinkComponent;
  accent?: 'money' | 'machine' | undefined;
}) {
  return (
    <section className={accent === 'money' ? 'w-card w-card--money' : 'w-card'}>
      <h3 style={accent === 'machine' ? { color: 'var(--w-violet)' } : undefined}>{title}</h3>
      {note === undefined ? null : <p className="w-card__note">{note}</p>}
      <div className="w-card__rows">{children}</div>
      {more === undefined ? null : (
        <Link href={more} className="w-card__more">
          {moreLabel}
          <Icon name="arrow" size={16} strokeWidth={1.8} />
        </Link>
      )}
    </section>
  );
}

export type SeekingView = {
  handle: string;
  address: string;
  model: string;
  words: string;
};

export function SeekingRow({ seeking, Link, action }: { seeking: SeekingView; Link: LinkComponent; action?: ReactNode }) {
  return (
    <div className="w-seeking">
      <div className="w-person" style={{ padding: 0, borderBottom: 0 }}>
        <Avatar address={seeking.address} isAgent size={38} />
        <span className="w-person__who">
          <Link href={`/agents/${seeking.handle}`} className="w-name">
            {seeking.handle}
            <AgentBadge />
          </Link>
          <span className="w-person__meta">{seeking.model}</span>
        </span>
      </div>
      <p className="w-seeking__words">{seeking.words}</p>
      {action === undefined ? null : action}
    </div>
  );
}
