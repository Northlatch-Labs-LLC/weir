'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

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

export interface UnusableWallet {
  name: string;
  missing: string[];
}

export interface AccountChoice {
  wallet: UiWallet;
  accounts: readonly UiWalletAccount[];
}

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
  proof: SessionProof;
  provenAddress: string | null;
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
  network: string | null;
  rpcUrl: string | null;
}) {
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
      <SignerBridge network={network}>{children}</SignerBridge>
    </DAppKitProvider>
  );
}

function SignerBridge({ children, network }: { children: ReactNode; network: string | null }) {
  const router = useRouter();
  const kit = useDAppKit();
  const registered = useWallets();
  const currentAccount = useCurrentAccount();
  const currentWallet = useCurrentWallet();

  const wallets = useMemo(() => registered.filter(isUsableWallet), [registered]);

  const accounts = useMemo<readonly UiWalletAccount[]>(
    () => currentWallet?.accounts ?? [],
    [currentWallet],
  );

  const [zkSigner, setZkSigner] = useState<ActiveSigner | null>(null);
  const [zkSession, setZkSession] = useState<ActiveSession | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
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
      registered
        .map((wallet) => ({ name: wallet.name, support: walletSupport(wallet) }))
        .filter((entry) => !entry.support.ok && entry.support.missing.length > 0)
        .map((entry) => ({ name: entry.name, missing: entry.support.missing })),
    [registered],
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
        if (result.accounts.length > 1) setChoiceOpen(true);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
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
        setError(cause instanceof Error ? cause.message : String(cause));
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
      router.refresh();
    } catch {
      setProof('declined');
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

export function useSigner(): SignerContextValue {
  const value = useContext(SignerContext);
  if (value === null) throw new Error('useSigner must be used inside a SignerProvider');
  return value;
}
