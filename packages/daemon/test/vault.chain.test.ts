// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { beforeAll, describe, expect, it } from 'vitest';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { fold } from '@projectx-social/sdk';
import { readCurrentEpoch, readStakeVault } from '../src/adapters/vault.js';
import { decideHarvest, isMatured, LADDER_DEPTH, MIN_STAKE_MIST } from '../src/domain/harvest.js';

const VAULT = '0xee64d87381e0056ec944af98a7a8a77a0de25652f4bee5e174df4b8b4f10bb11';
const OKX_EARN = '0x00ae78d3e5ba5d6b8de32455474f52811b95617cbad39ebf4f9e2daf67187407';
const CREATOR = '0xda784b6c20c5995f6b719a20a26eddee5ec971c8ecec890e61c8b4634dd1715d';

let client: SuiGrpcClient;

beforeAll(() => {
  const url = process.env['PROJECTX_SOCIAL_GRPC_URL'];
  if (url === undefined || url === '') {
    throw new Error(
      'PROJECTX_SOCIAL_GRPC_URL is not set. There is no default — source ' +
        'packages/sdk/.env.example, or run `pnpm test` for the unit suite (no network).',
    );
  }
  client = new SuiGrpcClient({ network: 'mainnet', baseUrl: url });
});

describe('the decoder reads the real vault', () => {
  it('decodes it at all', async () => {
    const reading = await readStakeVault(client, VAULT);
    fold(
      reading,
      (v) => expect(v.vaultId).toBe(VAULT),
      (f) => {
        throw new Error(`could not read the vault: ${f.kind} — ${f.detail}`);
      },
    );
  });

  it('recovers the fields the offsets depend on', async () => {
    const reading = await readStakeVault(client, VAULT);
    if (!reading.ok) throw new Error(reading.failure.detail);
    const v = reading.value;

    expect(v.creator).toBe(CREATOR);
    expect(v.validator).toBe(OKX_EARN);
    expect(v.accepting).toBe(true);

    expect(v.totalPrincipalMist).toBe(2n * MIN_STAKE_MIST);
    expect(v.liquidMist).toBe(MIN_STAKE_MIST);
    expect(v.harvests).toBeGreaterThanOrEqual(1n);
  });

  it('recovers exactly one tranche of one SUI', async () => {
    const reading = await readStakeVault(client, VAULT);
    if (!reading.ok) throw new Error(reading.failure.detail);

    expect(reading.value.tranches).toHaveLength(1);
    expect(reading.value.tranches[0]!.principalMist).toBe(MIN_STAKE_MIST);
    expect(reading.value.tranches[0]!.activationEpoch).toBeGreaterThan(0n);
  });

  it('holds no yield yet, and that zero is a real measurement', async () => {
    const reading = await readStakeVault(client, VAULT);
    expect(reading.ok).toBe(true);
    if (!reading.ok) return;

    expect(reading.value.lifetimeYieldMist).toBe(0n);
    expect(reading.value.creatorYieldMist).toBe(0n);
    expect(reading.value.platformYieldMist).toBe(0n);
  });
});

describe('the decision against real state', () => {
  it('declines to harvest again this epoch', async () => {
    const vault = await readStakeVault(client, VAULT);
    const epoch = await readCurrentEpoch(client);
    if (!vault.ok) throw new Error(vault.failure.detail);
    if (!epoch.ok) throw new Error(epoch.failure.detail);

    const decision = decideHarvest(vault.value, epoch.value);

    expect(decision.act).toBe(false);
    if (!decision.act) {
      expect(['already-staked-this-epoch', 'nothing-to-stake']).toContain(decision.reason);
    }
  });

  it('agrees with the contract about when this tranche matures', async () => {
    const vault = await readStakeVault(client, VAULT);
    const epoch = await readCurrentEpoch(client);
    if (!vault.ok) throw new Error(vault.failure.detail);
    if (!epoch.ok) throw new Error(epoch.failure.detail);

    const tranche = vault.value.tranches[0]!;
    const maturesAt = tranche.activationEpoch + LADDER_DEPTH;

    expect(isMatured(tranche, maturesAt - 1n)).toBe(false);
    expect(isMatured(tranche, maturesAt)).toBe(true);

    expect(isMatured(tranche, epoch.value)).toBe(false);
  });
});

describe('the epoch reader', () => {
  it('returns a plausible mainnet epoch', async () => {
    const reading = await readCurrentEpoch(client);
    fold(
      reading,
      (epoch) => {
        expect(epoch).toBeGreaterThan(1_200n);
      },
      (f) => {
        throw new Error(`could not read the epoch: ${f.kind} — ${f.detail}`);
      },
    );
  });
});

describe('a vault id that is not a vault', () => {
  it('fails rather than returning a plausible empty vault', async () => {
    const reading = await readStakeVault(
      client,
      '0x3f695b2c32714e2359c4bb9515598d8dd765b216148c5b8fa818073d52b50f36',
    );
    expect(reading.ok).toBe(false);
  });
});
