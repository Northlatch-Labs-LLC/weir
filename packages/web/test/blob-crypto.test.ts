// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { describe, expect, it } from 'vitest';
import { decryptBlob, encryptBlob, newBlobKey, sameKey } from '@/lib/blob-crypto';

const PLAINTEXT = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

describe('a blob survives the round trip', () => {
  it('returns exactly the bytes it was given', () => {
    const sealed = encryptBlob(PLAINTEXT);
    expect(decryptBlob(sealed)).toEqual(PLAINTEXT);
  });

  it('does not leave the plaintext visible in the ciphertext', () => {
    const sealed = encryptBlob(PLAINTEXT);
    expect(Buffer.from(sealed.ciphertext).includes(Buffer.from(PLAINTEXT))).toBe(false);
    expect(sealed.ciphertext.slice(0, 4)).not.toEqual(PLAINTEXT.slice(0, 4));
  });

  it('carries the tag, so the ciphertext is longer than the input', () => {
    expect(encryptBlob(PLAINTEXT).ciphertext.length).toBe(PLAINTEXT.length + 16);
  });

  it('handles a blob larger than one cipher block', () => {
    const big = new Uint8Array(64 * 1024).map((_, i) => i % 251);
    const sealed = encryptBlob(big);
    expect(decryptBlob(sealed)).toEqual(big);
  });
});

describe('nothing opens it but the right key', () => {
  it('refuses a different key', () => {
    const sealed = encryptBlob(PLAINTEXT);
    expect(() => decryptBlob({ ...sealed, key: newBlobKey() })).toThrow();
  });

  it('refuses a different nonce', () => {
    const sealed = encryptBlob(PLAINTEXT);
    const other = encryptBlob(PLAINTEXT);
    expect(() => decryptBlob({ ...sealed, nonce: other.nonce })).toThrow();
  });

  it('refuses a single altered byte', () => {
    const sealed = encryptBlob(PLAINTEXT);
    const tampered = new Uint8Array(sealed.ciphertext);
    tampered[0] = (tampered[0] ?? 0) ^ 0x01;
    expect(() => decryptBlob({ ...sealed, ciphertext: tampered })).toThrow();
  });

  it('refuses a stripped authentication tag', () => {
    const sealed = encryptBlob(PLAINTEXT);
    const truncated = sealed.ciphertext.slice(0, sealed.ciphertext.length - 16);
    expect(() => decryptBlob({ ...sealed, ciphertext: truncated })).toThrow();
  });
});

describe('key and nonce discipline', () => {
  it('never reuses a nonce across two encryptions', () => {
    const key = newBlobKey();
    const nonces = new Set(Array.from({ length: 200 }, () => encryptBlob(PLAINTEXT, key).nonce));
    expect(nonces.size).toBe(200);
  });

  it('issues a distinct key every time', () => {
    const keys = new Set(Array.from({ length: 200 }, () => newBlobKey()));
    expect(keys.size).toBe(200);
  });

  it('produces a 32-byte key and a 12-byte nonce', () => {
    const sealed = encryptBlob(PLAINTEXT);
    expect(Buffer.from(sealed.key, 'base64').length).toBe(32);
    expect(Buffer.from(sealed.nonce, 'base64').length).toBe(12);
  });

  it('rejects a key of the wrong length rather than padding it', () => {
    const short = Buffer.alloc(16).toString('base64');
    expect(() => encryptBlob(PLAINTEXT, short)).toThrow(/32 bytes/);
    expect(() =>
      decryptBlob({ ciphertext: PLAINTEXT, key: short, nonce: 'AAAAAAAAAAAAAAAA' }),
    ).toThrow(/32 bytes/);
  });

  it('rejects a nonce of the wrong length', () => {
    const sealed = encryptBlob(PLAINTEXT);
    expect(() => decryptBlob({ ...sealed, nonce: Buffer.alloc(8).toString('base64') })).toThrow(
      /12 bytes/,
    );
  });

  it('refuses to encrypt nothing', () => {
    expect(() => encryptBlob(new Uint8Array())).toThrow(/empty/);
  });

  it('refuses a ciphertext too short to hold a tag', () => {
    const key = newBlobKey();
    const nonce = encryptBlob(PLAINTEXT, key).nonce;
    expect(() => decryptBlob({ ciphertext: new Uint8Array(4), key, nonce })).toThrow(/too short/);
  });
});

describe('sameKey', () => {
  it('matches a key with itself and nothing else', () => {
    const key = newBlobKey();
    expect(sameKey(key, key)).toBe(true);
    expect(sameKey(key, newBlobKey())).toBe(false);
  });

  it('is false rather than throwing on a length mismatch', () => {
    expect(sameKey(newBlobKey(), Buffer.alloc(16).toString('base64'))).toBe(false);
  });
});
