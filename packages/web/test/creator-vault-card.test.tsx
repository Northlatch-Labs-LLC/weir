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
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
}));

let signer: { address: string; label: string; kind: 'zklogin' | 'wallet' } | null = null;

vi.mock('@/components/SignerProvider', () => ({
  useSigner: () => ({
    ready: true,
    wake: () => {},
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

const { CreatorScreen } = await import('@/components/app/CreatorScreen');
const { TipButton } = await import('@/components/TipButton');

const PROFILE = {
  handle: 'nova',
  displayName: 'Nova',
  bio: 'A bio.',
  address: `0x${'a'.repeat(64)}`,
  isAgent: false,
  sui: 'nova.sui',
};

function card(overrides: { tipSlot?: ReactNode } = {}) {
  return render(
    <CreatorScreen
      profile={PROFILE}
      counts={{ posts: 0, followers: 0, subscribers: null }}
      figures={[]}
      tiers={[
        {
          price: '10 SUI',
          cadence: 'Monthly · every 30 days',
          net: 'Creator keeps 9.71 SUI',
          held: false,
          action: <button type="button" data-testid="subscribe">Join</button>,
        },
      ]}
      posts={[]}
      followSlot={<button type="button" data-testid="follow">Follow</button>}
      depositSlot={
        <div data-testid="deposit">
          <label htmlFor="amount">AMOUNT · SUI</label>
          <input id="amount" defaultValue="1" />
        </div>
      }
      tipSlot={overrides.tipSlot ?? <button type="button" data-testid="tip">Send a tip</button>}
      depositLine="Pool SUI behind this account."
      tab="membership"
      tabHref={{ posts: '/c/nova', membership: '/c/nova?tab=membership' }}
      viewerAddress={null}
      viewerHandle={null}
      emptyMessage="No posts yet."
    />,
  );
}

afterEach(cleanup);

describe('the support-vault card', () => {
  it('offers exactly one amount field, and it is the one the transaction is built from', () => {
    const { container } = card();
    /* The shell's own search field also lives in the aside; the pool card is the money surface. */
    const pool = container.querySelector('aside .w-card--money');
    expect(pool).not.toBeNull();

    const fields = pool!.querySelectorAll('input');
    expect(fields.length).toBe(1);
    expect(pool!.querySelector('[data-testid="deposit"]')?.contains(fields[0]!)).toBe(true);
  });

  it('leaves no label pointing at a control that is gone', () => {
    const { container } = card();
    const pool = container.querySelector('aside .w-card--money')!;
    for (const label of pool.querySelectorAll('label[for]')) {
      const target = label.getAttribute('for')!;
      expect(pool.querySelector(`#${target}`)).not.toBeNull();
    }
  });

  it('keeps the tip out of the pool card', () => {
    const { container } = card();
    const pool = container.querySelector('aside .w-card--money')!;
    expect(pool.querySelector('[data-testid="tip"]')).toBeNull();
  });

  it('puts the tip where the design already explains it', () => {
    const { container } = card();
    const membership = container.querySelector('section[aria-label="Membership"]')!;
    expect(membership.querySelector('[data-testid="tip"]')).not.toBeNull();
  });

  it('keeps the membership purchase in the tier card and out of the pool card', () => {
    const { container } = card();
    const pool = container.querySelector('aside .w-card--money')!;
    const membership = container.querySelector('section[aria-label="Membership"]')!;
    expect(membership.querySelector('[data-testid="subscribe"]')).not.toBeNull();
    expect(pool.querySelector('[data-testid="subscribe"]')).toBeNull();
  });
});

describe('the tip field', () => {
  it('puts the label above the field, not beside it', () => {
    signer = { address: '0xaaa', label: 'Wallet', kind: 'wallet' };
    const { container } = render(<TipButton vaultId="0xv" decimals={6} symbol="USDC" />);
    const label = container.querySelector('label[for="tip"]')!;
    expect(label.parentElement?.classList.contains('w-field')).toBe(true);
  });

  it('gives the field the flex row its own class requires', () => {
    signer = { address: '0xaaa', label: 'Wallet', kind: 'wallet' };
    const { container } = render(<TipButton vaultId="0xv" decimals={6} symbol="USDC" />);
    const input = container.querySelector('#tip')!;
    expect(input.parentElement?.classList.contains('w-field__row')).toBe(true);
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
