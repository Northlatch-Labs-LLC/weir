// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * Blob encryption — the thing that makes a public storage network safe to put paid media on.
 *
 * # What these tests are actually defending
 *
 * A Walrus blob is readable by anyone holding its id, from any aggregator, with no check. The
 * entitlement gate this product already has is correct and is bypassed entirely by that fact: it
 * guards our door, and the bytes would also be behind somebody else's. Encryption is what makes the
 * second door open onto noise.
 *
 * So the failures worth pinning are not "does AES work" — Node's implementation is not on trial.
 * They are the integration mistakes that produce a blob which *looks* encrypted and is not, or one
 * that opens when it should have refused: a key silently padded to length, a tag not checked, a
 * nonce reused across blobs, an empty input sailing through.
 */

import { describe, expect, it } from 'vitest';
import { decryptBlob, encryptBlob, newBlobKey, sameKey } from '@/lib/blob-crypto';

const PLAINTEXT = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

describe('a blob survives the round trip', () => {
  it('returns exactly the bytes it was given', () => {
    const sealed = encryptBlob(PLAINTEXT);
    expect(decryptBlob(sealed)).toEqual(PLAINTEXT);
  });

  it('does not leave the plaintext visible in the ciphertext', () => {
    /*
      The check that catches a store path wired to the wrong variable. A "ciphertext" that still
      begins with the PNG magic number is plaintext with extra steps, and it would look entirely
      normal in a database column and on an aggregator.
    */
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
    // GCM's whole reason for being here. Bytes come back from storage nobody in this project
    // operates, and a silent corruption that decodes to *something* is the worst outcome.
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
    /*
      A repeated nonce under a repeated key breaks GCM catastrophically — it leaks the XOR of the
      two plaintexts and the authentication subkey. Both are random per call here, so this asserts
      the property rather than a counter's correctness.
    */
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
    // The silent-weakening case: a short key stretched to fit encrypts at a strength nobody chose,
    // and every blob written with it would look exactly like a correct one.
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
    // An empty upload is already refused upstream; this makes a zero-length blob unrepresentable
    // rather than storing an object that costs WAL and holds no content.
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
