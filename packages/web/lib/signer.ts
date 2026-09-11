// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { fromBase64 } from '@mysten/sui/utils';

export type SignerKind = 'wallet' | 'zklogin';

export interface ActiveSigner {
  kind: SignerKind;
  address: string;
  label: string;
  signTransaction(bytes: string): Promise<string>;
  signPersonalMessage(message: Uint8Array): Promise<string>;
}

export interface WalletSigningSurface {
  signTransaction(bytes: Uint8Array): Promise<{ bytes: string; signature: string }>;
  signPersonalMessage(bytes: Uint8Array): Promise<{ signature: string }>;
}

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
      const { signature } = await input.signer.signTransaction(fromBase64(bytes));
      return signature;
    },
    async signPersonalMessage(message) {
      const { signature } = await input.signer.signPersonalMessage(message);
      return signature;
    },
  };
}

const REQUIRED = [
  { label: 'connecting', any: ['standard:connect'] },
  { label: 'signing transactions', any: ['sui:signTransaction', 'sui:signTransactionBlock'] },
  { label: 'signing messages', any: ['sui:signPersonalMessage'] },
] as const;

export interface WalletSupport {
  ok: boolean;
  missing: string[];
}

export interface WalletCapabilities {
  chains: readonly string[];
  features: readonly string[];
}

export function walletSupport(wallet: WalletCapabilities): WalletSupport {
  if (!wallet.chains.some((chain) => chain.startsWith('sui:'))) {
    return { ok: false, missing: [] };
  }

  const missing = REQUIRED.filter(
    (requirement) => !requirement.any.some((feature) => wallet.features.includes(feature)),
  ).map((requirement) => requirement.label);

  return { ok: missing.length === 0, missing };
}

export function isUsableWallet(wallet: WalletCapabilities): boolean {
  return walletSupport(wallet).ok;
}
