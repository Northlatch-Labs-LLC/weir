// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { beforeEach, afterAll, describe, expect, it } from 'vitest';
import { Transaction } from '@mysten/sui/transactions';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { useTestDatabase, testDb, closeDatabase } from './helpers/database';

useTestDatabase();

const { assertIsOnlyAccountOpen, loadSponsor, reserveSeat, releaseSeat, seatsRemaining,
        SPONSORSHIP_SEATS, SEAT_HOLD_MS, SPONSORED_GAS_BUDGET_MIST,
        ZERO_COIN_TARGET } = await import('../lib/sponsor');

const LATEST = `0x${'f'.repeat(64)}`;
const OTHER = `0x${'e'.repeat(64)}`;
const config = { latestPackageId: LATEST } as unknown as Parameters<typeof assertIsOnlyAccountOpen>[1];
const SENDER = `0x${'9'.repeat(64)}`;

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
    const r = assertIsOnlyAccountOpen(callTo(`${LATEST}::creator::claim_earnings`), config);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.detail).toContain('claim_earnings');
  });

  it('refuses the right function on the wrong package', () => {
    const r = assertIsOnlyAccountOpen(callTo(`${OTHER}::account::open`), config);
    expect(r.ok).toBe(false);
  });

  it('refuses a transaction that opens an account AND does something else', () => {
    const tx = new Transaction();
    tx.setSender(SENDER);
    tx.moveCall({ target: `${LATEST}::account::open`, arguments: [tx.pure.string('kaela')] });
    const [coin] = tx.splitCoins(tx.gas, [1_000_000n]);
    tx.transferObjects([coin!], SENDER);

    const r = assertIsOnlyAccountOpen(tx, config);
    expect(r.ok).toBe(false);
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
    if (!r.ok) expect(r.failure.kind).toBe('unconfigured');
  });

  it('refuses a key that is not a bech32 Sui secret', () => {
    const r = loadSponsor({ PROJECTX_SOCIAL_SPONSOR_KEY: 'not-a-key' } as unknown as NodeJS.ProcessEnv);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.kind).toBe('malformed');
  });

  it('never puts the key value in the error', () => {
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

  it('reuses a seat whose hold expired instead of jamming on it', async () => {
    const t0 = 1_000_000;
    const first = await reserveSeat({ address: `0x${'1'.repeat(64)}`, handle: 'expiredone', gasBudgetMist: 1n, nowMs: t0 });
    expect(first.ok).toBe(true);

    const later = t0 + SEAT_HOLD_MS + 1;
    const second = await reserveSeat({ address: `0x${'2'.repeat(64)}`, handle: 'freshone', gasBudgetMist: 1n, nowMs: later });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.seat).toBe(1);
  });

  it('never takes over a seat that was actually claimed', async () => {
    const t0 = 2_000_000;
    const r = await reserveSeat({ address: `0x${'3'.repeat(64)}`, handle: 'claimedone', gasBudgetMist: 1n, nowMs: t0 });
    expect(r.ok).toBe(true);
    await testDb().query('UPDATE agent_sponsorships SET claimed_at_ms = $1 WHERE handle = $2', [t0, 'claimedone']);

    const later = t0 + SEAT_HOLD_MS * 100;
    const next = await reserveSeat({ address: `0x${'4'.repeat(64)}`, handle: 'anotherone', gasBudgetMist: 1n, nowMs: later });
    expect(next.ok).toBe(true);
    if (next.ok) expect(next.value.seat).not.toBe(r.ok ? r.value.seat : -1);
  });

  it('refuses a handle another seat already claimed', async () => {
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
    const held = await seatsRemaining(now);
    expect(held.ok).toBe(true);
    if (held.ok) expect(held.value).toBe(SPONSORSHIP_SEATS - 1);
    const later = await seatsRemaining(now + SEAT_HOLD_MS + 1);
    expect(later.ok && later.value).toBe(SPONSORSHIP_SEATS);
  });

  it('does not sweep a seat that was actually claimed', async () => {
    await reserveSeat({ address: addr(1), handle: 'one', gasBudgetMist: 0n, nowMs: now });
    await testDb().query(
      'UPDATE agent_sponsorships SET claimed_at_ms = $1 WHERE address = $2',
      [now, addr(1)],
    );
    const later = await seatsRemaining(now + SEAT_HOLD_MS * 100);
    expect(later.ok && later.value).toBe(SPONSORSHIP_SEATS - 1);
  });

  it('the gas ceiling is a chosen constant, not whatever a simulation returned', () => {
    expect(SPONSORED_GAS_BUDGET_MIST).toBe(20_000_000n);
    const worstCaseSui = Number(SPONSORED_GAS_BUDGET_MIST * BigInt(SPONSORSHIP_SEATS)) / 1e9;
    expect(worstCaseSui).toBeLessThanOrEqual(1);
  });
});

describe('the vault guard — what it must let through and what it must not', () => {
  const VAULT_CFG = config;
  const mk = (target: string, opts: { transfers?: number; recipient?: string } = {}) => {
    const tx = new Transaction();
    tx.setSender(SENDER);
    const [coin] = tx.moveCall({ target: ZERO_COIN_TARGET, typeArguments: ['0x2::sui::SUI'] });
    tx.moveCall({ target, arguments: [coin!] });
    for (let i = 0; i < (opts.transfers ?? 1); i += 1) {
      tx.transferObjects([coin!], opts.recipient ?? SENDER);
    }
    return tx;
  };

  it('accepts the real shape: mint an empty coin, open, transfer home', () => {
    const r = assertIsOnlyAccountOpen(mk(`${LATEST}::creator::open_vault`), VAULT_CFG, 'vault');
    expect(r.ok).toBe(true);
  });

  it('refuses a vault transaction that transfers to somebody else', () => {
    const stranger = `0x${'a'.repeat(64)}`;
    const r = assertIsOnlyAccountOpen(
      mk(`${LATEST}::creator::open_vault`, { recipient: stranger }),
      VAULT_CFG,
      'vault',
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.detail).toMatch(/hand the CreatorCap to somebody else|does not name its own sender/);
  });

  it('refuses a vault that pays out of the sponsor gas coin', () => {
    const tx = new Transaction();
    tx.setSender(SENDER);
    const [coin] = tx.splitCoins(tx.gas, [0n]);
    tx.moveCall({ target: `${LATEST}::creator::open_vault`, arguments: [coin!] });
    tx.transferObjects([coin!], SENDER);
    const r = assertIsOnlyAccountOpen(tx, VAULT_CFG, 'vault');
    expect(r.ok).toBe(false);
  });

  it('refuses a second transfer hiding beside the legitimate one', () => {
    const r = assertIsOnlyAccountOpen(
      mk(`${LATEST}::creator::open_vault`, { transfers: 2 }),
      VAULT_CFG,
      'vault',
    );
    expect(r.ok).toBe(false);
  });

  it('refuses the vault shape when the action is an account', () => {
    const r = assertIsOnlyAccountOpen(mk(`${LATEST}::account::open`), VAULT_CFG, 'account');
    expect(r.ok).toBe(false);
  });

  it('refuses a different function even in the vault shape', () => {
    const r = assertIsOnlyAccountOpen(mk(`${LATEST}::creator::claim_earnings`), VAULT_CFG, 'vault');
    expect(r.ok).toBe(false);
  });
});
