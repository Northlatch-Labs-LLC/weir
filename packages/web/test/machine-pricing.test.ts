// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

/**
 * A second price on the same post, for machines — proven against the deployed contract's own rules.
 *
 * # What these tests are actually asserting, and what they cannot
 *
 * They cannot ask a Seal key server for a key: the mainnet committee is permissioned, and a unit
 * suite that reaches the network fails for reasons unrelated to the code. So the key servers are
 * modelled, and the model is written to be *honest about the two things that decide the outcome*:
 *
 * 1. `entitlement::seal_approve_unlock` asserts `id == unlock_identity(unlock.vault,
 *    unlock.content_key)`. An `Unlock` therefore obtains exactly one identity's key and no other.
 *    {@link releaseKey} is that assert, transcribed.
 * 2. A Seal key is a deterministic function of the identity — that is what identity-based
 *    encryption means, and it is why `lib/seal.ts` can seal without ever holding a reader's
 *    signature. {@link releaseKey} models it as an HMAC over the identity bytes under a secret the
 *    test holds, which reproduces the only property the paywall depends on: **different identity,
 *    unrelated key.**
 *
 * The identities themselves are NOT modelled. They come from `@projectx-social/sdk`'s
 * `unlockIdentity`, which `packages/sdk/test/seal-identity.test.ts` and
 * `sui-contracts/tests/seal_tests.move` hold to the same byte vectors in both languages. And the
 * layout is re-derived by hand below, from `entitlement.move`, so that a change to either
 * implementation fails here too rather than quietly agreeing with itself.
 *
 * The AES layer is real: `node:crypto`, AES-256-GCM, the same construction `lib/blob-crypto.ts`
 * uses. A cross-edition open fails on GCM's authentication tag, which is a measurement, not a
 * model.
 *
 * # Zero Move changes, and the evidence for it
 *
 * Nothing in this suite needs a contract that does not exist today. `set_content_price` takes a
 * `vector<u8>` with no charset and no length ceiling, `content_prices` is a `Table` keyed by it,
 * and the live `@atlas` vault `0xa1f80da9…` carries two priced keys in one such table right now
 * (`sealed-on-walrus-001` at 10000, `mistakes-setting-up` at 250000 — read from mainnet, not
 * assumed). A machine edition is one more row of exactly that kind.
 */

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

/** Synthetic, and shaped like a real vault id: 32 bytes of hex. */
const VAULT = `0x${'a1'.repeat(32)}`;

/** `entitlement.move`: `const SEAL_UNLOCK: u8 = 0;` */
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
    // Trimmed the same way the pricing routes trim, so the composer and the server derive one key
    // rather than two that differ by a space nobody can see.
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
  /*
    The collision, stated as the scenario it would be in production.

    A creator prices `post-7` and its machine edition `post-7#machine`. A second post is then keyed
    `post-7#machine` by hand. Both are one `Table` entry on one vault, so they are not two prices —
    they are one, and one purchase opens two things that were sold separately. The `Unlock` objects
    already minted cannot be withdrawn, so this is not a state anything can recover from.
  */
  it('refuses the exact key that would collide with another post’s machine edition', () => {
    const machineOfPostSeven = machineContentKey('post-7');
    expect(machineOfPostSeven.ok).toBe(true);
    if (!machineOfPostSeven.ok) return;

    // The collision candidate, offered as a HUMAN key. The door refuses it.
    const problem = machineKeyProblem(machineOfPostSeven.value);
    expect(problem).not.toBeNull();
    expect(problem).toContain(MACHINE_EDITION_MARKER);
  });

  it('refuses the marker anywhere in the key, not only at the end', () => {
    // `a#machineb` would pass a suffix-only check, and then the set of keys carrying the marker
    // would be larger than the set of derived keys — which is the invariant `isMachineContentKey`
    // reports on.
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

    // Injective: as many distinct machine keys as there are distinct human keys.
    expect(new Set(derived).size).toBe(new Set(accepted.map((k) => k.trim())).size);

    // Disjoint: no machine key is a key the system would ever accept from a creator, so a machine
    // edition can never be some other post's human edition.
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

    // Rebuilt by hand from `entitlement.move`, not from the SDK, so that a change to the SDK's
    // derivation fails here rather than passing by agreeing with itself.
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
    // And they differ by exactly the marker — the machine identity is the human one extended.
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

  /*
    A finding, recorded where it was measured rather than in prose nobody reads.

    `packages/sdk/src/seal.ts` says of a short vault id: "Refused rather than padded. A short id
    that silently becomes a valid-looking 32 bytes is an identity nobody chose." It does not do
    that. `normalizeSuiObjectId` LEFT-PADS, so `unlockIdentity('0x01', …)` returns a perfectly
    well-formed identity beginning with 31 zero bytes, and `unlockIdentity('', …)` returns the zero
    vault. Only genuinely malformed hex throws. Asserted here as it behaves, with the discrepancy
    named — a test written to the comment instead of to the code would fail for the wrong reason,
    and the SDK is not this module's to change.
  */
  it('rejects malformed hex, and — noted, not endorsed — pads a short vault id', () => {
    expect(machineEditionIdentities('not-an-id', 'post-7').ok).toBe(false);
    expect(machineEditionIdentities(`0x${'a1'.repeat(33)}`, 'post-7').ok).toBe(false);

    const padded = machineEditionIdentities('0x01', 'post-7');
    expect(padded.ok).toBe(true);
    if (!padded.ok) return;
    expect(hex(padded.value.human).startsWith('00'.repeat(31))).toBe(true);
  });
});

/*
  The key server committee, modelled at exactly the fidelity that decides this question.

  `MASTER` stands in for the committee's secret. `releaseKey` is `seal_approve_unlock` plus IBE
  determinism: it will only ever produce a key for the identity the presented `Unlock` covers, and
  the key is a deterministic, unrelated-per-identity function of the identity bytes.
*/
const MASTER = randomBytes(32);

interface Unlock {
  vault: string;
  /** `entitlement::Unlock.content_key` — the key the buyer actually paid for. */
  contentKey: string;
}

function releaseKey(unlock: Unlock, requestedIdentity: Uint8Array): Buffer {
  const covered = unlockIdentity(unlock.vault, new TextEncoder().encode(unlock.contentKey));
  // `assert!(id == unlock_identity(unlock.vault, unlock.content_key), EWrongIdentity);`
  if (hex(covered) !== hex(requestedIdentity)) {
    throw new Error('EWrongIdentity');
  }
  return createHmac('sha256', MASTER).update(Buffer.from(requestedIdentity)).digest();
}

/** AES-256-GCM, the construction `lib/blob-crypto.ts` uses. */
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

  /** Both editions of one post, sealed the way `storeBody` seals: same plaintext, two identities. */
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

    // Each edition opens for its own buyer, so this is a paywall and not simply a broken key.
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
    // Everything a human buyer can obtain: the key their own Unlock releases, plus the machine
    // edition's public ciphertext and nonce — both of which are on a public Walrus blob anyway.
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

/*
  The route, with the chain mocked and everything below the handler real.

  `readContentPrice` is answered per key, which is the whole point: the endpoint must ask about two
  keys and report them apart. A mock that answered one value for both would agree with a handler
  that read the human key twice.
*/
const TABLE = `0x${'c3'.repeat(32)}`;

/** What the mocked chain says each key costs. Reassigned per test. */
let priceOf: (contentKey: string) => { ok: true; value: bigint | null } | { ok: false; failure: { kind: string; source: string; detail: string } } =
  () => ({ ok: true, value: null });

/** Whether the vault itself reads. */
let vaultReadable = true;

vi.mock('@/lib/rate-limit', () => ({
  // The simulate-class guard: durable ceiling plus the per-process Map. Allowed here, because
  // these files are about what the route decides and not about how often it may be asked.
  simulateLimit: async () => null, rateLimit: () => null }));

vi.mock('@/lib/chain', () => ({
  siteConfig: () => ({ ok: true, value: { network: 'mainnet' }, observedAtMs: 0 }),
}));

// The deliverability lookup is a database read; the real one, against real rows, is exercised in
// `test/machine-edition.test.ts`. Here it answers "nothing published yet" so the pricing shape can
// be pinned without a database.
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
      // Added with migration 034: whether a machine body was sealed for this post. This suite
      // stubs no post row, so the only truthful answers are the two that mean "no row / could
      // not read", never `sealed`.
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
    // The human price still arrives. A second read that failed must not take away a first that did
    // not — and `unreadable` must never be rendered as free.
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
