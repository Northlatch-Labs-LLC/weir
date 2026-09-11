// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { unlockIdentity } from '@projectx-social/sdk';
import {
  MACHINE_EDITION_MARKER,
  humanContentKey,
  isMachineContentKey,
  machineContentKey,
  machineEditionIdentities,
  machineKeyProblem,
  sealBothEditions,
} from '@/lib/machine-pricing';

const VAULT = `0x${'a1'.repeat(32)}`;

const SEAL_UNLOCK = 0x00;

function hex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('the derivation rule', () => {
  it('appends the documented marker and nothing else', () => {
    const derived = machineContentKey('post-7');
    expect(derived.ok && derived.value).toBe('post-7#machine');
    expect(MACHINE_EDITION_MARKER).toBe('#machine');
  });

  it('is deterministic — the same human key always derives the same machine key', () => {
    const a = machineContentKey('sealed-on-walrus-001');
    const b = machineContentKey('  sealed-on-walrus-001  ');
    expect(a.ok && a.value).toBe('sealed-on-walrus-001#machine');
    expect(b.ok && b.value).toBe('sealed-on-walrus-001#machine');
  });

  it('is invertible: the machine key names the human key it came from', () => {
    const derived = machineContentKey('mistakes-setting-up');
    expect(derived.ok).toBe(true);
    if (!derived.ok) return;
    const back = humanContentKey(derived.value);
    expect(back.ok && back.value).toBe('mistakes-setting-up');
    expect(isMachineContentKey(derived.value)).toBe(true);
    expect(isMachineContentKey('mistakes-setting-up')).toBe(false);
  });

  it('refuses to derive twice — no `k#machine#machine` key that nobody priced', () => {
    const once = machineContentKey('post-7');
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    const twice = machineContentKey(once.value);
    expect(twice.ok).toBe(false);
  });
});

describe('why a machine key cannot collide with a creator-chosen key', () => {
  it('refuses the exact key that would collide with another post’s machine edition', () => {
    const machineOfPostSeven = machineContentKey('post-7');
    expect(machineOfPostSeven.ok).toBe(true);
    if (!machineOfPostSeven.ok) return;

    const problem = machineKeyProblem(machineOfPostSeven.value);
    expect(problem).not.toBeNull();
    expect(problem).toContain(MACHINE_EDITION_MARKER);
  });

  it('refuses the marker anywhere in the key, not only at the end', () => {
    expect(machineKeyProblem('a#machineb')).not.toBeNull();
    expect(machineKeyProblem('#machine')).not.toBeNull();
    expect(machineKeyProblem('post-7')).toBeNull();
  });

  it('refuses an empty key, which the contract refuses anyway with EEmptyName', () => {
    expect(machineKeyProblem('')).not.toBeNull();
    expect(machineKeyProblem('   ')).not.toBeNull();
  });

  it('is injective over every accepted key, so two posts never share one machine edition', () => {
    const accepted = [
      'post-7',
      'post-70',
      'post-7 ',
      'season-1',
      'season-1/episode-2',
      'a',
      'キー',
      'k#machin',
      'k#machin e',
      'sealed-on-walrus-001',
      'mistakes-setting-up',
    ];

    const derived = accepted.map((key) => {
      const reading = machineContentKey(key);
      expect(reading.ok).toBe(true);
      return reading.ok ? reading.value : '';
    });

    expect(new Set(derived).size).toBe(new Set(accepted.map((k) => k.trim())).size);

    for (const machine of derived) {
      expect(machineKeyProblem(machine)).not.toBeNull();
    }
  });
});

describe('the two Seal identities', () => {
  it('are the contract’s own layout: vault ‖ 0x00 ‖ key', () => {
    const identities = machineEditionIdentities(VAULT, 'post-7');
    expect(identities.ok).toBe(true);
    if (!identities.ok) return;

    const vaultBytes = Uint8Array.from(Buffer.from(VAULT.slice(2), 'hex'));
    const expectedHuman = new Uint8Array([
      ...vaultBytes,
      SEAL_UNLOCK,
      ...new TextEncoder().encode('post-7'),
    ]);
    const expectedMachine = new Uint8Array([
      ...vaultBytes,
      SEAL_UNLOCK,
      ...new TextEncoder().encode('post-7#machine'),
    ]);

    expect(hex(identities.value.human)).toBe(hex(expectedHuman));
    expect(hex(identities.value.machine)).toBe(hex(expectedMachine));
    expect(hex(identities.value.human)).toBe(hex(unlockIdentity(VAULT, new TextEncoder().encode('post-7'))));
  });

  it('differ, which is the only property the paywall needs', () => {
    const identities = machineEditionIdentities(VAULT, 'post-7');
    expect(identities.ok).toBe(true);
    if (!identities.ok) return;
    expect(hex(identities.value.human)).not.toBe(hex(identities.value.machine));
    expect(hex(identities.value.machine).startsWith(hex(identities.value.human))).toBe(true);
    expect(identities.value.machine.length - identities.value.human.length).toBe(
      MACHINE_EDITION_MARKER.length,
    );
  });

  it('never collide across two different posts on one vault', () => {
    const seven = machineEditionIdentities(VAULT, 'post-7');
    const seventy = machineEditionIdentities(VAULT, 'post-70');
    expect(seven.ok && seventy.ok).toBe(true);
    if (!seven.ok || !seventy.ok) return;

    const all = [seven.value.human, seven.value.machine, seventy.value.human, seventy.value.machine];
    expect(new Set(all.map(hex)).size).toBe(4);
  });

  it('rejects malformed hex, and — noted, not endorsed — pads a short vault id', () => {
    expect(machineEditionIdentities('not-an-id', 'post-7').ok).toBe(false);
    expect(machineEditionIdentities(`0x${'a1'.repeat(33)}`, 'post-7').ok).toBe(false);

    const padded = machineEditionIdentities('0x01', 'post-7');
    expect(padded.ok).toBe(true);
    if (!padded.ok) return;
    expect(hex(padded.value.human).startsWith('00'.repeat(31))).toBe(true);
  });
});

const MASTER = randomBytes(32);

interface Unlock {
  vault: string;
  contentKey: string;
}

function releaseKey(unlock: Unlock, requestedIdentity: Uint8Array): Buffer {
  const covered = unlockIdentity(unlock.vault, new TextEncoder().encode(unlock.contentKey));
  if (hex(covered) !== hex(requestedIdentity)) {
    throw new Error('EWrongIdentity');
  }
  return createHmac('sha256', MASTER).update(Buffer.from(requestedIdentity)).digest();
}

function encrypt(key: Buffer, plaintext: string): { nonce: Buffer; ciphertext: Buffer } {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const body = Buffer.concat([cipher.update(Buffer.from(plaintext, 'utf8')), cipher.final()]);
  return { nonce, ciphertext: Buffer.concat([body, cipher.getAuthTag()]) };
}

function decrypt(key: Buffer, nonce: Buffer, ciphertext: Buffer): string {
  const tag = ciphertext.subarray(ciphertext.length - 16);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext.subarray(0, ciphertext.length - 16)),
    decipher.final(),
  ]).toString('utf8');
}

describe('one Unlock cannot open the other edition', () => {
  const BODY = 'The same words, sold twice.';

  function publishBothEditions() {
    const identities = machineEditionIdentities(VAULT, 'post-7');
    if (!identities.ok) throw new Error('identities should derive');

    const humanUnlock: Unlock = { vault: VAULT, contentKey: 'post-7' };
    const machineUnlock: Unlock = { vault: VAULT, contentKey: 'post-7#machine' };

    return {
      identities: identities.value,
      humanUnlock,
      machineUnlock,
      human: encrypt(releaseKey(humanUnlock, identities.value.human), BODY),
      machine: encrypt(releaseKey(machineUnlock, identities.value.machine), BODY),
    };
  }

  it('seals the same plaintext under both identities and produces two ciphertexts', () => {
    const post = publishBothEditions();
    expect(post.human.ciphertext.equals(post.machine.ciphertext)).toBe(false);

    expect(decrypt(releaseKey(post.humanUnlock, post.identities.human), post.human.nonce, post.human.ciphertext)).toBe(BODY);
    expect(decrypt(releaseKey(post.machineUnlock, post.identities.machine), post.machine.nonce, post.machine.ciphertext)).toBe(BODY);
  });

  it('refuses a human Unlock the machine identity — the contract’s own assert', () => {
    const post = publishBothEditions();
    expect(() => releaseKey(post.humanUnlock, post.identities.machine)).toThrow('EWrongIdentity');
    expect(() => releaseKey(post.machineUnlock, post.identities.human)).toThrow('EWrongIdentity');
  });

  it('leaves a human buyer unable to open the machine edition even with the whole response', () => {
    const post = publishBothEditions();
    const humanKey = releaseKey(post.humanUnlock, post.identities.human);
    expect(() => decrypt(humanKey, post.machine.nonce, post.machine.ciphertext)).toThrow();
  });

  it('leaves a machine buyer unable to open the human edition', () => {
    const post = publishBothEditions();
    const machineKey = releaseKey(post.machineUnlock, post.identities.machine);
    expect(() => decrypt(machineKey, post.human.nonce, post.human.ciphertext)).toThrow();
  });

  it('gives an Unlock bought on another vault nothing, even under the same key', () => {
    const post = publishBothEditions();
    const elsewhere: Unlock = { vault: `0x${'b2'.repeat(32)}`, contentKey: 'post-7#machine' };
    expect(() => releaseKey(elsewhere, post.identities.machine)).toThrow('EWrongIdentity');
  });
});

describe('sealBothEditions', () => {
  it('passes the identical plaintext to both editions', async () => {
    const seen: { contentKey: string; body: string }[] = [];
    const result = await sealBothEditions(
      { humanKey: 'post-7', body: 'one body' },
      async (gate) => {
        seen.push(gate);
        return { ok: true, value: `blob:${gate.contentKey}`, observedAtMs: 0 };
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(seen.map((s) => s.contentKey)).toEqual(['post-7', 'post-7#machine']);
    expect(new Set(seen.map((s) => s.body)).size).toBe(1);
    expect(result.value.human.contentKey).toBe('post-7');
    expect(result.value.machine.contentKey).toBe('post-7#machine');
    expect(result.value.human.sealed).toBe('blob:post-7');
    expect(result.value.machine.sealed).toBe('blob:post-7#machine');
  });

  it('fails the whole reading when the second seal fails, so no half-published post is written', async () => {
    let calls = 0;
    const result = await sealBothEditions({ humanKey: 'post-7', body: 'one body' }, async () => {
      calls += 1;
      return calls === 1
        ? { ok: true as const, value: 'blob:human', observedAtMs: 0 }
        : { ok: false as const, failure: { kind: 'transport' as const, source: 'seal', detail: 'no committee' } };
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.detail).toBe('no committee');
  });

  it('never calls the sealer at all for a reserved key', async () => {
    let calls = 0;
    const result = await sealBothEditions({ humanKey: 'post-7#machine', body: 'x' }, async () => {
      calls += 1;
      return { ok: true, value: 'blob', observedAtMs: 0 };
    });

    expect(result.ok).toBe(false);
    expect(calls).toBe(0);
  });
});

const TABLE = `0x${'c3'.repeat(32)}`;

let priceOf: (contentKey: string) => { ok: true; value: bigint | null } | { ok: false; failure: { kind: string; source: string; detail: string } } =
  () => ({ ok: true, value: null });

let vaultReadable = true;

vi.mock('@/lib/rate-limit', () => ({
  simulateLimit: async () => null, rateLimit: () => null }));

vi.mock('@/lib/chain', () => ({
  siteConfig: () => ({ ok: true, value: { network: 'mainnet' }, observedAtMs: 0 }),
}));

vi.mock('@/lib/content', () => ({
  machineBodyState: async () => 'no-post',
}));

vi.mock('@projectx-social/sdk', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createClient: () => ({}),
  readCreatorVault: async () =>
    vaultReadable
      ? { ok: true, value: { contentPricesTableId: TABLE }, observedAtMs: 0 }
      : { ok: false, failure: { kind: 'transport', source: 'vault', detail: 'unreachable' } },
  readContentPrice: async (_client: unknown, _table: string, contentKey: string) =>
    priceOf(contentKey),
}));

const { GET } = await import('@/app/api/studio/content-price/route');

function ask(contentKey: string): Promise<Response> {
  return GET(
    new Request(
      `https://weir.social/api/studio/content-price?vaultId=${VAULT}` +
        `&contentKey=${encodeURIComponent(contentKey)}`,
    ),
  );
}

describe('GET /api/studio/content-price', () => {
  it('reports both editions from one call, told apart', async () => {
    vaultReadable = true;
    priceOf = (key) =>
      key === 'post-7'
        ? { ok: true, value: 10_000n }
        : key === 'post-7#machine'
          ? { ok: true, value: 250_000n }
          : { ok: true, value: null };

    const body = (await (await ask('post-7')).json()) as {
      priced: boolean;
      price: string | null;
      machine: { contentKey: string; state: string; price: string | null };
    };

    expect(body).toEqual({
      priced: true,
      price: '10000',
      machine: { contentKey: 'post-7#machine', state: 'priced', price: '250000' },
      machineBody: 'no-post',
    });
  });

  it('keeps the human edition’s fields exactly where every existing caller reads them', async () => {
    vaultReadable = true;
    priceOf = () => ({ ok: true, value: null });

    const body = (await (await ask('post-7')).json()) as { priced: boolean; price: string | null };
    expect(body.priced).toBe(false);
    expect(body.price).toBeNull();
  });

  it('calls an unpriced machine edition unpriced, and an unreadable one unreadable', async () => {
    vaultReadable = true;
    priceOf = (key) =>
      key === 'post-7'
        ? { ok: true, value: 10_000n }
        : { ok: false, failure: { kind: 'transport', source: 'price', detail: 'unreachable' } };

    const failed = (await (await ask('post-7')).json()) as {
      price: string | null;
      machine: { state: string; price: string | null };
    };
    expect(failed.price).toBe('10000');
    expect(failed.machine).toEqual({
      contentKey: 'post-7#machine',
      state: 'unreadable',
      price: null,
    });

    priceOf = (key) => ({ ok: true, value: key === 'post-7' ? 10_000n : null });
    const unpriced = (await (await ask('post-7')).json()) as { machine: { state: string } };
    expect(unpriced.machine.state).toBe('unpriced');
  });

  it('refuses a creator-supplied key carrying the reserved marker', async () => {
    vaultReadable = true;
    priceOf = () => ({ ok: true, value: null });

    const response = await ask('post-7#machine');
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string; kind: string };
    expect(body.kind).toBe('reserved');
    expect(body.error).toContain(MACHINE_EDITION_MARKER);
  });

  it('still 503s when the vault itself cannot be read', async () => {
    vaultReadable = false;
    priceOf = () => ({ ok: true, value: null });
    expect((await ask('post-7')).status).toBe(503);
  });
});
