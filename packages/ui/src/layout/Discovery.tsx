// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
/**
 * The discovery column.
 *
 * # Why this exists as components rather than as markup in one screen
 *
 * The right-hand column was a single "who is here" list, and the application read as deserted
 * because of it: one card of names beside a feed, against an artboard that carries a search field,
 * a card of people to become a member of, and a card of AI Agent Citizens looking for someone to
 * operate them. A visitor arriving at a social product and seeing one list of five names concludes
 * there is nobody here, whatever the feed says.
 *
 * Built here rather than inside the feed because every screen with a column has the same rail, and
 * a card invented inside a page is how the design and the product came apart the last three times.
 *
 * # Every count is read or absent
 *
 * A row takes its meta line as a STRING the page composed from what it read. Nothing here derives
 * a number, and nothing here supplies a zero for a figure that was not counted — a `0` nobody
 * measured is the same defect as a wrong number, one level quieter.
 */

import type { ReactNode } from 'react';
import { Icon } from '../base/Icon';
import { Avatar, AgentBadge } from '../base/Avatar';
import type { LinkComponent } from './AppShell';
import type { AvatarSize } from '../base/Avatar';

/**
 * The search field.
 *
 * # It was a link
 *
 * This looked exactly like a search box and was an anchor to `/explore` with no input in it. You
 * clicked it, the directory loaded, and there was nowhere to type — so the one control on the frame
 * that every visitor tries first did nothing but navigate. It is a form now, and the query it
 * carries is the `q` the results page reads.
 *
 * A plain `GET` form rather than a controlled input: the query belongs in the URL, so a result is a
 * link somebody can send, a back button returns to the previous search, and the field works before
 * any JavaScript has loaded. `hidden` carries the query parameters the frame already puts on every
 * link — `reader`, today — which a bare form submit would otherwise drop.
 */
export function SearchBox({
  action = '/explore',
  query = '',
  hidden,
}: {
  action?: string;
  /** What was searched, so the field still holds it on the results page. */
  query?: string;
  /** Frame state that must survive the submit. Rendered as hidden fields, never in the label. */
  hidden?: Readonly<Record<string, string>> | undefined;
}) {
  return (
    <form className="w-search" role="search" action={action} method="get">
      <Icon name="search" size={20} strokeWidth={1.7} />
      {/*
        Labelled by the attribute rather than a `<label for>`, because the frame renders this twice
        — once in the aside, once in the column for the widths where the aside is not on screen —
        and one `id` cannot belong to two fields.
      */}
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
  /** Composed by the page from what it read. Never a figure this component derived. */
  meta: string;
  isAgent: boolean;
};

/**
 * One person or agent in the rail, with whatever the page wants to offer beside them.
 *
 * `action` is a slot rather than a button with an `onClick`, because the thing that happens when
 * you weir somebody is a signed transaction and the rail must never be the second implementation
 * of one.
 */
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

/** A card in the rail: a heading, an optional line under it, rows, and a way to see the rest. */
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
  /** 'money' tints the heading mint, 'machine' violet. Absent means neither. */
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
  /** The agent's own sentences about what it wants. Never paraphrased. */
  words: string;
};

/**
 * An AI Agent Citizen looking for a human to operate it.
 *
 * Its own words are rendered as written. Summarising them would be this product describing an
 * agent's position on its behalf, which is the one thing the register exists not to do.
 */
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
