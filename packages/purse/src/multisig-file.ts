// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { lstat, readFile } from 'node:fs/promises';
import { z } from 'zod';
import { publicKeyFromSuiBytes } from '@mysten/sui/verify';
import { multiSigSigner, type Signer } from '@projectx-social/signer';
import { allow, refuse, type Outcome } from './outcome.js';

const flaggedPublicKeyB64 = z
  .string()
  .regex(/^[A-Za-z0-9+/]{44,88}={0,2}$/, 'not a flag-prefixed public key in base64');

const weight = z.number().int().min(1).max(255);
const threshold = z.number().int().min(1).max(65535);

const memberName = z.string().regex(/^[a-z0-9][a-z0-9-]{0,31}$/, 'a member name is [a-z0-9-], at most 32');

export const MAX_DOCUMENT_BYTES = 8 * 1024;

export const multisigDocSchema = z.strictObject({
  version: z.literal(1),
  threshold,
  members: z
    .array(
      z.strictObject({
        name: memberName,
        publicKey: flaggedPublicKeyB64,
        weight,
      }),
    )
    .min(1)
    .max(10),
});

export type MultisigDoc = z.infer<typeof multisigDocSchema>;

export interface LoadedMultisig {
  readonly doc: MultisigDoc;
  readonly path: string;
}

export async function loadMultisigDoc(path: string): Promise<Outcome<LoadedMultisig>> {
  let info: Awaited<ReturnType<typeof lstat>>;
  try {
    info = await lstat(path);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return refuse('request-malformed', `the multisig document ${path} could not be read: ${detail}`);
  }
  if (info.isSymbolicLink()) {
    return refuse(
      'request-malformed',
      `${path} is a symbolic link. The purse never follows one to a document it will parse: a ` +
        `link is a way to make it read, and quote, a file that is not this document.`,
    );
  }
  if (!info.isFile()) {
    return refuse('request-malformed', `${path} is not a regular file.`);
  }
  if (info.size > MAX_DOCUMENT_BYTES) {
    return refuse(
      'request-malformed',
      `the multisig document ${path} is ${String(info.size)} bytes; a members document is under ` +
        `${String(MAX_DOCUMENT_BYTES)}. Refused unread.`,
    );
  }

  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return refuse('request-malformed', `the multisig document ${path} could not be read: ${detail}`);
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return refuse('request-malformed', `the multisig document ${path} is not JSON. Its bytes are deliberately not shown.`);
  }

  const parsed = multisigDocSchema.safeParse(json);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    return refuse(
      'request-malformed',
      `the multisig document ${path} does not have the shape this purse takes: ${issues}. It is ` +
        `{ version: 1, threshold, members: [{ name, publicKey, weight }] } and nothing else; an ` +
        `unrecognised field is refused rather than ignored.`,
    );
  }

  const names = new Set<string>();
  const addresses = new Set<string>();
  for (const member of parsed.data.members) {
    if (names.has(member.name)) {
      return refuse('request-malformed', `the multisig document ${path} names the member "${member.name}" twice.`);
    }
    let address: string;
    try {
      address = publicKeyFromSuiBytes(member.publicKey).toSuiAddress();
    } catch {
      return refuse(
        'request-malformed',
        `the multisig document ${path}: member "${member.name}" does not carry a public key this ` +
          `purse can read (flag-prefixed Sui bytes in base64).`,
      );
    }
    if (addresses.has(address)) {
      return refuse(
        'request-malformed',
        `the multisig document ${path} lists one public key twice (member "${member.name}"). A ` +
          `member counted twice is a weight nobody meant to grant.`,
      );
    }
    names.add(member.name);
    addresses.add(address);
  }

  return allow({ doc: parsed.data, path });
}

export interface MultisigWrapped {
  readonly signer: Signer;
  readonly memberName: string;
  readonly memberCount: number;
  readonly threshold: number;
}

export function wrapAsMultisig(doc: MultisigDoc, hot: Signer): Outcome<MultisigWrapped> {
  const wrapped = multiSigSigner({
    threshold: doc.threshold,
    members: doc.members.map((member) => ({ publicKey: member.publicKey, weight: member.weight })),
    available: [hot],
  });
  if (!wrapped.ok) {
    return refuse(
      'request-malformed',
      `the hot key cannot sign as this multisig: ${wrapped.failure.detail} The purse will not ` +
        `start; nothing was bound.`,
    );
  }

  let memberName = '';
  for (const member of doc.members) {
    const one = multiSigSigner({ threshold: 1, members: [{ publicKey: member.publicKey, weight: 1 }], available: [hot] });
    if (one.ok) {
      memberName = member.name;
      break;
    }
  }

  return allow({
    signer: wrapped.value,
    memberName,
    memberCount: doc.members.length,
    threshold: doc.threshold,
  });
}
