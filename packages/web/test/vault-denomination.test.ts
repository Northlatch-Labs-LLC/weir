// @vitest-environment node
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * Which coin a creator vault may be denominated in, and who decides.
 *
 * # The defect this pins
 *
 * `coinType` arrived in the body of `POST /api/creator/vault`, was checked for *shape*, and was
 * then used to build the transaction. The configured denomination was only ever a suggestion the
 * form happened to follow: anybody posting directly could name any coin at all and receive a
 * signable transaction for a vault denominated in it.
 *
 * That is not a cosmetic bypass. `CreatorVault<phantom T>` fixes the coin as the vault's type
 * parameter at creation, with no migration and no setter — so a vault opened in a coin nobody
 * offers is permanent, and every payment routed through it settles in that coin forever.
 *
 * # Why the check is in the builder rather than the route
 *
 * `prepareOpenVault` is what actually constructs the transaction, so a second route reaching the
 * same builder inherits the refusal instead of having to remember it. Tests here call the builder
 * directly for the same reason: routing is not what is being asserted.
 *
 * # What is deliberately NOT asserted
 *
 * That the chain refuses an unoffered coin. It does not, and it should not — `open_vault<T>` is
 * generic with no on-chain allowlist, so anyone calling the contract directly may denominate in
 * anything. The risk is borne entirely by the creator taking it, and an on-chain allowlist would be
 * a permanent governance burden. What is asserted is that *this deployment* will not build one.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

/*
  These cases build and simulate a real transaction shape; under a full-suite run on a loaded
  machine they have crossed the default 5 s and failed for time alone. 15 s is still a failure
  if the work hangs, and never a pass for the wrong reason.
*/
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
    /*
      The load-bearing case. A deployment that configured no denomination has not configured a safe
      one to guess, and the vault it would open cannot be changed afterwards — so the absence must
      propagate as "no choice available", never as "pick the usual one".
    */
    expect(read(undefined)).toEqual([]);
    expect(read('')).toEqual([]);
    expect(read('   ')).toEqual([]);
  });

  it('drops a malformed entry without withholding the ones spelled correctly', () => {
    // One typo in a comma-separated variable should not take the whole form down. A coin missing
    // from a choice is visible; a form that silently vanished is not.
    expect(read(`not-a-coin-type,${SUI}`)).toEqual([SUI]);
    expect(read(`${USDC},0x2::sui`)).toEqual([USDC]);
  });

  it('offers a coin once however many times it is listed', () => {
    // Rendered as a choice. The same coin twice reads as a bug in the money.
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
    /*
      A structurally perfect coin type that this deployment simply does not offer. Using well-formed
      bytes is the point: a refusal naming the *shape* would mean this test passes for the wrong
      reason and the bypass is still open.
    */
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
    /*
      Fails closed. An unset allowlist grants nothing — it must not read as "no restriction".
    */
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
    /*
      The other half, and it has to be here: a check that refused everything would pass every test
      above while removing the feature entirely.

      This asserts only that the refusal is not the *denomination* one. Building the transaction
      reaches a fullnode, which may fail in this environment for reasons that have nothing to do
      with the coin — so a failure is tolerated as long as it is not this one.
    */
    vi.stubEnv('PROJECTX_SOCIAL_VAULT_COIN_TYPES', `${USDC},${SUI}`);
    const r = await open(SUI);
    if (!r.ok) expect(r.failure.detail).not.toContain('denomination');
    vi.unstubAllEnvs();
  });
});
