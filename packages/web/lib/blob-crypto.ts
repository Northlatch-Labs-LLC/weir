// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import 'server-only';

import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export interface EncryptedBlob {
  ciphertext: Uint8Array;
  key: string;
  nonce: string;
}

export function newBlobKey(): string {
  return randomBytes(KEY_BYTES).toString('base64');
}

function decodeKey(key: string): Buffer {
  const raw = Buffer.from(key, 'base64');
  if (raw.length !== KEY_BYTES) {
    throw new Error(`a blob key must be ${KEY_BYTES} bytes; this one is ${raw.length}`);
  }
  return raw;
}

export function encryptBlob(plaintext: Uint8Array, key: string = newBlobKey()): EncryptedBlob {
  if (plaintext.length === 0) throw new Error('refusing to encrypt an empty blob');

  const raw = decodeKey(key);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', raw, nonce);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    ciphertext: new Uint8Array(Buffer.concat([body, tag])),
    key,
    nonce: nonce.toString('base64'),
  };
}

export function decryptBlob(input: {
  ciphertext: Uint8Array;
  key: string;
  nonce: string;
}): Uint8Array {
  const raw = decodeKey(input.key);
  const nonce = Buffer.from(input.nonce, 'base64');
  if (nonce.length !== NONCE_BYTES) {
    throw new Error(`a blob nonce must be ${NONCE_BYTES} bytes; this one is ${nonce.length}`);
  }
  if (input.ciphertext.length <= TAG_BYTES) {
    throw new Error('this ciphertext is too short to carry an authentication tag');
  }

  const body = Buffer.from(input.ciphertext.slice(0, input.ciphertext.length - TAG_BYTES));
  const tag = Buffer.from(input.ciphertext.slice(input.ciphertext.length - TAG_BYTES));

  const decipher = createDecipheriv('aes-256-gcm', raw, nonce);
  decipher.setAuthTag(tag);
  return new Uint8Array(Buffer.concat([decipher.update(body), decipher.final()]));
}

export function sameKey(a: string, b: string): boolean {
  const left = Buffer.from(a, 'base64');
  const right = Buffer.from(b, 'base64');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
