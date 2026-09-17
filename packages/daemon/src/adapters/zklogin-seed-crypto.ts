/**
 * C-01 Fix: ZKLOGIN_SEED encryption at rest
 *
 * Encrypts the raw zkLogin seed with a user-controlled recovery phrase.
 * Key derivation: PBKDF2-SHA256 (310 000 iterations, 32-byte key).
 * Cipher: AES-256-GCM (authenticated encryption — detects tampering).
 *
 * Storage layout (all hex-encoded, safe for JSON/DB TEXT):
 *   { version, salt, iv, tag, ciphertext }
 *
 * Integration points in weir-backend:
 *   - REGISTRATION: call encryptSeed(rawSeed, recoveryPhrase) → store blob
 *   - LOGIN: load blob, call decryptSeed(blob, recoveryPhrase) → raw seed
 *   - RECOVERY: same decryptSeed with phrase from recovery UI
 */

import { createCipheriv, createDecipheriv, pbkdf2Sync, randomBytes } from "crypto";

const ALGO = "aes-256-gcm";
const KEY_LEN = 32; // bytes
const IV_LEN = 12; // GCM standard
const TAG_LEN = 16; // GCM auth tag
const ITERATIONS = 310_000; // NIST 2024 minimum for PBKDF2-SHA256
const SALT_LEN = 32;
const VERSION = 1;

export interface EncryptedSeedBlob {
  version: number;
  salt: string; // hex
  iv: string; // hex
  tag: string; // hex
  ciphertext: string; // hex
}

function deriveKey(phrase: string, salt: Buffer): Buffer {
  return pbkdf2Sync(phrase, salt, ITERATIONS, KEY_LEN, "sha256");
}

export function encryptSeed(rawSeed: string, recoveryPhrase: string): EncryptedSeedBlob {
  if (!rawSeed || rawSeed.length === 0) throw new Error("rawSeed must not be empty");
  if (!recoveryPhrase || recoveryPhrase.length < 8)
    throw new Error("recoveryPhrase must be at least 8 characters");

  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = deriveKey(recoveryPhrase, salt);

  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(rawSeed, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    version: VERSION,
    salt: salt.toString("hex"),
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    ciphertext: ciphertext.toString("hex"),
  };
}

export function decryptSeed(blob: EncryptedSeedBlob, recoveryPhrase: string): string {
  if (blob.version !== VERSION)
    throw new Error(`Unsupported blob version: ${blob.version}`);

  const salt = Buffer.from(blob.salt, "hex");
  const iv = Buffer.from(blob.iv, "hex");
  const tag = Buffer.from(blob.tag, "hex");
  const ciphertext = Buffer.from(blob.ciphertext, "hex");

  if (tag.length !== TAG_LEN) throw new Error("Corrupt blob: bad tag length");

  const key = deriveKey(recoveryPhrase, salt);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);

  try {
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf8");
  } catch {
    // GCM auth failure = wrong phrase or tampered blob
    throw new Error("Decryption failed: wrong recovery phrase or corrupt blob");
  }
}
