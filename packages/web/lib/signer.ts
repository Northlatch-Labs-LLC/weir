// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * One seam, two ways of signing.
 *
 * # The problem this solves
 *
 * Before this file, twelve components each did their own wallet discovery: `getWallets().get()
 * .filter(w => 'sui:signTransaction' in w.features)[0]`, followed by a hand-rolled feature lookup
 * and a call. Twelve copies of the same four lines. Adding a second way to sign to that shape means
 * adding a branch to each of the twelve, and the thirteenth component someone writes next month
 * gets whichever one they copied from.
 *
 * So the wallet stops being something components find, and becomes something they are given. A
 * component asks for the current signer and calls `signTransaction`. It does not know, and must not
 * care, whether a browser extension or a zero-knowledge proof produced the bytes.
 *
 * # What deliberately did not change
 *
 * The simulate-then-sign gate. Every flow still prepares on the server, simulates against live
 * objects, shows a quote, and only then offers to sign — and submission still posts back the same
 * bytes unchanged. zkLogin substitutes exactly one step of that sequence. If adding it had required
 * relaxing the gate, the gate would have won.
 */

import { fromBase64 } from '@mysten/sui/utils';
import { Transaction } from '@mysten/sui/transactions';
import type { Wallet, WalletAccount } from '@mysten/wallet-standard';

/** How the current session signs. Shown to the user, because it is not a detail to them. */
export type SignerKind = 'wallet' | 'zklogin';

/**
 * The whole surface a component needs.
 *
 * Both methods take the artefact in the form the server produced it — base64 for a transaction, raw
 * bytes for a message — and return a signature. Nothing here exposes a keypair, a wallet handle or
 * a proof, because a component that could reach those would eventually reach around this seam.
 */
export interface ActiveSigner {
  kind: SignerKind;
  address: string;
  /** For display: the wallet's own name, or the provider that authenticated the session. */
  label: string;
  /** `bytes` is the base64 transaction exactly as `/api/*​/prepare` returned it. */
  signTransaction(bytes: string): Promise<string>;
  signPersonalMessage(message: Uint8Array): Promise<string>;
}

/**
 * The chain identifier passed to a wallet when signing.
 *
 * Read from the network the server is configured for rather than hardcoded, so a wallet connected
 * to testnet is refused by the wallet itself instead of producing a signature against the wrong
 * network. A literal here would make that mismatch silent.
 */
export type SuiChain = `sui:${string}`;

/**
 * Wrap a connected Wallet Standard wallet.
 *
 * The feature objects are looked up once, at construction, rather than at each call. A wallet that
 * lost a feature between connecting and signing is a broken wallet, and finding that out while
 * holding a simulated transaction is worse than finding out at connect time.
 */
export function walletSigner(input: {
  wallet: Wallet;
  account: WalletAccount;
  chain: SuiChain;
}): ActiveSigner {
  /*
    The shape of `sui:signTransaction`, and the reason this was wrong.

    It does not take bytes. It takes an object the wallet calls `.toJSON()` on, and it returns the
    bytes it actually signed alongside the signature. The previous version of this cast declared
    `transaction: string` and a return of `{ signature }` only — so we handed a wallet a base64
    string and it failed in the browser with `t.transaction.toJSON is not a function`.

    The cast is why that compiled. It did not describe the wallet's contract, it overrode it, and
    `tsc` then checked this code against our own wrong claim. A hand-written mirror of somebody
    else's signature is only safe if something fails when the original moves; nothing did.
  */
  const signTx = input.wallet.features['sui:signTransaction'] as
    | {
        signTransaction: (i: {
          transaction: { toJSON: () => Promise<string> };
          account: WalletAccount;
          chain: string;
        }) => Promise<{ bytes: string; signature: string }>;
      }
    | undefined;

  const signMsg = input.wallet.features['sui:signPersonalMessage'] as
    | {
        signPersonalMessage: (i: {
          message: Uint8Array;
          account: WalletAccount;
        }) => Promise<{ signature: string }>;
      }
    | undefined;

  return {
    kind: 'wallet',
    address: input.account.address,
    label: input.wallet.name,
    async signTransaction(bytes) {
      if (signTx === undefined) {
        throw new Error(`${input.wallet.name} cannot sign transactions`);
      }
      /*
        Rebuilt from the prepared bytes rather than passed as a string.

        Everything in these bytes is already resolved — the server built them, so gas coins, budget
        and price are fixed values, not the unresolved placeholders a client-built transaction
        carries. Re-serialising fully resolved data is deterministic, which is what makes this safe.
      */
      const { bytes: signedBytes, signature } = await signTx.signTransaction({
        transaction: Transaction.from(fromBase64(bytes)),
        account: input.account,
        chain: input.chain,
      });

      /*
        The wallet returns the bytes it actually signed, and they are the authority — a wallet may
        re-serialise before signing. Taking only the signature and submitting our own bytes would
        produce a signature valid for a transaction nobody sends, which the chain rejects with
        nothing explaining why.

        Comparing is what keeps simulate-then-sign true. If a wallet ever does change the bytes,
        this stops with a sentence naming that, rather than at a failed submission.
      */
      if (signedBytes !== bytes) {
        throw new Error(
          `${input.wallet.name} changed the transaction before signing it, so what it signed is ` +
            `not what was simulated and quoted. Nothing has been submitted.`,
        );
      }

      return signature;
    },
    async signPersonalMessage(message) {
      if (signMsg === undefined) {
        throw new Error(`${input.wallet.name} cannot sign messages`);
      }
      const { signature } = await signMsg.signPersonalMessage({
        message,
        account: input.account,
      });
      return signature;
    },
  };
}

/**
 * Wrap a zkLogin session.
 *
 * `ZkLoginSigner` extends `Signer`, and every signing method on `Signer` funnels through
 * `signWithIntent` — so transactions and personal messages both come out as zkLogin signatures
 * with no extra work here. That is why `lib/identity.ts` needed no change at all: it already passes
 * a client to `verifyPersonalMessageSignature`, which is exactly what a zkLogin signature requires
 * to verify, and it has done since it was written.
 */
export function zkLoginSignerAdapter(input: {
  address: string;
  label: string;
  signer: {
    signTransaction: (bytes: Uint8Array) => Promise<{ signature: string }>;
    signPersonalMessage: (bytes: Uint8Array) => Promise<{ signature: string }>;
  };
}): ActiveSigner {
  return {
    kind: 'zklogin',
    address: input.address,
    label: input.label,
    async signTransaction(bytes) {
      // The server hands out base64; the SDK signs raw bytes. Converted here rather than changing
      // either side, so the transaction that gets signed is byte-identical to the one simulated.
      const { signature } = await input.signer.signTransaction(fromBase64(bytes));
      return signature;
    },
    async signPersonalMessage(message) {
      const { signature } = await input.signer.signPersonalMessage(message);
      return signature;
    },
  };
}

/**
 * Which wallet, and which of its addresses, this browser was last signed in with.
 *
 * # Why `localStorage`, when zkLogin insists on `sessionStorage`
 *
 * They store different kinds of thing, and the difference is the whole reason the rule differs.
 *
 * A zkLogin session contains an ephemeral *spending key*. It can sign for the user's address until
 * `maxEpoch` passes, so leaving it on disk turns a two-day window into an indefinite one — anybody
 * with the disk has the account. It goes in `sessionStorage` and dies with the tab, deliberately.
 *
 * This holds a wallet's name and a public address. Both are public, neither is a credential, and
 * possessing them grants nothing: every signature still has to be approved inside the extension,
 * which holds the key and never gave it to us. There is no secret here to expire.
 *
 * So do not "fix" one of these to match the other. Moving this to `sessionStorage` costs a wallet
 * user their session on every tab close for no security gained. Moving zkLogin to `localStorage`
 * leaves a spending key on disk, which is the failure the comment in `SignerProvider` describes.
 */
export const WALLET_STORAGE_KEY = 'projectx.wallet';

export interface RememberedWallet {
  /** The wallet's own name, as it registered itself. */
  wallet: string;
  /** The exact address that was bound. Restoring anything else is the defect this file fixed. */
  address: string;
}

/**
 * The store, or nothing.
 *
 * `localStorage` is not always reachable: Safari's private mode throws on access, and some embedded
 * browsers omit it. That is "this browser cannot remember", which is a real answer — the reader
 * signs in again — and is not the same as "nothing was remembered". Neither is treated as an error
 * to show, because there is nothing the reader could do about either.
 */
function store(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

export function rememberWallet(remembered: RememberedWallet): void {
  store()?.setItem(WALLET_STORAGE_KEY, JSON.stringify(remembered));
}

export function forgetWallet(): void {
  store()?.removeItem(WALLET_STORAGE_KEY);
}

/**
 * What was remembered, or `null`.
 *
 * Both fields are required. A half-written record is discarded rather than partly believed: a name
 * with no address would restore a wallet and then have to pick an address, which is exactly the
 * guess this whole change exists to delete.
 */
export function readRememberedWallet(): RememberedWallet | null {
  const raw = store()?.getItem(WALLET_STORAGE_KEY);
  if (raw === null || raw === undefined) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<RememberedWallet>;
    if (typeof parsed.wallet !== 'string' || typeof parsed.address !== 'string') {
      forgetWallet();
      return null;
    }
    return { wallet: parsed.wallet, address: parsed.address };
  } catch {
    forgetWallet();
    return null;
  }
}

/**
 * Every address a connected wallet has authorised for this site.
 *
 * # Why both sources are read
 *
 * The Wallet Standard puts the authorised set on `wallet.accounts` and describes `standard:connect`
 * as the way to *obtain* that authorisation. Several wallets answer `connect()` with the currently
 * active account alone and leave the rest on the wallet object — so code that read only the return
 * value saw one address, never offered a choice, and bound whatever the extension happened to be
 * showing. That is the reported defect: Slush and Phantom each binding one fixed address no matter
 * which account was selected inside them.
 *
 * The reverse also happens: an address authorised during this very connect can appear in the return
 * value before the wallet object catches up. Dropping it would lose the address just approved.
 *
 * So neither source is authoritative alone and neither is discarded. The wallet object leads because
 * that is where the standard says the set lives; anything the connect result adds is appended.
 * De-duplicated by address, because the same account arriving twice is one account.
 */
export function authorisedAccounts(
  wallet: Wallet,
  returned: readonly WalletAccount[],
): readonly WalletAccount[] {
  const merged: WalletAccount[] = [];
  const seen = new Set<string>();
  for (const account of [...wallet.accounts, ...returned]) {
    if (seen.has(account.address)) continue;
    seen.add(account.address);
    merged.push(account);
  }
  return merged;
}

/**
 * A wallet that can do everything this application asks of one.
 *
 * Both features are required, not just signing transactions. A wallet missing
 * `sui:signPersonalMessage` can pay but cannot comment, follow or read its own direct messages —
 * so it would connect successfully and then fail on the third thing the user tried, with an error
 * about a missing feature. Better to not offer it.
 */
const REQUIRED = [
  { label: 'connecting', any: ['standard:connect'] },
  { label: 'signing transactions', any: ['sui:signTransaction', 'sui:signTransactionBlock'] },
  { label: 'signing messages', any: ['sui:signPersonalMessage'] },
] as const;

export interface WalletSupport {
  /** Everything present: the wallet is offered. */
  ok: boolean;
  /** Plain-language names of what is absent, for telling the user why. Empty when `ok`. */
  missing: string[];
}

/**
 * What a given wallet is missing, rather than merely whether it passed.
 *
 * The two generations of feature name matter here. Sui's Wallet Standard renamed
 * `sui:signTransactionBlock` to `sui:signTransaction`, and wallets migrated at different times.
 * Requiring the new name alone excluded any wallet that had not caught up — a supported wallet
 * disappearing over a spelling rather than a capability. Either name satisfies this.
 */
export function walletSupport(wallet: Wallet): WalletSupport {
  /*
    An extension for a different chain entirely is not a broken Sui wallet, it is simply not one.
    Naming it as unsupported would put a complaint about an Ethereum-only extension on the screen of
    everybody who happens to have both installed.
  */
  if (!wallet.chains.some((chain) => chain.startsWith('sui:'))) {
    return { ok: false, missing: [] };
  }

  const missing = REQUIRED.filter(
    (requirement) => !requirement.any.some((feature) => feature in wallet.features),
  ).map((requirement) => requirement.label);

  return { ok: missing.length === 0, missing };
}

/**
 * The predicate the discovery filter uses. It delegates, so "usable" has one definition rather than
 * two that can drift apart.
 */
export function isUsableWallet(wallet: Wallet): boolean {
  return walletSupport(wallet).ok;
}
