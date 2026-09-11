// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import { describe, expect, it } from 'vitest';
import {
  ABORT_CLASSIFICATION,
  MAINNET_RECORD,
  MACHINE_EDITION_MARKER,
  buildSetContentPrice,
  createAgent,
  findCreatorCap,
  generateAgentKey,
  loadAgentManifest,
  type Agent,
} from '../src/index.js';

const FULL_ENV = {
  PROJECTX_SOCIAL_NETWORK: 'mainnet',
  PROJECTX_SOCIAL_GRPC_URL: 'https://fullnode.mainnet.sui.io:443',
  PROJECTX_SOCIAL_PACKAGE_ID: MAINNET_RECORD.packageId,
  PROJECTX_SOCIAL_LATEST_PACKAGE_ID: MAINNET_RECORD.latestPackageId,
  PROJECTX_SOCIAL_PLATFORM_ID: MAINNET_RECORD.platformId,
  PROJECTX_SOCIAL_REGISTRY_ID: MAINNET_RECORD.registryId,
  PROJECTX_SOCIAL_AGENT_COIN_TYPE: MAINNET_RECORD.usdcType,
  PROJECTX_SOCIAL_AGENT_BASE_URL: 'https://weir.social',
};

const hex = (c: string) => `0x${c.repeat(64)}`;
const VAULT = hex('a');
const OTHER_VAULT = hex('b');
const CAP_FOR_VAULT = hex('c');
const CAP_FOR_OTHER = hex('d');

function capBytes(capId: string, vaultId: string): Uint8Array {
  const out = new Uint8Array(64);
  out.set(Buffer.from(capId.slice(2), 'hex'), 0);
  out.set(Buffer.from(vaultId.slice(2), 'hex'), 32);
  return out;
}

type Seen = { calls: string[] };

function fakeClient(caps: Array<{ objectId: string; content: Uint8Array }>): { client: SuiGrpcClient; seen: Seen } {
  const seen: Seen = { calls: [] };
  const fake = {
    listOwnedObjects: async (input: { owner: string; type: string }) => {
      seen.calls.push(`listOwnedObjects ${input.type.split('::').slice(1).join('::')}`);
      return { objects: caps };
    },
    getObject: async (input: { objectId: string }) => {
      seen.calls.push(`getObject ${input.objectId}`);
      throw new Error('not expected in these tests');
    },
  };
  return { client: fake as unknown as SuiGrpcClient, seen };
}

function keyed(client: SuiGrpcClient): Agent {
  const { key } = generateAgentKey();
  const made = createAgent({ keypair: key, config: FULL_ENV, client });
  if (!made.ok) throw new Error(made.failure.detail);
  return made.value;
}

const manifest = (() => {
  const m = loadAgentManifest(FULL_ENV);
  if (!m.ok) throw new Error(m.failure.detail);
  return m.value;
})();

describe('the transaction', () => {
  it('is one MoveCall at creator::set_content_price with the vault, the cap, the key bytes and the price', async () => {
    const tx = buildSetContentPrice(manifest.config, {
      coinType: manifest.coinType,
      vaultId: VAULT,
      capId: CAP_FOR_VAULT,
      contentKey: 'chapter-1',
      price: 250_000n,
    });
    const data = tx.getData();
    expect(data.commands).toHaveLength(1);
    const call = data.commands[0]!.MoveCall!;
    expect(`${call.package}::${call.module}::${call.function}`).toBe(`${manifest.config.latestPackageId}::creator::set_content_price`);
    expect(call.typeArguments).toEqual([manifest.coinType]);
    expect(call.arguments).toHaveLength(4);
    const inputs = data.inputs as Array<{ UnresolvedObject?: { objectId: string }; Pure?: { bytes: string } }>;
    const objectIds = inputs.filter((i) => i.UnresolvedObject !== undefined).map((i) => i.UnresolvedObject!.objectId);
    expect(objectIds).toEqual([VAULT, CAP_FOR_VAULT]);
    const pure = inputs.filter((i) => i.Pure !== undefined).map((i) => Buffer.from(i.Pure!.bytes, 'base64'));
    expect(pure).toHaveLength(2);
    expect(Array.from(pure[0]!)).toEqual([9, ...Array.from(new TextEncoder().encode('chapter-1'))]);
    expect(pure[1]!.readBigUInt64LE(0)).toBe(250_000n);
  });
});

describe('the cap', () => {
  it('is the one whose vault field matches, among two the agent owns', async () => {
    const { client } = fakeClient([
      { objectId: CAP_FOR_OTHER, content: capBytes(CAP_FOR_OTHER, OTHER_VAULT) },
      { objectId: CAP_FOR_VAULT, content: capBytes(CAP_FOR_VAULT, VAULT) },
    ]);
    const found = await findCreatorCap(client, manifest.config, hex('e'), VAULT);
    expect(found).toEqual({ ok: true, value: CAP_FOR_VAULT, observedAtMs: expect.any(Number) });
  });

  it('refuses an object that is not 64 bytes, rather than reading a vault id out of nothing', async () => {
    const { client } = fakeClient([{ objectId: CAP_FOR_VAULT, content: new Uint8Array(32) }]);
    const found = await findCreatorCap(client, manifest.config, hex('e'), VAULT);
    expect(found.ok).toBe(false);
    if (!found.ok) expect(found.failure.kind).toBe('malformed');
  });

  it('is not-found when no cap governs this vault — a cap for another vault is not a substitute', async () => {
    const { client } = fakeClient([{ objectId: CAP_FOR_OTHER, content: capBytes(CAP_FOR_OTHER, OTHER_VAULT) }]);
    const found = await findCreatorCap(client, manifest.config, hex('e'), VAULT);
    expect(found.ok).toBe(false);
    if (!found.ok) expect(found.failure.kind).toBe('not-found');
  });
});

describe('priceContent refuses before it reads', () => {
  const cases: Array<[string, { vaultId: string; contentKey: string; price: bigint }]> = [
    ['an empty key', { vaultId: VAULT, contentKey: '  ', price: 1n }],
    ['a zero price', { vaultId: VAULT, contentKey: 'chapter-1', price: 0n }],
    ['a negative price', { vaultId: VAULT, contentKey: 'chapter-1', price: -5n }],
    [`a key containing the reserved marker ${MACHINE_EDITION_MARKER}`, { vaultId: VAULT, contentKey: `chapter-1${MACHINE_EDITION_MARKER}`, price: 1n }],
  ];
  for (const [what, input] of cases) {
    it(`${what} — with zero calls to the chain`, async () => {
      const { client, seen } = fakeClient([{ objectId: CAP_FOR_VAULT, content: capBytes(CAP_FOR_VAULT, VAULT) }]);
      const result = await keyed(client).priceContent(input);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.failure.kind).toBe('malformed');
      expect(seen.calls).toEqual([]);
    });
  }

  it('reads the cap only after the arguments passed, and stops there when none governs the vault', async () => {
    const { client, seen } = fakeClient([]);
    const result = await keyed(client).priceContent({ vaultId: VAULT, contentKey: 'chapter-1', price: 1n });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe('not-found');
    expect(seen.calls).toEqual(['listOwnedObjects creator::CreatorCap']);
  });
});

describe('the marker and the abort', () => {
  const webPricing = join(process.cwd(), '..', 'web', 'lib', 'machine-pricing.ts');
  it.skipIf(!existsSync(webPricing))('uses the same reserved marker the web does, read from its source', () => {
    const src = readFileSync(webPricing, 'utf8');
    const m = /export const MACHINE_EDITION_MARKER = '([^']+)';/.exec(src);
    expect(m?.[1]).toBe(MACHINE_EDITION_MARKER);
  });

  it('classifies EZeroPrice (10), EEmptyName (16) and EWrongVault (2) as permanent — never a retry', () => {
    const creator = (ABORT_CLASSIFICATION as Record<string, Record<number, string>>)['creator']!;
    expect(creator[10]).toBe('permanent');
    expect(creator[16]).toBe('permanent');
    expect(creator[2]).toBe('permanent');
  });

  it('is not on the read-only surface', () => {
    const made = createAgent({ keypair: null, config: FULL_ENV });
    expect(made.ok && 'priceContent' in made.value).toBe(false);
  });
});

describe('the machine edition', () => {
  const fetchAnswering = (body: unknown, ok = true) =>
    (async () => ({ ok, status: ok ? 200 : 503, json: async () => body })) as unknown as NonNullable<Parameters<typeof createAgent>[0]['fetchImpl']>;

  function keyedWithFetch(client: SuiGrpcClient, fetchImpl: NonNullable<Parameters<typeof createAgent>[0]['fetchImpl']>): Agent {
    const { key } = generateAgentKey();
    const made = createAgent({ keypair: key, config: FULL_ENV, client, fetchImpl });
    if (!made.ok) throw new Error(made.failure.detail);
    return made.value;
  }

  it('still refuses a hand-typed marker under edition machine, with zero calls to the chain', async () => {
    const { client, seen } = fakeClient([]);
    const result = await keyed(client).priceContent({ vaultId: VAULT, contentKey: `chapter-1${MACHINE_EDITION_MARKER}`, edition: 'machine', price: 250_000n });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.detail).toContain('reserved');
    expect(seen.calls).toEqual([]);
  });

  it('derives the machine key and reaches the cap read under it', async () => {
    const { client, seen } = fakeClient([{ objectId: CAP_FOR_OTHER, content: capBytes(CAP_FOR_OTHER, OTHER_VAULT) }]);
    const result = await keyed(client).priceContent({ vaultId: VAULT, contentKey: 'chapter-1', edition: 'machine', price: 250_000n });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.failure.kind).toBe('not-found');
      expect(result.failure.source).toContain(`chapter-1${MACHINE_EDITION_MARKER}`);
    }
    expect(seen.calls).toEqual(['listOwnedObjects creator::CreatorCap']);
  });

  for (const state of ['no-post', 'sealed', 'absent'] as const) {
    it(`reads ${state} from the deployment, asking with the human key`, async () => {
      const asked: string[] = [];
      const fetchImpl = (async (url: string) => {
        asked.push(url);
        return { ok: true, status: 200, json: async () => ({ priced: false, price: null, machineBody: state }) };
      }) as unknown as NonNullable<Parameters<typeof createAgent>[0]['fetchImpl']>;
      const result = await keyedWithFetch(fakeClient([]).client, fetchImpl).machineBody({ vaultId: VAULT, contentKey: ' chapter-1 ' });
      expect(result.ok && result.value).toBe(state);
      expect(asked).toHaveLength(1);
      const url = new URL(asked[0]!);
      expect(url.pathname).toBe('/api/studio/content-price');
      expect(url.searchParams.get('contentKey')).toBe('chapter-1');
      expect(url.searchParams.get('vaultId')).toBe(VAULT);
    });
  }

  it('does not read an absent field as sealed', async () => {
    const result = await keyedWithFetch(fakeClient([]).client, fetchAnswering({ priced: false, price: null })).machineBody({ vaultId: VAULT, contentKey: 'chapter-1' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.kind).toBe('malformed');
  });

  it('reports an unreachable deployment as a failure, not as a state', async () => {
    const result = await keyedWithFetch(fakeClient([]).client, fetchAnswering({ error: 'down' }, false)).machineBody({ vaultId: VAULT, contentKey: 'chapter-1' });
    expect(result.ok).toBe(false);
  });
});
