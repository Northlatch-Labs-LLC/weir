// @vitest-environment happy-dom
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * `SignerProvider` — who is signed in, and how they sign.
 *
 * Every other component inherits its correctness from this one. It holds the ephemeral spending key
 * for a zkLogin session, decides when that session is dead, and is the only place in the
 * application that touches a wallet. The failures worth pinning are the ones that hand somebody a
 * signer they should not have, or take one away they should:
 *
 *   Restoring a session past its maxEpoch offers a signer the network will refuse, and the user
 *   discovers that after typing an amount and reading a quote.
 *   Discarding a live one throws away a valid session for no reason.
 *   Leaving the key in storage after signing out means signing out did nothing.
 *   Guessing the network would let a wallet on testnet sign against mainnet ids.
 *
 * Expiry is the sharpest of them, because it is compared against the chain's epoch rather than a
 * clock — Sui epochs do not advance on a schedule, so a wall-clock guess is wrong in both
 * directions.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

/** Wallets the browser reports. Swapped per test. */
let registered: unknown[] = [];
vi.mock('@mysten/wallet-standard', () => ({
  getWallets: () => ({
    get: () => registered,
    // Registration is asynchronous in a real browser; nothing here needs to exercise that.
    on: () => () => undefined,
  }),
}));

/*
 * The zkLogin signer is stubbed. Constructing a real one needs a proof, and what is under test is
 * *when* the provider builds one — not the cryptography, which the pipeline suite covers against a
 * real key.
 */
const constructed = vi.fn();
vi.mock('@mysten/sui/zklogin', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ZkLoginSigner: class {
    constructor(options: unknown) {
      constructed(options);
    }
  },
}));

const { SignerProvider, useSigner } = await import('../components/SignerProvider');
const { SESSION_STORAGE_KEY } = await import('../lib/zklogin');

/** Renders whatever the provider currently reports, so assertions read off the DOM. */
function Probe() {
  const { signer, wallets, session } = useSigner();
  return (
    <div>
      <span data-testid="address">{signer?.address ?? 'none'}</span>
      <span data-testid="label">{signer?.label ?? 'none'}</span>
      <span data-testid="wallets">{wallets.length}</span>
      <span data-testid="network">{session?.network ?? 'unknown'}</span>
    </div>
  );
}

const ADDRESS = '0xda784b6c20c5995f6b719a20a26eddee5ec971c8ecec890e61c8b4634dd1715d';

/** A stored session that has completed. `maxEpoch` is the dial under test. */
function storedSession(maxEpoch: number) {
  return JSON.stringify({
    ephemeralSecretKey: Ed25519Keypair.generate().getSecretKey(),
    jwtRandomness: '123',
    maxEpoch,
    nonce: 'n',
    returnTo: '/',
    address: ADDRESS,
    jwt: 'a.b.c',
    salt: '',
    addressSeed: '456',
    proofPoints: {},
    issBase64Details: {},
    headerBase64: 'h',
  });
}

function mockSession(body: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => body })),
  );
}

beforeEach(() => {
  registered = [];
  constructed.mockClear();
  window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('an unconfigured deployment is not a broken one', () => {
  it('reports the network even when zkLogin is unavailable', async () => {
    /*
     * The wallet path needs the network whether or not Google sign-in exists. Returning it only
     * alongside a working zkLogin config would break wallets on every deployment that had not set
     * zkLogin up.
     */
    mockSession({ network: 'mainnet', available: false, reason: 'not set: …' });
    render(<SignerProvider><Probe /></SignerProvider>);
    await waitFor(() => expect(screen.getByTestId('network').textContent).toBe('mainnet'));
  });

  it('signs nobody in on its own', async () => {
    mockSession({ network: 'mainnet', available: true, currentEpoch: '1220', maxEpoch: 1222 });
    render(<SignerProvider><Probe /></SignerProvider>);
    await waitFor(() => expect(screen.getByTestId('network').textContent).toBe('mainnet'));
    expect(screen.getByTestId('address').textContent).toBe('none');
  });
});

describe('restoring a stored zkLogin session', () => {
  it('restores one that is still inside its epoch window', async () => {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, storedSession(1222));
    mockSession({ network: 'mainnet', available: true, currentEpoch: '1220', maxEpoch: 1222 });
    render(<SignerProvider><Probe /></SignerProvider>);
    await waitFor(() => expect(screen.getByTestId('address').textContent).toBe(ADDRESS));
    expect(screen.getByTestId('label').textContent).toBe('Google');
  });

  it('restores one at exactly maxEpoch, which the network still accepts', async () => {
    // Inclusive. Treating maxEpoch as expired throws away the last valid day of every session.
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, storedSession(1222));
    mockSession({ network: 'mainnet', available: true, currentEpoch: '1222', maxEpoch: 1224 });
    render(<SignerProvider><Probe /></SignerProvider>);
    await waitFor(() => expect(screen.getByTestId('address').textContent).toBe(ADDRESS));
  });

  it('discards one the chain has moved past, and clears the key', async () => {
    /*
     * The ephemeral key is a spending key until maxEpoch passes. Leaving a dead session in storage
     * would offer a signer the network refuses — discovered after the user has typed an amount.
     */
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, storedSession(1222));
    mockSession({ network: 'mainnet', available: true, currentEpoch: '1223', maxEpoch: 1225 });
    render(<SignerProvider><Probe /></SignerProvider>);
    await waitFor(() => expect(screen.getByTestId('network').textContent).toBe('mainnet'));
    expect(screen.getByTestId('address').textContent).toBe('none');
    expect(window.sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it('builds the signer with the expected address, so a wrong flag throws instead of signing', async () => {
    // Without it, a wrong `legacyAddress` yields a working signer for an address the user does not
    // control, and the first signature fails on chain with nothing explaining why.
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, storedSession(1222));
    mockSession({ network: 'mainnet', available: true, currentEpoch: '1220', maxEpoch: 1222 });
    render(<SignerProvider><Probe /></SignerProvider>);
    await waitFor(() => expect(constructed).toHaveBeenCalled());
    const options = constructed.mock.calls[0]?.[0] as { address: string; legacyAddress: boolean };
    expect(options.address).toBe(ADDRESS);
    expect(options.legacyAddress).toBe(false);
  });

  it('ignores a half-finished session left by an abandoned sign-in', async () => {
    // A pending session has an ephemeral key but no address or proof. It cannot sign.
    window.sessionStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ ephemeralSecretKey: Ed25519Keypair.generate().getSecretKey(), jwtRandomness: '1', maxEpoch: 1222, nonce: 'n', returnTo: '/' }),
    );
    mockSession({ network: 'mainnet', available: true, currentEpoch: '1220', maxEpoch: 1222 });
    render(<SignerProvider><Probe /></SignerProvider>);
    await waitFor(() => expect(screen.getByTestId('network').textContent).toBe('mainnet'));
    expect(screen.getByTestId('address').textContent).toBe('none');
  });

  it('discards unparseable storage rather than failing to start', async () => {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, 'not json');
    mockSession({ network: 'mainnet', available: true, currentEpoch: '1220', maxEpoch: 1222 });
    render(<SignerProvider><Probe /></SignerProvider>);
    await waitFor(() => expect(screen.getByTestId('network').textContent).toBe('mainnet'));
    expect(window.sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });
});

describe('wallets the browser offers', () => {
  const usable = {
    name: 'Test Wallet',
    chains: ['sui:mainnet'],
    features: {
      'standard:connect': {},
      'sui:signTransaction': {},
      'sui:signPersonalMessage': {},
    },
  };

  it('offers a wallet that can do everything the application asks', async () => {
    registered = [usable];
    mockSession({ network: 'mainnet', available: false });
    render(<SignerProvider><Probe /></SignerProvider>);
    await waitFor(() => expect(screen.getByTestId('wallets').textContent).toBe('1'));
  });

  it('hides one that cannot sign messages', async () => {
    /*
     * A wallet missing `sui:signPersonalMessage` can pay but cannot comment, follow, or read its
     * own direct messages — so it would connect and then fail on the third thing tried, with an
     * error about a missing feature.
     */
    registered = [{ ...usable, features: { 'standard:connect': {}, 'sui:signTransaction': {} } }];
    mockSession({ network: 'mainnet', available: false });
    render(<SignerProvider><Probe /></SignerProvider>);
    await waitFor(() => expect(screen.getByTestId('network').textContent).toBe('mainnet'));
    expect(screen.getByTestId('wallets').textContent).toBe('0');
  });

  it('hides one that supports no Sui chain', async () => {
    registered = [{ ...usable, chains: ['ethereum:1'] }];
    mockSession({ network: 'mainnet', available: false });
    render(<SignerProvider><Probe /></SignerProvider>);
    await waitFor(() => expect(screen.getByTestId('network').textContent).toBe('mainnet'));
    expect(screen.getByTestId('wallets').textContent).toBe('0');
  });
});

describe('using the hook outside the provider', () => {
  it('throws rather than reporting nobody signed in', () => {
    /*
     * A wiring mistake the developer must see at once. Returning `null` would render every signed
     * action as "not connected" on a page where the user is, in fact, connected — which reads as a
     * product bug and gets investigated everywhere except the missing provider.
     */
    expect(() => render(<Probe />)).toThrow(/SignerProvider/);
  });
});
