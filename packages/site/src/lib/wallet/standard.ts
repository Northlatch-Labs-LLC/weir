// The Sui Wallet Standard integration. This is the ONLY code in the app that
// talks to wallets. It uses the browser-global Wallet Standard, so any
// compliant wallet works — no wallet brand is hardcoded.
//
// The app is an interface to a wallet, never a constructor of transaction
// contents. prepare/sign/submit is split: the backend prepares opaque bytes,
// the wallet signs those exact bytes, the signature and bytes go back. This
// module only detects, connects, and signs; it never builds a transaction.

import { getWallets } from '@mysten/wallet-standard';

// Minimal structural types. The Wallet Standard is a browser-global protocol;
// these describe only what this app uses, so the app is not coupled to a
// particular version of the package's type surface.

export type WalletAccount = {
  address: string;
  label?: string;
  icon?: string;
  publicKey?: Uint8Array;
};

/*
  What `pay()` needs from a wallet: one call that signs exact bytes and hands back
  the bytes it signed plus the signature. Nothing about connection or accounts.
*/
export type WalletSigner = {
  signTransaction: (bytes: Uint8Array) => Promise<{ bytes: string; signature: string }>;
};

export type DetectedWallet = {
  name: string;
  version: string;
  icon: string | null;
  accounts: WalletAccount[];
};

type RawWallet = {
  name: string;
  version?: string;
  icon?: string;
  accounts: readonly WalletAccount[];
  features: Record<string, unknown>;
};

// getWallets() returns the shared registry and dispatches wallet-standard
// "app-ready" so installed wallets register themselves.
const registry = getWallets();

function rawWallets(): RawWallet[] {
  return registry.get() as unknown as RawWallet[];
}

function findWallet(name: string): RawWallet | undefined {
  return rawWallets().find(w => w.name === name);
}

// The wallets the browser actually exposes, right now.
export function listDetectedWallets(): DetectedWallet[] {
  return rawWallets().map(w => ({
    name: w.name,
    version: w.version ?? '',
    icon: typeof w.icon === 'string' ? w.icon : null,
    accounts: [...w.accounts],
  }));
}

// Wallets register asynchronously after the page loads. Subscribe so the UI
// can update the moment a wallet appears.
export function onWalletsChanged(cb: () => void): () => void {
  return registry.on('register', cb);
}

export async function connectWallet(
  name: string,
  opts: { silent?: boolean } = {},
): Promise<WalletAccount[]> {
  const wallet = findWallet(name);
  if (!wallet) throw new Error('no-wallet');
  const feature = wallet.features['standard:connect'] as
    | { connect: (input?: { silent?: boolean }) => Promise<{ accounts: WalletAccount[] }> }
    | undefined;
  if (!feature?.connect) throw new Error('no-connect');
  const res = await feature.connect({ silent: opts.silent });
  return res.accounts ?? [];
}

// Sign the exact bytes the backend produced. They are passed through
// unchanged — rebuilding or re-encoding them invalidates the signature.
export async function signTransactionBytes(
  name: string,
  account: WalletAccount,
  bytes: Uint8Array,
): Promise<{ bytes: string; signature: string }> {
  const wallet = findWallet(name);
  if (!wallet) throw new Error('no-wallet');
  const feature = wallet.features['sui:signTransaction'] as
    | {
        signTransaction: (input: {
          transaction: Uint8Array;
          account: WalletAccount;
          chain: string;
        }) => Promise<{ bytes: string; signature: string }>;
      }
    | undefined;
  if (!feature?.signTransaction) throw new Error('no-sign');
  return feature.signTransaction({ transaction: bytes, account, chain: 'sui:mainnet' });
}

export async function disconnectWallet(name: string): Promise<void> {
  const wallet = findWallet(name);
  if (!wallet) return;
  const feature = wallet.features['standard:disconnect'] as
    | { disconnect: () => Promise<void> | void }
    | undefined;
  if (feature?.disconnect) await feature.disconnect();
}

// The wallet emits "change" when its accounts or active account change, e.g.
// a switch inside the wallet extension. Subscribe to re-read accounts.
export function onWalletAccountsChanged(name: string, cb: () => void): () => void {
  const wallet = findWallet(name);
  const feature = wallet?.features['standard:events'] as
    | { on: (event: string, listener: () => void) => () => void }
    | undefined;
  if (!feature?.on) return () => {};
  return feature.on('change', cb);
}

// Opaque bytes arrive base64-encoded from the backend (the serialized
// transaction). The wallet signs bytes, so decode the base64 losslessly.
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}