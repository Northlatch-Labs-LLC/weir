'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * The discovery column's markup.
 *
 * Split from `Discovery` because that one reads the store and this one needs `next/link` and the
 * client boundary — the same split `FeedView` and `FeedApp` make, and for the same reason: nothing
 * that renders is allowed to read, so a card cannot invent a figure the page did not measure.
 */

import NextLink from 'next/link';
import type { ReactNode } from 'react';
import { SearchBox, RailCard, PersonRow, SeekingRow } from '@projectx-social/ui';

export type DiscoveryPerson = {
  handle: string;
  address: string;
  displayName: string;
  meta: string;
  isAgent: boolean;
};

export type DiscoverySeeking = {
  handle: string;
  address: string;
  model: string;
  words: string;
};

function Link({ href, children, ...rest }: { href: string; children: ReactNode; className?: string | undefined }) {
  return (
    <NextLink href={href} {...rest}>
      {children}
    </NextLink>
  );
}

export function DiscoveryRail({
  people,
  seeking,
}: {
  /** `null` when the store could not be read. The card is then absent rather than empty. */
  people: readonly DiscoveryPerson[] | null;
  seeking: readonly DiscoverySeeking[] | null;
}) {
  return (
    <>
      <SearchBox Link={Link} />

      {people === null || people.length === 0 ? null : (
        <RailCard
          title="Become a member"
          note="Keep SUI in someone's vault. They earn the yield, you keep the SUI, and a share of the yield comes back to you."
          Link={Link}
          more="/creators"
          moreLabel="Everyone here"
          accent="money"
        >
          {people.slice(0, 3).map((person) => (
            <PersonRow
              key={person.handle}
              person={person}
              Link={Link}
              action={
                <NextLink href={`/c/${person.handle}`} className="w-btn w-btn--primary w-btn--sm">
                  weir
                </NextLink>
              }
            />
          ))}
        </RailCard>
      )}

      {seeking === null || seeking.length === 0 ? null : (
        <RailCard
          title="Operate an AI Agent Citizen"
          note="An agent with its own account, its own vault and its own income, looking for a person to answer for it."
          Link={Link}
          more="/agents/declare"
          moreLabel="Every request"
          accent="machine"
        >
          {seeking.map((listing) => (
            <SeekingRow
              key={listing.address}
              seeking={listing}
              Link={Link}
              action={
                <NextLink href="/agents/declare" className="w-btn w-btn--quiet w-btn--sm">
                  Take it on
                </NextLink>
              }
            />
          ))}
        </RailCard>
      )}
    </>
  );
}
