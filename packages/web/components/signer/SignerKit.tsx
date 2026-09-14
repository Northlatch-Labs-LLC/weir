'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
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
import { readWalletFailure } from '@/lib/wallet-failure';
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
import type {
  AccountChoice,
  KitValue,
  RecoveryDetails,
  SessionInfo,
  SessionProof,
  UnusableWallet,
} from '@/components/signer/context';

/*
  Everything below the wallet kit's provider: the Wallet Standard, the Sui SDK, zkLogin. It is
  the heaviest code in the app, and `SignerProvider` downloads it only once a reader is signed
  in or standing at a door. It publishes what it knows through `onValue` instead of wrapping the
  page, so that mounting it later never remounts what the reader is looking at.
*/
export interface SignerKitProps {
  network: string | null;
  rpcUrl: string | null;
  onValue: (value: KitValue) => void;
}

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

export default function SignerKit({ network, rpcUrl, onValue }: SignerKitProps) {
  const [kit] = useState(() =>
    createDAppKit({
      networks: [(network ?? 'mainnet') as 'mainnet'],
      createClient: (forNetwork) =>
        new SuiGrpcClient({ network: forNetwork, baseUrl: rpcUrl ?? 'http://127.0.0.1:0' }),
      storageKey: 'projectx.wallet',
      /*
        Slush's hosted wallet is offered alongside whatever extensions the reader has.

        It is the kit's default and it stays on. This product's whole first screen is addressed to
        somebody who has never held an address, and the alternative for them is "install a browser
        extension first" — which is the step most people stop at. A wallet that needs nothing
        installed is the difference between reading that page and leaving it.
      */
    }),
  );

  return (
    <DAppKitProvider dAppKit={kit}>
      <SignerBridge network={network} onValue={onValue} />
    </DAppKitProvider>
  );
}

function SignerBridge({
  network,
  onValue,
}: {
  network: string | null;
  onValue: (value: KitValue) => void;
}) {
  const router = useRouter();
  const kit = useDAppKit();
  const registered = useWallets();
  const currentAccount = useCurrentAccount();
  const currentWallet = useCurrentWallet();

  /*
    The Wallet Standard lets one extension register itself more than once (Slush registers a
    browser wallet and a web wallet under one name, and a dev reload re-registers both). A reader
    is shown each name once; the first registration wins, which is the extension's own.
  */
  const distinct = useMemo(() => {
    const seen = new Set<string>();
    return registered.filter((wallet) => (seen.has(wallet.name) ? false : (seen.add(wallet.name), true)));
  }, [registered]);
  const wallets = useMemo(() => distinct.filter(isUsableWallet), [distinct]);

  const accounts = useMemo<readonly UiWalletAccount[]>(
    () => currentWallet?.accounts ?? [],
    [currentWallet],
  );

  const [zkSigner, setZkSigner] = useState<ActiveSigner | null>(null);
  const [zkSession, setZkSession] = useState<ActiveSession | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  /* The wallet whose extension we are waiting on, so its own button can say so. */
  const [connecting, setConnecting] = useState<string | null>(null);
  const [choiceOpen, setChoiceOpen] = useState(false);
  const [proof, setProof] = useState<SessionProof>('unknown');
  const [provenAddress, setProvenAddress] = useState<string | null>(null);

  const walletActiveSigner = useMemo<ActiveSigner | null>(() => {
    if (currentWallet === null || currentAccount === null || network === null) return null;
    return walletSigner({
      signer: new CurrentAccountSigner(kit as DAppKit),
      address: currentAccount.address,
      label: currentWallet.name,
    });
  }, [kit, currentWallet, currentAccount, network]);

  const signer = walletActiveSigner ?? zkSigner;

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

  const unusableWallets = useMemo<UnusableWallet[]>(
    () =>
      distinct
        .map((wallet) => ({ name: wallet.name, support: walletSupport(wallet) }))
        .filter((entry) => !entry.support.ok && entry.support.missing.length > 0)
        .map((entry) => ({ name: entry.name, missing: entry.support.missing })),
    [distinct],
  );

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
        if (cancelled) return;
        const restoreFailure = readWalletFailure(cause);
        if (restoreFailure.say !== null) setError(restoreFailure.say);
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
      setConnecting(wallet.name);
      try {
        const result = await kit.connectWallet({ wallet });
        if (result.accounts.length > 1) setChoiceOpen(true);
      } catch (cause) {
        // Closing the wallet popup is a decision, not a fault: the screen returns to rest and says
        // nothing. Everything else is said in words that name the reader's next move.
        const failure = readWalletFailure(cause);
        if (failure.say !== null) setError(failure.say);
      } finally {
        setConnecting(null);
      }
    },
    [kit, network],
  );

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
        const failure = readWalletFailure(cause);
        setError(failure.say ?? 'Sign-in did not start. Try again.');
      }
    },
    [session],
  );

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
      const statement =
        `Weir\naddress: ${address}\nissued: ${timestampMs}\norigin: ${window.location.origin}` +
        `\naction: read content`;
      let signature: string | undefined;
      try {
        signature = await signer?.signPersonalMessage(new TextEncoder().encode(statement));
      } catch (cause) {
        // The one place a decline is real: the reader was asked and said no.
        setProof(readWalletFailure(cause).kind === 'dismissed' ? 'declined' : 'failed');
        return;
      }
      if (signature === undefined) {
        setProof('failed');
        return;
      }

      const response = await fetch('/api/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address, signature, timestampMs }),
      });
      if (!response.ok) {
        // A signature that stands and a server that refused it are not the reader's doing.
        setProof('failed');
        return;
      }
      setProvenAddress(address);
      setProof('proved');
      router.refresh();
    } catch {
      setProof('failed');
    }
  }, [signer, router]);

  useEffect(() => {
    if (signer === null || proof !== 'unknown') return;
    void proveSession();
  }, [signer, proof, proveSession]);

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
        window.location.assign('/');
      });
  }, [kit]);

  const exportRecovery = useCallback(async (): Promise<RecoveryDetails | null> => {
    if (zkSession === null) return null;
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
      throw new Error(body.error ?? `your recovery details are still loading (${response.status})`);
    }
    return body as RecoveryDetails;
  }, [zkSession]);

  const accountChoice = useMemo<AccountChoice | null>(
    () => (choiceOpen && currentWallet !== null ? { wallet: currentWallet, accounts } : null),
    [choiceOpen, currentWallet, accounts],
  );

  const value = useMemo<KitValue>(
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
      connecting,
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
      connecting,
    ],
  );

  /*
    Layout, not passive: the provider's consumers must see a new signer or an open account
    question in the same commit the kit decided it, or a screen paints one frame behind.
  */
  useLayoutEffect(() => {
    onValue(value);
  }, [value, onValue]);

  return null;
}

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
    salt: '',
    addressSeed: body.addressSeed,
    proofPoints: body.proofPoints,
    issBase64Details: body.issBase64Details,
    headerBase64: body.headerBase64 ?? '',
  };
  window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(complete));
  return complete;
}
