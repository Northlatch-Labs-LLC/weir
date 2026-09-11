// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { createHash } from 'node:crypto';
import { z } from 'zod';
import { statementIntent } from './statement.js';

const HEX_ID = /^0x[0-9a-fA-F]{1,64}$/;

const U64_DECIMAL = /^(0|[1-9][0-9]{0,19})$/;

const SHA256_HEX = /^[0-9a-f]{64}$/;

const MOVE_TYPE = /^0x[0-9a-fA-F]{1,64}::[A-Za-z_][A-Za-z0-9_]{0,127}::[A-Za-z_][A-Za-z0-9_]{0,127}$/;

const suiId = z.string().regex(HEX_ID, 'not a Sui object id or address');
const u64 = z.string().regex(U64_DECIMAL, 'not a u64 written as a decimal string');
const sha256Hex = z.string().regex(SHA256_HEX, 'not a lowercase hex sha256 digest');
const moveType = z.string().regex(MOVE_TYPE, 'not a fully-qualified Move type');

const objectDigest = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,64}$/, 'not a base58 object digest');

export const sharedObjectRef = z.strictObject({
  objectId: suiId,
  initialSharedVersion: u64,
  mutable: z.boolean(),
});

export const ownedObjectRef = z.strictObject({
  objectId: suiId,
  version: u64,
  digest: objectDigest,
});

export type SharedObjectRef = z.infer<typeof sharedObjectRef>;
export type OwnedObjectRef = z.infer<typeof ownedObjectRef>;

const contentKey = z
  .string()
  .min(1, 'a content key cannot be empty')
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 256, 'a content key is at most 256 bytes');

const positiveU64 = u64.refine((value) => value !== '0', 'a price of zero is not a price');

export const postIntent = z.strictObject({
  kind: z.literal('post'),
  coinType: moveType,
  vault: sharedObjectRef,
  cap: ownedObjectRef,
  contentKey,
  bodyDigestSha256: sha256Hex,
  priceMist: positiveU64,
});

export const priceIntent = z.strictObject({
  kind: z.literal('price'),
  coinType: moveType,
  vault: sharedObjectRef,
  cap: ownedObjectRef,
  contentKey,
  priceMist: positiveU64,
});

export const settleEpochIntent = z.strictObject({
  kind: z.literal('settle_epoch'),
  packageId: suiId,
  ledgerCap: ownedObjectRef,
  registry: sharedObjectRef,
  soul: sharedObjectRef,
  clock: sharedObjectRef,
  vaultSui: u64,
  epochNetNonneg: z.boolean(),
});

export const recordSpendIntent = z.strictObject({
  kind: z.literal('record_spend'),
  packageId: suiId,
  soul: sharedObjectRef,
  amountMist: positiveU64,
});

export const bookEarnedIntent = z.strictObject({
  kind: z.literal('book_earned'),
  packageId: suiId,
  ledgerCap: ownedObjectRef,
  soul: sharedObjectRef,
  amountMist: positiveU64,
});

export const bookBurnedIntent = z.strictObject({
  kind: z.literal('book_burned'),
  packageId: suiId,
  ledgerCap: ownedObjectRef,
  soul: sharedObjectRef,
  amountMist: positiveU64,
});

export const intentSchema = z.discriminatedUnion('kind', [
  postIntent,
  priceIntent,
  settleEpochIntent,
  recordSpendIntent,
  bookEarnedIntent,
  bookBurnedIntent,
  statementIntent,
]);

export type Intent = z.infer<typeof intentSchema>;
export type IntentKind = Intent['kind'];

export function parseIntent(value: unknown): { ok: true; intent: Intent } | { ok: false; reason: string } {
  const parsed = intentSchema.safeParse(value);
  if (parsed.success) return { ok: true, intent: parsed.data };

  const problems = parsed.error.issues
    .map((issue) => {
      const path = issue.path.length === 0 ? '(root)' : issue.path.join('.');
      return `${path}: ${issue.message}`;
    })
    .slice(0, 12);

  return {
    ok: false,
    reason:
      `the intent does not satisfy the schema — ${problems.join('; ')}. The offending values are ` +
      `deliberately not quoted: an intent is written by a model that reads the internet, and a ` +
      `refusal that echoed it would let that text choose what appears in the audit log.`,
  };
}

export function intentHash(intent: Intent): string {
  return createHash('sha256').update(canonicalJson(intent), 'utf8').digest('hex');
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}
