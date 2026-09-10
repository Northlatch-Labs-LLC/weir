// Built-by: @projectx.sui · Co-authored-by: Claude
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
 * The part of a wallet signer this application actually calls.
 *
 * `CurrentAccountSigner` from `@mysten/dapp-kit-core` satisfies this: it holds the kit rather than
 * an account, so it always signs with whichever address is current and cannot go stale between a
 * quote and a signature. Declared structurally rather than by importing the class, so this file
 * stays testable without standing a whole kit up.
 */
export interface WalletSigningSurface {
  signTransaction(bytes: Uint8Array): Promise<{ bytes: string; signature: string }>;
  signPersonalMessage(bytes: Uint8Array): Promise<{ signature: string }>;
}

/**
 * Wrap the kit's signer as this application's {@link ActiveSigner}.
 *
 * # What this no longer does
 *
 * It used to reach into `wallet.features['sui:signTransaction']` through a hand-written cast that
 * described the wallet's contract incorrectly — `transaction: string` where the standard passes an
 * object the wallet calls `.toJSON()` on — so `tsc` checked the call against our own wrong claim
 * and every wallet signature died in the browser. Feature lookup, the `toJSON` round trip and the
 * chain identifier are the kit's now, and it is generated from the standard rather than mirrored.
 *
 * # What it still does, and must
 *
 * The comparison below. Everything else here is plumbing.
 */
export function walletSigner(input: {
  signer: WalletSigningSurface;
  address: string;
  label: string;
}): ActiveSigner {
  return {
    kind: 'wallet',
    address: input.address,
    label: input.label,
    async signTransaction(bytes) {
      const { bytes: signedBytes, signature } = await input.signer.signTransaction(fromBase64(bytes));

      /*
        The wallet returns the bytes it actually signed, and they are the authority — a wallet may
        re-serialise before signing. Taking only the signature and submitting our own bytes would
        produce a signature valid for a transaction nobody sends, which the chain rejects with
        nothing explaining why.

        Comparing is what keeps simulate-then-sign true. If a wallet ever does change the bytes,
        this stops with a sentence naming that, rather than at a failed submission — and it stops
        before anything is sent, so the money is where it was.
      */
      if (signedBytes !== bytes) {
        throw new Error(
          `${input.label} changed the transaction before signing it, so what it signed is ` +
            `not what was simulated and quoted. Nothing has been submitted.`,
        );
      }

      return signature;
    },
    async signPersonalMessage(message) {
      const { signature } = await input.signer.signPersonalMessage(message);
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
 * The shape both a raw Wallet Standard wallet and the kit's `UiWallet` share.
 *
 * `UiWallet` reports features as a list of identifiers rather than an object keyed by them, which
 * is why this is declared here rather than imported: the check below is about which identifiers are
 * present, and that question has the same answer either way.
 */
export interface WalletCapabilities {
  chains: readonly string[];
  features: readonly string[];
}

/**
 * What a given wallet is missing, rather than merely whether it passed.
 *
 * The two generations of feature name matter here. Sui's Wallet Standard renamed
 * `sui:signTransactionBlock` to `sui:signTransaction`, and wallets migrated at different times.
 * Requiring the new name alone excluded any wallet that had not caught up — a supported wallet
 * disappearing over a spelling rather than a capability. Either name satisfies this.
 */
export function walletSupport(wallet: WalletCapabilities): WalletSupport {
  /*
    An extension for a different chain entirely is not a broken Sui wallet, it is simply not one.
    Naming it as unsupported would put a complaint about an Ethereum-only extension on the screen of
    everybody who happens to have both installed.
  */
  if (!wallet.chains.some((chain) => chain.startsWith('sui:'))) {
    return { ok: false, missing: [] };
  }

  const missing = REQUIRED.filter(
    (requirement) => !requirement.any.some((feature) => wallet.features.includes(feature)),
  ).map((requirement) => requirement.label);

  return { ok: missing.length === 0, missing };
}

/**
 * The predicate the discovery filter uses. It delegates, so "usable" has one definition rather than
 * two that can drift apart.
 */
export function isUsableWallet(wallet: WalletCapabilities): boolean {
  return walletSupport(wallet).ok;
}
