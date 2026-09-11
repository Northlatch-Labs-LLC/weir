// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it, vi } from 'vitest';
import { EncryptedObject, InvalidParameterError, NoAccessError } from '@mysten/seal';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { fromBase64, toBase58 } from '@mysten/sui/utils';
import {
  SEAL_PERIOD_MS,
  SEAL_SUBSCRIPTION,
  SEAL_UNLOCK,
  approvalBytes,
  periodIdentity,
  sealId,
  unlockIdentity,
  type ProjectXSocialConfig,
} from '@projectx-social/sdk';

import {
  PUBLIC_WALRUS_AGGREGATORS,
  SealDecryptor,
  SealHashMismatchError,
  approvalTransactionFor,
  identityForApproval,
  looksLikeSettling,
  openBlob,
  sha256Hex,
  type SealApproval,
  type SealedRef,
} from '../src/seal-node.js';

import type {
  SealApproval as SealApprovalContract,
  SealDecryptor as SealDecryptorContract,
} from '../src/index.js';

const _implementsContract: SealDecryptorContract = null as unknown as SealDecryptor;
const _approvalMatchesContract: SealApprovalContract = null as unknown as SealApproval;
const _contractMatchesApproval: SealApproval = null as unknown as SealApprovalContract;
void _implementsContract;
void _approvalMatchesContract;
void _contractMatchesApproval;

const VAULT = '0xa1f80da9efffa73a2617163f5f35249130972e4f6e0bfd2bf7396c584423fd6d';
const CONTENT_KEY = 'sealed-on-walrus-001';
const OTHER_CONTENT_KEY = 'mistakes-setting-up';
const PACKAGE = '0xc5c833991ed1123d70b1001c0bcdb01ec5728b09f25dfc42a0edaf16005d404d';
const LATEST = '0xfa7eb18bbb29b047ec86434e8a8f4cfba35615bde9680eebd781a187ca3a3694';

const CONFIG: ProjectXSocialConfig = {
  network: 'mainnet',
  grpcUrl: 'https://fullnode.mainnet.sui.io:443',
  packageId: PACKAGE,
  latestPackageId: LATEST,
  platformId: '0x3f695b2c32714e2359c4bb9515598d8dd765b216148c5b8fa818073d52b50f36',
  registryId: '0x1a3fb4ac25458d7524be064a2b7e1586ccd9ed09c0d5b351621e3b101e1203a0',
};

const UNLOCK_OBJECT = `0x${'11'.repeat(32)}`;
const SUBSCRIPTION_OBJECT = `0x${'22'.repeat(32)}`;

const UNLOCK: SealApproval = {
  kind: 'unlock',
  vaultId: VAULT,
  contentKey: CONTENT_KEY,
  unlockId: UNLOCK_OBJECT,
};
const SUBSCRIPTION: SealApproval = {
  kind: 'subscription',
  vaultId: VAULT,
  tier: 0n,
  period: 689n,
  subscriptionId: SUBSCRIPTION_OBJECT,
  coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
};

const here = fileURLToPath(new URL('.', import.meta.url));
const readRepoFile = (relative: string): string =>
  readFileSync(new URL(`../../../${relative}`, `file://${here}`), 'utf8');

const WEB_SEAL_OPEN = fileURLToPath(new URL('../../web/lib/seal-open.ts', import.meta.url));
const browserOpener = (existsSync(WEB_SEAL_OPEN) ? await import(pathToFileURL(WEB_SEAL_OPEN).href) : null) as null | {
  approvalFor: (
    config: ProjectXSocialConfig,
    entitlement:
      | { kind: 'unlock'; vaultId: string; contentKey: string; unlockId: string }
      | {
          kind: 'subscription';
          vaultId: string;
          tier: bigint;
          period: bigint;
          subscriptionId: string;
          coinType: string;
        },
  ) => Parameters<typeof approvalBytes>[0];
};
const approvalFor = browserOpener === null ? null : browserOpener.approvalFor;

function agentKey(): { address: string; keypair: Ed25519Keypair } {
  const keypair = Ed25519Keypair.generate();
  return { address: keypair.toSuiAddress(), keypair };
}

function offlineClient(): never {
  const digest = toBase58(new Uint8Array(32).fill(7));
  return {
    core: {
      resolveTransactionPlugin:
        () =>
        async (
          data: { inputs: Record<string, unknown>[] },
          _options: unknown,
          next: () => Promise<void>,
        ): Promise<void> => {
          for (const input of data.inputs) {
            if (input['$kind'] !== 'UnresolvedObject') continue;
            const { objectId } = input['UnresolvedObject'] as { objectId: string };
            delete input['UnresolvedObject'];
            input['$kind'] = 'Object';
            input['Object'] = {
              $kind: 'ImmOrOwnedObject',
              ImmOrOwnedObject: { objectId, version: '1', digest },
            };
          }
          await next();
        },
    },
    // The suite only ever passes this where a `SuiGrpcClient` is expected and only the one method
    // above is reached. Cast at the seam rather than sprinkling `any` through the tests.
  } as never;
}

function strictOfflineClient(): never {
  const digest = toBase58(new Uint8Array(32).fill(7));
  return {
    core: {
      resolveTransactionPlugin:
        () =>
        async (
          data: { inputs: Record<string, unknown>[] },
          _options: unknown,
          next: () => Promise<void>,
        ): Promise<void> => {
          for (const input of data.inputs) {
            if (input['$kind'] !== 'UnresolvedObject') continue;
            const unresolved = input['UnresolvedObject'] as {
              objectId: string;
              mutable?: boolean;
              initialSharedVersion?: string;
            };
            if (unresolved.mutable != null || unresolved.initialSharedVersion != null) {
              throw new Error(
                `Input did not match unresolved object. ${JSON.stringify(unresolved)} is not ` +
                  `compatible with an owned object`,
              );
            }
            delete input['UnresolvedObject'];
            input['$kind'] = 'Object';
            input['Object'] = {
              $kind: 'ImmOrOwnedObject',
              ImmOrOwnedObject: { objectId: unresolved.objectId, version: '1', digest },
            };
          }
          await next();
        },
    },
  } as never;
}

function wrappedKeyFor(identity: Uint8Array): string {
  const bytes = EncryptedObject.serialize({
    version: 0,
    packageId: PACKAGE,
    id: sealId(identity),
    services: [[`0x${'33'.repeat(32)}`, 1]],
    threshold: 1,
    encryptedShares: {
      BonehFranklinBLS12381: {
        nonce: new Uint8Array(96),
        encryptedShares: [new Uint8Array(32)],
        encryptedRandomness: new Uint8Array(32),
      },
    },
    ciphertext: { Plain: {} },
  }).toBytes();
  return Buffer.from(bytes).toString('base64');
}

function sealBlob(plaintext: Uint8Array): {
  ciphertext: Uint8Array;
  key: Uint8Array;
  nonce: string;
  sha256: string;
} {
  const key = randomBytes(32);
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    ciphertext: new Uint8Array(Buffer.concat([body, cipher.getAuthTag()])),
    key: new Uint8Array(key),
    nonce: nonce.toString('base64'),
    sha256: createHash('sha256').update(plaintext).digest('hex'),
  };
}

function served(status: number, bytes?: Uint8Array): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: async () => (bytes ?? new Uint8Array()).slice().buffer,
  } as unknown as Response;
}

function aggregatorServing(blobId: string, bytes: Uint8Array): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0]) =>
    String(input).endsWith(`/v1/blobs/${blobId}`) ? served(200, bytes) : served(404)) as typeof fetch;
}

describe('the identity an agent asks for', () => {
  it('builds an unlock identity as vault ‖ 0x00 ‖ contentKey', () => {
    const identity = identityForApproval(UNLOCK);
    const contentKey = new TextEncoder().encode(CONTENT_KEY);

    expect(identity.length).toBe(32 + 1 + contentKey.length);
    expect(Buffer.from(identity.subarray(0, 32)).toString('hex')).toBe(VAULT.slice(2));
    expect(identity[32]).toBe(0x00);
    expect(Buffer.from(identity.subarray(33))).toEqual(Buffer.from(contentKey));
  });

  it('builds a subscription identity as vault ‖ 0x01 ‖ tier LE ‖ period LE', () => {
    const identity = identityForApproval(SUBSCRIPTION);

    expect(identity.length).toBe(32 + 1 + 8 + 8);
    expect(Buffer.from(identity.subarray(0, 32)).toString('hex')).toBe(VAULT.slice(2));
    expect(identity[32]).toBe(0x01);
    expect([...identity.subarray(33, 41)]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect([...identity.subarray(41, 49)]).toEqual([0xb1, 0x02, 0, 0, 0, 0, 0, 0]);
  });

  it('delegates to the SDK derivations rather than deriving anything itself', () => {
    expect(identityForApproval(UNLOCK)).toEqual(
      unlockIdentity(VAULT, new TextEncoder().encode(CONTENT_KEY)),
    );
    expect(identityForApproval(SUBSCRIPTION)).toEqual(periodIdentity(VAULT, 0n, 689n));
  });

  it('encodes the content key as UTF-8, the same encoding the sealer used', () => {
    const contentKey = 'café-über-日本';
    const identity = identityForApproval({
      kind: 'unlock',
      vaultId: VAULT,
      contentKey,
      unlockId: UNLOCK_OBJECT,
    });

    const utf8 = Buffer.from(contentKey, 'utf8');
    const latin1 = Buffer.from(contentKey, 'latin1');
    expect(Buffer.from(utf8)).not.toEqual(Buffer.from(latin1));
    expect(Buffer.from(identity.subarray(33))).toEqual(utf8);
    expect(identity.length).toBe(32 + 1 + utf8.length);
  });

  it('keeps the two families apart, which is what stops one cheap unlock opening a period', () => {
    const forgedContentKey = new Uint8Array([
      SEAL_SUBSCRIPTION,
      ...new Uint8Array(8), // tier 0, u64 LE
      0xb1,
      0x02,
      ...new Uint8Array(6), // period 689, u64 LE
    ]);
    const asSubscription = periodIdentity(VAULT, 0n, 689n);

    const withoutTag = new Uint8Array([...Buffer.from(VAULT.slice(2), 'hex'), ...forgedContentKey]);
    expect(Buffer.from(withoutTag)).toEqual(Buffer.from(asSubscription));

    const asUnlock = unlockIdentity(VAULT, forgedContentKey);
    expect(Buffer.from(asUnlock)).not.toEqual(Buffer.from(asSubscription));
    expect(asUnlock.length).toBe(asSubscription.length + 1);
    expect(asUnlock[32]).toBe(SEAL_UNLOCK);
    expect(asSubscription[32]).toBe(SEAL_SUBSCRIPTION);
  });

  it('still agrees with the constants entitlement.move actually declares', () => {
    const move = readRepoFile('sui-contracts/sources/entitlement.move');
    expect(move).toContain('const SEAL_UNLOCK: u8 = 0;');
    expect(move).toContain('const SEAL_SUBSCRIPTION: u8 = 1;');
    expect(move).toContain('const PERIOD_MS: u64 = 30 * 24 * 60 * 60 * 1000;');
    expect(SEAL_UNLOCK).toBe(0);
    expect(SEAL_SUBSCRIPTION).toBe(1);
    expect(SEAL_PERIOD_MS).toBe(30n * 24n * 60n * 60n * 1000n);
  });
});

describe.skipIf(approvalFor === null)('the approval transaction handed to the key servers (web mirror; skipped where packages/web is absent)', () => {
  it('is byte-identical to the browser opener for an unlock', async () => {
    const mine = approvalTransactionFor(CONFIG, UNLOCK);
    const browser = approvalFor!(CONFIG, {
      kind: 'unlock',
      vaultId: VAULT,
      contentKey: CONTENT_KEY,
      unlockId: UNLOCK_OBJECT,
    });

    expect(mine.getData()).toEqual(browser.getData());
    expect(await approvalBytes(mine, offlineClient())).toEqual(
      await approvalBytes(browser, offlineClient()),
    );
  });

  it('is byte-identical to the browser opener for a subscription', async () => {
    const mine = approvalTransactionFor(CONFIG, SUBSCRIPTION);
    const browser = approvalFor!(CONFIG, {
      kind: 'subscription',
      vaultId: VAULT,
      tier: 0n,
      period: 689n,
      subscriptionId: SUBSCRIPTION_OBJECT,
      coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    });

    expect(mine.getData()).toEqual(browser.getData());
    expect(await approvalBytes(mine, offlineClient())).toEqual(
      await approvalBytes(browser, offlineClient()),
    );
  });

  it('targets the LATEST package, never the Seal namespace', () => {
    expect(LATEST).not.toBe(PACKAGE);
    for (const [approval, module] of [[UNLOCK, 'entitlement'], [SUBSCRIPTION, 'creator']] as const) {
      const command = approvalTransactionFor(CONFIG, approval).getData().commands[0];
      expect(command?.MoveCall?.package).toBe(LATEST);
      expect(command?.MoveCall?.module).toBe(module);
    }
  });

  it('calls seal_approve_unlock with the identity and the unlock object', () => {
    const data = approvalTransactionFor(CONFIG, UNLOCK).getData();
    expect(data.commands[0]?.MoveCall?.function).toBe('seal_approve_unlock');

    const identity = identityForApproval(UNLOCK);
    const pure = fromBase64(data.inputs[0]?.Pure?.bytes ?? '');
    expect(pure[0]).toBe(identity.length);
    expect(Buffer.from(pure.subarray(1))).toEqual(Buffer.from(identity));

    expect(data.inputs[1]?.UnresolvedObject).toEqual({ objectId: UNLOCK_OBJECT });
    expect(data.inputs[1]?.UnresolvedObject).not.toHaveProperty('mutable');
  });

  it('calls seal_approve_subscription with tier and period both beside and inside the identity', () => {
    const data = approvalTransactionFor(CONFIG, SUBSCRIPTION).getData();
    expect(data.commands[0]?.MoveCall?.function).toBe('seal_approve_subscription');

    expect([...fromBase64(data.inputs[1]?.Pure?.bytes ?? '')]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect([...fromBase64(data.inputs[2]?.Pure?.bytes ?? '')]).toEqual([
      0xb1, 0x02, 0, 0, 0, 0, 0, 0,
    ]);
    expect(data.inputs[3]?.UnresolvedObject).toEqual({ objectId: VAULT });
    expect(data.inputs[4]?.UnresolvedObject).toEqual({ objectId: SUBSCRIPTION_OBJECT });
    expect(data.commands[0]?.MoveCall?.typeArguments).toEqual([SUBSCRIPTION.coinType]);
    expect(data.inputs[3]?.UnresolvedObject).not.toHaveProperty('mutable');
  });

  it('carries no gas budget, price or payment', () => {
    const gas = approvalTransactionFor(CONFIG, UNLOCK).getData().gasData;
    expect(gas).toEqual({ budget: null, price: null, owner: null, payment: null });
  });
});

describe('an agent decrypts for itself and for nobody else', () => {
  it('names its own address as the sender of every approval', async () => {
    const key = agentKey();
    const decryptor = new SealDecryptor({
      config: CONFIG,
      key,
      suiClient: offlineClient(),
    });

    expect(decryptor.address).toBe(key.address);

    const bytes = await decryptor.approvalBytesFor(UNLOCK);
    const other = agentKey();
    const otherBytes = await new SealDecryptor({
      config: CONFIG,
      key: other,
      suiClient: offlineClient(),
    }).approvalBytesFor(UNLOCK);

    expect(bytes).toEqual(otherBytes);
    expect(key.address).not.toBe(other.address);
  });

  it('satisfies the decryptor contract src/index.ts declares', () => {
    const decryptor = new SealDecryptor({
      config: CONFIG,
      key: agentKey(),
      suiClient: offlineClient(),
    });
    expect(typeof decryptor.decrypt).toBe('function');
    expect(decryptor.decrypt.length).toBe(1);
  });

  it('exposes no way to name a different holder', () => {
    const surface = Object.getOwnPropertyNames(SealDecryptor.prototype);
    expect(surface.sort()).toEqual(
      ['constructor', 'approvalBytesFor', 'address', 'decrypt', 'recoverKeyFromCommittee', 'sessionKey'].sort(),
    );
  });
});

describe('opening the blob', () => {
  const PLAINTEXT = new TextEncoder().encode(
    'Where a paid post actually goes. Bytes an agent will act on, so they are checked twice.',
  );

  it('returns exactly what was sealed', async () => {
    const blob = sealBlob(PLAINTEXT);
    const identity = identityForApproval(UNLOCK);
    const ref: SealedRef = {
      blobId: 'ZqPLyhQFhpDUXNht2DBNly7NjSfTbv-2Vxm94o0LeMI',
      sealWrappedKey: wrappedKeyFor(identity),
      nonce: blob.nonce,
      sha256: blob.sha256,
      approval: UNLOCK,
    };

    const decryptor = new SealDecryptor({
      config: CONFIG,
      key: agentKey(),
      suiClient: offlineClient(),
      fetch: aggregatorServing(ref.blobId, blob.ciphertext),
      recoverKey: async () => blob.key,
    });

    expect(new TextDecoder().decode(await decryptor.decrypt(ref))).toBe(
      new TextDecoder().decode(PLAINTEXT),
    );
  });

  it('THROWS when the SHA-256 does not match what was recorded at publish', async () => {
    const blob = sealBlob(PLAINTEXT);
    const ref: SealedRef = {
      blobId: 'blob-with-a-lying-hash',
      sealWrappedKey: wrappedKeyFor(identityForApproval(UNLOCK)),
      nonce: blob.nonce,
      sha256: 'f'.repeat(64),
      approval: UNLOCK,
    };

    const decryptor = new SealDecryptor({
      config: CONFIG,
      key: agentKey(),
      suiClient: offlineClient(),
      fetch: aggregatorServing(ref.blobId, blob.ciphertext),
      recoverKey: async () => blob.key,
    });

    await expect(decryptor.decrypt(ref)).rejects.toThrow(SealHashMismatchError);
    await expect(decryptor.decrypt(ref)).rejects.toThrow(/do not match the hash recorded at publish/);
    await expect(decryptor.decrypt(ref)).rejects.toThrow(new RegExp(blob.sha256));
  });

  it('fails on GCM’s tag before the hash is ever reached, for a single flipped byte', async () => {
    const blob = sealBlob(PLAINTEXT);
    const altered = Uint8Array.from(blob.ciphertext);
    altered[0] = (altered[0] ?? 0) ^ 0x01;

    const decryptor = new SealDecryptor({
      config: CONFIG,
      key: agentKey(),
      suiClient: offlineClient(),
      fetch: aggregatorServing('b', altered),
      recoverKey: async () => blob.key,
    });

    await expect(
      decryptor.decrypt({
        blobId: 'b',
        sealWrappedKey: wrappedKeyFor(identityForApproval(UNLOCK)),
        nonce: blob.nonce,
        sha256: blob.sha256,
        approval: UNLOCK,
      }),
      // Not a `SealHashMismatchError`: authentication is supposed to catch this first, and if it
      // ever stops doing so the failure mode becomes "plausible plaintext".
    ).rejects.not.toThrow(SealHashMismatchError);
  });

  it('refuses a wrong-length key or nonce rather than producing noise', () => {
    const blob = sealBlob(PLAINTEXT);
    expect(() =>
      openBlob({ ciphertext: blob.ciphertext, key: blob.key.subarray(0, 31), nonce: new Uint8Array(12) }),
    ).toThrow(/must be 32 bytes; this one is 31/);
    expect(() =>
      openBlob({ ciphertext: blob.ciphertext, key: blob.key, nonce: new Uint8Array(11) }),
    ).toThrow(/must be 12 bytes; this one is 11/);
    expect(() =>
      openBlob({ ciphertext: new Uint8Array(16), key: blob.key, nonce: new Uint8Array(12) }),
    ).toThrow(/too short to carry an authentication tag/);
  });

  it.skipIf(!existsSync(WEB_SEAL_OPEN))('still agrees with the layout blob-crypto.ts actually writes', () => {
    const source = readRepoFile('packages/web/lib/blob-crypto.ts');
    expect(source).toContain('const KEY_BYTES = 32;');
    expect(source).toContain('const NONCE_BYTES = 12;');
    expect(source).toContain('const TAG_BYTES = 16;');
    expect(source).toContain('Buffer.concat([body, tag])');
    expect(source).toContain("createCipheriv('aes-256-gcm'");
  });

  it('hashes the way the publisher hashed', () => {
    expect(sha256Hex(new Uint8Array())).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(sha256Hex(PLAINTEXT)).toBe(createHash('sha256').update(PLAINTEXT).digest('hex'));
  });
});

describe('refusing before a metered request is spent', () => {
  it('refuses an approval that does not cover the identity the content is sealed to', async () => {
    const sealedTo = unlockIdentity(VAULT, new TextEncoder().encode(OTHER_CONTENT_KEY));
    const recoverKey = vi.fn();

    const decryptor = new SealDecryptor({
      config: CONFIG,
      key: agentKey(),
      suiClient: offlineClient(),
      fetch: (() => {
        throw new Error('the aggregator must not be reached');
      }) as unknown as typeof fetch,
      recoverKey: recoverKey as never,
    });

    await expect(
      decryptor.decrypt({
        blobId: 'b',
        sealWrappedKey: wrappedKeyFor(sealedTo),
        nonce: Buffer.alloc(12).toString('base64'),
        sha256: '0'.repeat(64),
        approval: UNLOCK,
      }),
    ).rejects.toThrow(/does not open this blob/);

    expect(recoverKey).not.toHaveBeenCalled();
  });

  it('refuses a nonce that is not twelve bytes', async () => {
    const decryptor = new SealDecryptor({
      config: CONFIG,
      key: agentKey(),
      suiClient: offlineClient(),
      recoverKey: async () => new Uint8Array(32),
    });

    await expect(
      decryptor.decrypt({
        blobId: 'b',
        sealWrappedKey: wrappedKeyFor(identityForApproval(UNLOCK)),
        nonce: Buffer.alloc(8).toString('base64'),
        sha256: '0'.repeat(64),
        approval: UNLOCK,
      }),
    ).rejects.toThrow(/nonce must be 12 bytes; this one is 8/);
  });

  it('says so plainly when it has neither a committee nor a seam', async () => {
    const blob = sealBlob(new Uint8Array([1, 2, 3]));
    const decryptor = new SealDecryptor({
      config: CONFIG,
      key: agentKey(),
      suiClient: offlineClient(),
      fetch: aggregatorServing('b', blob.ciphertext),
    });

    await expect(
      decryptor.decrypt({
        blobId: 'b',
        sealWrappedKey: wrappedKeyFor(identityForApproval(UNLOCK)),
        nonce: blob.nonce,
        sha256: blob.sha256,
        approval: UNLOCK,
      }),
    ).rejects.toThrow(/no key server committee/);
  });
});

describe('the entitlement reference the SDK builds, now that it resolves', () => {
  it('builds straight from the SDK builder, with no workaround in the path', async () => {
    for (const approval of [UNLOCK, SUBSCRIPTION]) {
      const bytes = await approvalBytes(
        approvalTransactionFor(CONFIG, approval),
        strictOfflineClient(),
      );
      expect(bytes.length).toBeGreaterThan(0);
    }
  });

  it('is what the decryptor actually uses, so a real approval builds', async () => {
    const decryptor = new SealDecryptor({
      config: CONFIG,
      key: agentKey(),
      suiClient: strictOfflineClient(),
    });
    expect((await decryptor.approvalBytesFor(UNLOCK)).length).toBeGreaterThan(0);
    expect((await decryptor.approvalBytesFor(SUBSCRIPTION)).length).toBeGreaterThan(0);
  });

  it('carries no workaround for the SDK to outgrow', () => {
    const source = readRepoFile('packages/agent/src/seal-node.ts');
    expect(source).not.toContain('delete input.UnresolvedObject.mutable');
  });

  it('never marks the Unlock or Subscription reference mutable, which @mysten/sui refuses outright', () => {
    // `mutable` is a SHARED-object property. An Unlock and a Subscription are OWNED — soulbound to
    // their holder — and @mysten/sui rejects the combination in transactions/TransactionData.ts, so
    // setting it does not save a round trip, it fails the build. This asserted a comment saying so
    // until 2026-09-11; the fact belongs here, where it is enforced.
    expect(readRepoFile('packages/sdk/src/seal.ts')).not.toContain('mutable');
  });
});

describe('the key server committee this module builds', () => {
  it('sets verifyKeyServers explicitly, and to true', () => {
    const source = readRepoFile('packages/agent/src/seal-node.ts');
    expect(source).toContain('verifyKeyServers: true');
    expect(source).not.toContain('verifyKeyServers: false');
  });

  it('is still right to set it, because the shipped SDK default is false', () => {
    const shipped = readRepoFile('packages/agent/node_modules/@mysten/seal/dist/client.mjs');
    expect(shipped).toContain('verifyKeyServers = options.verifyKeyServers ?? false');
  });
});

describe('reading ciphertext from a public aggregator', () => {
  const blob = sealBlob(new TextEncoder().encode('two aggregators, one of them awake'));

  it('falls through to the next aggregator when one is down', async () => {
    const seen: string[] = [];
    const decryptor = new SealDecryptor({
      config: CONFIG,
      key: agentKey(),
      suiClient: offlineClient(),
      aggregators: ['https://down.example', 'https://up.example'],
      fetch: (async (input: Parameters<typeof fetch>[0]) => {
        seen.push(String(input));
        return String(input).startsWith('https://down')
          ? served(503)
          : served(200, blob.ciphertext);
      }) as typeof fetch,
      recoverKey: async () => blob.key,
    });

    const bytes = await decryptor.decrypt({
      blobId: 'B1',
      sealWrappedKey: wrappedKeyFor(identityForApproval(UNLOCK)),
      nonce: blob.nonce,
      sha256: blob.sha256,
      approval: UNLOCK,
    });

    expect(new TextDecoder().decode(bytes)).toBe('two aggregators, one of them awake');
    expect(seen).toEqual(['https://down.example/v1/blobs/B1', 'https://up.example/v1/blobs/B1']);
  });

  it('names every aggregator it tried when none of them answers', async () => {
    const decryptor = new SealDecryptor({
      config: CONFIG,
      key: agentKey(),
      suiClient: offlineClient(),
      aggregators: ['https://a.example', 'https://b.example'],
      fetch: (async () => served(404)) as typeof fetch,
      recoverKey: async () => blob.key,
    });

    await expect(
      decryptor.decrypt({
        blobId: 'B2',
        sealWrappedKey: wrappedKeyFor(identityForApproval(UNLOCK)),
        nonce: blob.nonce,
        sha256: blob.sha256,
        approval: UNLOCK,
      }),
    ).rejects.toThrow(/a\.example answered 404; https:\/\/b\.example answered 404/);
  });

  it.skipIf(!existsSync(WEB_SEAL_OPEN))('defaults to the same two public aggregators the browser opener uses', () => {
    expect([...PUBLIC_WALRUS_AGGREGATORS]).toEqual([
      'https://aggregator.walrus-mainnet.walrus.space',
      'https://walrus.globalstake.io',
    ]);
    const browser = readRepoFile('packages/web/components/SealedBody.tsx');
    for (const url of PUBLIC_WALRUS_AGGREGATORS) expect(browser).toContain(url);
  });

  it('refuses to be built with no aggregator at all', () => {
    expect(
      () =>
        new SealDecryptor({
          config: CONFIG,
          key: agentKey(),
          suiClient: offlineClient(),
          aggregators: [],
        }),
    ).toThrow(/at least one Walrus aggregator/);
  });
});

describe('the settling window after a purchase', () => {
  const blob = sealBlob(new TextEncoder().encode('bought a moment ago'));
  const ref = (): SealedRef => ({
    blobId: 'S1',
    sealWrappedKey: wrappedKeyFor(identityForApproval(UNLOCK)),
    nonce: blob.nonce,
    sha256: blob.sha256,
    approval: UNLOCK,
  });

  it('retries a refusal that is really the fullnode catching up', async () => {
    const slept: number[] = [];
    let attempts = 0;

    const decryptor = new SealDecryptor({
      config: CONFIG,
      key: agentKey(),
      suiClient: offlineClient(),
      fetch: aggregatorServing('S1', blob.ciphertext),
      sleep: async (ms) => {
        slept.push(ms);
      },
      recoverKey: async () => {
        attempts += 1;
        if (attempts < 3) throw new NoAccessError('User does not have access to one or more keys');
        return blob.key;
      },
    });

    expect(new TextDecoder().decode(await decryptor.decrypt(ref()))).toBe('bought a moment ago');
    expect(attempts).toBe(3);
    expect(slept).toEqual([1500, 3500]);
  });

  it('gives up after four attempts rather than spinning for ever', async () => {
    let attempts = 0;
    const decryptor = new SealDecryptor({
      config: CONFIG,
      key: agentKey(),
      suiClient: offlineClient(),
      fetch: aggregatorServing('S1', blob.ciphertext),
      sleep: async () => {},
      recoverKey: async () => {
        attempts += 1;
        throw new NoAccessError('User does not have access to one or more keys');
      },
    });

    await expect(decryptor.decrypt(ref())).rejects.toThrow(/does not have access/);
    expect(attempts).toBe(4);
  });

  it('does not retry a failure that is not a settling window', async () => {
    let attempts = 0;
    const decryptor = new SealDecryptor({
      config: CONFIG,
      key: agentKey(),
      suiClient: offlineClient(),
      fetch: aggregatorServing('S1', blob.ciphertext),
      sleep: async () => {},
      recoverKey: async () => {
        attempts += 1;
        throw new Error('InvalidCiphertextError: the encrypted object is malformed');
      },
    });

    await expect(decryptor.decrypt(ref())).rejects.toThrow(/malformed/);
    expect(attempts).toBe(1);
  });

  it('recognises the refusals a key server actually sends — by class, not by prose', () => {
    const justPaid = new InvalidParameterError(
      'PTB contains an invalid parameter, possibly a newly created object that the FN has not yet seen',
    );
    expect(justPaid.name).toBe('Error');
    expect(looksLikeSettling(justPaid)).toBe(true);
    expect(looksLikeSettling(new NoAccessError('User does not have access to one or more keys'))).toBe(true);
    expect(looksLikeSettling(new Error('fetch failed'))).toBe(true);
    expect(looksLikeSettling(new Error('NoAccess'))).toBe(false);
    expect(looksLikeSettling(new Error('Object does not yet exist'))).toBe(false);
    expect(looksLikeSettling(new Error('the network is on fire'))).toBe(false);
  });
});
