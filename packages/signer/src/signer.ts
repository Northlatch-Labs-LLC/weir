// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import type { Reading } from '@projectx-social/sdk';

export type SerializedSignature = string;

export type SignerScheme = 'ed25519' | 'secp256r1' | 'multisig';

export interface Signer {
  readonly address: string;
  readonly scheme: SignerScheme;
  readonly signPersonalMessage: (bytes: Uint8Array) => Promise<Reading<SerializedSignature>>;
  readonly signTransaction: (bytes: Uint8Array) => Promise<Reading<SerializedSignature>>;
}
