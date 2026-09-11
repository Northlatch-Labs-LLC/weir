// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

vi.mock('@/components/app/AppFrame', () => ({
  AppFrame: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const { ExploreScreen } = await import('../components/app/ExploreScreen');

afterEach(cleanup);

const ROW = {
  handle: 'kaela_ai',
  address: `0x${'a'.repeat(64)}`,
  displayName: 'Kaela',
  bio: 'Audits Sui Move contracts',
  isAgent: true,
  pooled: 'no pool open',
  pooledState: 'none' as const,
  yieldShare: 'no pool',
  yieldState: 'none' as const,
};

const HIT = {
  id: 'p1',
  title: 'Three ways a Move upgrade can quietly change what you agreed to',
  preview: 'And the one property that stops all three.',
  authorHandle: 'kaela_ai',
  access: 'paid' as const,
};

function screenFor(props: Partial<Parameters<typeof ExploreScreen>[0]>) {
  return render(
    <ExploreScreen
      viewerAddress={null}
      viewerHandle={null}
      rows={[]}
      readAtMs={1_757_000_000_000}
      caveat=""
      {...props}
    />,
  );
}

describe('a search that matched', () => {
  it('shows the accounts and the posts, under headings that say which is which', () => {
    screenFor({ query: 'Move', rows: [ROW], posts: [HIT] });
    expect(screen.getByText('Accounts')).toBeTruthy();
    expect(screen.getByText('Posts')).toBeTruthy();
    expect(screen.getByText('Kaela')).toBeTruthy();
    expect(screen.getByText(HIT.title)).toBeTruthy();
  });

  it('links a post to the post, not to the author', () => {
    const { container } = screenFor({ query: 'Move', posts: [HIT] });
    expect(container.querySelector('a[href="/p/p1"]')).toBeTruthy();
  });

  it('says how a post is gated, and says nothing where it is not gated', () => {
    screenFor({ query: 'Move', posts: [HIT] });
    expect(screen.getByText('Paid unlock')).toBeTruthy();
    cleanup();
    screenFor({ query: 'Move', posts: [{ ...HIT, access: 'public' }] });
    expect(screen.queryByText('Paid unlock')).toBeNull();
    expect(screen.queryByText('Members only')).toBeNull();
  });

  it('counts both kinds, and offers the way back to the directory', () => {
    const { container } = screenFor({ query: 'Move', rows: [ROW], posts: [HIT] });
    expect(screen.getByText(/1 account and 1 post match/)).toBeTruthy();
    expect(container.querySelector('a[href="/explore"]')).toBeTruthy();
  });
});

describe('a search that matched nothing', () => {
  it('says so in the reader’s own words, and offers the directory', () => {
    screenFor({ query: 'zzzznothing', rows: [], posts: [] });
    expect(screen.getByText(/Nothing here matches/)).toBeTruthy();
    expect(screen.getByText('See everyone')).toBeTruthy();
  });
});

describe('a query too short to run', () => {
  it('says to keep typing and never says nothing matched', () => {
    screenFor({ query: 'ka', rows: [], posts: [], refusal: 'Keep going — a search needs at least 3 characters.' });
    expect(screen.getByText(/Keep going/)).toBeTruthy();
    expect(screen.queryByText(/Nothing here matches/)).toBeNull();
  });

  it('does not render the failure state either', () => {
    screenFor({ query: 'ka', refusal: 'Keep going — a search needs at least 3 characters.', failure: 'The store did not answer.' });
    expect(screen.queryByText(/being read from the chain/)).toBeNull();
  });
});

describe('the directory, unchanged', () => {
  it('is what an empty query still shows', () => {
    screenFor({ rows: [ROW] });
    expect(screen.getByText('everyone with a page here')).toBeTruthy();
    expect(screen.getByText(/1 creator, read from the store/)).toBeTruthy();
    expect(screen.queryByText('Accounts')).toBeNull();
    expect(screen.queryByText('Back to everyone')).toBeNull();
  });

  it('reports a store that did not answer as a failure, not as an empty directory', () => {
    screenFor({ rows: [], failure: 'The store did not answer.' });
    expect(screen.getByText(/The directory is being read from the chain/)).toBeTruthy();
  });
});
