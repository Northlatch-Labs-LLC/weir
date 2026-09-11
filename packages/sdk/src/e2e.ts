// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256, sha512 } from '@noble/hashes/sha2.js';

export const KEY_STATEMENT =
  'ProjectX Social — derive my message encryption key\n' +
  'version: 1\n' +
  'This signature never leaves your device and authorises nothing.';

const DOMAIN = 'projectx-e2e-v1';
const NONCE_BYTES = 24;

export interface Envelope {
  recipient: string;
  ephemeralPublic: string;
  nonce: string;
  wrappedKey: string;
}

export interface EncryptedPayload {
  ciphertext: string;
  nonce: string;
  envelopes: Envelope[];
}

export function toB64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

export function fromB64(text: string): Uint8Array {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i += 1) out[i] = s.charCodeAt(i);
  return out;
}

export function ciphertextDigest(ciphertext: string): string {
  return Array.from(sha256(new TextEncoder().encode(ciphertext)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function deriveSecret(signature: string): Uint8Array {
  const material = new TextEncoder().encode(`${DOMAIN}:${signature}`);
  return sha512(material).slice(0, 32);
}

export function publicFromSecret(secret: Uint8Array): Uint8Array {
  return x25519.getPublicKey(secret);
}

function kek(shared: Uint8Array, ephemeralPublic: Uint8Array, recipient: Uint8Array): Uint8Array {
  const info = new Uint8Array(ephemeralPublic.length + recipient.length);
  info.set(ephemeralPublic, 0);
  info.set(recipient, ephemeralPublic.length);
  return hkdf(sha256, shared, new TextEncoder().encode(DOMAIN), info, 32);
}

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

export function encrypt(
  plaintext: string,
  participants: ReadonlyArray<{ address: string; x25519Public: string }>,
): EncryptedPayload {
  return encryptBytes(new TextEncoder().encode(plaintext), participants);
}

export function encryptBytes(
  plaintext: Uint8Array,
  participants: ReadonlyArray<{ address: string; x25519Public: string }>,
): EncryptedPayload {
  if (participants.length === 0) throw new Error('no participants to encrypt to');

  const messageKey = randomBytes(32);
  const nonce = randomBytes(NONCE_BYTES);
  const ciphertext = xchacha20poly1305(messageKey, nonce).encrypt(plaintext);

  const envelopes = participants.map(({ address, x25519Public }) => {
    const recipientPublic = fromB64(x25519Public);
    const ephemeralSecret = randomBytes(32);
    const ephemeralPublic = x25519.getPublicKey(ephemeralSecret);
    const shared = x25519.getSharedSecret(ephemeralSecret, recipientPublic);
    const wrapNonce = randomBytes(NONCE_BYTES);
    const wrapped = xchacha20poly1305(
      kek(shared, ephemeralPublic, recipientPublic),
      wrapNonce,
    ).encrypt(messageKey);

    return {
      recipient: address,
      ephemeralPublic: toB64(ephemeralPublic),
      nonce: toB64(wrapNonce),
      wrappedKey: toB64(wrapped),
    };
  });

  return { ciphertext: toB64(ciphertext), nonce: toB64(nonce), envelopes };
}

export function decrypt(
  payload: EncryptedPayload,
  viewer: string,
  secret: Uint8Array,
): string | null {
  const bytes = decryptBytes(payload, viewer, secret);
  return bytes === null ? null : new TextDecoder().decode(bytes);
}

export function decryptBytes(
  payload: EncryptedPayload,
  viewer: string,
  secret: Uint8Array,
): Uint8Array | null {
  const envelope = payload.envelopes.find(
    (e) => e.recipient.toLowerCase() === viewer.toLowerCase(),
  );
  if (envelope === undefined) return null;

  try {
    const ephemeralPublic = fromB64(envelope.ephemeralPublic);
    const shared = x25519.getSharedSecret(secret, ephemeralPublic);
    const messageKey = xchacha20poly1305(
      kek(shared, ephemeralPublic, publicFromSecret(secret)),
      fromB64(envelope.nonce),
    ).decrypt(fromB64(envelope.wrappedKey));

    return xchacha20poly1305(messageKey, fromB64(payload.nonce)).decrypt(
      fromB64(payload.ciphertext),
    );
  } catch {
    return null;
  }
}
