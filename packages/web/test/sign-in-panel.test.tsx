// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

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

    expect(container.textContent).not.toMatch(/google/i);
    expect(container.textContent).not.toMatch(/not configured|not set up/i);
  });

  it('still tells a visitor what to do, rather than going quiet', () => {
    session = OFF;
    wallets = [];
    render(<SignIn />);

    expect(screen.getByText(/No Sui wallet in this browser/)).toBeTruthy();
    expect(screen.getByText('use a wallet')).toBeTruthy();
  });

  it('says something in the compact form too, which had no message of its own', () => {
    session = OFF;
    wallets = [];
    const { container } = render(<SignIn compact />);

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
    session = null;
    wallets = [];
    const { container } = render(<SignIn />);

    expect(container.textContent).not.toMatch(/google/i);
  });
});
