// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * What `SignerProvider` still decides about wallets, now that it does not implement them.
 *
 * # What moved, and why this file is shorter than it was
 *
 * Discovery, connecting, disconnecting, autoconnect, the remembered wallet and the extension's own
 * `standard:events` account changes are `@mysten/dapp-kit`'s. Eighteen assertions in the previous
 * version of this file tested that plumbing against a hand-built mock of `standard:connect` and
 * `standard:events` — they were testing an implementation this repository no longer has, and
 * keeping them would have meant maintaining a second, worse copy of dapp-kit's own suite.
 *
 * They are not dropped quietly. Each is named below with what now covers it:
 *
 *   reconnecting from a stored record, and not reconnecting from a stale one
 *     -> `WalletProvider autoConnect` and its `storageKey`
 *   following the extension when the bound address stops being authorised, re-binding when one
 *   address remains, signing out when access is revoked, ignoring an empty change
 *     -> dapp-kit's wallet store, which subscribes to `standard:events` itself
 *   reading the authorised set from the wallet object rather than only from `connect()`
 *     -> `useAccounts`, which reports the wallet's set rather than a connect result
 *
 * # What is left is the part nobody else can test for us
 *
 * Whether several authorised addresses produce a QUESTION rather than a guess; that choosing one
 * switches to that one; that re-authorising asks the extension from nothing rather than accepting
 * its cached answer; that signing out reaches the server; and that no signature is ever requested
 * against a chain this deployment did not name. Those are product decisions, and they are here.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const account = (address: string, label?: string) => ({
  address,
  label,
  publicKey: new Uint8Array(),
  chains: ['sui:mainnet'],
  features: [],
});

const A = account('0x' + 'a'.repeat(64), 'Trading');
const B = account('0x' + 'b'.repeat(64));

/**
 * The wallet the kit reports.
 *
 * `accounts` is on the wallet itself, which is where the authorised set lives now — the previous kit
 * exposed it through a `useAccounts` hook, the rewrite removed that, and the migration guide points
 * at the connection's wallet. Rebuilt per test by {@link walletWith} so the two never disagree.
 */
const WALLET = {
  name: 'Test Wallet',
  chains: ['sui:mainnet'],
  features: ['standard:connect', 'sui:signTransaction', 'sui:signPersonalMessage'],
  accounts: [] as unknown[],
};

/* What the kit reports. Set per test, before rendering. */
let currentWallet: unknown = null;
let currentAccount: unknown = null;
let connectResult: { accounts: unknown[] } = { accounts: [] };
const connect = vi.fn(async () => connectResult);
const disconnect = vi.fn(async () => undefined);
const switchAccount = vi.fn();
const order: string[] = [];

/** The connected wallet, carrying exactly the addresses this test wants it to authorise. */
function walletWith(accounts: unknown[]) {
  return { ...WALLET, accounts };
}

/*
  The kit is one object with methods, not a set of mutation hooks.

  `useConnectWallet`/`useDisconnectWallet`/`useSwitchAccount` were react-query mutations in the
  deprecated kit; the rewrite dropped react-query entirely and put the actions on the instance
  `useDAppKit()` returns. The provider calls them directly, so that is what is mocked.
*/
const kit = {
  connectWallet: async () => {
    order.push('connect');
    return connect();
  },
  disconnectWallet: async () => {
    order.push('disconnect');
    return disconnect();
  },
  switchAccount,
};

vi.mock('@mysten/dapp-kit-react', () => ({
  DAppKitProvider: ({ children }: { children: React.ReactNode }) => children,
  useDAppKit: () => kit,
  useWallets: () => [WALLET],
  useCurrentAccount: () => currentAccount,
  useCurrentWallet: () => currentWallet,
}));
vi.mock('@mysten/dapp-kit-core', () => ({
  createDAppKit: () => kit,
  CurrentAccountSigner: class {},
}));
vi.mock('@mysten/sui/grpc', () => ({ SuiGrpcClient: class {} }));

const { SignerProvider, useSigner } = await import('../components/SignerProvider');
const { SESSION_STORAGE_KEY } = await import('../lib/zklogin');

/** Renders what the provider reports, and exposes its actions as buttons. */
function Probe() {
  const s = useSigner();
  return (
    <div>
      <span data-testid="address">{s.signer?.address ?? 'none'}</span>
      <span data-testid="choice">{s.accountChoice === null ? 'closed' : 'open'}</span>
      <span data-testid="choice-accounts">
        {(s.accountChoice?.accounts ?? []).map((a) => a.address).join(',')}
      </span>
      <span data-testid="reported">
        {s.walletAccounts === null ? 'null' : s.walletAccounts.map((a) => a.address).join(',')}
      </span>
      <span data-testid="error">{s.error ?? 'none'}</span>
      <button type="button" onClick={() => void s.connectWallet(WALLET as never)}>
        connect
      </button>
      <button type="button" onClick={() => s.chooseAccount(B as never)}>
        choose B
      </button>
      <button type="button" onClick={() => s.cancelAccountChoice()}>
        cancel
      </button>
      <button type="button" onClick={() => s.reopenAccountChoice()}>
        reopen
      </button>
      <button type="button" onClick={() => void s.reauthorizeWallet()}>
        reauthorize
      </button>
      <button type="button" onClick={() => s.signOut()}>
        sign out
      </button>
    </div>
  );
}

function mount(network: string | null = 'mainnet') {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ network: 'mainnet', available: false }),
    })),
  );
  return render(
    <SignerProvider network={network} rpcUrl="http://127.0.0.1:9000">
      <Probe />
    </SignerProvider>,
  );
}

const press = async (label: string) => {
  screen.getByText(label).click();
  await waitFor(() => undefined);
};

beforeEach(() => {
  currentWallet = null;
  currentAccount = null;
  connectResult = { accounts: [] };
  connect.mockClear();
  disconnect.mockClear();
  switchAccount.mockClear();
  order.length = 0;
  window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('several authorised addresses are a question, not a guess', () => {
  it('says nothing when the wallet authorised one', async () => {
    connectResult = { accounts: [A] };
    mount();
    await press('connect');
    expect(screen.getByTestId('choice').textContent).toBe('closed');
  });

  it('asks which, when the wallet authorised several', async () => {
    /*
      dapp-kit binds the first account it is handed. That is the wrong answer here: which address
      is bound decides whose vault, whose earnings and whose messages are on screen, and picking
      one silently is how somebody reads the wrong account's money.
    */
    connectResult = { accounts: [A, B] };
    currentWallet = walletWith([A, B]);
    mount();
    await press('connect');
    expect(screen.getByTestId('choice').textContent).toBe('open');
    expect(screen.getByTestId('choice-accounts').textContent).toBe(`${A.address},${B.address}`);
  });

  it('switches to the address the reader picked, and closes the question', async () => {
    connectResult = { accounts: [A, B] };
    currentWallet = walletWith([A, B]);
    mount();
    await press('connect');
    await press('choose B');
    expect(switchAccount).toHaveBeenCalledWith({ account: B });
    expect(screen.getByTestId('choice').textContent).toBe('closed');
  });

  it('lets the reader back out without switching to anything', async () => {
    connectResult = { accounts: [A, B] };
    currentWallet = walletWith([A, B]);
    mount();
    await press('connect');
    await press('cancel');
    expect(screen.getByTestId('choice').textContent).toBe('closed');
    expect(switchAccount).not.toHaveBeenCalled();
  });
});

describe('reopening the choice', () => {
  it('offers every address the wallet currently authorises', async () => {
    currentWallet = walletWith([A, B]);
    currentAccount = A;
    mount();
    await press('reopen');
    expect(screen.getByTestId('choice-accounts').textContent).toBe(`${A.address},${B.address}`);
  });

  it('says so rather than opening an empty question when no wallet is connected', async () => {
    mount();
    await press('reopen');
    expect(screen.getByTestId('choice').textContent).toBe('closed');
    expect(screen.getByTestId('error').textContent).toContain('no wallet is connected');
  });
});

describe('asking the extension again', () => {
  it('disconnects first, because a connected wallet answers from cache and shows nothing', async () => {
    currentWallet = walletWith([A]);
    currentAccount = A;
    connectResult = { accounts: [A] };
    mount();
    await press('reauthorize');
    expect(order).toEqual(['disconnect', 'connect']);
  });

  it('says so when there is no wallet to ask', async () => {
    mount();
    await press('reauthorize');
    expect(screen.getByTestId('error').textContent).toContain('no wallet is connected');
    expect(connect).not.toHaveBeenCalled();
  });
});

describe('what the provider reports about the wallet', () => {
  it('reports no addresses at all when no wallet is connected', async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId('reported').textContent).toBe('null'));
  });

  it('reports every address the wallet authorises, not only the bound one', async () => {
    currentWallet = walletWith([A, B]);
    currentAccount = A;
    mount();
    await waitFor(() =>
      expect(screen.getByTestId('reported').textContent).toBe(`${A.address},${B.address}`),
    );
  });

  it('signs as the account the kit reports as current', async () => {
    currentWallet = walletWith([A]);
    currentAccount = A;
    mount();
    await waitFor(() => expect(screen.getByTestId('address').textContent).toBe(A.address));
  });
});

describe('a deployment that does not know its network signs nothing', () => {
  /*
    A wallet is asked to sign for `sui:<network>`. With the configuration unread there is no honest
    value for that, and the failure a guess produces is a signature valid on a chain nobody chose.
  */
  it('builds no signer, even with a wallet and an account connected', async () => {
    currentWallet = walletWith([A]);
    currentAccount = A;
    mount(null);
    await waitFor(() => expect(screen.getByTestId('reported').textContent).toBe(A.address));
    expect(screen.getByTestId('address').textContent).toBe('none');
  });

  it('refuses to connect, and says why, rather than connecting into nothing', async () => {
    mount(null);
    await press('connect');
    expect(connect).not.toHaveBeenCalled();
    expect(screen.getByTestId('error').textContent).toContain('which network it is on');
  });
});

describe('signing out', () => {
  it('disconnects the wallet, clears the Google session, and tells the server', async () => {
    currentWallet = walletWith([A]);
    currentAccount = A;
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, '{"maxEpoch":1}');
    mount();
    await press('sign out');

    expect(disconnect).toHaveBeenCalled();
    expect(window.sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    /*
      The DELETE is the part that matters. Clearing this browser leaves a cookie that still proves
      a reader for as long as it has left to live, so signing out without it means the server has
      not agreed that anybody signed out.
    */
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(
      calls.some(
        ([url, init]) =>
          url === '/api/session' && (init as { method?: string } | undefined)?.method === 'DELETE',
      ),
    ).toBe(true);
  });
});
