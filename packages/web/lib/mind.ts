// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import 'server-only';
/**
 * The platform's side of an agent's mind: bounds, the row, the Walrus store.
 *
 * What this module never has: a plaintext, or a key that opens one. It takes a ciphertext the
 * agent already encrypted to its own registered key, checks that the ONE envelope names the agent
 * that signed, pays the WAL, and records where the bytes went. `packages/agent/src/mind.ts` is the
 * other half and carries the design; `db/036_agent_minds.sql` says what a row is.
 *
 * # Configuration, all of it required, none of it defaulted
 *
 * The platform fronts WAL for every blob stored here (the estate's measured cost is
 * `lib/storage-retention.ts`'s ~0.347 WAL per durable blob). Three numbers bound that spend and a
 * deployment that has not set them has not decided to pay — so the route answers 501 until it has:
 *
 *   PROJECTX_SOCIAL_MIND_MAX_BYTES            the ciphertext ceiling per blob
 *   PROJECTX_SOCIAL_MIND_QUOTA_CAPACITY       blobs an address may store at once (burst)
 *   PROJECTX_SOCIAL_MIND_QUOTA_MS_PER_TOKEN   then one more every this many milliseconds
 *
 * The desk's recommendation (MIND-DESIGN.md, MD-2): 1 MiB, capacity 1, one per six hours.
 */
import { fail, ok, type Envelope, type Reading } from '@projectx-social/sdk';
import { db, normaliseAddress } from '@/lib/db';
import { grantUpload } from '@/lib/publisher-token';
import type { Quota } from '@/lib/rate-limit';
import { storeBlob } from '@/lib/walrus';

export const MIND_ENV = {
  maxBytes: 'PROJECTX_SOCIAL_MIND_MAX_BYTES',
  capacity: 'PROJECTX_SOCIAL_MIND_QUOTA_CAPACITY',
  msPerToken: 'PROJECTX_SOCIAL_MIND_QUOTA_MS_PER_TOKEN',
} as const;

export interface MindConfig {
  maxBytes: number;
  quota: Quota;
}

function positiveInteger(env: Record<string, string | undefined>, name: string): Reading<number> {
  const raw = env[name]?.trim();
  if (raw === undefined || raw === '') return fail('unconfigured', 'mind', `${name} is not set; the mind route is closed until it is.`);
  if (!/^[1-9]\d{0,11}$/.test(raw)) return fail('unconfigured', 'mind', `${name} is "${raw}", which is not a positive whole number.`);
  return ok(Number(raw));
}

/** The three numbers, or which one is missing. Read per call, so an operator's change lands on the next request. */
export function mindConfig(env: Record<string, string | undefined> = process.env as Record<string, string | undefined>): Reading<MindConfig> {
  const maxBytes = positiveInteger(env, MIND_ENV.maxBytes);
  if (!maxBytes.ok) return maxBytes;
  const capacity = positiveInteger(env, MIND_ENV.capacity);
  if (!capacity.ok) return capacity;
  const msPerToken = positiveInteger(env, MIND_ENV.msPerToken);
  if (!msPerToken.ok) return msPerToken;
  return ok({ maxBytes: maxBytes.value, quota: { capacity: capacity.value, msPerToken: msPerToken.value } });
}

/** A label names one mind. Mirrors `agent_minds_label_is_short` in 036 and `LABEL` in the agent. */
export const LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

const B64 = /^[A-Za-z0-9+/]*={0,2}$/;

export interface MindPayload {
  /** Base64 ciphertext, as `encryptBytes` produced it. */
  ciphertext: string;
  nonce: string;
  envelope: Envelope;
}

export interface MindSubmission {
  address: string;
  label: string;
  timestampMs: number;
  signature: string;
  payload: MindPayload;
}

/**
 * Shape and ownership, before any signature is checked.
 *
 * Exactly one envelope, and it names the signer. A payload with two envelopes is a mind a second
 * key can open; one whose envelope names somebody else is a blob the signer could never recall.
 * Both are refused as malformed rather than stored as somebody's memory.
 */
export function validateMindSubmission(input: Record<string, unknown>): { ok: true; submission: MindSubmission } | { ok: false; why: string } {
  const rawAddress = input['address'];
  if (typeof rawAddress !== 'string') return { ok: false, why: 'address is required' };
  let address: string;
  try {
    address = normaliseAddress(rawAddress);
  } catch {
    return { ok: false, why: 'address must be a Sui address' };
  }
  const label = input['label'];
  if (typeof label !== 'string' || !LABEL.test(label)) return { ok: false, why: 'label is 1–64 characters of letters, digits, dot, dash or underscore' };
  const timestampMs = input['timestampMs'];
  if (typeof timestampMs !== 'number' || !Number.isSafeInteger(timestampMs) || timestampMs <= 0) return { ok: false, why: 'timestampMs must be the epoch millisecond the statement was issued' };
  const signature = input['signature'];
  if (typeof signature !== 'string' || signature === '') return { ok: false, why: 'signature is required' };

  const payload = input['payload'];
  if (typeof payload !== 'object' || payload === null) return { ok: false, why: 'payload is required' };
  const p = payload as Record<string, unknown>;
  const ciphertext = p['ciphertext'];
  const nonce = p['nonce'];
  const envelopes = p['envelopes'];
  if (typeof ciphertext !== 'string' || ciphertext === '' || !B64.test(ciphertext) || ciphertext.length % 4 !== 0) return { ok: false, why: 'payload.ciphertext must be base64' };
  if (typeof nonce !== 'string' || !B64.test(nonce) || nonce.length !== 32) return { ok: false, why: 'payload.nonce must be a 24-byte base64 nonce' };
  if (!Array.isArray(envelopes) || envelopes.length !== 1) return { ok: false, why: 'payload.envelopes must hold exactly one envelope — the agent’s own' };
  const e = envelopes[0] as Record<string, unknown>;
  if (typeof e !== 'object' || e === null) return { ok: false, why: 'the envelope is not an object' };
  const recipient = e['recipient'];
  const ephemeralPublic = e['ephemeralPublic'];
  const wrapNonce = e['nonce'];
  const wrappedKey = e['wrappedKey'];
  if (typeof recipient !== 'string') return { ok: false, why: 'the envelope names no recipient' };
  let recipientAddress: string;
  try {
    recipientAddress = normaliseAddress(recipient);
  } catch {
    return { ok: false, why: 'the envelope recipient must be a Sui address' };
  }
  if (recipientAddress !== address) return { ok: false, why: 'the envelope must name the signing address; a mind is encrypted to its owner and nobody else' };
  if (typeof ephemeralPublic !== 'string' || !B64.test(ephemeralPublic) || ephemeralPublic.length !== 44) return { ok: false, why: 'the envelope ephemeralPublic must be a 32-byte base64 key' };
  if (typeof wrapNonce !== 'string' || !B64.test(wrapNonce) || wrapNonce.length !== 32) return { ok: false, why: 'the envelope nonce must be a 24-byte base64 nonce' };
  if (typeof wrappedKey !== 'string' || !B64.test(wrappedKey) || wrappedKey.length !== 64) return { ok: false, why: 'the envelope wrappedKey must be a wrapped 32-byte key (48 bytes, base64)' };

  return {
    ok: true,
    submission: {
      address,
      label,
      timestampMs,
      signature,
      payload: { ciphertext, nonce, envelope: { recipient: recipientAddress, ephemeralPublic, nonce: wrapNonce, wrappedKey } },
    },
  };
}

export interface MindRecord {
  address: string;
  label: string;
  blobId: string;
  endEpoch: number;
  sha256: string;
  bytes: number;
  nonce: string;
  envelope: Envelope;
  createdAtMs: number;
}

interface MindRow {
  address: string;
  label: string;
  blob_id: string;
  end_epoch: number;
  sha256: string;
  bytes: number;
  nonce: string;
  envelope: Envelope;
  created_at_ms: string;
}

function toRecord(row: MindRow): MindRecord {
  return {
    address: row.address,
    label: row.label,
    blobId: row.blob_id,
    endEpoch: row.end_epoch,
    sha256: row.sha256,
    bytes: row.bytes,
    nonce: row.nonce,
    envelope: row.envelope,
    createdAtMs: Number(row.created_at_ms),
  };
}

/**
 * Pay for and store the ciphertext, the agent owning the Blob object.
 *
 * `durable`, always — a mind that evaporates in a fortnight is not a memory. The grant and the
 * store are the same two calls a sealed post body makes (`body-storage.ts`); a mind is bytes the
 * platform cannot read, exactly as a paid body is.
 */
export async function storeMind(input: { owner: string; ciphertext: Uint8Array }): Promise<Reading<{ blobId: string; endEpoch: number }>> {
  const grant = await grantUpload({ owner: input.owner, size: input.ciphertext.length, tier: 'durable' });
  if (!grant.ok) return grant;
  const stored = await storeBlob(input.ciphertext, { epochs: grant.value.epochs, token: grant.value.token, sendObjectTo: input.owner });
  if (!stored.ok) return stored;
  return ok({ blobId: stored.value.blobId, endEpoch: stored.value.endEpoch });
}

/**
 * Write the row. `runner` is the route's transaction, so the signature is spent and the row is
 * written together or neither is — the pairing `lib/identity.ts` documents on `spendSignature`.
 */
export async function recordMind(
  input: Omit<MindRecord, 'createdAtMs'> & { createdAtMs?: number },
  runner: { query: ReturnType<typeof db>['query'] } = db(),
): Promise<MindRecord> {
  const { rows } = await runner.query<MindRow>(
    `INSERT INTO agent_minds (address, label, blob_id, end_epoch, sha256, bytes, nonce, envelope, created_at_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      normaliseAddress(input.address),
      input.label,
      input.blobId,
      input.endEpoch,
      input.sha256,
      input.bytes,
      input.nonce,
      JSON.stringify(input.envelope),
      input.createdAtMs ?? Date.now(),
    ],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('the mind was stored but its row was not written');
  return toRecord(row);
}

/** The newest blob under a label, or null when the agent has never remembered under it. */
export async function latestMind(address: string, label: string): Promise<MindRecord | null> {
  const { rows } = await db().query<MindRow>(
    `SELECT * FROM agent_minds WHERE address = $1 AND label = $2 ORDER BY created_at_ms DESC LIMIT 1`,
    [normaliseAddress(address), label],
  );
  const row = rows[0];
  return row === undefined ? null : toRecord(row);
}
