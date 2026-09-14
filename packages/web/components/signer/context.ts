// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { createContext, useContext, useSyncExternalStore } from 'react';
import type { UiWallet, UiWalletAccount } from '@mysten/dapp-kit-core';
import type { ActiveSigner } from '@/lib/signer';

export interface SessionInfo {
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

/*
  `declined` is the reader saying no. `failed` is everything that went wrong on the way — the
  server answering 500, the request never leaving the browser, the extension throwing. They used
  to be the same value, so an outage was shown to the reader as their own decision and the screen
  offered them nothing to do about it.
*/
export type SessionProof = 'unknown' | 'checking' | 'proved' | 'unproved' | 'declined' | 'failed';

export interface SignerContextValue {
  /*
    False until the wallet kit, the Sui SDK and zkLogin have been downloaded and mounted. While
    false, `wallets` is empty because nothing has looked yet, not because the browser has none;
    a screen that would tell the reader "no wallet" must wait for `ready` before saying so.
  */
  ready: boolean;
  /* Asks for the kit now. Idempotent; a screen that is about to need wallets calls it on open. */
  wake: () => void;
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
  /* The name of the wallet whose extension we are waiting on, so its button can say so. */
  connecting: string | null;
}

/* What the kit publishes: everything the reader can see or do, minus the loading state. */
export type KitValue = Omit<SignerContextValue, 'ready' | 'wake'>;

/*
  The kit writes here and screens read here. A publish re-renders the screens that subscribe
  and nothing else — not the provider, and so not the kit — which is what lets the kit publish
  from inside its own render cycle without that publish coming back round to it.
*/
export interface SignerStore {
  get: () => SignerContextValue;
  subscribe: (listener: () => void) => () => void;
  publish: (value: KitValue) => void;
}

export function createSignerStore(wake: () => void): SignerStore {
  const later = () => {
    wake();
  };
  const laterAsync = async () => {
    wake();
  };
  let current: SignerContextValue = {
    ready: false,
    wake,
    signer: null,
    wallets: [],
    unusableWallets: [],
    session: null,
    accountChoice: null,
    walletAccounts: null,
    chooseAccount: later,
    cancelAccountChoice: later,
    reopenAccountChoice: later,
    reauthorizeWallet: laterAsync,
    connectWallet: laterAsync,
    signInWithGoogle: laterAsync,
    proof: 'unknown',
    provenAddress: null,
    proveSession: laterAsync,
    signOut: later,
    exportRecovery: async () => {
      wake();
      return null;
    },
    error: null,
    connecting: null,
  };
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    publish: (value) => {
      current = { ...value, ready: true, wake };
      for (const listener of listeners) listener();
    },
  };
}

export const SignerContext = createContext<SignerStore | null>(null);

export function useSigner(): SignerContextValue {
  const store = useContext(SignerContext);
  if (store === null) throw new Error('useSigner must be used inside a SignerProvider');
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
