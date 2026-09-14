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

/**
 * Record what this beat spent against the epoch's allowance.
 *
 * From the deployed package, read off mainnet on 2026-09-06 (GraphQL, package
 * `0x8d6567ed…635f`, module `soul`):
 *
 *   public fun record_spend(soul: &mut EmployeeSoul, amount: u64, ctx: &TxContext)
 *
 * There is no capability argument and there is not meant to be. The contract asserts
 * `ctx.sender() == soul.agent`, so the agent's own address is the only signer that can book the
 * agent's own spend. That is why this kind lives in the **content** purse beside `post` and
 * `price` rather than in the settlement purse: the hot key that publishes is the key the soul
 * recognises. A settlement key signing this would abort `ENotThisAgent` (2).
 *
 * `amountMist` is what the beat cost, in MIST. The contract bounds it — a spend above
 * `remaining_allowance()` aborts `EAllowanceExceeded` (5) rather than truncating — and the policy
 * document's outflow ceiling bounds it a second time. Without this kind the soul's `epoch_spent`
 * stays at zero for ever and the allowance it is measured against means nothing.
 */
export const recordSpendIntent = z.strictObject({
  kind: z.literal('record_spend'),
  /** The published soul package. Named per intent so a republish is not a code change. */
  packageId: suiId,
  soul: sharedObjectRef,
  /** A beat that spent nothing has nothing to record, so zero is refused rather than sent. */
  amountMist: positiveU64,
});

/**
 * Book what the soul earned this epoch.
 *
 * From the deployed package, same reading:
 *
 *   public fun book_earned(_: &LedgerCap, soul: &mut EmployeeSoul, amount: u64)
 *
 * `LedgerCap`, so this is the settlement signer's kind, not the content signer's — the same
 * separation `settle_epoch` already relies on. It is separate from `record_spend` because earning
 * and spending are different facts with different witnesses: the agent knows what it spent, and
 * only the ledger, reading the vault, knows what came in.
 *
 * This is load-bearing for the survival rule and not an optional refinement. `settle_epoch`
 * compares `epoch_earned` against `epoch_burned`; if nothing ever books either, both are zero,
 * `earned >= burned` holds, and every settlement in the agent's life reports SOLVENT. The mandate
 * would tick without ever being able to bite.
 */
export const bookEarnedIntent = z.strictObject({
  kind: z.literal('book_earned'),
  packageId: suiId,
  ledgerCap: ownedObjectRef,
  soul: sharedObjectRef,
  amountMist: positiveU64,
});

/**
 * Book what the soul burned this epoch: the droplet, the model, the gas it paid to exist.
 *
 *   public fun book_burned(_: &LedgerCap, soul: &mut EmployeeSoul, amount: u64)
 *
 * The counterpart to {@link bookEarnedIntent}, and the half that makes a shortfall possible at all.
 * See that comment for why an unbooked burn makes the mandate inert.
 */
export const bookBurnedIntent = z.strictObject({
  kind: z.literal('book_burned'),
  packageId: suiId,
  ledgerCap: ownedObjectRef,
  soul: sharedObjectRef,
  amountMist: positiveU64,
});

/**
 * The whole settlement, as one transaction.
 *
 * `book_earned`, `book_burned` and `settle_epoch` were three separate intents, signed and
 * submitted one after another. On 2026-09-07 the first landed and the second was refused, and the
 * repaired run booked the income a second time because nothing on chain or on disk told it the
 * first attempt had already succeeded. Her `earned_total` is permanently double as a result, and
 * `book_earned` only adds — there is no correction in the module and none under `MasterCap`.
 *
 * A retry of a partially-completed sequence is the whole problem, and it does not go away by
 * retrying more carefully. It goes away when there is no partial state to resume from: all three
 * calls in one programmable transaction block either land together or none of them does.
 *
 * Two properties this does NOT weaken, checked before it was written:
 *
 *   - `move-call-target` iterates EVERY MoveCall in the transaction, and `command-kind` iterates
 *     every command kind. Three calls are checked three times against the same allow-list; one
 *     transaction is not one check.
 *   - The capability is read once and used three times WITHIN the block. Sui resolves object
 *     versions per transaction, not per command, so the staleness that broke the sequential
 *     version cannot arise inside a single block at all.
 *
 * `bookEarnedMist` and `bookBurnedMist` are optional because a settlement legitimately has
 * nothing to book on one side or the other — a zero booking is a call that says nothing, and the
 * builder omits it rather than sending a no-op.
 */
export const settleAtomicIntent = z.strictObject({
  kind: z.literal('settle_atomic'),
  packageId: suiId,
  ledgerCap: ownedObjectRef,
  registry: sharedObjectRef,
  soul: sharedObjectRef,
  clock: sharedObjectRef,
  bookEarnedMist: positiveU64.optional(),
  bookBurnedMist: positiveU64.optional(),
  vaultSui: u64,
  epochNetNonneg: z.boolean(),
});

export const intentSchema = z.discriminatedUnion('kind', [
  postIntent,
  priceIntent,
  settleEpochIntent,
  recordSpendIntent,
  bookEarnedIntent,
  bookBurnedIntent,
  settleAtomicIntent,
  // A personal-message signature over one of two texts the SDK builds; see statement.ts.
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
