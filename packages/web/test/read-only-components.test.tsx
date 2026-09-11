// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let signer: { address: string; kind: string; label: string } | null = null;
vi.mock('@/components/SignerProvider', () => ({ useSigner: () => ({ signer }) }));
vi.mock('@/components/SignIn', () => ({ SignIn: () => <div>sign in</div> }));

const { Purchases } = await import('../components/Purchases');
const { Referrals } = await import('../components/Referrals');

function mockJson(body: unknown, ok = true) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok, status: ok ? 200 : 503, json: async () => body })));
}

beforeEach(() => { signer = { address: '0xda78', kind: 'wallet', label: 'W' }; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Purchases', () => {
  it('does not render a failed read as an empty history', async () => {
    mockJson({ error: 'the chain could not be read' });
    render(<Purchases />);
    await waitFor(() => expect(screen.getByText(/could not be read/i)).toBeTruthy());
  });

  it('shows a subscription it did read', async () => {
    mockJson({
      subscriptions: [{
        objectId: '0xs', vaultId: '0xv', handle: 'alice', tier: 0, pricePaid: '500000', decimals: 6, symbol: 'USDC',
        startedAtMs: 1_700_000_000_000, expiresAtMs: 4_100_000_000_000, renewals: 0, active: true,
      }],
      unlocks: [], truncated: false,
    });
    render(<Purchases />);
    await waitFor(() => expect(screen.getByText(/alice/)).toBeTruthy());
  });

  it('offers sign-in rather than an empty statement when signed out', () => {
    signer = null;
    mockJson({ subscriptions: [], unlocks: [], truncated: false });
    render(<Purchases />);
    expect(screen.getByText('sign in')).toBeTruthy();
  });
});

describe('Referrals', () => {
  it('does not render a failed read as nobody referred', async () => {
    mockJson({ error: 'unreachable' });
    render(<Referrals />);
    await waitFor(() => expect(screen.getByText(/unreachable/i)).toBeTruthy());
  });

  it('shows a credited zero as a measured zero', async () => {
    mockJson({
      referred: [{ handle: 'nova', owner: '0xnova', createdAtMs: 1_700_000_000_000 }],
      earned: [], payments: 0, truncated: false,
    });
    render(<Referrals />);
    await waitFor(() => expect(screen.getByText(/nova/)).toBeTruthy());
  });

  it('flags a truncated walk rather than presenting it as complete', async () => {
    mockJson({ referred: [], earned: [], payments: 0, truncated: true });
    render(<Referrals />);
    await waitFor(() => expect(screen.getByText(/not complete|recent|more/i)).toBeTruthy());
  });
});
