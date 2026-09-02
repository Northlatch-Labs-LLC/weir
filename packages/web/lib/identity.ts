// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import 'server-only';
import { opaqueDetail } from './opaque';

/**
 * Proving who someone is, without a transaction.
 *
 * # Why a signature and not a claimed address
 *
 * Comments and follows move no money, so there is nothing to sign on chain — but an unproven
 * address is worthless as identity. Anyone could post as anyone, and follower counts would mean
 * nothing. So the client signs a short statement with `sui:signPersonalMessage`, which costs no
 * gas, and the server verifies it against the address being claimed.
 *
 * # Replay is bounded by the statement itself
 *
 * The signed statement names the action, the target and a timestamp. A signature is therefore
 * valid for one action on one target, and only briefly — a captured comment signature cannot be
 * replayed onto a different post, and cannot be replayed at all after the window closes. The
 * statement is rebuilt server-side from the request rather than trusted, so a client cannot sign
 * one thing and submit another.
 *
 * This is not a session. Nothing is stored, nothing is issued, and there is nothing to steal.
 *
 * # The statement format is no longer written here
 *
 * `Action`, `statementFor`, `isSingleUse` and `SIGNATURE_WINDOW_MS` moved to
 * `@projectx-social/sdk` (`packages/sdk/src/statements.ts`) and are re-exported below, unchanged,
 * so every importer of this module keeps working.
 *
 * They moved because they were **copied**. A headless agent has to produce the same bytes this
 * server rebuilds, and it could not import them: this module opens with `import 'server-only'`,
 * pulls in `node:crypto`, a Postgres pool and `siteConfig()`, and there was no package boundary to
 * import a formatter across. So `packages/agent/src/statements.ts` held a hand copy of 244 lines,
 * kept in step by a test that diffed the two — a guard that reports a divergence only after it has
 * happened, and did: `declare-agent` and `declare-operator` were added here and not there.
 *
 * What is left in this file is what could not travel. `verifyAction` reads `siteConfig()` for a
 * chain client, and spends a row in `used_signatures` through the Postgres pool. Neither belongs in
 * an Apache-licensed package a browser bundle and a stranger's agent both import. **Formatting a
 * statement and deciding whether one has already been spent are different jobs, and only the first
 * of them belongs to everyone.**
 */

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

/*
  Re-exported rather than re-pointed at every call site, and that is deliberate rather than lazy.

  Twenty-odd modules import these from `@/lib/identity`, which is where a server developer looks
  for them; sending them all to the SDK would be a large diff whose only effect is to make the
  import line longer. More to the point, this module is still the right *name* for the format on
  the server — the SDK is where it lives, this is where the server verifies against it.

  These are the SDK's symbols, not copies of them. There is exactly one `statementFor` in this
  repository and this line is a pointer to it.
*/
export { isSingleUse, statementFor, SIGNATURE_WINDOW_MS, type Action };

/**
 * Verify that `address` signed this exact action, recently.
 *
 * `client` is passed to the verifier so zkLogin signatures resolve — they need a chain read to
 * check the ephemeral key's proof, where a plain keypair signature does not. Without it, every
 * zkLogin user would be rejected as a forgery, which is the failure mode that would silently
 * exclude exactly the mainstream users this platform is for.
 */
export async function verifyAction(input: {
  address: string;
  signature: string;
  timestampMs: number;
  action: Action;
  /**
   * The origin this deployment answers on, from the request rather than from configuration.
   *
   * Part of the signed bytes, so a signature collected by another instance of this software — a
   * staging deployment, a preview URL, a local run, a fork — no longer verifies here. It was
   * portable before: every field described the action and none described where it was asked for,
   * and `used_signatures` does not close that because the ledger is per-database, so a signature
   * spent elsewhere arrives here unspent.
   *
   * Required rather than optional. An optional origin defaulting to something would verify the old
   * portable bytes on the day somebody forgot to pass it, which is the whole defect restored by a
   * default.
   */
  origin: string;
}): Promise<Reading<true>> {
  const proved = await proveSignature(input);
  if (!proved.ok) return proved;
  if (proved.value === null) return ok(true);

  const spent = await spendSignature(db(), proved.value);
  if (spent.ok) await sweepUsedSignatures();
  return spent;
}

/**
 * The same proof, with the spend left for the caller to make.
 *
 * Identical verification, and then it stops: the digest comes back unspent so the caller can claim
 * it inside the transaction that performs the write. See `spendSignature` for why that matters.
 */
/**
 * A proof with no spend at all — for a signature that will be spent LATER by another route.
 *
 * The one legitimate use: the agent half of a declaration, kept in the waiting room
 * (`/api/agents/declare/pending`) so the operator can sign in a browser. That same signature is
 * then presented to `POST /api/agents/declare`, which verifies it again and spends it. Spending it
 * here would refuse the real filing minutes later with "already used", which is the exact wrong
 * outcome for the honest caller and gains nothing against a replay: a replayed half puts a request
 * in one operator's waiting room, where the operator can decline it, and enters no register.
 *
 * Named for what it does not do, so `test/spend-pairing.test.ts` — which insists that every route
 * deferring a spend also performs one — keeps its rule intact: this is not a deferred spend, it is
 * a proof, and a route that needs a spend must not reach for it.
 */
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

/**
 * Everything that proves the signature genuine, and nothing that records it.
 *
 * Returns `null` for an action that is not single-use — there is no digest to claim, and the
 * caller has nothing to carry.
 *
 * Since #61 `isSingleUse` returns true for every action, so that `null` cannot currently occur. It
 * stays because it is the correct answer if an exemption ever returns, but a caller must not read
 * it as a live branch: code shaped as `if (proof.value === null) skip the spend` is a hole written
 * against a state that does not happen, and it would be the hole that matters on the day it does.
 */
async function proveSignature(input: Parameters<typeof verifyAction>[0]): Promise<Reading<PendingSpend | null>> {
  const source = 'signature';
  const age = Date.now() - input.timestampMs;

  if (!Number.isFinite(input.timestampMs)) {
    return fail('malformed', source, 'the timestamp is not a number');
  }
  // Future-dated statements are refused too. Allowing them would let a signature be minted now and
  // held indefinitely, which defeats the window entirely.
  if (age < -60_000) return fail('malformed', source, 'the statement is dated in the future');
  if (age > SIGNATURE_WINDOW_MS) {
    return fail('malformed', source, 'this signature has expired — sign again');
  }

  const config = siteConfig();
  if (!config.ok) return config;

  const message = new TextEncoder().encode(
    statementFor(input.action, input.address, input.timestampMs, input.origin),
  );

  try {
    // Passing `address` makes the verifier assert the recovered key belongs to it. Without that
    // option a valid signature by *anyone* would pass, which is a check that looks like a check.
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

  /*
    The digest is derived here and claimed elsewhere.

    Deriving costs nothing and has no side effect, so it belongs with the proof. Claiming writes a
    row, and where that row is written from decides whether a failed request costs the reader their
    signature — which is what `spendSignature` is about.
  */
  return ok({
    digest: createHash('sha256').update(input.signature).digest(),
    expiresAtMs: input.timestampMs + SIGNATURE_WINDOW_MS,
  });
}

/**
 * A proved signature that has not yet been recorded as used.
 *
 * It exists as a value so it can be carried from the proof to the write, across work that may
 * fail in between.
 */
export interface PendingSpend {
  digest: Buffer;
  expiresAtMs: number;
}

/**
 * Claim the digest, on whichever connection the caller names.
 *
 * # Why the connection is a parameter
 *
 * A signature is single-use, so spending it is a write, and it was previously made on the pool the
 * moment the proof succeeded — before the work it authorises had happened. On `POST /api/posts`
 * that left four `await`s between the claim and the row, one of them a Seal upload over the
 * network. Anything failing in that gap consumed the signature and stored nothing, and the reader
 * had to sign a second time to find out.
 *
 * Passing a client instead lets the caller claim the digest inside the same transaction as the
 * write, so the two commit together or neither does. A failed publish now leaves the signature
 * unspent and the reader's next attempt is the same signature, not a new one.
 *
 * # Why not simply hold a transaction across the whole route
 *
 * Because the Seal upload sits in the middle of it. A transaction open across a network call to a
 * third party is a connection held for as long as that party takes to answer, and `db/028` sets
 * `idle_in_transaction_session_timeout` to 30 seconds precisely to stop that. Verification first,
 * network second, transaction last is the ordering that respects both.
 *
 * `ON CONFLICT DO NOTHING` makes the claim atomic. Two concurrent replays of the same signature
 * race for one insert and Postgres decides; `rowCount` is 1 for exactly one of them. A read of
 * "does this digest exist" followed by an insert would leave a window between the two, which is
 * the entire attack rewritten as a race.
 */
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
    /*
      Fails closed. A signature we could not record is a signature we cannot promise is unused, and
      accepting it would make replay protection something an attacker turns off by making the
      database unreachable. The cost is that signed writes now require the store — which they
      already did, since every one of them was about to write to it.
    */
    return fail(
      'transport',
      source,
      `could not record this signature, so it was not accepted: ${opaqueDetail(source, error)}`,
    );
  }

  return ok(true);
}

/**
 * Sweep what can no longer matter.
 *
 * Opportunistic rather than scheduled: this application has no cron, and a table that only grows
 * is how a cheap guard becomes the slowest statement here. Bounded, so one unlucky request does
 * not pay for every expired row ever written.
 *
 * # Two separations, and they are different arguments
 *
 * NOT part of `spendSignature`, because a caller spending inside its own transaction would drag
 * this delete in with it — lengthening a transaction that is holding a connection open for a row
 * it has already written. Housekeeping runs on the pool, after the commit.
 *
 * NOT inside the claim's `try`, because a sweep that failed AFTER a successful insert used to be
 * reported as "could not record this signature, so it was not accepted". That sentence was false
 * in exactly the case it was most likely to be read: the signature HAD been recorded, `rowCount`
 * was 1, and it was spent. The caller was told to sign again, and the statement they had just
 * spent sat in the table doing nothing for anyone. (#75.)
 *
 * A failed sweep is housekeeping that did not happen. It is not a rejection and it must not be
 * able to produce one — the conclusion `rememberQuote` in `lib/checkout.ts` already reached in its
 * own words: the caller is mid-request and a bookkeeping error is not their problem.
 *
 * Swallowed rather than logged-and-swallowed for the same reason it is swallowed there: the next
 * request tries again, and the table's growth is bounded by every other caller's sweep.
 */
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
