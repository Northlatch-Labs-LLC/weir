// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';

let registered: unknown[] = [];

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@mysten/dapp-kit-react', () => ({
  DAppKitProvider: ({ children }: { children: React.ReactNode }) => children,
  useDAppKit: () => ({
    connectWallet: vi.fn(async () => ({ accounts: [] })),
    disconnectWallet: vi.fn(async () => undefined),
    switchAccount: vi.fn(),
  }),
  useWallets: () => registered,
  useCurrentAccount: () => null,
  useCurrentWallet: () => null,
}));
vi.mock('@mysten/dapp-kit-core', () => ({
  createDAppKit: () => ({}),
  CurrentAccountSigner: class {},
}));
vi.mock('@mysten/sui/grpc', () => ({ SuiGrpcClient: class {} }));

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
    mockSession({ network: 'mainnet', available: false, reason: 'not set: …' });
    render(<SignerProvider network="mainnet" rpcUrl="http://127.0.0.1:9000"><Probe /></SignerProvider>);
    await waitFor(() => expect(screen.getByTestId('network').textContent).toBe('mainnet'));
  });

  it('signs nobody in on its own', async () => {
    mockSession({ network: 'mainnet', available: true, currentEpoch: '1220', maxEpoch: 1222 });
    render(<SignerProvider network="mainnet" rpcUrl="http://127.0.0.1:9000"><Probe /></SignerProvider>);
    await waitFor(() => expect(screen.getByTestId('network').textContent).toBe('mainnet'));
    expect(screen.getByTestId('address').textContent).toBe('none');
  });
});

describe('restoring a stored zkLogin session', () => {
  it('restores one that is still inside its epoch window', async () => {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, storedSession(1222));
    mockSession({ network: 'mainnet', available: true, currentEpoch: '1220', maxEpoch: 1222 });
    render(<SignerProvider network="mainnet" rpcUrl="http://127.0.0.1:9000"><Probe /></SignerProvider>);
    await waitFor(() => expect(screen.getByTestId('address').textContent).toBe(ADDRESS));
    expect(screen.getByTestId('label').textContent).toBe('Google');
  });

  it('restores one at exactly maxEpoch, which the network still accepts', async () => {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, storedSession(1222));
    mockSession({ network: 'mainnet', available: true, currentEpoch: '1222', maxEpoch: 1224 });
    render(<SignerProvider network="mainnet" rpcUrl="http://127.0.0.1:9000"><Probe /></SignerProvider>);
    await waitFor(() => expect(screen.getByTestId('address').textContent).toBe(ADDRESS));
  });

  it('discards one the chain has moved past, and clears the key', async () => {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, storedSession(1222));
    mockSession({ network: 'mainnet', available: true, currentEpoch: '1223', maxEpoch: 1225 });
    render(<SignerProvider network="mainnet" rpcUrl="http://127.0.0.1:9000"><Probe /></SignerProvider>);
    await waitFor(() => expect(screen.getByTestId('network').textContent).toBe('mainnet'));
    expect(screen.getByTestId('address').textContent).toBe('none');
    expect(window.sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it('builds the signer with the expected address, so a wrong flag throws instead of signing', async () => {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, storedSession(1222));
    mockSession({ network: 'mainnet', available: true, currentEpoch: '1220', maxEpoch: 1222 });
    render(<SignerProvider network="mainnet" rpcUrl="http://127.0.0.1:9000"><Probe /></SignerProvider>);
    await waitFor(() => expect(constructed).toHaveBeenCalled());
    const options = constructed.mock.calls[0]?.[0] as { address: string; legacyAddress: boolean };
    expect(options.address).toBe(ADDRESS);
    expect(options.legacyAddress).toBe(false);
  });

  it('ignores a half-finished session left by an abandoned sign-in', async () => {
    window.sessionStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({ ephemeralSecretKey: Ed25519Keypair.generate().getSecretKey(), jwtRandomness: '1', maxEpoch: 1222, nonce: 'n', returnTo: '/' }),
    );
    mockSession({ network: 'mainnet', available: true, currentEpoch: '1220', maxEpoch: 1222 });
    render(<SignerProvider network="mainnet" rpcUrl="http://127.0.0.1:9000"><Probe /></SignerProvider>);
    await waitFor(() => expect(screen.getByTestId('network').textContent).toBe('mainnet'));
    expect(screen.getByTestId('address').textContent).toBe('none');
  });

  it('discards unparseable storage rather than failing to start', async () => {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, 'not json');
    mockSession({ network: 'mainnet', available: true, currentEpoch: '1220', maxEpoch: 1222 });
    render(<SignerProvider network="mainnet" rpcUrl="http://127.0.0.1:9000"><Probe /></SignerProvider>);
    await waitFor(() => expect(screen.getByTestId('network').textContent).toBe('mainnet'));
    expect(window.sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });
});

describe('wallets the browser offers', () => {
  const usable = {
    name: 'Test Wallet',
    chains: ['sui:mainnet'],
    features: ['standard:connect', 'sui:signTransaction', 'sui:signPersonalMessage'],
  };

  it('offers a wallet that can do everything the application asks', async () => {
    registered = [usable];
    mockSession({ network: 'mainnet', available: false });
    render(<SignerProvider network="mainnet" rpcUrl="http://127.0.0.1:9000"><Probe /></SignerProvider>);
    await waitFor(() => expect(screen.getByTestId('wallets').textContent).toBe('1'));
  });

  it('hides one that cannot sign messages', async () => {
    registered = [{ ...usable, features: ['standard:connect', 'sui:signTransaction'] }];
    mockSession({ network: 'mainnet', available: false });
    render(<SignerProvider network="mainnet" rpcUrl="http://127.0.0.1:9000"><Probe /></SignerProvider>);
    await waitFor(() => expect(screen.getByTestId('network').textContent).toBe('mainnet'));
    expect(screen.getByTestId('wallets').textContent).toBe('0');
  });

  it('hides one that supports no Sui chain', async () => {
    registered = [{ ...usable, chains: ['ethereum:1'] }];
    mockSession({ network: 'mainnet', available: false });
    render(<SignerProvider network="mainnet" rpcUrl="http://127.0.0.1:9000"><Probe /></SignerProvider>);
    await waitFor(() => expect(screen.getByTestId('network').textContent).toBe('mainnet'));
    expect(screen.getByTestId('wallets').textContent).toBe('0');
  });
});

describe('using the hook outside the provider', () => {
  it('throws rather than reporting nobody signed in', () => {
    expect(() => render(<Probe />)).toThrow(/SignerProvider/);
  });
});
