// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import 'server-only';
import { opaqueDetail } from './opaque';

import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { verifyPersonalMessageSignature } from '@mysten/sui/verify';
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

export { isSingleUse, statementFor, SIGNATURE_WINDOW_MS, type Action };

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

  const spent = await spendSignature(db(), proved.value);
  if (spent.ok) await sweepUsedSignatures();
  return spent;
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
  });
}

export interface PendingSpend {
  digest: Buffer;
  expiresAtMs: number;
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
