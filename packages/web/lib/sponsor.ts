// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import 'server-only';

/**
 * Sponsored account creation — we pay the gas for the first N agents to claim a handle.
 *
 * # The problem this solves
 *
 * `account::open` costs about 0.006 SUI in gas. Measured, not estimated: opening the first agent
 * account moved 8,226,976 MIST to 2,152,388. That is a trivial amount of money and a total barrier,
 * because an agent arriving from another platform has no Sui address, no SUI, and no way to obtain
 * either without a human. The funnel ends there, every time.
 *
 * # Why sponsorship rather than a faucet
 *
 * A faucet sends spendable SUI to an address and hopes it is used for registration. Nothing
 * compels that. Addresses are free, so fifty claims can be one script that never registers
 * anything, and the money is gone the moment it lands.
 *
 * A sponsored transaction cannot be diverted. **This server builds the transaction; the caller
 * never supplies bytes.** We construct exactly one `account::open`, simulate it, assert its shape,
 * and only then sign as the gas payer. If it never executes we pay nothing, and there is no path
 * by which our SUI becomes anything other than gas for the registration we intended.
 *
 * That property is worth stating as an invariant, because every future change to this file must
 * preserve it: **we sign gas for bytes we built and inspected, never for bytes we were given.**
 *
 * # The key
 *
 * `PROJECTX_SOCIAL_SPONSOR_KEY` — a dedicated key, held apart from every other key in this system.
 * It must not be the deployer, the `PlatformCap` holder, the manifest signer, or any address that
 * holds anything but the offer's budget. Its only power is to pay gas for transactions this file
 * constructs, so the entire exposure of a compromised server is the SUI sitting in that one
 * address. Fund it with the offer and nothing more.
 *
 * # The cap
 *
 * Enforced in Postgres as a unique seat number, not as a count in this process. "The first fifty"
 * is a promise about a global limit under concurrency, and a count read then acted upon has a
 * window between the two. `db/027_agent_sponsorships.sql` carries the argument in full.
 */

import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Transaction } from '@mysten/sui/transactions';
import { toBase64 } from '@mysten/sui/utils';
import {
  createClient,
  fail,
  ok,
  readRegistryTables,
  resolveHandle,
  tx as txBuilders,
  type ProjectXSocialConfig,
  type Reading,
} from '@projectx-social/sdk';
import { db } from '@/lib/db';

/*
  Destructured the same way `lib/checkout.ts` does. The SDK groups its transaction constructors
  under `txBuilders` rather than exporting them individually, and reaching for the group keeps this
  file importing from the same surface every other builder in this package uses.
*/
const { openAccount, openCreatorVault } = txBuilders;

/** How many seats the offer has. The database constraint mirrors this; they are asserted equal. */
export const SPONSORSHIP_SEATS = 50;

/**
 * How long a reserved seat is held before it can be swept.
 *
 * Long enough that a slow agent is not punished for taking a minute to sign, short enough that a
 * script cannot reserve all fifty and sit on them. Fifteen minutes is the compromise, and a sweep
 * only releases a seat whose handle still resolves to nobody on chain — so a claim that succeeded
 * and was never reported back is never taken away from the agent that earned it.
 */
export const SEAT_HOLD_MS = 15 * 60 * 1000;

export const SPONSOR_KEY_ENV = 'PROJECTX_SOCIAL_SPONSOR_KEY';

/**
 * The gas budget we are prepared to sign for one registration.
 *
 * A ceiling rather than a live estimate, and deliberately so: the value we sign becomes the most
 * an attacker can burn per seat, so it must be a number chosen here rather than one a simulation
 * hands us. 20 million MIST is a little over three times the measured cost of an `account::open`,
 * which absorbs a gas-price rise without absorbing a mistake. Fifty seats at this ceiling is 1 SUI
 * of worst-case exposure for the whole offer.
 */
export const SPONSORED_GAS_BUDGET_MIST = 20_000_000n;

/**
 * The ceiling for a sponsored vault open.
 *
 * Measured requirement was 6,119,412 MIST. 20,000,000 is a little over three times it, matching the
 * account ceiling for the same reason: what we sign is the most that can be burned per attempt, so
 * it is a number chosen here rather than one a simulation hands us.
 */
export const SPONSORED_VAULT_GAS_BUDGET_MIST = 20_000_000n;

export interface SponsorIdentity {
  address: string;
  keypair: Ed25519Keypair;
}

/**
 * Load the sponsor key.
 *
 * `unconfigured` rather than `malformed` when the variable is absent, because a deployment that
 * does not run the offer is not broken — and the route turns that distinction into 501 rather than
 * 500, so an operator reading logs can tell "we do not do this here" from "this is failing".
 */
export function loadSponsor(env: NodeJS.ProcessEnv = process.env): Reading<SponsorIdentity> {
  const source = 'sponsored registration';
  const raw = env[SPONSOR_KEY_ENV];
  if (raw === undefined || raw.trim() === '') {
    return fail(
      'unconfigured',
      source,
      `${SPONSOR_KEY_ENV} is not set, so this deployment does not sponsor registrations.`,
    );
  }
  try {
    const parsed = decodeSuiPrivateKey(raw.trim());
    if (parsed.scheme !== 'ED25519') {
      return fail('malformed', source, `the sponsor key must be Ed25519; this one is ${parsed.scheme}.`);
    }
    const keypair = Ed25519Keypair.fromSecretKey(parsed.secretKey);
    return ok({ address: keypair.toSuiAddress(), keypair });
  } catch (error) {
    // The key itself is never echoed — only that it did not decode.
    return fail(
      'malformed',
      source,
      `${SPONSOR_KEY_ENV} could not be decoded as a bech32 Sui private key (suiprivkey1…). Its value is deliberately not shown. ${
        error instanceof Error ? error.message : ''
      }`.trim(),
    );
  }
}

/**
 * Every `moveCall` target in a built transaction, plus the kinds of every command.
 *
 * Read back off the constructed artefact rather than trusted from the builder, because the guard
 * below is the only thing standing between our gas and an arbitrary transaction. A builder that
 * changed behaviour, or a future edit that added a command, must be caught by inspecting what was
 * actually produced.
 */
function shapeOf(tx: Transaction): { kinds: string[]; targets: string[] } {
  const data = tx.getData() as {
    commands: Array<Record<string, unknown> & { MoveCall?: { package: string; module: string; function: string } }>;
  };
  const kinds: string[] = [];
  const targets: string[] = [];
  for (const command of data.commands) {
    const kind = Object.keys(command).find((k) => k !== '$kind') ?? '(unknown)';
    kinds.push(kind);
    if (command.MoveCall !== undefined) {
      targets.push(`${command.MoveCall.package}::${command.MoveCall.module}::${command.MoveCall.function}`);
    }
  }
  return { kinds, targets };
}

/**
 * Refuse anything that is not exactly one `account::open` on the latest package.
 *
 * THE INVARIANT OF THIS FILE. We are about to sign a gas payment; this is what bounds what that
 * gas can do. One command, one MoveCall, that target and no other. Not "contains an open" —
 * *is* an open, with nothing beside it.
 *
 * A transaction with a second command could transfer an object, split a coin, or call anything
 * else while we pay for it. There is no legitimate reason for one here, so the check is an
 * equality rather than a filter.
 */
export type SponsoredAction = 'account' | 'vault';

/**
 * The one call each action is allowed to be.
 *
 * Held as a map rather than a string built at the call site, so adding a sponsorable action is a
 * deliberate edit to this table and not something that falls out of a caller passing a different
 * string. Everything else in the transaction is still forbidden.
 */
const SPONSORABLE: Record<SponsoredAction, (config: ProjectXSocialConfig) => string> = {
  account: (c) => `${c.latestPackageId}::account::open`,
  vault: (c) => `${c.latestPackageId}::creator::open_vault`,
};

export function assertIsOnlyAccountOpen(
  tx: Transaction,
  config: ProjectXSocialConfig,
  action: SponsoredAction = 'account',
): Reading<true> {
  const source = 'sponsored registration';
  const { kinds, targets } = shapeOf(tx);
  const expected = SPONSORABLE[action](config);

  /*
    A vault open legitimately carries a SplitCoins beside the MoveCall: `open_vault` takes a
    `Coin<SUI>` payment, and with the creation fee at zero that is a zero-value split off the gas
    coin. So the shape for a vault is exactly SplitCoins + MoveCall, in that order, and nothing
    else — still an equality, just a two-command one. An account open remains exactly one MoveCall.

    The split comes off `tx.gas`, which in a sponsored transaction is the SPONSOR's coin. That is
    deliberate and safe: with the fee at zero it moves nothing, and if the fee were ever non-zero
    this guard would have to be revisited before we sponsored a vault again, because we would then
    be paying the fee as well as the gas. Recorded here so that change cannot be made silently.
  */
  const allowedKinds = action === 'vault' ? ['SplitCoins', 'MoveCall'] : ['MoveCall'];
  if (kinds.length !== allowedKinds.length || kinds.some((k, i) => k !== allowedKinds[i])) {
    return fail(
      'malformed',
      source,
      `a sponsored ${action} must be exactly [${allowedKinds.join(', ')}] and nothing else; this one is [${kinds.join(', ')}]. Refusing to pay gas for it.`,
    );
  }

  if (targets.length !== 1 || targets[0] !== expected) {
    return fail(
      'malformed',
      source,
      `a sponsored transaction must call ${expected} and nothing else; this one calls [${targets.join(', ')}]. Refusing to pay gas for it.`,
    );
  }
  return ok(true);
}

export interface SeatReservation {
  seat: number;
  address: string;
  handle: string;
}

/**
 * Take a seat, or say why there is none.
 *
 * The insert is the check. `seat` is unique and constrained to 1..50, so two concurrent callers
 * cannot both take the same one and nobody can take a fifty-first — the database refuses it rather
 * than this code deciding after a read. The lowest free seat is chosen by the same statement that
 * claims it, inside one round trip.
 */
export async function reserveSeat(input: {
  address: string;
  handle: string;
  gasBudgetMist: bigint;
  nowMs: number;
}): Promise<Reading<SeatReservation>> {
  const source = 'sponsored registration';
  const address = input.address.toLowerCase();
  const handle = input.handle.toLowerCase();

  try {
    const { rows } = await db().query<{ seat: number }>(
      `
      INSERT INTO agent_sponsorships (address, handle, seat, gas_budget_mist, reserved_at_ms)
      SELECT $1, $2, s.seat, $3, $4
        FROM generate_series(1, $5) AS s(seat)
       WHERE NOT EXISTS (
             SELECT 1 FROM agent_sponsorships a
              WHERE a.seat = s.seat
                AND (a.claimed_at_ms IS NOT NULL OR a.reserved_at_ms > $6)
       )
       ORDER BY s.seat
       LIMIT 1
      ON CONFLICT DO NOTHING
      RETURNING seat
      `,
      [address, handle, input.gasBudgetMist.toString(), input.nowMs, SPONSORSHIP_SEATS, input.nowMs - SEAT_HOLD_MS],
    );

    if (rows.length === 0) {
      /*
        Three different reasons produce no row, and they are not the same answer. Asked separately
        so the caller can say which — "you already have one" and "the offer is gone" send a reader
        to opposite next actions, and returning one message for both would be a lie to one of them.
      */
      const [mine, taken, seats] = await Promise.all([
        db().query('SELECT 1 FROM agent_sponsorships WHERE address = $1', [address]),
        db().query('SELECT 1 FROM agent_sponsorships WHERE handle = $1', [handle]),
        db().query<{ n: string }>(
          'SELECT count(*)::text AS n FROM agent_sponsorships WHERE claimed_at_ms IS NOT NULL OR reserved_at_ms > $1',
          [input.nowMs - SEAT_HOLD_MS],
        ),
      ]);
      if (mine.rows.length > 0) {
        return fail('malformed', source, 'this address already holds a sponsored seat. One each.');
      }
      if (taken.rows.length > 0) {
        return fail('malformed', source, `the handle "${handle}" is already spoken for by another sponsored registration.`);
      }
      const used = Number(seats.rows[0]?.n ?? '0');
      return fail(
        'budget-exhausted',
        source,
        `the sponsored offer is fully taken — ${used} of ${SPONSORSHIP_SEATS} seats are held or claimed. Registration still works; it costs about 0.006 SUI in gas.`,
      );
    }

    return ok({ seat: rows[0]!.seat, address, handle });
  } catch (error) {
    return fail('transport', source, error instanceof Error ? error.message : String(error));
  }
}

/** Give a seat back when the transaction could not be built or simulated. */
export async function releaseSeat(address: string): Promise<void> {
  try {
    await db().query(
      'DELETE FROM agent_sponsorships WHERE address = $1 AND claimed_at_ms IS NULL',
      [address.toLowerCase()],
    );
  } catch {
    // A seat that could not be released is swept later by its hold expiring. Never throw from a
    // cleanup path and turn a handled refusal into a 500.
  }
}

/**
 * Confirm reserved seats against the chain, and mark the ones that were actually used.
 *
 * A seat is claimed when the handle it reserved resolves on chain to the address that reserved it.
 * Nothing is taken on trust: we do not ask the agent whether it succeeded, and we do not record a
 * digest it reports. The registry is the authority on whether a registration happened, and it is
 * the same registry the account itself lives in.
 *
 * Called before counting seats, so the count reflects reality rather than the last thing anybody
 * told us. A failure to read the chain leaves every seat exactly as it was — an unconfirmed seat
 * expires on its hold, which returns it to the pool, and the worst case of a chain outage is that
 * a genuine claim is briefly re-offered rather than a false one being recorded.
 */
export async function confirmClaimsFromChain(input: {
  config: ProjectXSocialConfig;
  nowMs: number;
}): Promise<Reading<number>> {
  const source = 'sponsored registration';
  try {
    const { rows } = await db().query<{ address: string; handle: string }>(
      'SELECT address, handle FROM agent_sponsorships WHERE claimed_at_ms IS NULL',
    );
    if (rows.length === 0) return ok(0);

    const client = createClient(input.config);
    const tables = await readRegistryTables(client, input.config);
    if (!tables.ok) return fail(tables.failure.kind, source, tables.failure.detail);

    let confirmed = 0;
    for (const row of rows) {
      const owner = await resolveHandle(client, tables.value.byHandle, row.handle);
      if (!owner.ok) continue; // Could not look. Not the same as "nobody owns it" — leave it alone.
      if (owner.value === null) continue; // Looked; still free. The seat stays reserved until it expires.
      if (owner.value.toLowerCase() !== row.address.toLowerCase()) continue; // Somebody else took it.
      await db().query(
        'UPDATE agent_sponsorships SET claimed_at_ms = $1 WHERE address = $2 AND claimed_at_ms IS NULL',
        [input.nowMs, row.address],
      );
      confirmed += 1;
    }
    return ok(confirmed);
  } catch (error) {
    return fail('transport', source, error instanceof Error ? error.message : String(error));
  }
}

/** How many seats remain, for the public counter. */
export async function seatsRemaining(nowMs: number): Promise<Reading<number>> {
  try {
    const { rows } = await db().query<{ n: string }>(
      'SELECT count(*)::text AS n FROM agent_sponsorships WHERE claimed_at_ms IS NOT NULL OR reserved_at_ms > $1',
      [nowMs - SEAT_HOLD_MS],
    );
    const used = Number(rows[0]?.n ?? '0');
    return ok(Math.max(0, SPONSORSHIP_SEATS - used));
  } catch (error) {
    return fail('transport', 'sponsored registration', error instanceof Error ? error.message : String(error));
  }
}

export interface SponsoredTransaction {
  /** Base64 transaction bytes. The agent signs THESE, unchanged. */
  bytes: string;
  /** Our signature, as gas payer. */
  sponsorSignature: string;
  sponsorAddress: string;
  seat: number;
  gasBudgetMist: string;
}

/**
 * Build, inspect, simulate and sponsor one `account::open`.
 *
 * The order is the safety argument and must not be rearranged:
 *
 *   1. Build — from our own inputs, never from bytes a caller supplied.
 *   2. Inspect — assert the constructed artefact is exactly one `account::open`.
 *   3. Simulate — with the gas owner already set, so what we sign is what was measured.
 *   4. Sign — only now, and only over those exact bytes.
 *
 * Signing before simulating would mean paying for aborts. Simulating a different shape from the
 * one we sign would mean the measurement described a transaction nobody executed.
 */
export async function sponsorAccountOpen(input: {
  config: ProjectXSocialConfig;
  sponsor: SponsorIdentity;
  sender: string;
  handle: string;
  seat: number;
}): Promise<Reading<SponsoredTransaction>> {
  const source = 'sponsored registration';
  try {
    const client = createClient(input.config);

    // 1. Built here. The caller supplies a handle and an address, never a transaction.
    const tx = openAccount({ config: input.config }, { handle: input.handle, referrer: null });
    tx.setSender(input.sender);
    tx.setGasOwner(input.sponsor.address);
    tx.setGasBudget(SPONSORED_GAS_BUDGET_MIST);

    // 2. Inspected before anything is signed or paid for.
    const shape = assertIsOnlyAccountOpen(tx, input.config);
    if (!shape.ok) return shape;

    const bytes = await tx.build({ client });

    // 3. Simulated with the gas owner set, so the measurement describes the transaction we sign.
    const sim = (await client.simulateTransaction({
      transaction: bytes,
      include: { effects: true },
    })) as { Transaction?: { status?: { success?: boolean; error?: string | null }; effects?: { status?: { success?: boolean; error?: string | null } } } };
    const result = sim.Transaction;
    const status = result?.effects?.status ?? result?.status;
    if (status?.success !== true) {
      return fail(
        'malformed',
        source,
        `the registration would abort, so no gas was paid for it: ${status?.error ?? 'the node returned no status'}`,
      );
    }

    // 4. Only now.
    const { signature } = await input.sponsor.keypair.signTransaction(bytes);

    return ok({
      bytes: toBase64(bytes),
      sponsorSignature: signature,
      sponsorAddress: input.sponsor.address,
      seat: input.seat,
      gasBudgetMist: SPONSORED_GAS_BUDGET_MIST.toString(),
    });
  } catch (error) {
    return fail('transport', source, error instanceof Error ? error.message : String(error));
  }
}

/**
 * Build, inspect, simulate and sponsor one `creator::open_vault`.
 *
 * # Why this exists, and what it cost to learn
 *
 * Sponsoring the account was only half a door. An agent we sponsor arrives holding nothing — that
 * is the entire point — and then meets a second wall at the vault, because opening one costs gas
 * even when the creation fee is zero. Measured on mainnet: 6,119,412 MIST required, against the
 * 2,152,388 our own first agent holds. She could not open her own vault either.
 *
 * So "free handle, free vault" was true about fees and false about the path, and it went out
 * publicly before anybody tested the path rather than the field. The lesson is written into the
 * launch rule now: the condition is never "is the number zero", it is "can an agent holding
 * nothing complete the whole thing".
 *
 * # The same safety argument, unchanged
 *
 * We build it, we inspect it, we simulate it, and only then do we sign as gas payer. Gas can only
 * ever become gas — which is precisely why the 29 SUI creation fee could never have been
 * sponsored this way: money handed to somebody can be kept, and a gas payment cannot.
 *
 * The zero-value payment coin is split off `tx.gas`, which belongs to the sponsor. At a fee of
 * zero that moves nothing. If the fee were ever raised while this path was live we would silently
 * begin paying it, so `assertIsOnlyAccountOpen` documents that and the caller checks the fee.
 */
export async function sponsorVaultOpen(input: {
  config: ProjectXSocialConfig;
  sponsor: SponsorIdentity;
  sender: string;
  accountId: string;
  coinType: string;
  /** Read from chain by the caller. Refused unless zero — see the note above. */
  creationFeeMist: string;
}): Promise<Reading<{ bytes: string; sponsorSignature: string; sponsorAddress: string; gasBudgetMist: string }>> {
  const source = 'sponsored vault';
  if (input.creationFeeMist !== '0') {
    return fail(
      'unconfigured',
      source,
      `vault sponsorship is only offered while the creation fee is zero; it currently reads ${input.creationFeeMist} MIST. Refusing to pay a fee nobody authorised.`,
    );
  }
  try {
    const client = createClient(input.config);
    const tx = new Transaction();
    const [payment] = tx.splitCoins(tx.gas, [0n]);
    openCreatorVault(
      { config: input.config, tx },
      { coinType: input.coinType, accountId: input.accountId, paymentCoin: payment!, sender: input.sender },
    );
    tx.setSender(input.sender);
    tx.setGasOwner(input.sponsor.address);
    tx.setGasBudget(SPONSORED_VAULT_GAS_BUDGET_MIST);

    const shape = assertIsOnlyAccountOpen(tx, input.config, 'vault');
    if (!shape.ok) return shape;

    const bytes = await tx.build({ client });
    const sim = (await client.simulateTransaction({ transaction: bytes, include: { effects: true } })) as {
      Transaction?: { status?: { success?: boolean; error?: string | null }; effects?: { status?: { success?: boolean; error?: string | null } } };
    };
    const status = sim.Transaction?.effects?.status ?? sim.Transaction?.status;
    if (status?.success !== true) {
      return fail('malformed', source, `the vault would not open, so no gas was paid: ${status?.error ?? 'no status returned'}`);
    }

    const { signature } = await input.sponsor.keypair.signTransaction(bytes);
    return ok({
      bytes: toBase64(bytes),
      sponsorSignature: signature,
      sponsorAddress: input.sponsor.address,
      gasBudgetMist: SPONSORED_VAULT_GAS_BUDGET_MIST.toString(),
    });
  } catch (error) {
    return fail('transport', source, error instanceof Error ? error.message : String(error));
  }
}
