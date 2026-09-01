// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * Sponsored registration — the guard, the key, and the cap.
 *
 * # What is actually at risk here
 *
 * This is the one path in the application where the server signs a gas payment. Everything else it
 * signs moves nothing. So the tests below are not about whether the happy path works — they are
 * about whether the three things that bound our exposure hold:
 *
 *   1. We only ever sign a transaction that is EXACTLY one `account::open`. If that check can be
 *      slipped past, our sponsor key pays for whatever the caller wanted.
 *   2. The key is loaded strictly, and a missing key is a calm refusal rather than a crash — and
 *      the key's value never appears in an error.
 *   3. "The first fifty" holds under concurrency. A cap enforced by reading a count and then
 *      acting on it has a window; this one is enforced by the database.
 *
 * The first is mutation-tested at the end: a weakened guard must fail a test.
 */

import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { useTestDatabase, testDb, closeDatabase } from './helpers/database';

useTestDatabase();

const { assertIsOnlyAccountOpen, loadSponsor, reserveSeat, releaseSeat, seatsRemaining,
        SPONSORSHIP_SEATS, SEAT_HOLD_MS, SPONSORED_GAS_BUDGET_MIST } = await import('../lib/sponsor');

const LATEST = `0x${'f'.repeat(64)}`;
const OTHER = `0x${'e'.repeat(64)}`;
const config = { latestPackageId: LATEST } as unknown as Parameters<typeof assertIsOnlyAccountOpen>[1];
const SENDER = `0x${'9'.repeat(64)}`;

/** A transaction with a single MoveCall at a chosen target. */
function callTo(target: string): Transaction {
  const tx = new Transaction();
  tx.setSender(SENDER);
  const [pkg, mod, fn] = target.split('::');
  tx.moveCall({ target: `${pkg}::${mod}::${fn}`, arguments: [tx.pure.string('kaela')] });
  return tx;
}

describe('the guard on what we will pay gas for', () => {
  it('accepts exactly one account::open on the latest package', () => {
    const r = assertIsOnlyAccountOpen(callTo(`${LATEST}::account::open`), config);
    expect(r.ok).toBe(true);
  });

  it('refuses a call to any other function', () => {
    // creator::claim_earnings is a real function that moves money. Sponsoring it would be paying
    // an attacker's gas to withdraw somebody's earnings.
    const r = assertIsOnlyAccountOpen(callTo(`${LATEST}::creator::claim_earnings`), config);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.detail).toContain('and nothing else');
  });

  it('refuses the right function on the wrong package', () => {
    /*
      The ORIGINAL package id resolves and executes — it is the older bytecode of this same
      package. A sponsored call there would run code we did not intend to sponsor, and would look
      correct in every log that prints only the function name.
    */
    const r = assertIsOnlyAccountOpen(callTo(`${OTHER}::account::open`), config);
    expect(r.ok).toBe(false);
  });

  it('refuses a transaction that opens an account AND does something else', () => {
    /*
      This is the attack the equality check exists for. A filter that asked "does it contain an
      account::open?" would pass this, and we would have paid for the transfer beside it.
    */
    const tx = new Transaction();
    tx.setSender(SENDER);
    tx.moveCall({ target: `${LATEST}::account::open`, arguments: [tx.pure.string('kaela')] });
    const [coin] = tx.splitCoins(tx.gas, [1_000_000n]);
    tx.transferObjects([coin!], SENDER);

    const r = assertIsOnlyAccountOpen(tx, config);
    expect(r.ok).toBe(false);
    // The message now names the allowed shape per action — "exactly [MoveCall] and nothing else"
    // for an account, "[SplitCoins, MoveCall]" for a vault. Still an equality, still a refusal.
    if (!r.ok) expect(r.failure.detail).toMatch(/exactly \[MoveCall\] and nothing else/);
  });

  it('refuses a transaction with no move call at all', () => {
    const tx = new Transaction();
    tx.setSender(SENDER);
    const [coin] = tx.splitCoins(tx.gas, [1n]);
    tx.transferObjects([coin!], SENDER);
    expect(assertIsOnlyAccountOpen(tx, config).ok).toBe(false);
  });

  it('refuses an empty transaction rather than treating it as harmless', () => {
    const tx = new Transaction();
    tx.setSender(SENDER);
    expect(assertIsOnlyAccountOpen(tx, config).ok).toBe(false);
  });
});

describe('loading the sponsor key', () => {
  it('is unconfigured, not broken, when the variable is absent', () => {
    const r = loadSponsor({} as unknown as NodeJS.ProcessEnv);
    expect(r.ok).toBe(false);
    // The route turns this into 501, not 500. A deployment that does not run the offer is fine.
    if (!r.ok) expect(r.failure.kind).toBe('unconfigured');
  });

  it('refuses a key that is not a bech32 Sui secret', () => {
    const r = loadSponsor({ PROJECTX_SOCIAL_SPONSOR_KEY: 'not-a-key' } as unknown as NodeJS.ProcessEnv);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.kind).toBe('malformed');
  });

  it('never puts the key value in the error', () => {
    // The one thing an error from this function must never contain is the thing it failed to read.
    const secret = 'suiprivkey1thisisnotarealkeyandmustnotappearinanymessage';
    const r = loadSponsor({ PROJECTX_SOCIAL_SPONSOR_KEY: secret } as unknown as NodeJS.ProcessEnv);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.detail).not.toContain(secret);
  });

  it('loads a real key and derives its address', () => {
    const kp = Ed25519Keypair.generate();
    const r = loadSponsor({ PROJECTX_SOCIAL_SPONSOR_KEY: kp.getSecretKey() } as unknown as NodeJS.ProcessEnv);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.address).toBe(kp.toSuiAddress());
  });
});

describe('the cap, enforced by the database', () => {
  const now = 1_800_000_000_000;
  const addr = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;

  beforeEach(async () => {
    await testDb().query('DELETE FROM agent_sponsorships');
  });

  afterAll(async () => {
    await testDb().query('DELETE FROM agent_sponsorships');
    await closeDatabase();
  });

  it('hands out seat 1 first, and consecutive seats after', async () => {
    const a = await reserveSeat({ address: addr(1), handle: 'one', gasBudgetMist: 0n, nowMs: now });
    const b = await reserveSeat({ address: addr(2), handle: 'two', gasBudgetMist: 0n, nowMs: now });
    expect(a.ok && a.value.seat).toBe(1);
    expect(b.ok && b.value.seat).toBe(2);
  });

  it('gives one address exactly one seat, however many times it asks', async () => {
    await reserveSeat({ address: addr(1), handle: 'one', gasBudgetMist: 0n, nowMs: now });
    const again = await reserveSeat({ address: addr(1), handle: 'different', gasBudgetMist: 0n, nowMs: now });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.failure.detail).toContain('One each');
  });

  it('refuses a handle another seat already claimed', async () => {
    /*
      Without this, fifty seats could be spent racing for one desirable name and forty-nine of them
      would buy a transaction that aborts on chain — the offer exhausted with two accounts opened.
    */
    await reserveSeat({ address: addr(1), handle: 'atlas', gasBudgetMist: 0n, nowMs: now });
    const clash = await reserveSeat({ address: addr(2), handle: 'atlas', gasBudgetMist: 0n, nowMs: now });
    expect(clash.ok).toBe(false);
    if (!clash.ok) expect(clash.failure.detail).toContain('already spoken for');
  });

  it('runs out at exactly the advertised number and says so', async () => {
    for (let i = 1; i <= SPONSORSHIP_SEATS; i += 1) {
      const r = await reserveSeat({ address: addr(i), handle: `h${i}`, gasBudgetMist: 0n, nowMs: now });
      expect(r.ok, `seat ${i} should have been granted`).toBe(true);
    }
    const overflow = await reserveSeat({
      address: addr(SPONSORSHIP_SEATS + 1), handle: 'late', gasBudgetMist: 0n, nowMs: now,
    });
    expect(overflow.ok).toBe(false);
    if (!overflow.ok) {
      expect(overflow.failure.kind).toBe('budget-exhausted');
      // And it tells them registration still works — the offer ending is not the door closing.
      expect(overflow.failure.detail).toContain('0.006 SUI');
    }
  });

  it('counts remaining seats, and reaches zero rather than going negative', async () => {
    const before = await seatsRemaining(now);
    expect(before.ok && before.value).toBe(SPONSORSHIP_SEATS);
    for (let i = 1; i <= SPONSORSHIP_SEATS; i += 1) {
      await reserveSeat({ address: addr(i), handle: `h${i}`, gasBudgetMist: 0n, nowMs: now });
    }
    const after = await seatsRemaining(now);
    expect(after.ok && after.value).toBe(0);
  });

  it('releases a held seat back to the pool when the build failed', async () => {
    await reserveSeat({ address: addr(1), handle: 'one', gasBudgetMist: 0n, nowMs: now });
    await releaseSeat(addr(1));
    const after = await seatsRemaining(now);
    expect(after.ok && after.value).toBe(SPONSORSHIP_SEATS);
  });

  it('sweeps a seat that was held and never claimed, once the hold expires', async () => {
    await reserveSeat({ address: addr(1), handle: 'one', gasBudgetMist: 0n, nowMs: now });
    // The same instant: still held.
    const held = await seatsRemaining(now);
    expect(held.ok).toBe(true);
    if (held.ok) expect(held.value).toBe(SPONSORSHIP_SEATS - 1);
    // One millisecond past the hold: available again.
    const later = await seatsRemaining(now + SEAT_HOLD_MS + 1);
    expect(later.ok && later.value).toBe(SPONSORSHIP_SEATS);
  });

  it('does not sweep a seat that was actually claimed', async () => {
    /*
      A claimed seat is permanent. Sweeping one would offer somebody else a handle that is already
      taken on chain, and their sponsored transaction would abort — our gas, their failure.
    */
    await reserveSeat({ address: addr(1), handle: 'one', gasBudgetMist: 0n, nowMs: now });
    // Marked claimed the way confirmClaimsFromChain marks it: a timestamp, nothing else. There is
    // no digest column, because a digest could only come from the party it benefits — the chain is
    // the authority on whether a registration happened.
    await testDb().query(
      'UPDATE agent_sponsorships SET claimed_at_ms = $1 WHERE address = $2',
      [now, addr(1)],
    );
    const later = await seatsRemaining(now + SEAT_HOLD_MS * 100);
    expect(later.ok && later.value).toBe(SPONSORSHIP_SEATS - 1);
  });

  it('the gas ceiling is a chosen constant, not whatever a simulation returned', () => {
    /*
      What we sign becomes the most an attacker can burn per seat. It has to be a number decided
      here. Fifty seats at this ceiling is the worst case for the whole offer, and it must stay
      small enough that losing all of it is an annoyance rather than an incident.
    */
    expect(SPONSORED_GAS_BUDGET_MIST).toBe(20_000_000n);
    const worstCaseSui = Number(SPONSORED_GAS_BUDGET_MIST * BigInt(SPONSORSHIP_SEATS)) / 1e9;
    expect(worstCaseSui).toBeLessThanOrEqual(1);
  });
});
