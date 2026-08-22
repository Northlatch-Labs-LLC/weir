// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * # Why these are worth a test when the contract already asserts them
 *
 * The contract is the authority and it still runs. These exist because of *when* they run. The
 * capability for this deployment sits at an address with no browser wallet, so a governing
 * transaction is assembled by a multisig — several people signing in turn. Discovering
 * `EFeeAboveCeiling` at execution means discovering it after all of them have signed.
 *
 * # And because the numbers are copied
 *
 * `MAX_PLATFORM_FEE_BPS` and `MAX_REFERRAL_SHARE_BPS` are mirrored from `platform.move` into
 * TypeScript. A copied constant is safe only if something fails when the original moves, and these
 * assertions are that something: they read the Move source and compare.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { checkAction, MAX_PLATFORM_FEE_BPS, MAX_REFERRAL_SHARE_BPS } from '@/lib/admin';

const MOVE = readFileSync(
  new URL('../../../sui-contracts/sources/platform.move', import.meta.url),
  'utf8',
);

const CREATOR_MOVE = readFileSync(
  new URL('../../../sui-contracts/sources/creator.move', import.meta.url),
  'utf8',
);

describe('the fee ceilings mirrored from the contract', () => {
  /*
    Read out of the module rather than restated here. Restating it would make this test agree with
    itself and prove nothing about the contract.
  */
  function constantOf(name: string): bigint {
    const match = MOVE.match(new RegExp(`const ${name}: u64 = ([0-9_]+);`));
    if (match?.[1] === undefined) throw new Error(`${name} not found in platform.move`);
    return BigInt(match[1].replace(/_/g, ''));
  }

  it('matches MAX_PLATFORM_FEE_BPS in platform.move', () => {
    expect(MAX_PLATFORM_FEE_BPS).toBe(constantOf('MAX_PLATFORM_FEE_BPS'));
  });

  it('matches MAX_REFERRAL_SHARE_BPS in platform.move', () => {
    expect(MAX_REFERRAL_SHARE_BPS).toBe(constantOf('MAX_REFERRAL_SHARE_BPS'));
  });

  /*
    The ceiling is a real limit rather than a formality: 3000 bps is 30%, so a fee above it is not
    an unusual choice but one the contract refuses outright.
  */
  it('keeps the platform fee ceiling below the whole gross', () => {
    const denominator = constantOf('BPS_DENOMINATOR');
    expect(MAX_PLATFORM_FEE_BPS).toBeLessThan(denominator);
  });

  /*
    The referral share is a share OF THE FEE, not of the gross, so 5000 bps means half the platform's
    cut. Reading it as half of everything is the misunderstanding this ordering guards against —
    a referral can never reduce what a creator earns.
  */
  it('allows a referral share of at most half the platform fee', () => {
    expect(MAX_REFERRAL_SHARE_BPS).toBe(5_000n);
    expect(MAX_REFERRAL_SHARE_BPS * 2n).toBe(constantOf('BPS_DENOMINATOR'));
  });
});

/*
  The multisig path exists, and says the true thing about why.
*/
describe('the multisig signing path', () => {
  const source = readFileSync(new URL('../components/MultisigSubmit.tsx', import.meta.url), 'utf8');

  it('submits the simulated bytes unchanged, never a rebuilt transaction', () => {
    expect(source).toContain('JSON.stringify({ bytes, signature: signature.trim() })');
    // The component is handed bytes; it must have no way to construct any of its own.
    expect(source).not.toContain('new Transaction');
  });

  it('carries the combine recipe with this committee\'s real weights and threshold', () => {
    expect(source).toContain('multi-sig-combine-partial-sig');
    expect(source).toContain('--weights 1 1 1 --threshold 2');
  });

  it('is reachable from the controls whenever the wallet is not the capability holder', () => {
    const controls = readFileSync(new URL('../components/AdminControls.tsx', import.meta.url), 'utf8');
    expect(controls).toContain('<MultisigSubmit');
    expect(controls).toContain("signer === null || signer.address.toLowerCase() !== address.toLowerCase()");
  });
});

/**
 * Collecting the platform's commission.
 *
 * Nothing in this application had ever called `claim_platform_fees`, so every fee the platform
 * earned was still sitting in the vault that charged it. These cover the guards that run *before*
 * a multisig is asked to sign, because that is the only point at which a mistake is still cheap.
 */
describe('claiming platform fees', () => {
  const VAULT = '0xac9ccb28667782d4bece2bbbc205939d28cca75fa131e6c627f8aef1db524cf8';
  const USDC = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
  const claim = (over: Partial<{ vaultId: string; coinType: string; amount: string }> = {}) =>
    checkAction(
      { kind: 'claim-platform-fees', vaultId: VAULT, coinType: USDC, amount: '17400', ...over },
      0n,
    );

  it('accepts a well-formed claim', () => {
    expect(claim()).toBeNull();
  });

  it('refuses a zero or negative amount rather than building a pointless transaction', () => {
    // A zero claim simulates fine and collects nothing — a signature spent on nothing.
    expect(claim({ amount: '0' })).not.toBeNull();
    expect(claim({ amount: '-1' })).not.toBeNull();
  });

  it('refuses an amount that is not a whole number', () => {
    expect(claim({ amount: '1.5' })).not.toBeNull();
    expect(claim({ amount: 'all of it' })).not.toBeNull();
  });

  it('refuses a malformed coin type here rather than inside the transaction builder', () => {
    const problem = claim({ coinType: 'not-a-coin' });
    expect(problem).not.toBeNull();
    expect(problem).toContain('coin type');
  });

  it('refuses a vault id that is not an object id', () => {
    expect(claim({ vaultId: 'the projectx one' })).not.toBeNull();
  });

  /*
    The treasury figure is irrelevant to this action and must stay so. `sweep_treasury` moves SUI
    out of `Platform.treasury`; this moves a `Balance<T>` out of one vault. Sharing a validator
    between them is how the wrong ceiling ends up applied to the wrong balance.
  */
  it('does not measure the claim against the platform treasury', () => {
    expect(
      checkAction(
        { kind: 'claim-platform-fees', vaultId: VAULT, coinType: USDC, amount: '999999999' },
        0n,
      ),
    ).toBeNull();
  });
});

describe('the claim call matches the contract', () => {
  /*
    The builder names a function, an argument order and a return. Move can change any of them, and
    the failure would appear as an abort in a transaction a multisig had already signed. This reads
    the contract rather than restating it.
  */
  it('claim_platform_fees takes (vault, cap, amount) and returns a coin', () => {
    const match = CREATOR_MOVE.match(
      /public fun claim_platform_fees<T>\(\s*vault: &mut CreatorVault<T>,\s*cap: &PlatformCap,\s*amount: u64,\s*ctx: &mut TxContext,\s*\): Coin<T>/,
    );
    expect(match).not.toBeNull();
  });

  it('is governed by PlatformCap, not CreatorCap', () => {
    // The distinction is the whole authorisation model: a creator must never be able to claim the
    // platform's cut, and the platform must never be able to claim a creator's earnings.
    expect(CREATOR_MOVE).toMatch(/public fun claim_earnings<T>[\s\S]{0,200}cap: &CreatorCap/);
    expect(CREATOR_MOVE).toMatch(/public fun claim_platform_fees<T>[\s\S]{0,200}cap: &PlatformCap/);
  });
});
