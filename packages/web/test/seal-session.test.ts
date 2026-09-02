// @vitest-environment node
// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/*
  One Seal session per signer per tab.

  Mutations predicted: drop the cache lookup in `sessionKeyFor` → "five cards, one signature"
  red (five signatures); cache a rejected creation → "a failed creation is retried" red.
*/
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

let created = 0;
let failNext = false;
vi.mock('@mysten/seal', () => ({
  SessionKey: {
    create: async (input: { address: string; packageId: string; ttlMin: number }) => {
      created += 1;
      if (failNext) {
        failNext = false;
        throw new Error('the package object could not be read');
      }
      return {
        address: input.address,
        getPersonalMessage: () => new Uint8Array([1, 2, 3]),
        setPersonalMessageSignature: async () => undefined,
      };
    },
  },
}));

const { sessionKeyFor, forgetSealSessions } = await import('../lib/seal-session');

const signerFor = (address: string) => {
  let signatures = 0;
  return {
    signer: { address, signPersonalMessage: async () => { signatures += 1; return 'sig'; } },
    count: () => signatures,
  };
};
const PKG = `0x${'e5'.repeat(32)}`;
const client = {} as never;

beforeEach(() => {
  forgetSealSessions();
  created = 0;
  failNext = false;
});

describe('sessionKeyFor', () => {
  it('five cards, one signature: the same signer and package share one session', async () => {
    const { signer, count } = signerFor(`0x${'a'.repeat(64)}`);
    const keys = await Promise.all(
      Array.from({ length: 5 }, () => sessionKeyFor({ signer, packageId: PKG, ttlMin: 10, suiClient: client })),
    );
    expect(new Set(keys).size).toBe(1);
    expect(created).toBe(1);
    expect(count()).toBe(1);
  });

  it('a different signer gets its own session', async () => {
    const a = signerFor(`0x${'a'.repeat(64)}`);
    const b = signerFor(`0x${'b'.repeat(64)}`);
    await sessionKeyFor({ signer: a.signer, packageId: PKG, ttlMin: 10, suiClient: client });
    await sessionKeyFor({ signer: b.signer, packageId: PKG, ttlMin: 10, suiClient: client });
    expect(created).toBe(2);
  });

  it('renews shortly before the TTL, not after', async () => {
    const { signer, count } = signerFor(`0x${'a'.repeat(64)}`);
    const t0 = 1_000_000;
    await sessionKeyFor({ signer, packageId: PKG, ttlMin: 10, suiClient: client, now: t0 });
    await sessionKeyFor({ signer, packageId: PKG, ttlMin: 10, suiClient: client, now: t0 + 8 * 60_000 });
    expect(count()).toBe(1);
    await sessionKeyFor({ signer, packageId: PKG, ttlMin: 10, suiClient: client, now: t0 + 9 * 60_000 + 1 });
    expect(count()).toBe(2);
  });

  it('a failed creation is retried by the next card, not inherited', async () => {
    const { signer } = signerFor(`0x${'a'.repeat(64)}`);
    failNext = true;
    await expect(sessionKeyFor({ signer, packageId: PKG, ttlMin: 10, suiClient: client })).rejects.toThrow(/package object/);
    const key = await sessionKeyFor({ signer, packageId: PKG, ttlMin: 10, suiClient: client });
    expect(key).toBeDefined();
    expect(created).toBe(2);
  });
});

describe('the sealed cards', () => {
  const src = (name: string) => readFileSync(join(process.cwd(), 'components', name), 'utf8');

  it('SealedBody no longer carries the regex that never matched settling, and reads isSettling', () => {
    const body = src('SealedBody.tsx');
    expect(body).not.toMatch(/not yet exist/);
    expect(body).not.toMatch(/function looksLikeSettling/);
    expect(body).toMatch(/isSettling\(/);
  });

  it('both cards take their session from the shared helper, never from SessionKey.create directly', () => {
    for (const name of ['SealedBody.tsx', 'SealedMedia.tsx']) {
      const text = src(name);
      expect(text, name).toMatch(/sessionKeyFor\(/);
      expect(text, name).not.toMatch(/SessionKey\.create\(/);
    }
  });
});
