// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { createHash } from 'node:crypto';
import type { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { statementFor, type Action } from '@projectx-social/sdk';

export {
  statementFor,
  isSingleUse,
  SIGNATURE_WINDOW_MS,
  STATEMENT_SHAPES,
  type Action,
} from '@projectx-social/sdk';

export interface SignedAction {
  address: string;
  signature: string;
  timestampMs: number;
  statement: string;
}

export async function signAction(
  keypair: Ed25519Keypair,
  action: Action,
  origin: string,
  timestampMs: number = Date.now(),
): Promise<SignedAction> {
  const address = keypair.toSuiAddress();
  const statement = statementFor(action, address, timestampMs, origin);
  const { signature } = await keypair.signPersonalMessage(new TextEncoder().encode(statement));
  return { address, signature, timestampMs, statement };
}

export function publishContentSha256(preview: string, text: string): string {
  return createHash('sha256')
    .update(`${preview.length}:${preview}${text.length}:${text}`)
    .digest('hex');
}

export function paidStatementFor(
  paid: { handle: string; contentKey: string; price: string } | undefined,
): string {
  return paid === undefined ? '' : `${paid.handle}:${paid.contentKey}:${paid.price}`;
}
