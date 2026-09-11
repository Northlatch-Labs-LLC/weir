// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { beforeAll, describe, expect, it } from 'vitest';
import { loadConfig, type ProjectXSocialConfig } from '../src/config.js';
import { createClient, readDecimals, readPlatform } from '../src/client.js';
import { computeSplit } from '../src/split.js';
import { fold } from '../src/reading.js';
import type { SuiGrpcClient } from '@mysten/sui/grpc';

const USDC =
  '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';

let config: ProjectXSocialConfig;
let client: SuiGrpcClient;

beforeAll(() => {
  config = fold(
    loadConfig(process.env),
    (value) => value,
    (failure) => {
      throw new Error(
        `${failure.detail}\n\n` +
          `These tests read the live deployment. Copy .env.example and source it, ` +
          `or run: pnpm test (unit tests only, no network).`,
      );
    },
  );
  client = createClient(config);
});

describe('the published platform', () => {
  it('is readable over gRPC', async () => {
    const reading = await readPlatform(client, config);
    fold(
      reading,
      (platform) => expect(platform.version).toBe(1n),
      (failure) => {
        throw new Error(`could not read the Platform: ${failure.kind} — ${failure.detail}`);
      },
    );
  });

  it('carries the economic terms that were configured', async () => {
    const reading = await readPlatform(client, config);
    if (!reading.ok) throw new Error(reading.failure.detail);

    expect(reading.value.feeBps).toBe(290n);
    expect(reading.value.referralShareBps).toBe(500n);
    expect(reading.value.creationFeeMist).toBe(0n);
  });

  it('is open for business', async () => {
    const reading = await readPlatform(client, config);
    if (!reading.ok) throw new Error(reading.failure.detail);

    expect(reading.value.creationPaused).toBe(false);
    expect(reading.value.paymentsPaused).toBe(false);
  });

  it('never exceeds its own compiled ceilings', async () => {
    const reading = await readPlatform(client, config);
    if (!reading.ok) throw new Error(reading.failure.detail);

    expect(reading.value.feeBps).toBeLessThanOrEqual(3_000n);
    expect(reading.value.referralShareBps).toBeLessThanOrEqual(5_000n);
  });
});

describe('the split shown to a user matches the live terms', () => {
  it('computes a 10 USDC subscription from chain-read rates', async () => {
    const reading = await readPlatform(client, config);
    if (!reading.ok) throw new Error(reading.failure.detail);

    const { feeBps, referralShareBps } = reading.value;
    const gross = 10_000_000n;

    const referred = computeSplit(gross, feeBps, referralShareBps, true);
    const organic = computeSplit(gross, feeBps, referralShareBps, false);

    expect(referred.creator + referred.platform + referred.referrer).toBe(gross);
    expect(organic.creator + organic.platform + organic.referrer).toBe(gross);

    expect(referred.creator).toBe(organic.creator);

    expect(referred.creator).toBe(9_710_000n);
    expect(referred.platform).toBe(275_500n);
    expect(referred.referrer).toBe(14_500n);
  });
});

describe('coin decimals are read, not assumed', () => {
  it('reads 6 for native USDC', async () => {
    const reading = await readDecimals(client, USDC);
    fold(
      reading,
      (decimals) => expect(decimals).toBe(6),
      (failure) => {
        throw new Error(`could not read USDC decimals: ${failure.kind} — ${failure.detail}`);
      },
    );
  });

  it('reports a failure rather than a number for a coin that does not exist', async () => {
    const reading = await readDecimals(
      client,
      '0x0000000000000000000000000000000000000000000000000000000000000abc::nope::NOPE',
    );
    expect(reading.ok).toBe(false);
    if (!reading.ok) {
      expect(['not-found', 'transport', 'malformed']).toContain(reading.failure.kind);
    }
  });
});

describe('a misconfigured client refuses rather than guessing', () => {
  it('fails when the platform id names something that is not a Platform', async () => {
    const wrong = { ...config, platformId: `0x${'0'.repeat(63)}6` };
    const reading = await readPlatform(client, wrong);
    expect(reading.ok).toBe(false);
  });
});
