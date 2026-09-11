// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactNode } from 'react';

vi.mock('next/navigation', () => ({
  usePathname: () => '/c/nova',
  useSearchParams: () => new URLSearchParams(),
}));

let signer: { address: string; label: string; kind: 'zklogin' | 'wallet' } | null = null;

vi.mock('@/components/SignerProvider', () => ({
  useSigner: () => ({
    signer,
    signOut: vi.fn(),
    signInWithGoogle: vi.fn(),
    wallets: [],
    unusableWallets: [],
    connectWallet: vi.fn(),
    accountChoice: null,
    chooseAccount: vi.fn(),
    cancelAccountChoice: vi.fn(),
    error: null,
    session: { network: 'mainnet', available: true },
  }),
}));

const { DesignCreator } = await import('@/components/design/Creator');
const { TipButton } = await import('@/components/TipButton');

const PROFILE = {
  handle: 'nova',
  displayName: 'Nova',
  bio: 'A bio.',
  initials: 'no',
  meta: '@nova · 3 followers',
  sui: 'nova.sui',
};

function card(overrides: { tipSlot?: ReactNode } = {}) {
  return render(
    <DesignCreator
      counts={{ posts: 0, followers: 0, subscribers: null }}
      signedIn
      myHandle="nova"
      profile={PROFILE}
      tiers={[
        {
          price: '10 USDC',
          cadence: 'Monthly · every 30 days',
          net: 'Creator keeps 9.71 USDC',
          held: false,
          action: <button type="button" data-testid="subscribe">Join</button>,
        },
      ]}
      stats={[]}
      profilePosts={[]}
      viewingLabel="Viewing as a guest"
      tiersHref={undefined}
      tiersLabel="No vault"
      subscribeSlot={<button type="button" data-testid="follow">Follow</button>}
      depositSlot={
        <div data-testid="deposit">
          <label htmlFor="amount">AMOUNT · SUI</label>
          <input id="amount" defaultValue="1" />
        </div>
      }
      tipSlot={overrides.tipSlot ?? <button type="button" data-testid="tip">Send a tip</button>}
      depositLine="Pool SUI behind this account."
      depositNote="Withdrawable in full, any time."
      tab="membership"
      perks={[]}
      tabHref={{ posts: '/c/nova', membership: '/c/nova?tab=membership' }}
    />,
  );
}

afterEach(cleanup);

describe('the support-vault card', () => {
  it('offers exactly one amount field, and it is the one the transaction is built from', () => {
    const { container } = card();
    const aside = container.querySelector('aside');
    expect(aside).not.toBeNull();

    const fields = aside!.querySelectorAll('input');
    expect(fields.length).toBe(1);
    expect(aside!.querySelector('[data-testid="deposit"]')?.contains(fields[0]!)).toBe(true);
  });

  it('leaves no label pointing at a control that is gone', () => {
    const { container } = card();
    const aside = container.querySelector('aside')!;
    for (const label of aside.querySelectorAll('label[for]')) {
      const target = label.getAttribute('for')!;
      expect(aside.querySelector(`#${target}`)).not.toBeNull();
    }
  });

  it('keeps the tip out of the pool card', () => {
    const { container } = card();
    const aside = container.querySelector('aside')!;
    expect(aside.querySelector('[data-testid="tip"]')).toBeNull();
  });

  it('puts the tip where the design already explains it', () => {
    const { container } = card();
    const membership = container.querySelector('section[aria-label="Membership"]')!;
    expect(membership.querySelector('[data-testid="tip"]')).not.toBeNull();
  });

  it('keeps the membership purchase in the tier card and out of the pool card', () => {
    const { container } = card();
    const aside = container.querySelector('aside')!;
    const membership = container.querySelector('section[aria-label="Membership"]')!;
    expect(membership.querySelector('[data-testid="subscribe"]')).not.toBeNull();
    expect(aside.querySelector('[data-testid="subscribe"]')).toBeNull();
  });
});

describe('the tip field', () => {
  it('puts the label above the field, not beside it', () => {
    signer = { address: '0xaaa', label: 'Wallet', kind: 'wallet' };
    const { container } = render(<TipButton vaultId="0xv" decimals={6} symbol="USDC" />);
    const label = container.querySelector('label[for="tip"]')!;
    expect(getComputedStyle(label).display).toBe('block');
  });

  it('gives the field the flex row its own class requires', () => {
    signer = { address: '0xaaa', label: 'Wallet', kind: 'wallet' };
    const { container } = render(<TipButton vaultId="0xv" decimals={6} symbol="USDC" />);
    const input = container.querySelector('#tip')!;
    expect(getComputedStyle(input.parentElement!).display).toBe('flex');
  });
});

const PAGE = readFileSync(resolve(process.cwd(), 'app/c/[handle]/page.tsx'), 'utf8');

const DEPOSIT_SLOT = (() => {
  const start = PAGE.indexOf('const depositSlot');
  if (start === -1) throw new Error('depositSlot was not found on the creator page');
  const ends = ['const tipNote', 'const tipSlot']
    .map((decl) => PAGE.indexOf(decl, start))
    .filter((at) => at !== -1);
  const end = ends.length === 0 ? -1 : Math.min(...ends);
  return PAGE.slice(start, end === -1 ? PAGE.length : end);
})();

describe('what the creator page puts in the pool card', () => {
  it('mounts the deposit control there', () => {
    expect(DEPOSIT_SLOT).toContain('<DepositCheckout');
  });

  it('mounts no payment denominated in the creator’s own coin', () => {
    expect(DEPOSIT_SLOT).not.toContain('TipButton');
    expect(DEPOSIT_SLOT).not.toContain('SubscribeButton');
    expect(DEPOSIT_SLOT).not.toContain('coinDecimals');
  });

  it('builds a tip slot, so the control still exists somewhere', () => {
    expect(PAGE).toContain('const tipSlot');
    expect(PAGE).toContain('tipSlot={tipSlot}');
  });
});
