// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  BREAKER_DEFAULTS,
  BREAKER_ENV,
  BREAKER_WINDOW_MS,
  QUOTAS,
  breakerSetting,
  tripBreaker,
  type QuotaName,
} from '../lib/rate-limit';

const BUCKETS = Object.keys(QUOTAS) as QuotaName[];

describe('the ceiling an operator sets', () => {
  it('has a variable, a window and a default for every bucket a route can spend from', () => {
    for (const bucket of BUCKETS) {
      expect(BREAKER_ENV[bucket]).toMatch(/^PROJECTX_SOCIAL_BREAKER_/);
      expect(BREAKER_WINDOW_MS[bucket]).toBeGreaterThan(0);
      expect(BREAKER_DEFAULTS[bucket]).toBeGreaterThan(0);
    }
  });

  it('falls back to the default when nothing is set, never to unlimited', () => {
    for (const bucket of BUCKETS) {
      const setting = breakerSetting(bucket, {});
      expect(setting.state).toBe('open');
      if (setting.state !== 'open') continue;
      expect(setting.ceiling).toBe(BREAKER_DEFAULTS[bucket]);
      expect(setting.windowMs).toBe(BREAKER_WINDOW_MS[bucket]);
    }
  });

  it('treats an empty string as unset rather than as zero', () => {
    const setting = breakerSetting('read', { [BREAKER_ENV.read]: '   ' });
    expect(setting.state).toBe('open');
  });

  it('reads zero as the kill switch, for each bucket independently', () => {
    for (const bucket of BUCKETS) {
      const setting = breakerSetting(bucket, { [BREAKER_ENV[bucket]]: '0' });
      expect(setting.state).toBe('closed');
      if (setting.state !== 'closed') continue;
      expect(setting.reason).toContain(BREAKER_ENV[bucket]);
    }

    expect(breakerSetting('read', { [BREAKER_ENV.purchase]: '0' }).state).toBe('open');
  });

  it('closes rather than defaults when the value cannot be read', () => {
    for (const bad of ['O', 'ten', '-1', '1_000', '12.5', 'unlimited']) {
      const setting = breakerSetting('write', { [BREAKER_ENV.write]: bad });
      expect([bad, setting.state]).toEqual([bad, 'closed']);
    }
  });

  it('converts a ceiling into a refill rate that spends the whole window', () => {
    const setting = breakerSetting('purchase', { [BREAKER_ENV.purchase]: '60' });
    expect(setting.state).toBe('open');
    if (setting.state !== 'open') return;
    expect(setting.msPerToken).toBe(60_000);
    expect(setting.ceiling * setting.msPerToken).toBe(BREAKER_WINDOW_MS.purchase);
  });

  it('never produces a refill of zero milliseconds, however large the ceiling', () => {
    const setting = breakerSetting('read', { [BREAKER_ENV.read]: '999999999' });
    expect(setting.state).toBe('open');
    if (setting.state !== 'open') return;
    expect(setting.msPerToken).toBeGreaterThanOrEqual(1);
    expect(setting.ceiling).toBe(BREAKER_WINDOW_MS.read);
  });
});

describe('the switch itself', () => {
  it('refuses without touching the database when it is closed', async () => {
    const outcome = await tripBreaker('write', { env: { [BREAKER_ENV.write]: '0' } });
    expect(outcome).toEqual({
      tripped: true,
      kind: 'closed',
      reason: expect.stringContaining(BREAKER_ENV.write),
    });
  });

  it('refuses a single request larger than the whole ceiling, and does not throw about it', async () => {
    const outcome = await tripBreaker('purchase', {
      cost: 5,
      env: { [BREAKER_ENV.purchase]: '2' },
    });
    expect(outcome.tripped).toBe(true);
    if (!outcome.tripped || outcome.kind !== 'over-ceiling') throw new Error('expected a ceiling');
    expect(outcome.ceiling).toBe(2);
    expect(outcome.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it('rejects a cost that is not a whole number of requests, loudly', async () => {
    await expect(tripBreaker('read', { cost: 0 })).rejects.toThrow(/whole number/);
    await expect(tripBreaker('read', { cost: 1.5 })).rejects.toThrow(/whole number/);
  });
});

describe('what the layers are for', () => {
  it('is documented against every layer, including the two that are not code', () => {
    const layers = readLayers();
    for (const marker of [
      'Layer 1 — edge, volumetric, per-IP and per-ASN',
      'Layer 2 — identity',
      'Layer 3 — the global circuit breaker',
      'Layer 4 — economic',
      'The rules to create in Cloudflare',
      'ip.geoip.asnum',
      'payments_paused',
      'PROJECTX_SOCIAL_BEHIND_CLOUDFLARE',
    ]) {
      expect([marker, layers.includes(marker)]).toEqual([marker, true]);
    }
  });

  it('no longer claims the per-address bucket is the ceiling', () => {
    const layers = readLayers();
    expect(layers).not.toContain('This is the ceiling that actually holds');
    expect(layers).toContain('It is not the ceiling on agent traffic');
    expect(layers).toContain('bounds one runaway caller. It does not bound an adversary');
    expect(layers).toContain('Serverless multiplies instances, and each instance counts on its own');
  });
});

function readSource(): string {
  return readFileSync(new URL('../lib/rate-limit.ts', import.meta.url), 'utf8');
}

/**
 * The four layers, as prose.
 *
 * Two of them are not code — Layer 1 is Cloudflare configuration, Layer 4 is on chain — so nothing
 * in this repository can assert either is in place. Naming them is the only control there is, and
 * this is what fails when a layer loses its section. It read the doc comment at the top of
 * `lib/rate-limit.ts` until 2026-09-11; a runbook that lives in a comment is one a comment sweep
 * deletes.
 */
function readLayers(): string {
  return readFileSync(new URL('../docs/rate-limit-layers.md', import.meta.url), 'utf8');
}
