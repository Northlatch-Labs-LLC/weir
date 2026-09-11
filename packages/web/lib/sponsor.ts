// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import 'server-only';
import { opaqueDetail } from './opaque';

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
  simulationEnvelope,
  simulationStatus,
} from '@projectx-social/sdk';
import { db, normaliseAddress } from '@/lib/db';

const { openAccount, openCreatorVault } = txBuilders;

export const SETTLE_SCAN_LIMIT = 12;

export const SPONSORSHIP_SEATS = 50;

export const SEAT_HOLD_MS = 15 * 60 * 1000;

export const SPONSOR_KEY_ENV = 'PROJECTX_SOCIAL_SPONSOR_KEY';

export const SPONSORED_GAS_BUDGET_MIST = 20_000_000n;

export const SPONSORED_VAULT_GAS_BUDGET_MIST = 20_000_000n;

export interface SponsorIdentity {
  address: string;
  keypair: Ed25519Keypair;
}

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
    return fail(
      'malformed',
      source,
      `${SPONSOR_KEY_ENV} could not be decoded as a bech32 Sui private key (suiprivkey1…). Its value is deliberately not shown. ${
        error instanceof Error ? error.message : ''
      }`.trim(),
    );
  }
}

function transferRecipient(tx: Transaction, transfer: unknown): string | null {
  const address = (transfer as { address?: unknown } | undefined)?.address as
    | { $kind?: string; Input?: number }
    | undefined;
  if (address?.$kind !== 'Input' || typeof address.Input !== 'number') return null;

  const inputs = (tx.getData() as { inputs?: unknown[] }).inputs ?? [];
  const input = inputs[address.Input] as { Pure?: { bytes?: string } } | undefined;
  const bytes = input?.Pure?.bytes;
  if (typeof bytes !== 'string' || bytes === '') return null;

  const raw = Buffer.from(bytes, 'base64');
  if (raw.length !== 32) return null;
  return `0x${raw.toString('hex')}`;
}

function sameAddress(a: string, b: string): boolean {
  const norm = (v: string): string | null => {
    if (!/^0x[0-9a-fA-F]{1,64}$/.test(v)) return null;
    return v.slice(2).toLowerCase().padStart(64, '0');
  };
  const left = norm(a);
  const right = norm(b);
  return left !== null && right !== null && left === right;
}

function shapeOf(tx: Transaction): { kinds: string[]; targets: string[]; transferArgs: unknown[] } {
  const data = tx.getData() as {
    commands: Array<Record<string, unknown> & { MoveCall?: { package: string; module: string; function: string } }>;
  };
  const kinds: string[] = [];
  const targets: string[] = [];
  const transferArgs: unknown[] = [];
  for (const command of data.commands) {
    const kind = Object.keys(command).find((k) => k !== '$kind') ?? '(unknown)';
    kinds.push(kind);
    if (command.MoveCall !== undefined) {
      targets.push(`${command.MoveCall.package}::${command.MoveCall.module}::${command.MoveCall.function}`);
    }
    const transfer = (command as Record<string, unknown>)['TransferObjects'];
    if (transfer !== undefined) transferArgs.push(transfer);
  }
  return { kinds, targets, transferArgs };
}

export type SponsoredAction = 'account' | 'vault';

export const ZERO_COIN_TARGET = '0x0000000000000000000000000000000000000000000000000000000000000002::coin::zero';

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
  const { kinds, targets, transferArgs } = shapeOf(tx);
  const expected = SPONSORABLE[action](config);

  const allowedKinds = action === 'vault' ? ['MoveCall', 'MoveCall', 'TransferObjects'] : ['MoveCall'];
  if (kinds.length !== allowedKinds.length || kinds.some((k, i) => k !== allowedKinds[i])) {
    return fail(
      'malformed',
      source,
      `a sponsored ${action} must be exactly [${allowedKinds.join(', ')}] and nothing else; this one is [${kinds.join(', ')}]. Refusing to pay gas for it.`,
    );
  }

  const expectedTargets = action === 'vault' ? [`${ZERO_COIN_TARGET}`, expected] : [expected];
  if (targets.length !== expectedTargets.length || targets.some((t, i) => t !== expectedTargets[i])) {
    return fail(
      'malformed',
      source,
      `a sponsored ${action} must call exactly [${expectedTargets.join(', ')}]; this one calls [${targets.join(', ')}]. Refusing to pay gas for it.`,
    );
  }

  if (action === 'vault') {
    if (transferArgs.length !== 1) {
      return fail('malformed', source, `a sponsored vault must contain exactly one transfer; this one has ${transferArgs.length}.`);
    }
    const sender = (tx.getData() as { sender?: string }).sender ?? '';
    const recipient = transferRecipient(tx, transferArgs[0]);
    if (recipient === null || !sameAddress(recipient, sender)) {
      return fail(
        'malformed',
        source,
        'the vault transaction does not transfer to its own sender. Refusing to pay gas for a ' +
          'transaction that would hand the CreatorCap to somebody else.',
      );
    }
  }

  return ok(true);
}

export interface SeatReservation {
  seat: number;
  address: string;
  handle: string;
}

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
         /*
           This address or handle already has a row anywhere in the table: select nothing.

           Without this the statement can reach the conflict clause on the PRIMARY KEY or on
           handle, neither of which the ON CONFLICT target covers, and Postgres raises instead of
           returning no rows — surfacing "one seat each" as a transport failure. Returning no rows
           is correct here: the diagnostic queries below then say which of the three reasons it
           was.
         */
         AND NOT EXISTS (
             SELECT 1 FROM agent_sponsorships b
              WHERE b.address = $1 OR b.handle = $2
         )
       ORDER BY s.seat
       LIMIT 1
      ON CONFLICT (seat) DO UPDATE
         SET address         = EXCLUDED.address,
             handle          = EXCLUDED.handle,
             gas_budget_mist = EXCLUDED.gas_budget_mist,
             reserved_at_ms  = EXCLUDED.reserved_at_ms,
             claimed_at_ms   = NULL
       WHERE agent_sponsorships.claimed_at_ms IS NULL
         AND agent_sponsorships.reserved_at_ms <= $6
      RETURNING seat
      `,
      [address, handle, input.gasBudgetMist.toString(), input.nowMs, SPONSORSHIP_SEATS, input.nowMs - SEAT_HOLD_MS],
    );

    if (rows.length === 0) {
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
    return fail('transport', source, opaqueDetail(source, error));
  }
}

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

export async function confirmClaimsFromChain(input: {
  config: ProjectXSocialConfig;
  nowMs: number;
}): Promise<Reading<number>> {
  const source = 'sponsored registration';
  try {
    const { rows } = await db().query<{ address: string; handle: string }>(
      `SELECT address, handle FROM agent_sponsorships
        WHERE claimed_at_ms IS NULL
        ORDER BY reserved_at_ms ASC
        LIMIT $1`,
      [SETTLE_SCAN_LIMIT],
    );
    if (rows.length === 0) return ok(0);

    const client = createClient(input.config);
    const tables = await readRegistryTables(client, input.config);
    if (!tables.ok) return fail(tables.failure.kind, source, tables.failure.detail);

    let confirmed = 0;
    for (const row of rows) {
      const owner = await resolveHandle(client, tables.value.byHandle, row.handle);
      if (!owner.ok) continue;
      if (owner.value === null) continue;
      if (owner.value.toLowerCase() !== row.address.toLowerCase()) continue;
      await db().query(
        'UPDATE agent_sponsorships SET claimed_at_ms = $1 WHERE address = $2 AND claimed_at_ms IS NULL',
        [input.nowMs, row.address],
      );
      confirmed += 1;
    }
    return ok(confirmed);
  } catch (error) {
    return fail('transport', source, opaqueDetail(source, error));
  }
}

export async function seatsRemaining(nowMs: number): Promise<Reading<number>> {
  try {
    const { rows } = await db().query<{ n: string }>(
      'SELECT count(*)::text AS n FROM agent_sponsorships WHERE claimed_at_ms IS NOT NULL OR reserved_at_ms > $1',
      [nowMs - SEAT_HOLD_MS],
    );
    const used = Number(rows[0]?.n ?? '0');
    return ok(Math.max(0, SPONSORSHIP_SEATS - used));
  } catch (error) {
    return fail('transport', 'sponsored registration', opaqueDetail('sponsored registration', error));
  }
}

export interface SponsoredTransaction {
  bytes: string;
  sponsorSignature: string;
  sponsorAddress: string;
  seat: number;
  gasBudgetMist: string;
}

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

    const tx = openAccount({ config: input.config }, { handle: input.handle, referrer: null });
    tx.setSender(input.sender);
    tx.setGasOwner(input.sponsor.address);
    tx.setGasBudget(SPONSORED_GAS_BUDGET_MIST);

    const shape = assertIsOnlyAccountOpen(tx, input.config);
    if (!shape.ok) return shape;

    const bytes = await tx.build({ client });

    const sim = (await client.simulateTransaction({
      transaction: bytes,
      include: { effects: true },
    })) as { Transaction?: { status?: { success?: boolean; error?: string | null }; effects?: { status?: { success?: boolean; error?: string | null } } } };
    const { grpc } = simulationEnvelope(sim);
    const result = grpc as typeof sim.Transaction;
    const status = simulationStatus(sim);
    if (status?.success !== true) {
      return fail(
        'malformed',
        source,
        `the registration would abort, so no gas was paid for it: ${status?.error ?? 'the node returned no status'}`,
      );
    }

    const { signature } = await input.sponsor.keypair.signTransaction(bytes);

    return ok({
      bytes: toBase64(bytes),
      sponsorSignature: signature,
      sponsorAddress: input.sponsor.address,
      seat: input.seat,
      gasBudgetMist: SPONSORED_GAS_BUDGET_MIST.toString(),
    });
  } catch (error) {
    return fail('transport', source, opaqueDetail(source, error));
  }
}

export async function sponsorVaultOpen(input: {
  config: ProjectXSocialConfig;
  sponsor: SponsorIdentity;
  sender: string;
  accountId: string;
  coinType: string;
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
    const [payment] = tx.moveCall({ target: ZERO_COIN_TARGET, typeArguments: ['0x2::sui::SUI'] });
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
    const status = simulationStatus(sim);
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
    return fail('transport', source, opaqueDetail(source, error));
  }
}

export const SPONSORED_VAULT_SLOTS = 50;

export async function claimVaultSlot(input: {
  address: string;
  gasBudgetMist: bigint;
  nowMs: number;
}): Promise<Reading<{ slot: number }>> {
  const source = 'sponsor-vault-slot';
  const address = normaliseAddress(input.address);

  try {
    const { rows } = await db().query<{ slot: number }>(
      `
      INSERT INTO agent_sponsored_vaults (address, slot, gas_budget_mist, sponsored_at_ms)
      SELECT $1, s.slot, $2, $3
        FROM generate_series(1, $4) AS s(slot)
       WHERE NOT EXISTS (
             SELECT 1 FROM agent_sponsored_vaults taken WHERE taken.slot = s.slot
       )
         /*
           This address already holds one: select nothing rather than reaching the primary key and
           raising. Returning no rows is the correct answer; the diagnostic below says which of the
           two reasons it was.
         */
         AND NOT EXISTS (
             SELECT 1 FROM agent_sponsored_vaults mine WHERE mine.address = $1
       )
       ORDER BY s.slot
       LIMIT 1
      RETURNING slot
      `,
      [address, input.gasBudgetMist.toString(), input.nowMs, SPONSORED_VAULT_SLOTS],
    );

    if (rows.length > 0) return ok({ slot: rows[0]!.slot });

    const mine = await db().query<{ n: number }>(
      'SELECT count(*)::int AS n FROM agent_sponsored_vaults WHERE address = $1',
      [address],
    );
    if ((mine.rows[0]?.n ?? 0) > 0) {
      return fail(
        'malformed',
        source,
        'this address has already had a vault opening sponsored. One each.',
      );
    }
    const used = await db().query<{ n: number }>(
      'SELECT count(*)::int AS n FROM agent_sponsored_vaults',
    );
    return fail(
      'budget-exhausted',
      source,
      `the sponsored vault offer is fully taken — ${used.rows[0]?.n ?? 0} of ${SPONSORED_VAULT_SLOTS} ` +
        'slots are used. Opening a vault still works; it costs about 0.02 SUI in gas.',
    );
  } catch (error) {
    if ((error as { code?: string } | null)?.code === '23505') {
      return fail(
        'budget-exhausted',
        source,
        'two callers took the last sponsored vault slot at once and this one lost the race.',
      );
    }
    return fail('transport', source, opaqueDetail(source, error));
  }
}

export async function vaultSlotsLeft(): Promise<Reading<number>> {
  const source = 'sponsor-vault-slot';
  try {
    const { rows } = await db().query<{ n: number }>(
      'SELECT count(*)::int AS n FROM agent_sponsored_vaults',
    );
    return ok(Math.max(0, SPONSORED_VAULT_SLOTS - (rows[0]?.n ?? 0)));
  } catch (error) {
    return fail('transport', source, opaqueDetail(source, error));
  }
}

export async function releaseVaultSlot(address: string): Promise<void> {
  try {
    await db().query('DELETE FROM agent_sponsored_vaults WHERE address = $1 AND vault_id IS NULL', [
      normaliseAddress(address),
    ]);
  } catch {
    // Deliberately swallowed. See the note above.
  }
}
