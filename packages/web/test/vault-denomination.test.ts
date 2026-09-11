// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.setConfig({ testTimeout: 15_000 });
import { vaultCoinTypes } from '../lib/chain';

for (const line of readFileSync(join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const [key, ...rest] = line.split('=');
  if (key?.startsWith('PROJECTX_SOCIAL_') && process.env[key] === undefined) {
    process.env[key] = rest.join('=').trim();
  }
}

const { prepareOpenVault } = await import('../lib/checkout');

const USDC = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
const SUI = '0x2::sui::SUI';

describe('reading the offered denominations', () => {
  const read = (value: string | undefined) =>
    vaultCoinTypes({ PROJECTX_SOCIAL_VAULT_COIN_TYPES: value });

  it('offers each configured coin, in the configured order', () => {
    expect(read(`${USDC},${SUI}`)).toEqual([USDC, SUI]);
  });

  it('tolerates the spacing a human actually types', () => {
    expect(read(` ${USDC} , ${SUI} `)).toEqual([USDC, SUI]);
  });

  it('offers nothing when unset, so the vault form is withheld rather than defaulted', () => {
    expect(read(undefined)).toEqual([]);
    expect(read('')).toEqual([]);
    expect(read('   ')).toEqual([]);
  });

  it('drops a malformed entry without withholding the ones spelled correctly', () => {
    expect(read(`not-a-coin-type,${SUI}`)).toEqual([SUI]);
    expect(read(`${USDC},0x2::sui`)).toEqual([USDC]);
  });

  it('offers a coin once however many times it is listed', () => {
    expect(read(`${USDC},${USDC},${SUI}`)).toEqual([USDC, SUI]);
  });
});

describe('building a vault in a coin this deployment offers', () => {
  const open = (coinType: string) =>
    prepareOpenVault({
      sender: '0x1111111111111111111111111111111111111111111111111111111111111111',
      accountId: '0x2222222222222222222222222222222222222222222222222222222222222222',
      coinType,
      creationFeeMist: '0',
    });

  it('refuses a coin that is not offered, before anything reaches the network', async () => {
    vi.stubEnv('PROJECTX_SOCIAL_VAULT_COIN_TYPES', USDC);
    const r = await open('0xdeadbeef::scam::SCAM');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failure.kind).toBe('malformed');
      expect(r.failure.detail).toContain('denomination');
      expect(r.failure.detail).toContain('0xdeadbeef::scam::SCAM');
    }
    vi.unstubAllEnvs();
  });

  it('refuses every coin when the deployment offers none', async () => {
    vi.stubEnv('PROJECTX_SOCIAL_VAULT_COIN_TYPES', '');
    const r = await open(USDC);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failure.kind).toBe('malformed');
      expect(r.failure.detail).toContain('offers no vault denomination');
    }
    vi.unstubAllEnvs();
  });

  it('does not refuse a coin that is offered', async () => {
    vi.stubEnv('PROJECTX_SOCIAL_VAULT_COIN_TYPES', `${USDC},${SUI}`);
    const r = await open(SUI);
    if (!r.ok) expect(r.failure.detail).not.toContain('denomination');
    vi.unstubAllEnvs();
  });
});
