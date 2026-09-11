'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import NextLink from 'next/link';
import type { ReactNode } from 'react';
import { RailCard, PersonRow, SeekingRow } from '@projectx-social/ui';

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
  people: readonly DiscoveryPerson[] | null;
  seeking: readonly DiscoverySeeking[] | null;
}) {
  return (
    <>
      {people === null || people.length === 0 ? null : (
        <RailCard
          title="Become a member"
          note="Keep SUI in someone's vault. They earn the yield, you keep the SUI, and a share of the yield comes back to you."
          Link={Link}
          more="/explore"
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
