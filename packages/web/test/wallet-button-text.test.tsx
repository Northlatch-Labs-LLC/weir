// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { SignInDoors } from '@/components/app/SignInDoors';

const base = {
  ready: true, address: null, signer: null, wallets: [], unusableWallets: [],
  signInWithGoogle: vi.fn(), connectWallet: vi.fn(), disconnect: vi.fn(),
  error: null as string | null, connecting: null as string | null,
};
let mock = { ...base };
vi.mock('@/components/SignerProvider', () => ({ useSigner: () => mock }));

afterEach(cleanup);

describe('the wallet button says one thing', () => {
  it('a usable wallet reads as its own name, with no status word inside the control', () => {
    mock = { ...base, wallets: [{ name: 'Slush' }] } as typeof base;
    render(<SignInDoors returnTo="/join" />);
    const button = screen.getByRole('button', { name: /slush/i });
    // The defect this replaces: the control's text was the run "Slushdetected".
    expect(button.textContent).toBe('Slush');
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it('a wallet that cannot sign on Sui says so, and cannot be pressed', () => {
    mock = { ...base, unusableWallets: [{ name: 'Keplr', missing: ['signing messages'] }] } as typeof base;
    render(<SignInDoors returnTo="/join" />);
    const button = screen.getByRole('button', { name: /keplr/i });
    expect(button.textContent).toContain('Cannot sign on Sui');
    expect(button.textContent).not.toContain('missing');
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('a wallet for another chain is named as such', () => {
    mock = { ...base, unusableWallets: [{ name: 'MetaMask', missing: [] }] } as typeof base;
    render(<SignInDoors returnTo="/join" />);
    expect(screen.getByRole('button', { name: /metamask/i }).textContent).toContain('Not a Sui wallet');
  });
});

describe('a wallet failure reaches the reader', () => {
  it('the door shows what went wrong — it used to be caught, published, and never rendered', () => {
    mock = { ...base, wallets: [{ name: 'Slush' }], error: 'Unlock your wallet, then press it again.' } as typeof base;
    render(<SignInDoors returnTo="/join" />);
    const shown = screen.getByRole('alert');
    expect(shown.textContent).toBe('Unlock your wallet, then press it again.');
  });

  it('nothing is shown when nothing is wrong', () => {
    mock = { ...base, wallets: [{ name: 'Slush' }] } as typeof base;
    render(<SignInDoors returnTo="/join" />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('while the extension is open the button says so and cannot be pressed again', () => {
    mock = { ...base, wallets: [{ name: 'Slush' }], connecting: 'Slush' } as typeof base;
    render(<SignInDoors returnTo="/join" />);
    const button = screen.getByRole('button', { name: /slush/i });
    expect(button.textContent).toContain('Check your wallet');
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });
});
