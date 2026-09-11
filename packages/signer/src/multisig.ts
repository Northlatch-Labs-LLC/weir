// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { MultiSigPublicKey } from '@mysten/sui/multisig';
import { publicKeyFromSuiBytes } from '@mysten/sui/verify';
import type { PublicKey } from '@mysten/sui/cryptography';
import { fail, ok, type Reading } from '@projectx-social/sdk';
import type { SerializedSignature, Signer } from './signer.js';

export interface MultiSigMember {
  readonly publicKey: PublicKey | string | Uint8Array;
  readonly weight: number;
}

export interface MultiSigSignerOptions {
  readonly threshold: number;
  readonly members: readonly MultiSigMember[];
  readonly available: readonly Signer[];
}

export function multiSigSigner(options: MultiSigSignerOptions): Reading<Signer> {
  const source = 'multisig signer';

  if (options.members.length === 0) {
    return fail('unconfigured', source, 'a multisig needs at least one member.');
  }
  if (!Number.isInteger(options.threshold) || options.threshold <= 0) {
    return fail(
      'unconfigured',
      source,
      `threshold ${String(options.threshold)} is not a positive integer. A threshold of zero is ` +
        `an address anybody can sign for.`,
    );
  }

  const publicKeys: { publicKey: PublicKey; weight: number }[] = [];
  for (const member of options.members) {
    if (!Number.isInteger(member.weight) || member.weight <= 0) {
      return fail('unconfigured', source, `a member declares weight ${String(member.weight)}.`);
    }
    try {
      const publicKey =
        typeof member.publicKey === 'string' || member.publicKey instanceof Uint8Array
          ? publicKeyFromSuiBytes(member.publicKey)
          : member.publicKey;
      publicKeys.push({ publicKey, weight: member.weight });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return fail('malformed', source, `a member public key could not be read: ${detail}`);
    }
  }

  const totalWeight = publicKeys.reduce((sum, entry) => sum + entry.weight, 0);
  if (totalWeight < options.threshold) {
    return fail(
      'unconfigured',
      source,
      `the members' weights total ${totalWeight}, below the threshold of ${options.threshold}. ` +
        `This address could never be signed for by anyone.`,
    );
  }

  let multiSigPublicKey: MultiSigPublicKey;
  try {
    multiSigPublicKey = MultiSigPublicKey.fromPublicKeys({
      threshold: options.threshold,
      publicKeys,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return fail('malformed', source, `the multisig public key could not be built: ${detail}`);
  }

  const address = multiSigPublicKey.toSuiAddress();

  const memberAddresses = new Set(publicKeys.map((entry) => entry.publicKey.toSuiAddress()));
  for (const signer of options.available) {
    if (!memberAddresses.has(signer.address)) {
      return fail(
        'unconfigured',
        source,
        `${signer.address} was supplied as an available signer but is not a member of this ` +
          `multisig. Checked now rather than at signing time, which in an unattended process is ` +
          `three in the morning.`,
      );
    }
  }

  if (options.available.length === 0) {
    return fail(
      'unconfigured',
      source,
      `no member keys are available to this process, so ${address} cannot sign here. Use ` +
        `readOnlySigner() if that is intended, so the refusal is deliberate rather than a ` +
        `signer that fails on first use.`,
    );
  }

  const combine = async (
    bytes: Uint8Array,
    signOne: (signer: Signer, b: Uint8Array) => Promise<Reading<SerializedSignature>>,
    verify: (message: Uint8Array, signature: string) => Promise<boolean>,
    what: string,
  ): Promise<Reading<SerializedSignature>> => {
    const partials: string[] = [];
    for (const signer of options.available) {
      const partial = await signOne(signer, bytes);
      if (!partial.ok) {
        return fail(
          partial.failure.kind,
          source,
          `member ${signer.address} could not sign the ${what}: ${partial.failure.detail}`,
        );
      }
      partials.push(partial.value);
    }

    let combined: string;
    try {
      combined = multiSigPublicKey.combinePartialSignatures(partials);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return fail('malformed', source, `partial signatures could not be combined: ${detail}`);
    }

    let valid: boolean;
    try {
      valid = await verify(bytes, combined);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return fail('malformed', source, `the combined signature could not be verified: ${detail}`);
    }

    if (!valid) {
      const availableWeight = options.available.reduce((sum, signer) => {
        const entry = publicKeys.find((p) => p.publicKey.toSuiAddress() === signer.address);
        return sum + (entry?.weight ?? 0);
      }, 0);
      return fail(
        'unconfigured',
        source,
        `the combined signature does not satisfy this multisig. The members available to this ` +
          `process carry ${availableWeight} of the ${options.threshold} weight required. ` +
          `Refused here rather than sent to a node, so the missing key is named instead of a ` +
          `rejection code.`,
      );
    }

    return ok<SerializedSignature>(combined);
  };

  return ok({
    address,
    scheme: 'multisig',
    signPersonalMessage: (bytes) =>
      combine(
        bytes,
        (signer, b) => signer.signPersonalMessage(b),
        (message, signature) => multiSigPublicKey.verifyPersonalMessage(message, signature),
        'personal message',
      ),
    signTransaction: (bytes) =>
      combine(
        bytes,
        (signer, b) => signer.signTransaction(b),
        (message, signature) => multiSigPublicKey.verifyTransaction(message, signature),
        'transaction',
      ),
  });
}
