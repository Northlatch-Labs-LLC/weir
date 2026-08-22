// @vitest-environment happy-dom
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * Which address a wallet session binds to.
 *
 * # The defect these pin
 *
 * The failure is quiet in the worst way: a signature comes back, the transaction executes, and the
 * money moves from the wrong account. Nothing errors.
 *
 * # Why the fake wallet is here rather than a stub of `connectWallet`
 *
 * The bug lives in the shape of what a real wallet returns — a list, of which we used one. A stub
 * that hands back a single account cannot express it. `wallet()` below behaves like a Wallet
 * Standard wallet: `standard:connect` resolves `{ accounts }`, and `standard:events` hands out a
 * `change` listener that can be fired, and counted, so "unsubscribed on cleanup" is a fact rather
 * than a claim about a line of code.
 *
 * # Assertions are plain DOM
 *
 * `@testing-library/jest-dom` is not installed here. `textContent` and `toBeNull()` say the same
 * thing against the same tree.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Wallet, WalletAccount } from '@mysten/wallet-standard';

/** Wallets the browser reports. Swapped per test. */
let registered: unknown[] = [];
/*
  The registry's own listeners, kept firable rather than stubbed out.

  Restoring a session races wallet registration. An extension announces itself well after first
  paint, so a restore attempted once at mount looks at an empty registry and concludes there is no
  wallet. `announceWallets` below is that late arrival, and it is the only way to state as a fact
  that the restore waits for it.
*/
const registryListeners = new Set<() => void>();
vi.mock('@mysten/wallet-standard', () => ({
  getWallets: () => ({
    get: () => registered,
    on: (_event: string, listener: () => void) => {
      registryListeners.add(listener);
      return () => registryListeners.delete(listener);
    },
  }),
}));

// `SignIn` reads the current route to decide where Google should return the reader to. Nothing
// under test here depends on the value.
vi.mock('next/navigation', () => ({ usePathname: () => '/join' }));

import { SignerProvider, useSigner } from '@/components/SignerProvider';
import { SignIn } from '@/components/SignIn';

/*
  Three synthetic addresses, deliberately unmistakable for each other at a glance and equally
  unmistakable for anything on chain. The repeated nibble is the point: an assertion that passes on
  the wrong one of these is impossible to misread in a failure message.
*/
const FIRST = '0x1111111111111111111111111111111111111111111111111111111111111111';
const SECOND = '0x2222222222222222222222222222222222222222222222222222222222222222';
const THIRD = '0x3333333333333333333333333333333333333333333333333333333333333333';

type ChangeProperties = { accounts?: readonly WalletAccount[] };
type ChangeListener = (properties: ChangeProperties) => void;

/**
 * The smallest thing shaped like a wallet account. Only `address` and `label` are read, so the cast
 * stays confined here rather than spreading across every case.
 */
function account(address: string, label?: string): WalletAccount {
  return { address, label, chains: ['sui:mainnet'], features: [] } as unknown as WalletAccount;
}

/**
 * A wallet that behaves like a real one: it authorises a list of accounts, it keeps that list on
 * itself where the Wallet Standard says it lives, and it can announce that the list changed the way
 * an extension does when the user switches account inside it.
 */
function wallet(
  accounts: readonly WalletAccount[],
  options: {
    events?: boolean;
    /*
      What `standard:connect` resolves with, when that differs from what the wallet object holds.
    */
    returns?: readonly WalletAccount[];
    /** A wallet that refuses `{ silent: true }`. Several do, and that is not a failure. */
    silentThrows?: boolean;
  } = {},
) {
  const listeners = new Set<ChangeListener>();
  // Mutable, because `announce` has to move it: an extension that switches account changes what
  // `wallet.accounts` reports from that moment on, and a restore reading a frozen list would pass
  // for the wrong reason.
  const held = { accounts };

  const connect = vi.fn(async (input?: { silent?: boolean }) => {
    if (input?.silent === true && options.silentThrows === true) {
      throw new Error('this wallet cannot connect without asking');
    }
    return { accounts: options.returns ?? held.accounts };
  });

  const events = {
    version: '1.0.0',
    on: (event: string, listener: ChangeListener) => {
      if (event !== 'change') return () => undefined;
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  const features: Record<string, unknown> = {
    'standard:connect': { version: '1.0.0', connect },
    'sui:signTransaction': { version: '2.0.0', signTransaction: vi.fn() },
    'sui:signPersonalMessage': { version: '1.1.0', signPersonalMessage: vi.fn() },
  };
  // Off by request, so the "wallet has no events feature" case is exercised rather than assumed.
  if (options.events !== false) features['standard:events'] = events;

  return {
    handle: {
      name: 'Slush',
      chains: ['sui:mainnet'],
      // A getter, not a snapshot: the real property tracks the extension, and code that caches it
      // at connect time would go stale exactly when the reader switches account.
      get accounts() {
        return held.accounts;
      },
      features,
    } as unknown as Wallet,
    connect,
    /** Fire what a wallet fires when its authorised accounts change. */
    announce(properties: ChangeProperties) {
      if (properties.accounts !== undefined) held.accounts = properties.accounts;
      act(() => listeners.forEach((listener) => listener(properties)));
    },
    /** Must reach zero on cleanup, or every mount of the app leaks a listener into the extension. */
    listening: () => listeners.size,
  };
}

/** What the browser does when an extension registers itself after the page has already painted. */
function announceWallets(handles: unknown[]) {
  registered = handles;
  act(() => registryListeners.forEach((listener) => listener()));
}

/** Renders whatever the provider currently reports, so assertions read off the DOM. */
function Probe() {
  const { signer } = useSigner();
  return <span data-testid="bound">{signer?.address ?? 'none'}</span>;
}

function mockSession(body: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => body })),
  );
}

/*
  Google is switched off in every case here. It is a second button with nothing to do with which
  address a wallet binds to, and leaving it on puts an irrelevant control in every query.
*/
function mount(children: React.ReactNode) {
  mockSession({ network: 'mainnet', available: false, reason: 'not set: GOOGLE_CLIENT_ID' });
  return render(<SignerProvider>{children}</SignerProvider>);
}

/** The panel renders nothing on its first pass; `findBy*` waits for the mount effect to land. */
async function clickWallet() {
  fireEvent.click(await screen.findByRole('button', { name: 'Slush' }));
}

function bound(): string | null {
  return screen.getByTestId('bound').textContent;
}

/** What a wallet session is remembered as between reloads. Mirrors `lib/signer.ts`. */
const REMEMBERED = 'projectx.wallet';

/*
  A `localStorage` for the test environment, because there isn't one.

  happy-dom implements `sessionStorage` but `window.localStorage` reads as `undefined` here: Node
  ships its own experimental `localStorage` global that is inert unless the process was started with
  `--localstorage-file`, and it shadows the one happy-dom would otherwise provide.

  So this is not a mock standing in for behaviour under test — it is the missing half of the DOM.
  Map-backed and exact, so `getItem` on an absent key returns `null` the way the real API does
  rather than `undefined`, which is the distinction every assertion below turns on.
*/
const stored = new Map<string, string>();
Object.defineProperty(window, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => void stored.set(key, value),
    removeItem: (key: string) => void stored.delete(key),
    clear: () => stored.clear(),
    key: (index: number) => [...stored.keys()][index] ?? null,
    get length() {
      return stored.size;
    },
  },
});

function remember(walletName: string, address: string) {
  window.localStorage.setItem(REMEMBERED, JSON.stringify({ wallet: walletName, address }));
}

beforeEach(() => {
  registered = [];
  registryListeners.clear();
  stored.clear();
});

/*
  Explicit, because this config does not set `globals: true` — so React Testing Library's automatic
  cleanup never registers. Without it every render stays in the document and the second test onwards
  fails with "found multiple elements", which reads as a duplicate-rendering bug in the component
  rather than as the harness leaking between tests.
*/
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('choosing which address a wallet session uses', () => {
  /*
    One account is not a choice. Making somebody confirm the only answer to a question they were not
    asked is a step that exists for the implementation's convenience, not theirs.
  */
  it('connects straight through when the wallet authorises one address', async () => {
    const slush = wallet([account(FIRST)]);
    registered = [slush.handle];
    mount(<><SignIn /><Probe /></>);

    await clickWallet();

    await waitFor(() => expect(bound()).toBe(FIRST));
    expect(screen.queryByText(/Which Slush address/)).toBeNull();
  });

  it('asks which address when the wallet authorises several, and binds to none until told', async () => {
    const slush = wallet([account(FIRST), account(SECOND), account(THIRD)]);
    registered = [slush.handle];
    mount(<><SignIn /><Probe /></>);

    await clickWallet();

    await screen.findByText(/Which Slush address/);
    expect(bound()).toBe('none');
    for (const address of [FIRST, SECOND, THIRD]) {
      expect(screen.queryByRole('button', { name: new RegExp(address) })).not.toBeNull();
    }
  });

  /*
    The defect itself. Picking the third address and getting the first is the live report, and it is
    invisible: the wallet signs, the chain accepts, and the money leaves an account nobody chose.
  */
  it('binds to the address the reader picked, not the first the wallet returned', async () => {
    const slush = wallet([account(FIRST), account(SECOND), account(THIRD)]);
    registered = [slush.handle];
    mount(<><SignIn /><Probe /></>);

    await clickWallet();
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(THIRD) }));

    await waitFor(() => expect(bound()).toBe(THIRD));
  });

  /*
    Addresses are shown in full. A picker is the one place truncation cannot be tolerated: `0x1111…`
    and `0x1111…` are the same six characters, and choosing between two of those is choosing blind.
  */
  it('shows each address in full, and the wallet’s own name for it when there is one', async () => {
    const slush = wallet([account(FIRST, 'Everyday'), account(SECOND)]);
    registered = [slush.handle];
    mount(<><SignIn /><Probe /></>);

    await clickWallet();

    const labelled = await screen.findByRole('button', { name: new RegExp(FIRST) });
    expect(labelled.textContent).toContain(FIRST);
    expect(labelled.textContent).toContain('Everyday');
    // No invented name for the one the wallet did not name — "Account 2" is data nobody measured.
    const plain = screen.getByRole('button', { name: new RegExp(SECOND) });
    expect(plain.textContent).toBe(SECOND);
  });

  it('lets the reader back out of the choice without binding to anything', async () => {
    const slush = wallet([account(FIRST), account(SECOND)]);
    registered = [slush.handle];
    mount(<><SignIn /><Probe /></>);

    await clickWallet();
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByText(/Which Slush address/)).toBeNull());
    expect(bound()).toBe('none');
    // Back to the wallet list, rather than a panel with nothing on it.
    expect(screen.queryByRole('button', { name: 'Slush' })).not.toBeNull();
  });

  it('says the wallet authorised nothing rather than binding to an absent account', async () => {
    const slush = wallet([]);
    registered = [slush.handle];
    mount(<><SignIn /><Probe /></>);

    await clickWallet();

    await screen.findByText('the wallet returned no accounts');
    expect(bound()).toBe('none');
  });
});

describe('following the account the wallet is on', () => {
  async function connectAndPick(address: string) {
    const slush = wallet([account(FIRST), account(SECOND), account(THIRD)]);
    registered = [slush.handle];
    mount(<><SignIn /><Probe /></>);
    await clickWallet();
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(address) }));
    await waitFor(() => expect(bound()).toBe(address));
    return slush;
  }

  /*
    The extension is the other half of this control. Switching account inside Slush and leaving the
    page bound to the old one produces a signature request the wallet answers from a different
    address than the page is showing.
  */
  it('moves with the wallet when the bound address is no longer authorised', async () => {
    const slush = await connectAndPick(SECOND);

    slush.announce({ accounts: [account(THIRD)] });

    await waitFor(() => expect(bound()).toBe(THIRD));
  });

  /*
    The other direction, and the one that is easy to get wrong. A wallet re-announcing its whole list
    has not asked us to change anything, and taking the first entry there would silently undo the
    reader's explicit choice — reintroducing the original defect through the back door.
  */
  it('keeps the picked address when the wallet still authorises it', async () => {
    const slush = await connectAndPick(THIRD);

    slush.announce({ accounts: [account(FIRST), account(SECOND), account(THIRD)] });

    expect(bound()).toBe(THIRD);
  });

  /*
    The bound address is gone and there is more than one candidate left. There is no answer to be
    read off that list — picking one is guessing, and `accounts[0]` is the exact guess this whole
    change exists to delete. So the reader is asked again, and nothing signs in the meantime.
  */
  it('asks again rather than guessing when several addresses remain and none is the bound one', async () => {
    const slush = await connectAndPick(SECOND);

    slush.announce({ accounts: [account(FIRST), account(THIRD)] });

    await waitFor(() => expect(bound()).toBe('none'));
    expect(screen.queryByText(/Which Slush address/)).not.toBeNull();
    for (const address of [FIRST, THIRD]) {
      expect(screen.queryByRole('button', { name: new RegExp(address) })).not.toBeNull();
    }
  });

  /*
    The list on the sign-in surface is only worth having if it tracks the extension. A wallet that
    authorises a third address while the page is open must say so there, or the reader checks a
    stale list against a live wallet and concludes we lost one.
  */
  it('updates the reported addresses when the wallet authorises another', async () => {
    const slush = await connectAndPick(SECOND);

    slush.announce({ accounts: [account(FIRST), account(SECOND), account(THIRD)] });

    await waitFor(() => expect(screen.queryByText(/Slush reports 3 addresses/)).not.toBeNull());
    expect(bound()).toBe(SECOND);
  });

  /*
    An empty list is a revocation: the reader took this site's access away in the extension. Leaving
    the address on screen would show a session that cannot sign, and they would find that out at the
    end of a checkout.
  */
  it('signs out, and says so, when the wallet revokes access', async () => {
    const slush = await connectAndPick(FIRST);

    slush.announce({ accounts: [] });

    await waitFor(() => expect(bound()).toBe('none'));
    expect(screen.queryByText(/Slush is no longer sharing/)).not.toBeNull();
  });

  /*
    `accounts` absent means the wallet changed something else — its chains, its features. "We were
    not told" is not "there are none", and treating the two alike drops a working session.
  */
  it('ignores a change that carries no accounts at all', async () => {
    const slush = await connectAndPick(SECOND);

    slush.announce({});

    expect(bound()).toBe(SECOND);
  });

  it('stops listening when the provider goes away', async () => {
    const slush = await connectAndPick(FIRST);
    expect(slush.listening()).toBe(1);

    cleanup();

    expect(slush.listening()).toBe(0);
  });

  /*
    `standard:events` is not among the features this application requires, so a wallet without it
    must still connect and sign. It simply cannot tell us when it moves.
  */
  it('connects to a wallet that announces nothing', async () => {
    const slush = wallet([account(FIRST)], { events: false });
    registered = [slush.handle];
    mount(<><SignIn /><Probe /></>);

    await clickWallet();

    await waitFor(() => expect(bound()).toBe(FIRST));
  });
});

/*
  What the wallet said, on screen, permanently.
*/
describe('reporting what the wallet actually returned', () => {
  it('says how many addresses the wallet reports, and shows every one in full', async () => {
    const slush = wallet([account(FIRST), account(SECOND), account(THIRD)]);
    registered = [slush.handle];
    mount(<><SignIn /><Probe /></>);

    await clickWallet();
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(SECOND) }));
    await waitFor(() => expect(bound()).toBe(SECOND));

    expect(screen.queryByText(/Slush reports 3 addresses/)).not.toBeNull();
    // In full, all of them — an address abbreviated to six characters cannot be checked against
    // the one the extension is showing, which is the entire comparison being made here.
    //
    // Read off the report's own list rather than the document, because `Probe` renders the bound
    // address too and a document-wide query cannot tell which of the two it found.
    const reported = screen.getByRole('list').textContent;
    for (const address of [FIRST, SECOND, THIRD]) {
      expect(reported).toContain(address);
    }
  });

  it('marks which of the reported addresses this session signs with', async () => {
    const slush = wallet([account(FIRST), account(SECOND)]);
    registered = [slush.handle];
    mount(<><SignIn /><Probe /></>);

    await clickWallet();
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(SECOND) }));
    await waitFor(() => expect(bound()).toBe(SECOND));

    const rows = screen.getAllByRole('listitem');
    expect(rows.find((row) => row.textContent?.includes(SECOND))?.textContent).toContain(
      'signing with this one',
    );
    expect(rows.find((row) => row.textContent?.includes(FIRST))?.textContent).not.toContain(
      'signing with this one',
    );
  });

  it('reports a single shared address rather than staying silent about it', async () => {
    const slush = wallet([account(FIRST)]);
    registered = [slush.handle];
    mount(<><SignIn /><Probe /></>);

    await clickWallet();
    await waitFor(() => expect(bound()).toBe(FIRST));

    expect(screen.queryByText(/Slush reports 1 address/)).not.toBeNull();
    expect(screen.getByRole('list').textContent).toContain(FIRST);
  });
});

/*
  Where the authorised set is read from.

  The Wallet Standard keeps the authorised accounts on `wallet.accounts`. `connect()` resolving with
  one entry does not mean one is authorised — several wallets answer with the currently-active
  account and leave the rest on the wallet object. Reading only the return value is how a wallet
  holding three addresses produces a session that never once offered a choice, which is the report.
*/
describe('reading the authorised set from the wallet, not only from connect()', () => {
  it('offers every address the wallet object holds, not just the one connect() returned', async () => {
    const slush = wallet([account(FIRST), account(SECOND), account(THIRD)], {
      returns: [account(FIRST)],
    });
    registered = [slush.handle];
    mount(<><SignIn /><Probe /></>);

    await clickWallet();

    await screen.findByText(/Which Slush address/);
    expect(bound()).toBe('none');
    for (const address of [FIRST, SECOND, THIRD]) {
      expect(screen.queryByRole('button', { name: new RegExp(address) })).not.toBeNull();
    }
  });

  /*
    The other direction. A wallet that authorises an address during this very connect can return it
    before its own `accounts` property has caught up, and dropping it would lose the address the
    reader just approved.
  */
  it('keeps an address connect() returned that the wallet object had not listed yet', async () => {
    const slush = wallet([account(FIRST)], { returns: [account(FIRST), account(SECOND)] });
    registered = [slush.handle];
    mount(<><SignIn /><Probe /></>);

    await clickWallet();

    await screen.findByText(/Which Slush address/);
    expect(screen.queryByRole('button', { name: new RegExp(SECOND) })).not.toBeNull();
  });

  /*
    A reader whose other addresses were never authorised cannot be left at a dead end. Re-invoking
    connect is what makes several wallets show their own account picker, which is the only surface
    that can widen an authorisation — nothing on this page can.
  */
  it('offers a way back to the wallet’s own authorisation when it shared one address', async () => {
    const slush = wallet([account(FIRST)]);
    registered = [slush.handle];
    mount(<><SignIn /><Probe /></>);

    await clickWallet();
    await waitFor(() => expect(bound()).toBe(FIRST));
    expect(slush.connect).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /Ask Slush/ }));

    await waitFor(() => expect(slush.connect).toHaveBeenCalledTimes(2));
  });

  it('lets a reader reopen the choice between addresses already authorised', async () => {
    const slush = wallet([account(FIRST), account(SECOND), account(THIRD)]);
    registered = [slush.handle];
    mount(<><SignIn /><Probe /></>);

    await clickWallet();
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(FIRST) }));
    await waitFor(() => expect(bound()).toBe(FIRST));

    fireEvent.click(screen.getByRole('button', { name: /different address/ }));
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(THIRD) }));

    await waitFor(() => expect(bound()).toBe(THIRD));
    // Reopening asks us, not the extension. The wallet was already told what to authorise.
    expect(slush.connect).toHaveBeenCalledTimes(1);
  });
});

describe('the choice outliving the panel that offered it', () => {
  /*
    `SignIn` is rendered by twelve components and unmounts on every navigation. A pending choice held
    in its own state would vanish when the reader moved, leaving a connected wallet and no address —
    which is why this state belongs to the provider at the root, not to the panel.

    Changing the key is how a route change is expressed here: React unmounts the old element and
    mounts a fresh one, exactly as a navigation between two pages that each render `SignIn` does.
  */
  it('keeps the pending choice when the panel that opened it is replaced', async () => {
    const slush = wallet([account(FIRST), account(SECOND), account(THIRD)]);
    registered = [slush.handle];
    const { rerender } = mount(<><SignIn key="/join" /><Probe /></>);

    await clickWallet();
    await screen.findByText(/Which Slush address/);

    rerender(<SignerProvider><><SignIn key="/earnings" /><Probe /></></SignerProvider>);

    fireEvent.click(await screen.findByRole('button', { name: new RegExp(SECOND) }));
    await waitFor(() => expect(bound()).toBe(SECOND));
  });

  it('keeps the chosen address when the panel is replaced', async () => {
    const slush = wallet([account(FIRST), account(SECOND), account(THIRD)]);
    registered = [slush.handle];
    const { rerender } = mount(<><SignIn key="/join" /><Probe /></>);

    await clickWallet();
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(THIRD) }));
    await waitFor(() => expect(bound()).toBe(THIRD));

    rerender(<SignerProvider><><SignIn key="/earnings" /><Probe /></></SignerProvider>);

    expect(bound()).toBe(THIRD);
    // And the fresh panel shows the session rather than offering to start another one.
    expect(await screen.findByRole('button', { name: 'Sign out' })).not.toBeNull();
  });
});

