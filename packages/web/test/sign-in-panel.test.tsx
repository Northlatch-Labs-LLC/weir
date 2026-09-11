// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
/**
 * `SignIn` on a deployment that does not offer Google.
 *
 * # What this deployment was actually showing
 *
 * With zkLogin switched off and no wallet extension present — which is what a first-time visitor
 * on a plain browser gets — the panel rendered two overlapping notices, one of them reading
 * "Google is not configured on this deployment". A deliberate product decision was being announced
 * as a configuration fault, and the reader was pointed at a way in that does not exist here.
 *
 * These tests pin the two halves of that: nothing names Google when Google is not offered, and the
 * panel is never silent, because the previous fix for silence lived in the line that has now gone.
 *
 * The `compact` case matters most and is the easiest to lose: it took its only message from the
 * removed line, so an inline prompt would render an empty box and no test would have noticed.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

interface Session { network: string; available: boolean; reason?: string }

let session: Session | null = null;
let wallets: { name: string }[] = [];

vi.mock('next/navigation', () => ({ usePathname: () => '/signin' }));
vi.mock('@/components/SignerProvider', () => ({
  useSigner: () => ({
    signer: null,
    wallets,
    unusableWallets: [],
    session,
    accountChoice: null,
    walletAccounts: [],
    chooseAccount: vi.fn(),
    cancelAccountChoice: vi.fn(),
    reopenAccountChoice: vi.fn(),
    signInWithGoogle: vi.fn(),
    reauthorizeWallet: vi.fn(),
    connectWallet: vi.fn(),
    signOut: vi.fn(),
    error: null,
  }),
}));

const { SignIn } = await import('../components/SignIn');

/** What `/api/zklogin/session` answers with once the feature is switched off. */
const OFF: Session = {
  network: 'mainnet',
  available: false,
  reason: 'Signing in with Google is not enabled on this deployment.',
};

afterEach(() => {
  cleanup();
  session = null;
  wallets = [];
});

describe('SignIn with Google switched off', () => {
  it('never names Google when Google is not on offer', () => {
    session = OFF;
    wallets = [];
    const { container } = render(<SignIn />);

    // The deployment's choice is not the visitor's problem, and naming it reads as a fault.
    expect(container.textContent).not.toMatch(/google/i);
    expect(container.textContent).not.toMatch(/not configured|not set up/i);
  });

  it('still tells a visitor what to do, rather than going quiet', () => {
    session = OFF;
    wallets = [];
    render(<SignIn />);

    expect(screen.getByText(/No Sui wallet in this browser/)).toBeTruthy();
    // Not "or use a wallet": with nothing to be an alternative to, "or" sends people hunting.
    expect(screen.getByText('use a wallet')).toBeTruthy();
  });

  it('says something in the compact form too, which had no message of its own', () => {
    session = OFF;
    wallets = [];
    const { container } = render(<SignIn compact />);

    // The regression this guards: an inline prompt rendering an empty box and looking fine.
    expect(container.textContent?.trim()).not.toBe('');
    expect(screen.getByText(/A Sui wallet is needed to sign in/)).toBeTruthy();
  });

  it('keeps the wallet path unchanged when a wallet is present', () => {
    session = OFF;
    wallets = [{ name: 'Slush' }];
    const { container } = render(<SignIn />);

    expect(screen.getByText('Slush')).toBeTruthy();
    expect(container.textContent).not.toMatch(/google/i);
  });

  it('says nothing about availability while the server has not answered', () => {
    // `null` is "not asked yet", not "unavailable" — announcing absence during the gap would
    // tell a working deployment's users that a working feature is missing.
    session = null;
    wallets = [];
    const { container } = render(<SignIn />);

    expect(container.textContent).not.toMatch(/google/i);
  });
});
