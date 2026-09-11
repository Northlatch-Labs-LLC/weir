// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { readFile } from 'node:fs/promises';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Secp256r1Keypair } from '@mysten/sui/keypairs/secp256r1';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import type { Keypair } from '@mysten/sui/cryptography';
import { fail, ok, type Reading } from '@projectx-social/sdk';
import type { SerializedSignature, Signer, SignerScheme } from './signer.js';

type KeypairScheme = Extract<SignerScheme, 'ed25519' | 'secp256r1'>;

function fromKeypair(keypair: Keypair, scheme: KeypairScheme): Signer {
  const address = keypair.toSuiAddress();
  return {
    address,
    scheme,
    signPersonalMessage: async (bytes) => {
      try {
        const { signature } = await keypair.signPersonalMessage(bytes);
        return ok<SerializedSignature>(signature);
      } catch (error) {
        void error;
        return fail('transport', `local ${scheme} signer ${address}`, 'signing failed');
      }
    },
    signTransaction: async (bytes) => {
      try {
        const { signature } = await keypair.signTransaction(bytes);
        return ok<SerializedSignature>(signature);
      } catch (error) {
        void error;
        return fail('transport', `local ${scheme} signer ${address}`, 'signing failed');
      }
    },
  };
}

export function localKeypairSignerFromSecret(secret: string): Reading<Signer> {
  const source = 'local keypair signer';
  const trimmed = secret.trim();
  if (trimmed === '') {
    return fail('unconfigured', source, 'the signing secret is empty.');
  }

  let parsed: { scheme: string; secretKey: Uint8Array };
  try {
    parsed = decodeSuiPrivateKey(trimmed);
  } catch (error) {
    void error;
    return fail(
      'unconfigured',
      source,
      'the signing secret could not be decoded as a bech32 Sui private key (suiprivkey1…). ' +
        'Its value is deliberately not shown.',
    );
  }

  return fromParsed(parsed.scheme, parsed.secretKey, source);
}

export async function localKeypairSignerFromKeystore(args: {
  readonly path: string;
  readonly address: string;
}): Promise<Reading<Signer>> {
  const source = `Sui keystore ${args.path}`;

  let contents: string;
  try {
    contents = await readFile(args.path, 'utf8');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return fail('unconfigured', source, `could not be read: ${detail}`);
  }

  let entries: unknown;
  try {
    entries = JSON.parse(contents);
  } catch (error) {
    void error;
    return fail('malformed', source, 'is not valid JSON. Its contents are deliberately not shown.');
  }

  if (!Array.isArray(entries)) {
    return fail('malformed', source, 'is not a JSON array of base64 key entries.');
  }

  const wanted = normalise(args.address);
  if (wanted === null) {
    return fail('unconfigured', source, `${JSON.stringify(args.address)} is not a Sui address.`);
  }

  for (const entry of entries) {
    if (typeof entry !== 'string') continue;

    let raw: Uint8Array;
    try {
      raw = Uint8Array.from(Buffer.from(entry, 'base64'));
    } catch (error) {
      void error;
      continue;
    }
    if (raw.length !== 33) continue;

    const scheme = FLAG_TO_SCHEME[raw[0]!];
    if (scheme === undefined) continue;

    const candidate = fromParsed(scheme, raw.slice(1), source);
    if (!candidate.ok) continue;
    if (normalise(candidate.value.address) === wanted) return candidate;
  }

  return fail(
    'not-found',
    source,
    `holds no key for ${wanted}. Nothing about the other entries is reported by design.`,
  );
}

const FLAG_TO_SCHEME: Record<number, KeypairScheme | undefined> = {
  0x00: 'ed25519',
  0x02: 'secp256r1',
};

function fromParsed(
  scheme: string,
  secretKey: Uint8Array,
  source: string,
): Reading<Signer> {
  try {
    if (scheme === 'ED25519' || scheme === 'ed25519') {
      return ok(fromKeypair(Ed25519Keypair.fromSecretKey(secretKey), 'ed25519'));
    }
    if (scheme === 'Secp256r1' || scheme === 'secp256r1') {
      return ok(fromKeypair(Secp256r1Keypair.fromSecretKey(secretKey), 'secp256r1'));
    }
  } catch (error) {
    void error;
    return fail('malformed', source, `a ${scheme} key could not be loaded.`);
  }

  return fail(
    'unconfigured',
    source,
    `signature scheme ${JSON.stringify(scheme)} is not supported by LocalKeypairSigner. ` +
      `Only ed25519 and secp256r1 are, and adding one means adding tests for it, not a branch.`,
  );
}

function normalise(address: string): string | null {
  const trimmed = address.trim();
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(trimmed)) return null;
  return `0x${trimmed.slice(2).toLowerCase().padStart(64, '0')}`;
}
