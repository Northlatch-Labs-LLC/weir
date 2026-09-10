'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * Who is signing, and how they came to be signing.
 *
 * # Why this file moved twice
 *
 * The wallet half was written by hand once — `getWallets()`, a register/unregister subscription,
 * `standard:connect` called directly, a `standard:events` listener, a remembered-wallet record and
 * a silent reconnect. Nine hundred lines, half of them a re-implementation of somebody else's
 * library. That went to `@mysten/dapp-kit`.
 *
 * `@mysten/dapp-kit` is deprecated. Not a version behind — ended. It speaks the JSON-RPC API that
 * Sui has retired, and the rest of this workspace has been on `@mysten/sui` 2.x, which speaks gRPC,
 * the whole time. So the wallet layer talked to the chain over a protocol nothing else here uses,
 * and it was never going to get another release.
 *
 * This is `@mysten/dapp-kit-react` on `@mysten/dapp-kit-core`, which is the same library after the
 * rewrite: one kit object created outside React instead of three nested providers, nanostores
 * instead of react-query, and a client built from `SuiGrpcClient` — the same transport `lib/chain`
 * already uses to read this chain.
 *
 * # What stays ours, and has to
 *
 * The kit has no concept of the two things this application depends on:
 *
 *   - **zkLogin as a peer of a browser wallet.** A Google sign-in and an extension produce the same
 *     {@link ActiveSigner}, and every consumer is written against that one shape.
 *   - **A proved read session.** Connecting is the extension sharing an address. It grants nothing
 *     here. What grants anything is a signature over the read-content statement, which mints a
 *     server session — see `SessionBridge`. The kit has no opinion on that, correctly.
 *
 * # The contract is unchanged on purpose
 *
 * Thirty-three components call `useSigner()`. {@link SignerContextValue} keeps every member it had,
 * with the same meaning. The wallet and account types are the kit's `UiWallet` and `UiWalletAccount`
 * rather than the raw standard's — the fields those components read (`name`, `icon`, `address`,
 * `label`) are the same on both, which is why this is one file changing rather than thirty-four.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  DAppKitProvider,
  useCurrentAccount,
  useCurrentWallet,
  useDAppKit,
  useWallets,
} from '@mysten/dapp-kit-react';
import {
  createDAppKit,
  CurrentAccountSigner,
  type DAppKit,
  type UiWallet,
  type UiWalletAccount,
} from '@mysten/dapp-kit-core';
import { SuiGrpcClient } from '@mysten/sui/grpc';
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
  isUsableWallet,
  walletSupport,
  walletSigner,
  zkLoginSignerAdapter,
  type ActiveSigner,
} from '@/lib/signer';

interface SessionInfo {
  network: string;
  available: boolean;
  reason?: string;
  googleClientId?: string;
  redirectUri?: string;
  currentEpoch?: string;
  maxEpoch?: number;
}

export interface RecoveryDetails {
  salt: string;
  iss: string;
  aud: string;
  sub: string;
  keyClaimName: string;
  legacyAddress: boolean;
  note: string;
}

/** A wallet that announced itself but is missing a feature this application requires. */
export interface UnusableWallet {
  name: string;
  missing: string[];
}

/** A connected wallet holding more than one address, waiting to be told which. */
export interface AccountChoice {
  wallet: UiWallet;
  accounts: readonly UiWalletAccount[];
}

/**
 * How far a connected address has got towards being somebody the server will answer as.
 *
 * The whole defect this replaces is that there was no such value. Connecting was one fact, held by
 * the wallet kit in the browser; being proved was another, held by a cookie the server reads; and
 * nothing in the application could see both. So the account menu could show an address while the
 * page beside it rendered a guest, and a reader whose signature failed had no way to know that had
 * happened, let alone try again.
 *
 * - `unknown`    — nothing connected, or not looked at yet.
 * - `checking`   — asking the server what it already has, or waiting on the wallet.
 * - `proved`     — the server holds a session for this exact address. This is the only state that
 *                  opens paid content.
 * - `unproved`   — connected, and the server does not have it. Recoverable: {@link proveSession}.
 * - `declined`   — the reader refused the signature, or the wallet failed it. Also recoverable, and
 *                  kept distinct because a refusal is a decision and should not be retried at them
 *                  automatically.
 */
export type SessionProof = 'unknown' | 'checking' | 'proved' | 'unproved' | 'declined';

interface SignerContextValue {
  signer: ActiveSigner | null;
  wallets: UiWallet[];
  unusableWallets: UnusableWallet[];
  session: SessionInfo | null;
  accountChoice: AccountChoice | null;
  walletAccounts: readonly UiWalletAccount[] | null;
  chooseAccount: (account: UiWalletAccount) => void;
  cancelAccountChoice: () => void;
  reopenAccountChoice: () => void;
  reauthorizeWallet: () => Promise<void>;
  connectWallet: (wallet: UiWallet) => Promise<void>;
  signInWithGoogle: (returnTo: string) => Promise<void>;
  /** How far the connected address has got. One value, read by every part of the chrome. */
  proof: SessionProof;
  /** The address the server currently holds a session for, which may not be the connected one. */
  provenAddress: string | null;
  /**
   * Ask the wallet to sign the read-content statement and hand it to the server.
   *
   * Safe to call at any time: it re-reads what the server has first, so a reader pressing a
   * "confirm" control that is already satisfied gets no wallet prompt.
   */
  proveSession: () => Promise<void>;
  signOut: () => void;
  exportRecovery: () => Promise<RecoveryDetails | null>;
  error: string | null;
}

const SignerContext = createContext<SignerContextValue | null>(null);

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
    address: session.address,
  });
  return zkLoginSignerAdapter({ address: session.address, label: 'Google', signer });
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

export function SignerProvider({
  children,
  network,
  rpcUrl,
}: {
  children: ReactNode;
  /**
   * The network this deployment is pointed at, read from configuration on the server.
   *
   * `null` when the configuration could not be read. A wallet signs against the kit's current
   * network, so an unknown network means no wallet signer is built at all and connecting says why.
   * It does not mean a plausible guess: a signature requested against a chain nobody chose is the
   * failure this refuses to have.
   */
  network: string | null;
  /**
   * The gRPC endpoint this deployment is configured with, handed to the kit's client.
   *
   * The same transport `lib/chain` reads through. Under the previous kit this was a JSON-RPC URL
   * for a client nothing in this application used; now it is the deployment's own node, and the
   * kit reads the chain the same way the rest of the product does.
   */
  rpcUrl: string | null;
}) {
  /*
    One kit for the life of the document.

    `createDAppKit` builds stores, a client and a wallet registry. Calling it in render would throw
    all of that away on every pass — including the connection autoconnect is in the middle of
    restoring. `useState` with an initialiser runs it exactly once per mount, and this provider
    mounts once, in the root layout.

    Where the configuration could not be read, the kit is still built — the reader can still see
    which wallets they have — but pointed at a closed port and named `mainnet` only so the object
    exists. Nothing signs in that state: `walletActiveSigner` below requires a real `network`.
  */
  const [kit] = useState(() =>
    createDAppKit({
      networks: [(network ?? 'mainnet') as 'mainnet'],
      createClient: (forNetwork) =>
        new SuiGrpcClient({ network: forNetwork, baseUrl: rpcUrl ?? 'http://127.0.0.1:0' }),
      /* Carried over so a reader who was connected before this change still is. */
      storageKey: 'projectx.wallet',
      /*
        The kit offers to inject Mysten's hosted Slush wallet alongside the reader's extensions.
        It is off because adding a wallet provider to this product is a decision, not a default —
        turning it on is deleting this line.
      */
      slushWalletConfig: null,
    }),
  );

  return (
    <DAppKitProvider dAppKit={kit}>
      <SignerBridge network={network}>{children}</SignerBridge>
    </DAppKitProvider>
  );
}

/**
 * The product's own signer, assembled from the kit's wallet state and this application's zkLogin.
 *
 * Everything that follows is either zkLogin, which the kit does not know about, or a translation
 * from the kit's shape into the {@link ActiveSigner} that thirty-three components already read.
 */
function SignerBridge({ children, network }: { children: ReactNode; network: string | null }) {
  const router = useRouter();
  const kit = useDAppKit();
  const registered = useWallets();
  const currentAccount = useCurrentAccount();
  const currentWallet = useCurrentWallet();

  /*
    The kit no longer takes a filter.

    `walletFilter` was removed in the rewrite: the kit filters by network compatibility itself, which
    is not the same question. A wallet that cannot sign a personal message is compatible with mainnet
    and still cannot comment, follow or read its own direct messages here — it would connect, then
    fail on the third thing the reader tried. So the filter moved from a prop to this line, and the
    ones it removes are still named below rather than silently absent.
  */
  const wallets = useMemo(() => registered.filter(isUsableWallet), [registered]);

  /** Every address the connected wallet currently authorises, in the kit's order. */
  const accounts = useMemo<readonly UiWalletAccount[]>(
    () => currentWallet?.accounts ?? [],
    [currentWallet],
  );

  const [zkSigner, setZkSigner] = useState<ActiveSigner | null>(null);
  const [zkSession, setZkSession] = useState<ActiveSession | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Open only when the reader asked for it, or when a connect returned more than one address. */
  const [choiceOpen, setChoiceOpen] = useState(false);
  const [proof, setProof] = useState<SessionProof>('unknown');
  const [provenAddress, setProvenAddress] = useState<string | null>(null);

  /*
    The wallet's signer, derived rather than stored.

    The hand-written version held the bound account in state and kept it in step with the extension
    through a `standard:events` subscription — the source of the "no longer sharing that address"
    branch, the re-bind, and the forget. The kit's stores already track all of that.

    `CurrentAccountSigner` holds the kit rather than an account, so it signs with whatever is current
    at the moment of signing. That closes the window the old shape left open: a signer built from an
    account captured at quote time, used after the reader switched addresses inside the extension.
  */
  const walletActiveSigner = useMemo<ActiveSigner | null>(() => {
    if (currentWallet === null || currentAccount === null || network === null) return null;
    return walletSigner({
      signer: new CurrentAccountSigner(kit as DAppKit),
      address: currentAccount.address,
      label: currentWallet.name,
    });
  }, [kit, currentWallet, currentAccount, network]);

  /*
    A wallet outranks a Google session when both are present.

    Only one can be true at a time in practice — `signOut` clears both, and connecting a wallet
    clears the zkLogin session below — but the order is written down rather than left to whichever
    state updated last.
  */
  const signer = walletActiveSigner ?? zkSigner;

  /*
    A different address is a different session, and saying otherwise is the whole defect.

    Switching account inside the extension changes who `signer` is while the server's cookie still
    names the previous address. Left alone, the chrome would keep reporting "signed in" about
    somebody who is no longer connected — which is exactly how a reader ends up looking at another
    of their own accounts' pages and being told the posts they paid for are locked.
  */
  useEffect(() => {
    const address = signer?.address;
    if (address === undefined) {
      setProof('unknown');
      return;
    }
    setProof((was) =>
      provenAddress !== null && provenAddress.toLowerCase() === address.toLowerCase()
        ? was
        : 'unknown',
    );
  }, [signer?.address, provenAddress]);

  /* Wallets that announced themselves but cannot do what this application needs. */
  const unusableWallets = useMemo<UnusableWallet[]>(
    () =>
      registered
        .map((wallet) => ({ name: wallet.name, support: walletSupport(wallet) }))
        .filter((entry) => !entry.support.ok && entry.support.missing.length > 0)
        .map((entry) => ({ name: entry.name, missing: entry.support.missing })),
    [registered],
  );

  /* This deployment's zkLogin configuration, and a Google session restored from the tab. */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/zklogin/session');
        const info = (await response.json()) as SessionInfo;
        if (cancelled) return;
        setSession(info);
        const stored = readStoredSession();
        if (stored === null || !isComplete(stored)) return;
        if (info.currentEpoch !== undefined && sessionExpired(stored, BigInt(info.currentEpoch))) {
          window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
          setError('Your sign-in expired. Sign in again to continue.');
          return;
        }
        setZkSigner(signerFromSession(stored));
        setZkSession(stored);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const connectWallet = useCallback(
    async (wallet: UiWallet) => {
      setError(null);
      setChoiceOpen(false);
      if (network === null) {
        setError('this deployment has not been told which network it is on, so nothing can be signed here');
        return;
      }
      try {
        const result = await kit.connectWallet({ wallet });
        /*
          Several authorised addresses is a question, not a default.

          The kit binds the first account it is given. Where the reader authorised more than one,
          the previous behaviour — and the one this product wants — is to ask which, rather than
          pick and be silently wrong about whose vault is on screen.
        */
        if (result.accounts.length > 1) setChoiceOpen(true);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [kit, network],
  );

  /*
    Ask the extension again, from nothing.

    A wallet already connected answers a second connect instantly with whatever it authorised
    before and shows the reader no prompt. Disconnecting first is what makes the extension open its
    own window, which is the only place an address can actually be added or removed.
  */
  const reauthorizeWallet = useCallback(async () => {
    const wallet = currentWallet;
    if (wallet === null) {
      setError('no wallet is connected to ask');
      return;
    }
    setError(null);
    setChoiceOpen(false);
    try {
      await kit.disconnectWallet();
    } catch {
      /* An extension that refuses to disconnect is still worth trying to connect again. */
    }
    await connectWallet(wallet);
  }, [currentWallet, kit, connectWallet]);

  const reopenAccountChoice = useCallback(() => {
    if (currentWallet === null || accounts.length === 0) {
      setError('no wallet is connected to choose from');
      return;
    }
    setError(null);
    setChoiceOpen(true);
  }, [currentWallet, accounts]);

  const chooseAccount = useCallback(
    (account: UiWalletAccount) => {
      setError(null);
      setChoiceOpen(false);
      /* Choosing a wallet address ends a Google session; one signer at a time. */
      setZkSigner(null);
      setZkSession(null);
      kit.switchAccount({ account });
    },
    [kit],
  );

  const cancelAccountChoice = useCallback(() => {
    setChoiceOpen(false);
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

  /*
    Prove the connected address to the server.

    # What this is for

    Connecting tells the browser who you are. It tells the server nothing, and the server is what
    decides whether a paid post opens — naming an address proves nothing, because every buyer's
    address is enumerable from public chain events. A signature over the read-content statement is
    the proof, and it mints a session that lasts a day.

    # Why it is checked before it is signed

    `GET /api/session` is a cheap round trip; a wallet prompt is not. Signing unconditionally would
    prompt on every reload, and a prompt people see that often is a prompt they approve without
    reading. So this is also safe to call from a control the reader presses: if the server already
    has them, nothing opens.

    # Why the failure is a state rather than a swallowed exception

    It used to be `catch {}` inside an effect nothing could see. A reader who declined, or whose
    wallet errored, got no signal at all: their own paid posts rendered locked, the account menu
    showed them signed in, and there was no control anywhere that would ask again. The whole
    recovery path was to guess that reloading might help. That is what `declined` and `unproved`
    exist for — they are what the chrome renders, and what a retry control is enabled by.
  */
  const proveSession = useCallback(async () => {
    const address = signer?.address;
    if (address === undefined) {
      setProof('unknown');
      setProvenAddress(null);
      return;
    }
    setProof('checking');
    try {
      const current = (await (await fetch('/api/session')).json()) as {
        reader?: string | null;
        checked?: boolean;
      };
      /*
        `checked: false` means the server could not look, which is not the same as "you have no
        session" — and the difference decides whether to raise a wallet prompt. Treating an outage
        as an absent session would prompt for a signature to replace a session that is probably
        intact, which is how people are trained to approve prompts without reading them.
      */
      if (current.checked !== true) {
        setProof('unproved');
        return;
      }
      if (current.reader != null && current.reader.toLowerCase() === address.toLowerCase()) {
        setProvenAddress(current.reader);
        setProof('proved');
        return;
      }

      const timestampMs = Date.now();
      // Rebuilt to match `statementFor({ kind: 'read-content' })` byte for byte. Pinned against
      // the server's copy in `test/statement-drift.test.ts`, because a drift here fails every
      // sign-in with a signature error that names nothing.
      const statement =
        `Weir\naddress: ${address}\nissued: ${timestampMs}\norigin: ${window.location.origin}` +
        `\naction: read content`;
      const signature = await signer?.signPersonalMessage(new TextEncoder().encode(statement));
      if (signature === undefined) {
        setProof('unproved');
        return;
      }

      const response = await fetch('/api/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address, signature, timestampMs }),
      });
      if (!response.ok) {
        setProof('unproved');
        return;
      }
      setProvenAddress(address);
      setProof('proved');
      /*
        The pages resolve entitlement on the server, so the proof only takes effect on the next
        render. Without this the reader sits looking at their own paid posts, locked.
      */
      router.refresh();
    } catch {
      /*
        Declined, or the wallet failed, or the server is unreachable. Recorded rather than
        swallowed: `declined` is what puts a "confirm your account" control on the screen instead
        of leaving the reader with a sentence and no button.
      */
      setProof('declined');
    }
  }, [signer, router]);

  /*
    Ask once, as soon as an address appears.

    This lives here rather than in `SessionBridge` on purpose. The proof is this provider's state,
    and a session that only gets proved when some other component happens to be mounted is the
    original defect in a different costume — that is exactly how the handshake came to be a side
    effect of rendering a navigation bar, and how every route without that bar left a connected
    reader anonymous to the server.

    Only `unknown` triggers it. `declined` deliberately does not: a refusal is a decision, and
    re-prompting somebody who just said no is how a wallet prompt becomes something people dismiss
    without reading.
  */
  useEffect(() => {
    if (signer === null || proof !== 'unknown') return;
    void proveSession();
  }, [signer, proof, proveSession]);

  /*
    Signing out ends both halves and the server's session.

    The `DELETE` is what actually revokes: clearing this browser leaves a cookie that still proves
    a reader for as long as it has left to live, and "I signed out" has to mean the server agrees.
  */
  const signOut = useCallback(() => {
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
    setZkSigner(null);
    setZkSession(null);
    setChoiceOpen(false);
    setError(null);
    setProof('unknown');
    setProvenAddress(null);
    void kit.disconnectWallet().catch(() => undefined);
    void fetch('/api/session', { method: 'DELETE' })
      .catch(() => undefined)
      .finally(() => {
        /*
          Then leave, with a real navigation.

          Server components decided guest-or-dashboard on the PREVIOUS request. Without this the
          frame keeps rendering the signed-in shell until something else happens to navigate, which
          is exactly what "I signed out and stayed in the dashboard" looks like.

          Home rather than reloading in place: a reader who signs out on `/studio` should land
          somewhere that makes sense as a guest, not on a studio they can no longer use.
        */
        window.location.assign('/');
      });
  }, [kit]);

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

  const accountChoice = useMemo<AccountChoice | null>(
    () => (choiceOpen && currentWallet !== null ? { wallet: currentWallet, accounts } : null),
    [choiceOpen, currentWallet, accounts],
  );

  const value = useMemo<SignerContextValue>(
    () => ({
      signer,
      wallets: [...wallets],
      unusableWallets,
      session,
      accountChoice,
      walletAccounts: currentWallet === null ? null : accounts,
      chooseAccount,
      cancelAccountChoice,
      reopenAccountChoice,
      reauthorizeWallet,
      connectWallet,
      signInWithGoogle,
      proof,
      provenAddress,
      proveSession,
      signOut,
      exportRecovery,
      error,
    }),
    [
      signer,
      wallets,
      unusableWallets,
      session,
      accountChoice,
      currentWallet,
      accounts,
      chooseAccount,
      cancelAccountChoice,
      reopenAccountChoice,
      reauthorizeWallet,
      connectWallet,
      signInWithGoogle,
      proof,
      provenAddress,
      proveSession,
      signOut,
      exportRecovery,
      error,
    ],
  );

  return <SignerContext.Provider value={value}>{children}</SignerContext.Provider>;
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

export function useSigner(): SignerContextValue {
  const value = useContext(SignerContext);
  if (value === null) throw new Error('useSigner must be used inside a SignerProvider');
  return value;
}
