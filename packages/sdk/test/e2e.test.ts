// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { describe, expect, it } from 'vitest';
import {
  ciphertextDigest,
  decrypt,
  deriveSecret,
  encrypt,
  fromB64,
  publicFromSecret,
  toB64,
  KEY_STATEMENT,
  encryptBytes,
  decryptBytes,
} from '../src/e2e.js';

const ALICE = '0x1111111111111111111111111111111111111111111111111111111111111111';
const BOB = '0x2222222222222222222222222222222222222222222222222222222222222222';
const MALLORY = '0x3333333333333333333333333333333333333333333333333333333333333333';

const aliceSecret = deriveSecret('signature-from-alices-wallet');
const bobSecret = deriveSecret('signature-from-bobs-wallet');
const mallorySecret = deriveSecret('signature-from-mallorys-wallet');

const alice = { address: ALICE, x25519Public: toB64(publicFromSecret(aliceSecret)) };
const bob = { address: BOB, x25519Public: toB64(publicFromSecret(bobSecret)) };

describe('key derivation', () => {
  it('is deterministic — the same signature always yields the same key', () => {
    expect(toB64(deriveSecret('same'))).toBe(toB64(deriveSecret('same')));
  });

  it('separates different signatures', () => {
    expect(toB64(deriveSecret('a'))).not.toBe(toB64(deriveSecret('b')));
  });

  it('does not return the signature itself', () => {
    const signature = 'AQIDBAUGBwgJ';
    expect(toB64(deriveSecret(signature))).not.toBe(signature);
  });

  it('matches a fixed vector', () => {
    expect(toB64(deriveSecret('fixed-test-vector'))).toBe(
      'oU7iA0h5lITW5s3BK81wqyZ5mN+y3CTG2iVJcr0bTCU=',
    );
    expect(toB64(publicFromSecret(deriveSecret('fixed-test-vector')))).toBe(
      'rLqk2TCInGem0NosKjF1QtOlj7BUQSr4Fk/B1F6ZYnw=',
    );
  });

  it('produces a 32-byte secret and a 32-byte public key', () => {
    expect(aliceSecret.length).toBe(32);
    expect(publicFromSecret(aliceSecret).length).toBe(32);
  });

  it('signs a statement that names its own purpose and version', () => {
    expect(KEY_STATEMENT).toContain('derive my message encryption key');
    expect(KEY_STATEMENT).toContain('version: 1');
  });
});

describe('base64', () => {
  it('round-trips arbitrary bytes, including 0x00 and 0xff', () => {
    const bytes = new Uint8Array(256).map((_, i) => i);
    expect([...fromB64(toB64(bytes))]).toEqual([...bytes]);
  });
});

describe('encrypt and decrypt', () => {
  it('lets the recipient read it', () => {
    const payload = encrypt('the vault harvests at epoch end', [alice, bob]);
    expect(decrypt(payload, BOB, bobSecret)).toBe('the vault harvests at epoch end');
  });

  it('lets the sender read their own message', () => {
    const payload = encrypt('mine to read', [alice, bob]);
    expect(decrypt(payload, ALICE, aliceSecret)).toBe('mine to read');
  });

  it('does not put the plaintext anywhere in the payload', () => {
    const payload = encrypt('SECRETWORD', [alice, bob]);
    expect(JSON.stringify(payload)).not.toContain('SECRETWORD');
  });

  it('gives a different ciphertext for the same plaintext each time', () => {
    const a = encrypt('identical', [alice, bob]);
    const b = encrypt('identical', [alice, bob]);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.nonce).not.toBe(b.nonce);
  });

  it('uses a fresh ephemeral key for every envelope', () => {
    const first = encrypt('one', [alice, bob]);
    const second = encrypt('two', [alice, bob]);
    const ephemerals = [...first.envelopes, ...second.envelopes].map((e) => e.ephemeralPublic);
    expect(new Set(ephemerals).size).toBe(ephemerals.length);
  });

  it('survives multi-byte characters', () => {
    const text = 'yield → creator · 290 bps · 日本語 · 🔐';
    const payload = encrypt(text, [alice, bob]);
    expect(decrypt(payload, BOB, bobSecret)).toBe(text);
  });

  it('refuses to encrypt to nobody', () => {
    expect(() => encrypt('x', [])).toThrow();
  });
});

describe('what must not work', () => {
  it('does not let a third party read it, even with a valid key of their own', () => {
    const payload = encrypt('not for mallory', [alice, bob]);
    expect(decrypt(payload, MALLORY, mallorySecret)).toBeNull();
  });

  it('does not let a third party read it by claiming to be the recipient', () => {
    const payload = encrypt('not for mallory', [alice, bob]);
    expect(decrypt(payload, BOB, mallorySecret)).toBeNull();
  });

  it('rejects a tampered ciphertext rather than returning garbage', () => {
    const payload = encrypt('the original words', [alice, bob]);
    const bytes = fromB64(payload.ciphertext);
    bytes.set([(bytes[0] ?? 0) ^ 0x01], 0);
    const tampered = { ...payload, ciphertext: toB64(bytes) };
    expect(decrypt(tampered, BOB, bobSecret)).toBeNull();
  });

  it('rejects a tampered wrapped key', () => {
    const payload = encrypt('the original words', [alice, bob]);
    const envelopes = payload.envelopes.map((e) => {
      if (e.recipient !== BOB) return e;
      const bytes = fromB64(e.wrappedKey);
      bytes.set([(bytes[0] ?? 0) ^ 0x01], 0);
      return { ...e, wrappedKey: toB64(bytes) };
    });
    expect(decrypt({ ...payload, envelopes }, BOB, bobSecret)).toBeNull();
  });

  it('rejects an envelope re-labelled for someone else', () => {
    const payload = encrypt('for alice and bob', [alice, bob]);
    const stolen = payload.envelopes.find((e) => e.recipient === ALICE);
    expect(stolen).toBeDefined();
    const relabelled = { ...payload, envelopes: [{ ...stolen!, recipient: MALLORY }] };
    expect(decrypt(relabelled, MALLORY, mallorySecret)).toBeNull();
  });

  it('returns null rather than throwing when there is no envelope at all', () => {
    const payload = encrypt('for bob only', [bob]);
    expect(decrypt(payload, ALICE, aliceSecret)).toBeNull();
  });

  it('matches the recipient case-insensitively', () => {
    const payload = encrypt('case', [alice, bob]);
    expect(decrypt(payload, BOB.toUpperCase().replace('0X', '0x'), bobSecret)).toBe('case');
  });
});

describe('ciphertextDigest', () => {
  it('is 64 lower-case hex characters', () => {
    expect(ciphertextDigest('anything')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('agrees with the published SHA-256 of the empty string', () => {
    expect(ciphertextDigest('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('changes when a single byte of the ciphertext changes', () => {
    expect(ciphertextDigest('abc')).not.toBe(ciphertextDigest('abd'));
  });
});

describe('bytes, not text (the agent mind path)', () => {
  const blob = new Uint8Array(1024).map((_, i) => (i * 7 + 3) & 0xff);

  it('round-trips arbitrary bytes for a participant, byte for byte', () => {
    const payload = encryptBytes(blob, [alice]);
    const opened = decryptBytes(payload, ALICE, aliceSecret);
    expect(opened).not.toBeNull();
    expect(Array.from(opened!)).toEqual(Array.from(blob));
  });

  it('a stranger cannot open it, and a flipped ciphertext byte is refused rather than returned', () => {
    const payload = encryptBytes(blob, [alice]);
    expect(decryptBytes(payload, MALLORY, mallorySecret)).toBeNull();
    const raw = fromB64(payload.ciphertext);
    raw[10] = raw[10]! ^ 0x01;
    expect(decryptBytes({ ...payload, ciphertext: toB64(raw) }, ALICE, aliceSecret)).toBeNull();
  });

  it('the string view is the byte view over UTF-8, so a message and a mind share one scheme', () => {
    const payload = encrypt('héllo — 🚀', [alice]);
    expect(new TextDecoder().decode(decryptBytes(payload, ALICE, aliceSecret)!)).toBe('héllo — 🚀');
  });
});
