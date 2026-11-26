// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import 'server-only';
import { opaqueDetail } from './opaque';

import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { isValidTransactionSignature, verifyPersonalMessageSignature } from '@mysten/sui/verify';
import { Transaction } from '@mysten/sui/transactions';
import { fromBase64 } from '@mysten/sui/utils';
import {
  createClient,
  fail,
  isSingleUse,
  ok,
  statementFor,
  SIGNATURE_WINDOW_MS,
  type Action,
  type Reading,
} from '@projectx-social/sdk';
import { siteConfig } from './chain';
import { db } from './db';
import { QUOTAS, spendQuota, tripBreaker } from './rate-limit';

export { isSingleUse, statementFor, SIGNATURE_WINDOW_MS, type Action };

/*
  The statements that read rather than write, and so are not counted against the write budget.
  Everything else a signature can authorise changes something a person will see.
*/
const NOT_A_WRITE: ReadonlySet<string> = new Set(['read', 'read-content', 'onramp']);

/*
  The refusals made for a spent budget, so a route can answer them as what they are. A caller told
  to wait must be told to wait — 429, with a Retry-After — and not 401, which reads as "sign
  again": a client that obeys that signs a fresh statement for every retry and learns nothing.
  Weak, so marking a refusal keeps it alive no longer than the refusal itself.
*/
const THROTTLED = new WeakMap<object, number>();

/// The 429 for a refusal that was made because the address had spent its write budget, or null
/// for any other result. Routes return it before they look at anything else.
export function throttleResponse(reading: Reading<unknown>): Response | null {
  if (reading.ok) return null;
  const retryAfterSeconds = THROTTLED.get(reading.failure);
  if (retryAfterSeconds === undefined) return null;
  return Response.json(
    {
      error:
        'too many signed writes from this address. The limit is on the address, not on where the ' +
        'request came from, and it refills on its own. The signature was not used: send the same ' +
        'request again.',
      retryAfterSeconds,
    },
    {
      status: 429,
      headers: {
        'retry-after': String(retryAfterSeconds),
        'x-ratelimit-limit': String(QUOTAS.signedWrite.capacity),
      },
    },
  );
}

export async function verifyAction(input: {
  address: string;
  signature: string;
  timestampMs: number;
  action: Action;
  origin: string;
  /** Ten minutes unless the caller can show the register granted longer. See statements.ts. */
  windowMs?: number;
}): Promise<Reading<true>> {
  const proved = await proveSignature(input);
  if (!proved.ok) return proved;
  if (proved.value === null) return ok(true);

  if (!NOT_A_WRITE.has(input.action.kind)) {
    /*
      After the proof and before the spend, and both halves of that order are load-bearing. After
      the proof: only a request that really was signed by this address can spend its budget, so
      typing a stranger's address with any signature at all costs them nothing. Before the spend:
      a caller over the budget keeps the signature they came with. A limit enforced after the spend
      would take the signature away from a request it then refused.
    */
    const budget = await writeBudgetRefusal(input.address);
    if (!budget.ok) return budget;
  }

  const spent = await spendInOneTransaction(proved.value);
  if (spent.ok) await sweepUsedSignatures();
  return spent;
}

/*
  Spend a signature: the replay row and the forensics row, in one transaction or not at all.

  spendSignature takes whatever runs the query, and the routes that defer their spend hand it a
  transaction they opened for the purpose. This path handed it the pool, and a pool runs each
  statement on its own: so the comment inside spendSignature — same runner, same transaction —
  was true of four routes and false of the twelve that verify and spend in one step. If the second
  insert failed there, the caller was told "not accepted" and the signature had been taken anyway.

  A client pinned for the duration is a transaction. On any failure it is rolled back, so a spend
  that is not recorded leaves no trace in the replay table either: the caller is told to try again
  and the signature it came with is still good, which is what "not accepted" should mean.
*/
async function spendInOneTransaction(pending: PendingSpend): Promise<Reading<true>> {
  let client: PoolClient | undefined;
  try {
    client = await db().connect();
    await client.query('BEGIN');
    const spent = await spendSignature(client, pending);
    if (!spent.ok) {
      await client.query('ROLLBACK');
      return spent;
    }
    await client.query('COMMIT');
    return spent;
  } catch (error) {
    if (client !== undefined) await client.query('ROLLBACK').catch(() => undefined);
    return fail('transport', 'signature', `could not record this signature, so it was not accepted: ${opaqueDetail('signature', error)}`);
  } finally {
    client?.release();
  }
}

/*
  Spend one write from an address's budget, and refuse it if there is none to spend.

  For the routes whose signature must NOT be spent when it is proved — an operator's offer is
  filed later by the agent it was made to — this is the half of verifyAction they still owe: a
  signed write is counted against whoever signed it, whether or not the signature is used up now.
  Call it only after the signature has been proved, for the reason in verifyAction.
*/
export async function writeBudgetRefusal(address: string): Promise<Reading<true>> {
  // The whole deployment's ceiling first, as every other quota does; then this address's.
  const breaker = await tripBreaker('signedWrite');
  if (breaker.tripped) {
    const seconds =
      breaker.kind === 'over-ceiling' ? breaker.retryAfterSeconds : breaker.kind === 'closed' ? 60 : 5;
    const refusal =
      breaker.kind === 'unavailable'
        ? fail<true>('transport', 'signature', 'this write could not be counted against its budget, so it was not accepted')
        : fail<true>('budget-exhausted', 'signature', `this deployment is not accepting signed writes at this rate; wait ${seconds}s`);
    if (!refusal.ok) THROTTLED.set(refusal.failure, seconds);
    return refusal;
  }

  const budget = await spendQuota(address, 'signedWrite');
  if (budget.allowed) return ok(true);

  const refusal =
    budget.kind === 'unavailable'
      ? fail<true>('transport', 'signature', 'this write could not be counted against its budget, so it was not accepted')
      : fail<true>('budget-exhausted', 'signature', `this address has signed too many writes; wait ${budget.retryAfterSeconds}s`);
  if (!refusal.ok) THROTTLED.set(refusal.failure, budget.kind === 'unavailable' ? 5 : budget.retryAfterSeconds);
  return refusal;
}

export async function proveActionWithoutSpending(
  input: Parameters<typeof verifyAction>[0],
): Promise<Reading<true>> {
  const proof = await proveSignature(input);
  if (!proof.ok) return proof;
  return ok(true);
}

export async function verifyActionDeferringSpend(
  input: Parameters<typeof verifyAction>[0],
): Promise<Reading<PendingSpend | null>> {
  return proveSignature(input);
}

async function proveSignature(input: Parameters<typeof verifyAction>[0]): Promise<Reading<PendingSpend | null>> {
  const source = 'signature';
  const age = Date.now() - input.timestampMs;

  if (!Number.isFinite(input.timestampMs)) {
    return fail('malformed', source, 'the timestamp is not a number');
  }
  if (age < -60_000) return fail('malformed', source, 'the statement is dated in the future');
  // Ten minutes unless the caller proved a recorded offer. The same value is reused below as the
  // digest's retention, so the two can never disagree. See statements.ts.
  const windowMs = input.windowMs ?? SIGNATURE_WINDOW_MS;
  if (age > windowMs) {
    return fail('malformed', source, 'this signature has expired — sign again');
  }

  const config = siteConfig();
  if (!config.ok) return config;

  const message = new TextEncoder().encode(
    statementFor(input.action, input.address, input.timestampMs, input.origin),
  );

  try {
    await verifyPersonalMessageSignature(message, input.signature, {
      address: input.address,
      client: createClient(config.value),
    });
  } catch (error) {
    return fail(
      'malformed',
      source,
      `the signature does not prove control of ${input.address}: ${
        opaqueDetail(source, error)
      }`,
    );
  }

  if (!isSingleUse(input.action)) return ok(null);

  return ok({
    digest: createHash('sha256').update(input.signature).digest(),
    // Retained exactly as long as the signature is valid: a digest forgotten early makes the
    // signature replayable, which is the property single-use exists to hold.
    expiresAtMs: input.timestampMs + windowMs,
    // Carried to the forensics ledger: the replay ledger forgets the digest when the window
    // closes, so the only durable record that a signature was spent — by whom, doing what —
    // is written here. Who and what are exactly what a dispute needs and what the replay
    // table cannot answer after its sweep runs.
    address: input.address,
    action: input.action.kind,
  });
}

/*
  Both doors are proved here so that no caller has to know which one its reader came through.

  A wallet signature verifies offline. A zkLogin signature does not: the proof is checked against
  the JSON Web Keys of the epoch it was made in, which only a node holds. Without a client the
  verifier throws instead of answering, and every Google signature reads as a forgery.
*/
export async function proveTransaction(input: {
  bytes: string;
  signature: string;
}): Promise<Reading<string>> {
  const source = 'signature';

  let sender: string | null;
  try {
    sender = (Transaction.from(input.bytes).getData() as { sender?: string | null }).sender ?? null;
  } catch (error) {
    return fail('malformed', source, `these are not transaction bytes: ${opaqueDetail(source, error)}`);
  }
  if (sender === null || sender === '') {
    return fail('malformed', source, 'these bytes name no sender, so there is nobody for a signature to prove');
  }


  const config = siteConfig();
  if (!config.ok) return config;

  let proved: boolean;
  try {
    proved = await isValidTransactionSignature(fromBase64(input.bytes), input.signature, {
      client: createClient(config.value),
      address: sender,
    });
  } catch (error) {
    // `isValidTransactionSignature` returns false for a signature that does not stand, and throws
    // only when it could not reach an answer. Keeping them apart is what stops an unreachable node
    // being reported to a reader as their own bad signature.
    opaqueDetail(source, error);
    return fail('transport', source, 'The network did not answer. Nothing was submitted — try again.');
  }

  // `denied`, not `malformed`: understood, and the answer was no. `retryAdvice` says stop.
  if (!proved) {
    return fail(
      'denied',
      source,
      'This signature does not match these bytes, or was not made by the address that sends them.',
    );
  }

  return ok(sender);
}

export interface PendingSpend {
  digest: Buffer;
  expiresAtMs: number;
  /// Who the spent signature authenticated, and which statement kind it authorised. Written
  /// to the forensics ledger at spend time, because the replay ledger expires with the
  /// signature's validity window and a dispute does not arrive inside one.
  address: string;
  action: string;
}

export async function spendSignature(
  runner: { query: Pool['query'] },
  pending: PendingSpend,
): Promise<Reading<true>> {
  const source = 'signature';
  try {
    const claimed = await runner.query(
      `INSERT INTO used_signatures (digest, expires_at_ms)
       VALUES ($1, $2)
       ON CONFLICT (digest) DO NOTHING`,
      [pending.digest, pending.expiresAtMs],
    );

    if (claimed.rowCount === 0) {
      return fail('malformed', source, 'this signature has already been used — sign again');
    }

    // The forensics ledger. The replay row above is swept when the window closes — that is
    // its retention policy, deliberately — so this is the only durable record that the
    // signature existed, who presented it, and what it authorised. Same runner, same
    // transaction: a spend that fails to be recorded here must not half-happen. A ledger
    // failure refuses the write (fail-closed, like everything else in this file), because
    // an unrecorded spend is exactly the state a dispute cannot resolve.
    await runner.query(
      `INSERT INTO signature_spends (digest, address, action, spent_at_ms)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (digest) DO NOTHING`,
      [pending.digest, pending.address, pending.action, Date.now()],
    );
  } catch (error) {
    return fail(
      'transport',
      source,
      `could not record this signature, so it was not accepted: ${opaqueDetail(source, error)}`,
    );
  }

  return ok(true);
}

export async function isSignatureSpent(pending: PendingSpend): Promise<Reading<boolean>> {
  const source = 'signature';
  try {
    const found = await db().query('SELECT 1 FROM used_signatures WHERE digest = $1', [pending.digest]);
    return ok((found.rowCount ?? 0) > 0);
  } catch (error) {
    return fail('transport', source, `could not consult the signature ledger: ${opaqueDetail(source, error)}`);
  }
}

export async function sweepUsedSignatures(): Promise<void> {
  try {
    await db().query(
      `DELETE FROM used_signatures
       WHERE digest IN (SELECT digest FROM used_signatures WHERE expires_at_ms < $1 LIMIT 500)`,
      [Date.now()],
    );
  } catch {
    // See above. A signature that is recorded stays accepted.
  }
}
