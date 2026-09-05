'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude

/**
 * Who is signed in, and how they sign.
 *
 * One provider at the root of the application. Components call `useSigner()` and get an
 * `ActiveSigner` or `null`; none of them discovers a wallet, none of them knows what zkLogin is,
 * and none of them decides what "signed in" means.
 *
 * # Two ways in, one way out
 *
 * A browser wallet and a Google sign-in produce the same object. The only place the difference is
 * visible is the label shown to the user, which is the one place it *should* be visible.
 *
 * # The session survives a redirect and nothing else
 *
 * zkLogin needs an ephemeral private key to exist before the user leaves for Google and still exist
 * when they come back, so it goes in `sessionStorage`. Not `localStorage`: closing the tab should
 * end the session, because the key is a spending key for as long as `maxEpoch` has not passed and
 * leaving it on disk turns a two-day window into an indefinite one.
 *
 * # Expiry is measured against the chain, not the clock
 *
 * A restored session is checked against the epoch the server reports. Sui epochs do not advance on
 * a schedule, so a wall-clock estimate would either offer a dead session — which fails after the
 * user has typed an amount and read a quote — or discard a live one for no reason.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  getWallets,
  type StandardConnectFeature,
  type StandardEventsFeature,
  type Wallet,
  type WalletAccount,
} from '@mysten/wallet-standard';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import {
  generateNonce,
  generateRandomness,
  getExtendedEphemeralPublicKey,
  ZkLoginSigner,
} from '@mysten/sui/zklogin';
import {
  buildAuthUrl,
  sessionExpired,
  SESSION_STORAGE_KEY,
  type ActiveSession,
  type PendingSession,
} from '@/lib/zklogin';
import {
  authorisedAccounts,
  forgetWallet,
  isUsableWallet,
  readRememberedWallet,
  rememberWallet,
  walletSupport,
  walletSigner,
  zkLoginSignerAdapter,
  type ActiveSigner,
  type SuiChain,
} from '@/lib/signer';

/** What the sign-in endpoint tells the browser. Mirrors `/api/zklogin/session`. */
interface SessionInfo {
  network: string;
  available: boolean;
  reason?: string;
  googleClientId?: string;
  redirectUri?: string;
  currentEpoch?: string;
  maxEpoch?: number;
}

/**
 * What a user needs to reach their zkLogin address without this platform.
 *
 * All five values, together. A salt on its own recovers nothing — the address is a function of
 * `iss`, `aud`, `sub` *and* the salt, so somebody who kept only the number kept a quarter of what
 * they need, and would find that out with no working deployment left to ask.
 */
export interface RecoveryDetails {
  salt: string;
  iss: string;
  aud: string;
  sub: string;
  keyClaimName: string;
  legacyAddress: boolean;
  note: string;
}

export interface UnusableWallet {
  /** The wallet's own name, as it registered itself. */
  name: string;
  /** Plain-language capabilities it lacks, e.g. ['signing messages']. */
  missing: string[];
}

/**
 * A connected wallet holding more than one address, waiting to be told which.
 *
 * This lives on the provider rather than inside the panel that started the connection. `SignIn` is
 * rendered by twelve components and unmounts on every navigation, so a pending choice held there
 * would evaporate the moment the reader moved — leaving an authorised wallet and no address.
 */
export interface AccountChoice {
  wallet: Wallet;
  /** Every address the wallet authorised, in the order it gave them. Never truncated to one. */
  accounts: readonly WalletAccount[];
}

interface SignerContextValue {
  signer: ActiveSigner | null;
  /** Wallets present in this browser that can do everything the application needs. */
  wallets: Wallet[];
  /** Detected Sui wallets we cannot offer, with the reason. Never silently dropped. */
  unusableWallets: UnusableWallet[];
  /** `null` while the server has not answered yet — distinct from "zkLogin is unavailable". */
  session: SessionInfo | null;
  /** Set when a connected wallet returned several addresses. `null` the rest of the time. */
  accountChoice: AccountChoice | null;
  /**
   * Every address the connected wallet currently reports as authorised, and which one is bound.
   *
   * Kept and published rather than consumed and dropped. When an address the reader expects is not
   * here, the wallet did not share it — and that is a different problem, with a different fix, from
   * this application losing it. Nothing on screen could tell those apart before, and working out
   * which one was happening cost a day.
   *
   * `null` when no wallet is connected, which is not the same as a wallet that shared nothing.
   */
  walletAccounts: readonly WalletAccount[] | null;
  /** Answer an open `accountChoice`. Ignored — with a reason — when nothing is pending. */
  chooseAccount: (account: WalletAccount) => void;
  /** Abandon an open choice without binding to anything. */
  cancelAccountChoice: () => void;
  /**
   * Choose again between addresses the wallet has already authorised. Asks us, not the extension.
   *
   * The existing session is left alone until an answer arrives, so cancelling leaves the reader
   * exactly where they were rather than signed out for having looked.
   */
  reopenAccountChoice: () => void;
  /**
   * Ask the wallet to authorise again, from scratch.
   *
   * The only route out of "my other address is not in this list". Nothing on this page can
   * authorise an address — that decision lives in the extension — and connecting again is not
   * enough on its own: an already-connected wallet answers instantly with what it authorised
   * before and shows the reader nothing. This disconnects first, which is what makes the wallet
   * ask again.
   */
  reauthorizeWallet: () => Promise<void>;
  connectWallet: (wallet: Wallet) => Promise<void>;
  signInWithGoogle: (returnTo: string) => Promise<void>;
  signOut: () => void;
  /**
   * Fetch this user's own recovery details.
   *
   * Lives on the provider rather than in a component because it spends the stored identity token,
   * and that token should not be readable by every component that happens to want an address. The
   * provider holds it; components get the answer.
   *
   * `null` when there is nothing to export — a wallet session is already self-custodial and has no
   * salt at all, which is a different thing from a failed lookup.
   */
  exportRecovery: () => Promise<RecoveryDetails | null>;
  error: string | null;
}

const SignerContext = createContext<SignerContextValue | null>(null);

/**
 * Build a signer from a completed session.
 *
 * Shared by the restore path and the callback path so both produce an identical object. Two
 * constructions would eventually disagree about `legacyAddress`, which does not throw — it silently
 * yields a signer for a different, empty address.
 */
function signerFromSession(session: ActiveSession): ActiveSigner {
  const ephemeral = Ed25519Keypair.fromSecretKey(session.ephemeralSecretKey);
  const signer = new ZkLoginSigner({
    ephemeralSigner: ephemeral,
    maxEpoch: session.maxEpoch,
    inputs: {
      proofPoints: session.proofPoints,
      issBase64Details: session.issBase64Details,
      headerBase64: session.headerBase64,
      addressSeed: session.addressSeed,
    } as never,
    legacyAddress: false,
    // Passing the address makes the constructor re-derive it from the proof inputs and throw on a
    // mismatch. Without it a wrong `legacyAddress` produces a working signer for an address the
    // user does not control, and the first sign would simply fail on chain with nothing explaining
    // why. The SDK documents this parameter as exactly that guard; it is not optional here.
    address: session.address,
  });
  return zkLoginSignerAdapter({
    address: session.address,
    label: 'Google',
    signer,
  });
}

function readStoredSession(): ActiveSession | PendingSession | null {
  if (typeof window === 'undefined') return null;
  const raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as ActiveSession | PendingSession;
  } catch {
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
    return null;
  }
}

function isComplete(session: ActiveSession | PendingSession): session is ActiveSession {
  return 'address' in session && 'addressSeed' in session;
}

export function SignerProvider({ children }: { children: ReactNode }) {
  const [signer, setSigner] = useState<ActiveSigner | null>(null);
  // The zkLogin session behind `signer`, when that is how this user signed in. Kept out of the
  // ActiveSigner interface deliberately: components sign, they do not read identity tokens.
  const [zkSession, setZkSession] = useState<ActiveSession | null>(null);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  /*
    Wallets we found and cannot offer, kept rather than discarded.

    Discarding them made an installed wallet indistinguishable from no wallet: the section rendered
    nothing, and the user was left to conclude we had not implemented their wallet. Carrying the
    reason turns that into one sentence naming what is missing.
  */
  const [unusableWallets, setUnusableWallets] = useState<UnusableWallet[]>([]);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  /*
    A connect that came back with several addresses and has not been answered yet.

    `connect()` returns every address the reader authorised. The previous code took `accounts[0]`
    and dropped the rest, so a Slush wallet holding three addresses bound to whichever one the
    extension happened to list first and offered no way to change it. That failure is silent: the
    wallet signs, the chain accepts, and the money leaves an account nobody chose.
  */
  const [accountChoice, setAccountChoice] = useState<AccountChoice | null>(null);
  /*
    The wallet and chain behind a wallet `signer`, kept because `ActiveSigner` deliberately exposes
    neither. Only the `change` subscription below needs them, and it needs them to rebuild the
    signer for a different account without re-running the connect prompt.
  */
  const [walletBinding, setWalletBinding] = useState<{ wallet: Wallet; chain: SuiChain } | null>(
    null,
  );
  /*
    Everything the connected wallet says it has authorised, held so it can be shown.

    Separate state rather than a field on `walletBinding` because the `change` subscription below is
    keyed on the binding: folding the list in would tear the listener down and rebuild it on every
    announcement, which is an unsubscribe in the middle of handling the event that caused it.
  */
  const [walletAccounts, setWalletAccounts] = useState<readonly WalletAccount[] | null>(null);
  /*
    The bound address, mirrored where the `change` listener can read it.

    A ref rather than a dependency for the same reason: an effect keyed on the address would
    resubscribe every time the address moved, including the moves this very listener makes.
  */
  const boundAddress = useRef<string | null>(null);
  useEffect(() => {
    boundAddress.current = signer !== null && signer.kind === 'wallet' ? signer.address : null;
  }, [signer]);

  // Wallets register asynchronously — an extension can announce itself well after hydration, so a
  // list taken once at first paint is usually empty on a cold load.
  useEffect(() => {
    const registry = getWallets();
    const refresh = () => {
      const found = registry.get();
      setWallets(found.filter(isUsableWallet));
      setUnusableWallets(
        found
          .map((wallet) => ({ name: wallet.name, support: walletSupport(wallet) }))
          // `missing` empty on a failure means "not a Sui wallet at all" — nothing to report, and
          // complaining about somebody's Ethereum-only extension would be noise, not information.
          .filter((entry) => !entry.support.ok && entry.support.missing.length > 0)
          .map((entry) => ({ name: entry.name, missing: entry.support.missing })),
      );
    };
    refresh();
    const off = [registry.on('register', refresh), registry.on('unregister', refresh)];
    return () => off.forEach((cancel) => cancel());
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/zklogin/session');
        const info = (await response.json()) as SessionInfo;
        if (cancelled) return;
        setSession(info);

        // Restore an existing zkLogin session, but only after the epoch is known. Restoring first
        // and validating later would briefly offer a signer that cannot sign.
        const stored = readStoredSession();
        if (stored === null || !isComplete(stored)) return;
        if (info.currentEpoch !== undefined && sessionExpired(stored, BigInt(info.currentEpoch))) {
          window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
          setError('Your sign-in expired. Sign in again to continue.');
          return;
        }
        setSigner(signerFromSession(stored));
        setZkSession(stored);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Commit to one address of one wallet. The single place a wallet `signer` is built. */
  const bindAccount = useCallback(
    (wallet: Wallet, account: WalletAccount, accounts: readonly WalletAccount[]) => {
      // The network comes from the server's configuration. If it has not answered yet there is
      // nothing safe to assume, so the connection is refused rather than guessed at.
      if (session === null) throw new Error('still reading this deployment’s network');
      const chain: SuiChain = `sui:${session.network}`;
      setSigner(walletSigner({ wallet, account, chain }));
      setWalletBinding({ wallet, chain });
      setWalletAccounts(accounts);
      setAccountChoice(null);
      // A wallet session has no salt and needs none. Cleared rather than left stale, so a user
      // who switches from Google to a wallet cannot be shown the previous account's recovery.
      setZkSession(null);
      /*
        Written here, at the one place a wallet session begins, rather than at each caller. Connect,
        a picked address, a wallet that moved and a restored reload all pass through this line, so
        there is one answer to "what will the next reload come back as" instead of four.
      */
      /*
        The wallet and the chosen address, so a reload comes back signed in.

        This was removed for a day and that was an overcorrection. Remembering was never the defect:
        the defect was remembering with no way to change it, so one address was welded to the
        control and navigating anywhere re-bound it. Removing it fixed that by making everybody sign
        in on every single page, which is worse.

        What makes it safe now is the account picker and the `change` subscription that did not
        exist then. The remembered address is restored only if the wallet still authorises it,
        `signOut` forgets it, revocation forgets it, and switching account in the extension moves
        the app rather than being overridden by what was stored.

        Only a wallet name and a public address. No secret — which is why this may live in
        `localStorage`, where zkLogin's ephemeral spending key may not.
      */
      rememberWallet({ wallet: wallet.name, address: account.address });
    },
    [session],
  );

  /*
    Coming back to the same address after a reload.

    # Why this is keyed off the registry rather than run once at mount

    Restoration races wallet registration. Extensions announce themselves through the registry well
    after first paint, so a single attempt at first paint reads an empty list, finds no wallet, and
    leaves a reader who is signed in looking at a sign-in button for the rest of the page's life.
    Keyed off `wallets` instead, it runs again each time the registry moves, and gets its answer the
    moment the extension arrives.

    # And why it can only fire once

    The registry announces on every registration and unregistration, and a page can see several. A
    connect per announcement is a connect per extension the reader happens to have installed, and on
    any wallet that ignores the `silent` hint that is an approval prompt each time. The ref is what
    makes "at most one attempt" true rather than likely.
  */
  const restoreAttempted = useRef(false);
  /*
    Silent restore is gone, and this clears what it left behind.

    # What it did to a real person

    It remembered the wallet and address, then called `connect({ silent: true })` on every load. The
    intent was that a reload should not sign you out. The effect was a trap: the wallet never
    opened, the same address came back every time, and nothing reachable in the interface changed
    it — because the restore re-ran on the next load and overwrote whatever had just been chosen.

    Two of those were the point of `silent`, so they did not look like a defect from in here. From
    the outside it read as an address welded to the button, and it survived clearing everything the
    reader knew how to clear, because the state was ours and the reader had never been told it
    existed.

    # Why removed rather than repaired

    Nobody asked for it. It was folded into an account-selection fix as a convenience, and it cost
    more than the inconvenience it removed. Connecting a wallet is one click and it shows the reader
    exactly which address they are binding — the thing that was actually broken. A session that
    survives a reload can come back when it is asked for, designed rather than assumed, with a
    visible way to reset it.

    # This runs once, on purpose

    Anyone who loaded the build that wrote `projectx.wallet` still has it in `localStorage`, and it
    would sit there unread forever. Clearing it here means their next load fixes them, rather than
    a console command they should never have needed to be told.
  */
  useEffect(() => {
    if (restoreAttempted.current) return;
    // The network decides the chain a signer is bound to. Nothing safe to assume before it answers.
    if (session === null) return;

    const remembered = readRememberedWallet();
    if (remembered === null) {
      restoreAttempted.current = true;
      return;
    }

    const wallet = wallets.find((candidate) => candidate.name === remembered.wallet);
    // Extensions announce themselves after hydration. "Not yet" and "uninstalled" look identical at
    // this instant, and waiting costs nothing.
    if (wallet === undefined) return;

    restoreAttempted.current = true;
    const feature = wallet.features['standard:connect'] as
      | StandardConnectFeature['standard:connect']
      | undefined;
    if (feature === undefined) return;

    void (async () => {
      let accounts: readonly WalletAccount[];
      try {
        // Asks for what was already authorised without prompting. Some wallets ignore the flag and
        // some throw on it; both mean "not restored", which is the signed-out state already on
        // screen. Not reported, because nobody asked for anything yet.
        const returned = await feature.connect({ silent: true });
        accounts = authorisedAccounts(wallet, returned.accounts);
      } catch {
        return;
      }

      const exact = accounts.find((account) => account.address === remembered.address);
      if (exact === undefined) {
        // Never `accounts[0]`. Returning somebody as a different address of the same wallet looks
        // like a successful restore, and is the original stuck-address defect with a reload in
        // front of it. Signed out is the honest answer.
        forgetWallet();
        return;
      }
      bindAccount(wallet, exact, accounts);
    })();
  }, [wallets, session, bindAccount]);

  /*
    The wallet is the other half of this control, and it can move on its own.

    Switching account inside the extension changes which address it will sign with. A page still
    bound to the previous one keeps showing that address and keeps asking the wallet to sign as it —
    a disagreement neither side reports, and one the reader only discovers from the explorer.

    Subscribed per binding rather than per wallet: the listener has to be gone once this provider
    unmounts, or every mount leaves another one attached inside the extension.
  */
  useEffect(() => {
    if (walletBinding === null) return;
    const { wallet, chain } = walletBinding;

    const events = wallet.features['standard:events'] as
      | StandardEventsFeature['standard:events']
      | undefined;
    // Not among the features `walletSupport` requires, so a wallet without it must still work. It
    // simply cannot tell us when it moves.
    if (events === undefined) return;

    return events.on('change', ({ accounts }) => {
      // Absent means the wallet changed something else — its chains, its features. "We were not
      // told" is not "there are none", and collapsing the two throws away a live session.
      if (accounts === undefined) return;

      if (accounts.length === 0) {
        /*
          A revocation: the reader took this site's access away in the extension. Keeping the
          address on screen would offer a session that cannot sign, discovered at the end of a
          checkout rather than at the moment it stopped being true.
        */
        setSigner(null);
        setWalletBinding(null);
        setWalletAccounts(null);
        setAccountChoice(null);
        // Forgotten too, or every reload from here on tries to restore an address the reader
        // deliberately took away, and explains afresh why it could not.
        forgetWallet();
        setError(`${wallet.name} is no longer sharing an address with this site.`);
        return;
      }

      // Published first, so the list on screen matches the extension even when nothing rebinds.
      setWalletAccounts(accounts);

      const current = boundAddress.current;
      if (current === null) {
        // Nothing bound — a choice is open, or this is a wallet session that has ended. Either way
        // the open question is now about a different list, and asking it about the old one would
        // offer addresses the wallet has stopped authorising.
        setAccountChoice((pending) => (pending === null ? null : { wallet, accounts }));
        return;
      }

      /*
        The reader's pick wins whenever the wallet still authorises it. A wallet re-announcing its
        whole list has not asked us to change anything, and following its idea of "active" would
        quietly undo their choice — the original defect, reintroduced from the other end.
      */
      if (accounts.some((account) => account.address === current)) return;

      /*
        The bound address is gone. With one address left there is only one answer and taking it is
        not a guess. With several there is no answer to be read off the list at all — so the reader
        is asked, and nothing signs in the meantime. `accounts[0]` here would be the whole defect
        restored: an address nobody chose, bound silently, discovered on an explorer.
      */
      const only = accounts.length === 1 ? accounts[0] : undefined;
      if (only !== undefined) {
        bindAccount(wallet, only, accounts);
        return;
      }

      setSigner(null);
      forgetWallet();
      setAccountChoice({ wallet, accounts });
      setError(
        `${wallet.name} stopped sharing ${current}. Choose which address this site should use.`,
      );
    });
  }, [walletBinding, bindAccount]);

  const connectWallet = useCallback(
    async (wallet: Wallet) => {
      setError(null);
      setAccountChoice(null);
      try {
        const feature = wallet.features['standard:connect'] as
          | StandardConnectFeature['standard:connect']
          | undefined;
        if (feature === undefined) throw new Error('this wallet does not support connecting');

        const returned = await feature.connect();
        /*
          Both sources, not just the return value.

          `connect()` resolving with one account does not mean one is authorised — the standard puts
          the authorised set on `wallet.accounts` and several wallets answer here with the active
          account alone. Reading only this result is why Slush and Phantom each bound one fixed
          address no matter which account was selected inside them.
        */
        const accounts = authorisedAccounts(wallet, returned.accounts);
        if (accounts.length === 0) throw new Error('the wallet returned no accounts');

        const only = accounts.length === 1 ? accounts[0] : undefined;
        if (only !== undefined) bindAccount(wallet, only, accounts);
        else setAccountChoice({ wallet, accounts });
      } catch (cause) {
        // Shown verbatim. A wallet's own "User rejected the request" is more useful than anything
        // this component could invent, and inventing one risks describing a refusal as a fault.
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [bindAccount],
  );

  /**
   * Ask the connected wallet to share more than it has.
   *
   * A reader whose second address was never authorised cannot get to it from this page — the
   * decision belongs to the extension. Connecting again is the standard's own way of asking, and it
   * is what makes most wallets show their account picker.
   */
  /**
   * Ask the wallet to authorise again, from scratch.
   *
   * # Why connecting again is not enough
   *
   * `standard:connect` on an already-connected wallet returns immediately with the accounts it has
   * already authorised, and shows the reader nothing. So the previous version of this — which only
   * called connect — was a button that could not do the one thing it existed for: somebody holding
   * several addresses in Slush had no way to reach any but the first they approved.
   *
   * Disconnecting first is what makes the wallet ask again. `standard:disconnect` drops the
   * authorisation, and the connect that follows opens the wallet's own account chooser, where the
   * decision actually belongs — a site cannot enumerate addresses a wallet has not shared.
   *
   * # The session is dropped deliberately
   *
   * Signing out first, rather than swapping the binding underneath a signed-in session. A wallet
   * that disconnects and reconnects may come back with a different address, and leaving the old
   * signer in place while that happens is how somebody ends up signing from an account they think
   * they have left.
   */
  const reauthorizeWallet = useCallback(async () => {
    const wallet = walletBinding?.wallet ?? accountChoice?.wallet;
    if (wallet === undefined) {
      setError('no wallet is connected to ask');
      return;
    }

    setError(null);
    setAccountChoice(null);
    setSigner(null);
    setWalletBinding(null);
    setWalletAccounts(null);
    forgetWallet();

    const feature = wallet.features['standard:disconnect'] as
      | { disconnect: () => Promise<void> }
      | undefined;
    try {
      // Not every wallet implements it. Where it is missing, connecting again is all that can be
      // done — and it is no worse than before, rather than an error the reader can act on.
      await feature?.disconnect();
    } catch {
      // A refused or failed disconnect still leaves the connect below worth attempting.
    }

    await connectWallet(wallet);
  }, [walletBinding, accountChoice, connectWallet]);

  const reopenAccountChoice = useCallback(() => {
    if (walletBinding === null || walletAccounts === null) {
      setError('no wallet is connected to choose from');
      return;
    }
    setError(null);
    // The session is deliberately left standing. Cancelling has to put the reader back where they
    // were, not sign them out for having opened a list.
    setAccountChoice({ wallet: walletBinding.wallet, accounts: walletAccounts });
  }, [walletBinding, walletAccounts]);

  const chooseAccount = useCallback(
    (account: WalletAccount) => {
      setError(null);
      if (accountChoice === null) {
        // Said out loud rather than returned as a no-op. A button that silently does nothing reads
        // as a broken wallet, and sends the reader to reinstall an extension that is fine.
        setError('that choice is no longer open — connect the wallet again');
        return;
      }
      try {
        bindAccount(accountChoice.wallet, account, accountChoice.accounts);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [accountChoice, bindAccount],
  );

  const cancelAccountChoice = useCallback(() => {
    setAccountChoice(null);
    setError(null);
  }, []);

  const signInWithGoogle = useCallback(
    async (returnTo: string) => {
      setError(null);
      try {
        if (session === null) throw new Error('still reading this deployment’s configuration');
        if (
          !session.available ||
          session.googleClientId === undefined ||
          session.redirectUri === undefined ||
          session.maxEpoch === undefined
        ) {
          throw new Error(session.reason ?? 'signing in with Google is not available here');
        }

        // Generated here, in the browser, and never sent anywhere. A server that minted this would
        // be able to sign for the user for the life of the session.
        const ephemeral = Ed25519Keypair.generate();
        const randomness = generateRandomness();
        const nonce = generateNonce(ephemeral.getPublicKey(), session.maxEpoch, randomness);

        const pending: PendingSession = {
          ephemeralSecretKey: ephemeral.getSecretKey(),
          jwtRandomness: randomness,
          maxEpoch: session.maxEpoch,
          nonce,
          returnTo,
        };
        window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(pending));

        window.location.assign(
          buildAuthUrl({
            clientId: session.googleClientId,
            redirectUri: session.redirectUri,
            nonce,
          }),
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [session],
  );

  const signOut = useCallback(() => {
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
    // The wallet half too. A remembered address would be silently restored on the next load, which
    // makes signing out look like it did not take.
    forgetWallet();
    setSigner(null);
    setZkSession(null);
    // Dropped together with the signer, so the `change` subscription cannot resurrect an address
    // for somebody who has just signed out.
    setWalletBinding(null);
    setWalletAccounts(null);
    setAccountChoice(null);
    setError(null);

    /*
      Tell the *server*, which is the half this was missing.

      Everything above forgets the browser's copy of the session. None of it touched the read-session
      cookie, so the server went on treating the visitor as a proved reader: reported as signing out
      and still landing in the dashboard, because `AppFrame` asks `provenReader()` and `provenReader`
      still said yes.

      The dashboard was the visible symptom and the smaller half of the problem. Entitlement is
      resolved from that same proved session, so a reader who believed they had signed out still had
      their paid bodies released — on a shared machine, to whoever sat down next.

      `DELETE /api/session` revokes by address and clears the cookie. It existed, tested, and nothing
      called it.

      Deliberately not awaited, and the local state is already cleared above: the browser must look
      signed out immediately whether or not the network cooperates. A failure here leaves a cookie
      that expires on its own, which is the same place we were before — never worse.
    */
    void fetch('/api/session', { method: 'DELETE' })
      .catch(() => undefined)
      .finally(() => {
        /*
          Then leave, with a real navigation.

          Server components decided guest-or-dashboard on the *previous* request. Without this the
          frame keeps rendering the signed-in shell until something else happens to navigate, which
          is exactly what "I signed out and stayed in the dashboard" looks like.

          Home rather than reloading in place: a reader who signs out on `/studio` should land
          somewhere that makes sense as a guest, not on a studio they can no longer use.
        */
        window.location.assign('/');
      });
  }, []);

  /**
   * This user's own recovery details, from the route that derives them.
   *
   * Costs a fresh, nonce-bound, Google-signed token — the same proof of control that signing in
   * required, spent again for this one purpose. Google identity tokens are short-lived, so a
   * session left open for an hour will need signing in again; that is said in those words rather
   * than reported as a failure, because it is not one.
   */
  const exportRecovery = useCallback(async (): Promise<RecoveryDetails | null> => {
    if (zkSession === null) return null;

    /*
      The commitment goes with the token, not the nonce.

      The server derives the nonce from these three and compares it to the one Google signed. It
      cannot be sent the nonce itself: a value the caller supplies cannot prove anything about the
      caller. The ephemeral secret never leaves this browser — only the public half is sent, which
      is already public in every zkLogin signature this account produces.
    */
    const ephemeral = Ed25519Keypair.fromSecretKey(zkSession.ephemeralSecretKey);
    const response = await fetch('/api/zklogin/export', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jwt: zkSession.jwt,
        extendedEphemeralPublicKey: getExtendedEphemeralPublicKey(ephemeral.getPublicKey()),
        maxEpoch: zkSession.maxEpoch,
        jwtRandomness: zkSession.jwtRandomness,
      }),
    });
    const body = (await response.json()) as Partial<RecoveryDetails> & { error?: string };

    if (response.status === 401) {
      throw new Error(
        'Your Google sign-in has expired, which is what protects this. Sign in again, then ask for your recovery details.',
      );
    }
    if (!response.ok || typeof body.salt !== 'string') {
      throw new Error(body.error ?? `recovery details could not be read (${response.status})`);
    }
    return body as RecoveryDetails;
  }, [zkSession]);

  const value = useMemo<SignerContextValue>(
    () => ({
      signer, wallets, unusableWallets, session, accountChoice, walletAccounts, chooseAccount,
      cancelAccountChoice, reopenAccountChoice, reauthorizeWallet, connectWallet, signInWithGoogle,
      signOut, exportRecovery, error,
    }),
    [signer, wallets, unusableWallets, session, accountChoice, walletAccounts, chooseAccount,
      cancelAccountChoice, reopenAccountChoice, reauthorizeWallet, connectWallet, signInWithGoogle,
      signOut, exportRecovery, error],
  );

  return <SignerContext.Provider value={value}>{children}</SignerContext.Provider>;
}

/**
 * The current signer, and the ways to get one.
 *
 * Throws when used outside the provider. That is a wiring mistake the developer must see at once,
 * not a runtime condition to degrade around — returning `null` here would render every signed
 * action as "not connected" on a page where the user is, in fact, connected.
 */
export function useSigner(): SignerContextValue {
  const value = useContext(SignerContext);
  if (value === null) throw new Error('useSigner must be used inside <SignerProvider>');
  return value;
}

/**
 * Finish a sign-in after Google redirects back. Called only by the callback page.
 *
 * Exported as a plain function rather than a hook because the callback page runs it once, in an
 * effect, and a hook would invite it being called from a render.
 */
export async function completeGoogleSignIn(idToken: string): Promise<ActiveSession> {
  const stored = readStoredSession();
  if (stored === null) {
    throw new Error('this sign-in did not start in this tab — start again');
  }

  const ephemeral = Ed25519Keypair.fromSecretKey(stored.ephemeralSecretKey);
  const response = await fetch('/api/zklogin/complete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jwt: idToken,
      /*
        The nonce is not sent, deliberately.

        A token from another sign-in verifies perfectly against Google's keys and must still be
        refused — that was always the intent of this field, and sending the nonce could never
        achieve it, because the server was comparing Google's nonce against our copy of the same
        value. The server now derives it from the three fields below, which is the only form of
        this check that a caller cannot satisfy by echoing.
      */
      extendedEphemeralPublicKey: getExtendedEphemeralPublicKey(ephemeral.getPublicKey()),
      maxEpoch: stored.maxEpoch,
      jwtRandomness: stored.jwtRandomness,
    }),
  });

  const body = (await response.json()) as {
    address?: string;
    addressSeed?: string;
    proofPoints?: unknown;
    issBase64Details?: unknown;
    headerBase64?: string;
    error?: string;
  };
  if (!response.ok || body.address === undefined || body.addressSeed === undefined) {
    throw new Error(body.error ?? `the sign-in could not be completed (${response.status})`);
  }

  const complete: ActiveSession = {
    ...stored,
    address: body.address,
    jwt: idToken,
    // The salt is not here and is not stored. It never leaves the server unless the user asks for
    // it explicitly at `/api/zklogin/export`.
    salt: '',
    addressSeed: body.addressSeed,
    proofPoints: body.proofPoints,
    issBase64Details: body.issBase64Details,
    headerBase64: body.headerBase64 ?? '',
  };
  window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(complete));
  return complete;
}
