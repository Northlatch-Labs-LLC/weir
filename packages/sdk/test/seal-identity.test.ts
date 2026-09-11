// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  approvalBytes,
  approveMind,
  approveSubscription,
  approveUnlock,
  mindIdentity,
  periodIdentity,
  periodOf,
  sealId,
  sealPackageId,
  SEAL_MIND,
  SEAL_PERIOD_MS,
  SEAL_SUBSCRIPTION,
  SEAL_UNLOCK,
  unlockIdentity,
  type ProjectXSocialConfig,
} from '../src/index.js';

const VAULT = '0x00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';
const VAULT_HEX = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

const CONTENT_KEY = new TextEncoder().encode('issue-7');

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('the identity bytes agree with entitlement.move', () => {
  it('derives an unlock identity as <vault> ‖ 0x00 ‖ <content key>', () => {
    expect(hex(unlockIdentity(VAULT, CONTENT_KEY))).toBe(
      '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff0069737375652d37',
    );
  });

  it('derives a period identity as <vault> ‖ 0x01 ‖ <tier LE> ‖ <period LE>', () => {
    expect(hex(periodIdentity(VAULT, 3n, 5n))).toBe(
      '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff0103000000000000000500000000000000',
    );
  });

  it('keeps the tag byte even when the content key is empty', () => {
    expect(hex(unlockIdentity(VAULT, new Uint8Array()))).toBe(`${VAULT_HEX}00`);
  });

  it('encodes u64 fields little-endian, matching std::bcs::to_bytes', () => {
    const identity = periodIdentity(VAULT, 1n, 258n);
    expect(hex(identity.slice(33 + 8))).toBe('0201000000000000');
  });

  it('accepts a short-form vault id by normalising it, never by padding it blindly', () => {
    expect(hex(unlockIdentity('0x6', CONTENT_KEY))).toBe(
      hex(unlockIdentity(`0x${'0'.repeat(63)}6`, CONTENT_KEY)),
    );
  });

  it('refuses a vault id that is not an object id at all', () => {
    expect(() => unlockIdentity('not-an-id', CONTENT_KEY)).toThrow(/32-byte hex object id/);
    expect(() => unlockIdentity(`0x${'ab'.repeat(33)}`, CONTENT_KEY)).toThrow(
      /32-byte hex object id/,
    );
  });

  it('keeps the two tags distinct, because a collision sells subscriber content for one unlock', () => {
    expect(SEAL_UNLOCK).toBe(0);
    expect(SEAL_SUBSCRIPTION).toBe(1);
    expect(SEAL_UNLOCK).not.toBe(SEAL_SUBSCRIPTION);
  });

  it('cannot be made to collide by a crafted content key', () => {
    const crafted = new Uint8Array([
      SEAL_SUBSCRIPTION,
      3, 0, 0, 0, 0, 0, 0, 0,
      5, 0, 0, 0, 0, 0, 0, 0,
    ]);
    expect(hex(unlockIdentity(VAULT, crafted))).not.toBe(hex(periodIdentity(VAULT, 3n, 5n)));
  });
});

describe('the mind identity agrees with agent_mind.move', () => {
  const ACCOUNT = '0xffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100';
  const ACCOUNT_HEX = 'ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100';

  it('derives a mind identity as <account> ‖ 0x02, and nothing else', () => {
    expect(hex(mindIdentity(ACCOUNT))).toBe(`${ACCOUNT_HEX}02`);
    expect(mindIdentity(ACCOUNT)).toHaveLength(33);
  });

  it('pins SEAL_MIND to the constant in agent_mind.move', () => {
    const source = readFileSync(
      join(process.cwd(), '..', '..', 'sui-contracts-mind', 'sources', 'agent_mind.move'),
      'utf8',
    );
    expect(source).toContain('module agent_mind::agent_mind');
    expect(source).toContain('const SEAL_MIND: u8 = 2;');
    expect(SEAL_MIND).toBe(2);
  });

  it('keeps the three tags pairwise distinct', () => {
    expect(SEAL_UNLOCK).not.toBe(SEAL_SUBSCRIPTION);
    expect(SEAL_UNLOCK).not.toBe(SEAL_MIND);
    expect(SEAL_SUBSCRIPTION).not.toBe(SEAL_MIND);
  });

  it('accepts a short-form account id by normalising it, as the vault identities do', () => {
    expect(hex(mindIdentity('0x6'))).toBe(hex(mindIdentity(`0x${'0'.repeat(63)}6`)));
  });

  it('refuses an account id that is not an object id at all', () => {
    expect(() => mindIdentity('not-an-id')).toThrow(/32-byte hex object id/);
  });
});

describe('the period arithmetic agrees with entitlement.move', () => {
  it('is a fixed thirty-day width', () => {
    expect(SEAL_PERIOD_MS).toBe(2_592_000_000n);
  });

  it('truncates rather than rounds, on both sides of a boundary', () => {
    expect(periodOf(0n)).toBe(0n);
    expect(periodOf(2_591_999_999n)).toBe(0n);
    expect(periodOf(2_592_000_000n)).toBe(1n);
    expect(periodOf(2_592_000_001n)).toBe(1n);
  });

  it('stays exact past the range where a float would not', () => {
    const huge = 9_007_199_254_740_993n;
    expect(periodOf(huge)).toBe(huge / 2_592_000_000n);
  });
});

describe('the seal id encoding', () => {
  it('is bare lowercase hex with no 0x prefix', () => {
    const id = sealId(unlockIdentity(VAULT, CONTENT_KEY));
    expect(id.startsWith('0x')).toBe(false);
    expect(id).toBe(id.toLowerCase());
    expect(id).toMatch(/^[0-9a-f]+$/);
  });

  it('is always an even number of characters, so it cannot be silently left-padded', () => {
    expect(sealId(unlockIdentity(VAULT, new Uint8Array())).length % 2).toBe(0);
    expect(sealId(unlockIdentity(VAULT, CONTENT_KEY)).length % 2).toBe(0);
  });
});

const CONFIG: ProjectXSocialConfig = {
  network: 'mainnet',
  grpcUrl: 'https://example.invalid',
  packageId: `0x${'11'.repeat(32)}`,
  latestPackageId: `0x${'22'.repeat(32)}`,
  platformId: `0x${'33'.repeat(32)}`,
  registryId: `0x${'44'.repeat(32)}`,
};

describe('the approval transactions', () => {
  it('namespaces identities under the original package, never the latest', () => {
    expect(sealPackageId(CONFIG)).toBe(CONFIG.packageId);
    expect(sealPackageId(CONFIG)).not.toBe(CONFIG.latestPackageId);
  });

  it('calls seal_approve_unlock on the latest package with the identity and the unlock', () => {
    const tx = approveUnlock(CONFIG, {
      identity: unlockIdentity(VAULT, CONTENT_KEY),
      unlockId: `0x${'aa'.repeat(32)}`,
    });
    const data = tx.getData();
    expect(data.commands).toHaveLength(1);
    const call = data.commands[0]!.MoveCall!;
    expect(call.package).toBe(CONFIG.latestPackageId);
    expect(call.module).toBe('entitlement');
    expect(call.function).toBe('seal_approve_unlock');
    expect(call.arguments).toHaveLength(2);
  });

  it('calls creator::seal_approve_subscription<T> with identity, tier, period, the vault and the subscription, in order', () => {
    const tx = approveSubscription(CONFIG, {
      identity: periodIdentity(VAULT, 3n, 5n),
      tier: 3n,
      period: 5n,
      subscriptionId: `0x${'bb'.repeat(32)}`,
      vaultId: VAULT,
      coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    });
    const data = tx.getData();
    const call = data.commands[0]!.MoveCall!;
    expect(call.package).toBe(CONFIG.latestPackageId);
    expect(call.module).toBe('creator');
    expect(call.typeArguments).toEqual(['0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC']);
    expect(call.function).toBe('seal_approve_subscription');
    expect(call.arguments).toHaveLength(5);
  });

  it('calls seal_approve_mind on the mind package with the identity, then the account object', () => {
    const MIND_PACKAGE = `0x${'55'.repeat(32)}`;
    const ACCOUNT = `0x${'66'.repeat(32)}`;
    const tx = approveMind(CONFIG, {
      identity: mindIdentity(ACCOUNT),
      accountId: ACCOUNT,
      mindPackageId: MIND_PACKAGE,
    });
    const data = tx.getData();
    expect(data.commands).toHaveLength(1);
    const call = data.commands[0]!.MoveCall!;
    expect(call.package).toBe(MIND_PACKAGE);
    expect(call.package).not.toBe(CONFIG.latestPackageId);
    expect(call.module).toBe('agent_mind');
    expect(call.function).toBe('seal_approve_mind');
    expect(call.arguments).toHaveLength(2);
    const [first, second] = call.arguments as Array<{ $kind: string; Input?: number }>;
    expect(first!.$kind).toBe('Input');
    expect(second!.$kind).toBe('Input');
    const firstInput = data.inputs[first!.Input!] as { Pure?: { bytes: string } };
    const secondInput = data.inputs[second!.Input!] as { UnresolvedObject?: { objectId: string } };
    expect(firstInput.Pure).toBeDefined();
    expect(secondInput.UnresolvedObject).toBeDefined();
    expect(secondInput.UnresolvedObject!.objectId).toBe(ACCOUNT);
    expect(secondInput.UnresolvedObject).not.toHaveProperty('mutable');
  });

  it('composes into one transaction when a reader opens several assets at once', () => {
    const tx = approveUnlock(CONFIG, {
      identity: unlockIdentity(VAULT, CONTENT_KEY),
      unlockId: `0x${'aa'.repeat(32)}`,
    });
    approveUnlock(
      CONFIG,
      { identity: unlockIdentity(VAULT, new Uint8Array([1])), unlockId: `0x${'cc'.repeat(32)}` },
      tx,
    );
    expect(tx.getData().commands).toHaveLength(2);
  });

  it('cannot be serialised without a client, because owned objects carry a version and a digest', async () => {
    const tx = approveUnlock(CONFIG, {
      identity: unlockIdentity(VAULT, CONTENT_KEY),
      unlockId: `0x${'aa'.repeat(32)}`,
    });
    await expect(approvalBytes(tx, undefined as never)).rejects.toThrow();
  });
});
