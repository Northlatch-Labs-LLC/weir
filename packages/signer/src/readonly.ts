// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { fail, type Reading } from '@projectx-social/sdk';
import type { SerializedSignature, Signer, SignerScheme } from './signer.js';

export interface ReadOnlySignerOptions {
  readonly address: string;
  readonly scheme?: SignerScheme;
  readonly because?: string;
}

export function readOnlySigner(options: ReadOnlySignerOptions): Signer {
  const source = `read-only signer ${options.address}`;
  const because =
    options.because ?? 'no signing key is configured for this address.';

  const refuse = (): Promise<Reading<SerializedSignature>> =>
    Promise.resolve(
      fail<SerializedSignature>(
        'unconfigured',
        source,
        `${because} Nothing was signed and nothing was submitted. This is a deliberate absence ` +
          `rather than a fault: retrying will produce the same refusal.`,
      ),
    );

  return {
    address: options.address,
    scheme: options.scheme ?? 'ed25519',
    signPersonalMessage: refuse,
    signTransaction: refuse,
  };
}
