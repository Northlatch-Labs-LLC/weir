// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
/**
 * What `/explore` shows once it has been asked something.
 *
 * The frame's search box submits `q` here. Before this, the page read no query at all, so a search
 * was a navigation and nothing else. These assertions are about the four answers a search can have
 * — matches, nothing, too short, and the store not answering — and that the four stay four.
 *
 * The one that matters most is the third. "You have typed two characters" and "there is nobody
 * called that" are different sentences, and a page that prints both at once has told the reader
 * something it just said it had not looked for.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

// The frame reaches the wallet, the account menu and `usePathname`. None of that is what is under
// test here, and a search result must not depend on any of it.
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
  /*
    The whole point of this case. `discover` never ran, so the page knows nothing about whether
    anything matches — and must not imply that it does.
  */
  it('says to keep typing and never says nothing matched', () => {
    screenFor({ query: 'ka', rows: [], posts: [], refusal: 'Keep going — a search needs at least 3 characters.' });
    expect(screen.getByText(/Keep going/)).toBeTruthy();
    expect(screen.queryByText(/Nothing here matches/)).toBeNull();
  });

  it('does not render the failure state either', () => {
    screenFor({ query: 'ka', refusal: 'Keep going — a search needs at least 3 characters.', failure: 'The store did not answer.' });
    expect(screen.queryByText(/could not be read/)).toBeNull();
  });
});

describe('the directory, unchanged', () => {
  it('is what an empty query still shows', () => {
    screenFor({ rows: [ROW] });
    expect(screen.getByText('everyone with a page here')).toBeTruthy();
    expect(screen.getByText(/1 creator, read from the store/)).toBeTruthy();
    // No search happened, so no section headings and no way "back" to where you already are.
    expect(screen.queryByText('Accounts')).toBeNull();
    expect(screen.queryByText('Back to everyone')).toBeNull();
  });

  it('reports a store that did not answer as a failure, not as an empty directory', () => {
    screenFor({ rows: [], failure: 'The store did not answer.' });
    expect(screen.getByText(/The directory could not be read/)).toBeTruthy();
  });
});
