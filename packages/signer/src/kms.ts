// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { fail, type Reading } from '@projectx-social/sdk';
import type { SerializedSignature, Signer } from './signer.js';

export interface KmsTransport {
  readonly publicKey: () => Promise<Uint8Array>;
  readonly signDigest: (digest: Uint8Array) => Promise<Uint8Array>;
}

export interface KmsSignerOptions {
  readonly address: string;
  readonly transport?: KmsTransport;
}

export function kmsSigner(options: KmsSignerOptions): Signer {
  const source = `KMS signer ${options.address}`;
  const detail =
    options.transport === undefined
      ? 'no KMS transport is configured. KmsSigner is a documented stub: the interface is fixed ' +
        '(see KmsTransport) and no backend is implemented, because no key has been provisioned ' +
        'in any cloud KMS and this package takes no cloud SDK dependency speculatively.'
      : 'a KMS transport was supplied, but KmsSigner has no implementation to drive it. The ' +
        'digest construction and public-key handling are unwritten. Refusing rather than ' +
        'returning a signature from an unimplemented path.';

  const refuse = (): Promise<Reading<SerializedSignature>> =>
    Promise.resolve(fail<SerializedSignature>('unconfigured', source, detail));

  return {
    address: options.address,
    scheme: 'secp256r1',
    signPersonalMessage: refuse,
    signTransaction: refuse,
  };
}
