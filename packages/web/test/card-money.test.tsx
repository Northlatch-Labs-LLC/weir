// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
/**
 * The money buttons on a card in the feed and on a creator's page do what they say.
 *
 * # The defect
 *
 * The shared card draws "Unlock · 0.05 SUI", "Subscribe" and "Support" and takes handlers for
 * each. The feed and the creator page rendered the card without any of them, so a signed-in
 * reader pressed a priced button and nothing happened: no dialog, no request, no error. The
 * single-post page was the only place a paid post could actually be bought. Production logs
 * showed it plainly — a day of traffic and not one request to the checkout route.
 */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PostView } from '@projectx-social/ui';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  usePathname: () => '/feed',
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const READER = `0x${'b'.repeat(64)}`;
vi.mock('@/components/SignerProvider', () => ({
  useSigner: () => ({
    ready: true,
    wake: () => {},
    signer: { kind: 'wallet', address: READER, label: 'Test Wallet', signTransaction: vi.fn(), signPersonalMessage: vi.fn() },
    signOut: vi.fn(),
    signInWithGoogle: vi.fn(),
    wallets: [],
    unusableWallets: [],
    connectWallet: vi.fn(),
    accountChoice: null,
    chooseAccount: vi.fn(),
    cancelAccountChoice: vi.fn(),
    reopenAccountChoice: vi.fn(),
    reauthorizeWallet: vi.fn(),
    proof: 'proved',
    proveSession: vi.fn(),
    walletAccounts: null,
    error: null,
    session: { network: 'mainnet', available: true },
  }),
}));
vi.mock('@/components/SignIn', () => ({ SignIn: () => <div>sign in</div> }));

const { FeedApp } = await import('@/components/app/FeedApp');
const { CreatorScreen } = await import('@/components/app/CreatorScreen');

const VAULT = `0x${'e'.repeat(64)}`;
const AUTHOR = { address: `0x${'a'.repeat(64)}`, handle: 'wren', displayName: 'Wren', isAgent: false };

function paidPost(id: string): PostView {
  return {
    id,
    author: AUTHOR,
    when: '4d',
    title: 'Cacio e pepe',
    body: 'Most cacio e pepe fails because the cheese clumps.',
    access: { kind: 'paid', price: '0.05 SUI' },
    unlocked: false,
    comments: 0,
  };
}

const UNLOCK = { vaultId: VAULT, contentKey: 'k-pasta', expectedPrice: '50000000' };

/* Every request the shell makes on mount answers empty; the one that matters is recorded. */
const calls: { url: string; body: Record<string, unknown> }[] = [];
beforeEach(() => {
  calls.length = 0;
  push.mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST') calls.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function feed(posts: PostView[], unlocks: Record<string, typeof UNLOCK>) {
  return render(
    <FeedApp
      viewerAddress={READER}
      viewerHandle="reader"
      viewerName="reader"
      posts={posts}
      unlocks={unlocks}
      tabs={[{ label: 'Everything', href: '/feed', current: true }]}
      emptyMessage="Nothing."
      creators={[]}
      creatorCount="1 account with a page here"
      sessionNote="Signed in as @reader"
    />,
  );
}

describe('a paid post in the feed', () => {
  it('opens the unlock dialog against the vault, key and price the server read', async () => {
    feed([paidPost('p1')], { p1: UNLOCK });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock · 0.05 SUI' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText("Unlock Wren's post")).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Unlock · 0.05 SUI' }));
    await waitFor(() => expect(calls.some((c) => c.url === '/api/checkout/unlock')).toBe(true));
    const sent = calls.find((c) => c.url === '/api/checkout/unlock')!.body;
    expect(sent).toMatchObject({ sender: READER, ...UNLOCK });
  });

  it('never does nothing: a priced post the page holds no target for goes to the post itself', () => {
    feed([paidPost('p2')], {});
    fireEvent.click(screen.getByRole('button', { name: 'Unlock · 0.05 SUI' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(push).toHaveBeenCalledWith('/p/p2');
  });

  it('sends a subscriber-only post to the tiers on the creator page', () => {
    feed([{ ...paidPost('p3'), access: { kind: 'subscribers', tier: null } }], {});
    fireEvent.click(screen.getByRole('button', { name: 'Subscribe' }));
    expect(push).toHaveBeenCalledWith('/c/wren?tab=membership');
  });

  it('sends Support to the creator page, where the tip lives', () => {
    feed([{ ...paidPost('p4'), access: { kind: 'free' } }], {});
    fireEvent.click(screen.getByRole('button', { name: /support/i }));
    expect(push).toHaveBeenCalledWith('/c/wren');
  });
});

describe('a paid post on the creator page', () => {
  it('opens the same dialog', async () => {
    render(
      <CreatorScreen
        profile={{ ...AUTHOR, bio: 'Pasta.', sui: 'wren.sui' }}
        counts={{ posts: 1, followers: 0, subscribers: null }}
        figures={[]}
        tiers={[]}
        posts={[paidPost('p5')]}
        unlocks={{ p5: UNLOCK }}
        followSlot={null}
        tab="posts"
        tabHref={{ posts: '/c/wren', membership: '/c/wren?tab=membership' }}
        viewerAddress={READER}
        viewerHandle="reader"
        emptyMessage="No posts."
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Unlock · 0.05 SUI' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText("Unlock Wren's post")).toBeTruthy();
  });
});
