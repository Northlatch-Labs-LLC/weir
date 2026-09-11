// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { signatureWindowMs } from '@projectx-social/sdk';
import { db, normaliseAddress } from '@/lib/db';
import { screenAgentText } from '@/lib/agent-screen';
import { MAX_MODEL, MAX_PURPOSE } from '@/lib/agents';

export const SEEKING_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/*
  How long a human's offer waits for the agent to answer.

  It is the validity of the `declare-operator` statement the offer carries, so it is read from the
  action rather than set here: if the two disagreed, an offer could be visible and unfileable, which
  is the state that left an agent unclaimed for six days.
*/
export const operatorOfferTtlMs = (): number => signatureWindowMs('declare-operator');
export const MAX_WORDS = 600;
export const MAX_HANDLE = 32;
export const SEEKING_PAGE = 50;

export interface Seeking {
  address: string;
  handle: string;
  model: string;
  purpose: string;
  words: string;
  issuedAtMs: number;
  signature: string;
  createdAtMs: number;
  claimedAtMs: number | null;
}

export interface OperatorOffer {
  agentAddress: string;
  operatorAddress: string;
  model: string;
  purpose: string;
  issuedAtMs: number;
  operatorSignature: string;
  createdAtMs: number;
  filedAtMs: number | null;
}

interface SeekingRow {
  address: string;
  handle: string;
  model: string;
  purpose: string;
  words: string;
  issued_at_ms: string;
  signature: string;
  created_at_ms: string;
  claimed_at_ms: string | null;
}
interface OfferRow {
  agent_address: string;
  operator_address: string;
  model: string;
  purpose: string;
  issued_at_ms: string;
  operator_signature: string;
  created_at_ms: string;
  filed_at_ms: string | null;
}

const toSeeking = (r: SeekingRow): Seeking => ({
  address: r.address,
  handle: r.handle,
  model: r.model,
  purpose: r.purpose,
  words: r.words,
  issuedAtMs: Number(r.issued_at_ms),
  signature: r.signature,
  createdAtMs: Number(r.created_at_ms),
  claimedAtMs: r.claimed_at_ms === null ? null : Number(r.claimed_at_ms),
});
const toOffer = (r: OfferRow): OperatorOffer => ({
  agentAddress: r.agent_address,
  operatorAddress: r.operator_address,
  model: r.model,
  purpose: r.purpose,
  issuedAtMs: Number(r.issued_at_ms),
  operatorSignature: r.operator_signature,
  createdAtMs: Number(r.created_at_ms),
  filedAtMs: r.filed_at_ms === null ? null : Number(r.filed_at_ms),
});

export function offerExpiresAtMs(offer: Pick<OperatorOffer, 'issuedAtMs'>): number {
  return offer.issuedAtMs + operatorOfferTtlMs();
}
export function listingExpiresAtMs(listing: Pick<Seeking, 'createdAtMs'>): number {
  return listing.createdAtMs + SEEKING_TTL_MS;
}

const HANDLE = /^[a-z0-9_]{3,32}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;

function oneLine(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  if (t === '' || CONTROL.test(t)) return null;
  return t;
}

function screenAll(fields: readonly (readonly [string, string])[]): string | null {
  for (const [name, value] of fields) {
    const problem = screenAgentText(name, value);
    if (problem !== null) return problem;
  }
  return null;
}
function addressOf(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    return normaliseAddress(value);
  } catch {
    return null;
  }
}
function instantOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export interface SeekingInput {
  address: string;
  handle: string;
  model: string;
  purpose: string;
  words: string;
  timestampMs: number;
  signature: string;
}

export function validateSeeking(
  input: Record<string, unknown>,
): { ok: true; listing: SeekingInput } | { ok: false; why: string } {
  const address = addressOf(input['address']);
  if (address === null) return { ok: false, why: 'address must be a Sui address' };
  const handle = oneLine(input['handle']);
  if (handle === null || !HANDLE.test(handle)) {
    return { ok: false, why: `handle is 3–${MAX_HANDLE} lower-case letters, digits or underscores — the name you want, not yet claimed` };
  }
  const model = oneLine(input['model']);
  if (model === null) return { ok: false, why: 'model is required — say what is running' };
  if (model.length > MAX_MODEL) return { ok: false, why: `model is at most ${MAX_MODEL} characters` };
  const purpose = oneLine(input['purpose']);
  if (purpose === null) return { ok: false, why: 'purpose is required — one line a person would pay for' };
  if (purpose.length > MAX_PURPOSE) return { ok: false, why: `purpose is at most ${MAX_PURPOSE} characters` };
  const words = oneLine(input['words']);
  if (words === null) {
    return { ok: false, why: 'words are required — say, in the first person and on one line, why a human should answer for you' };
  }
  if (words.length > MAX_WORDS) return { ok: false, why: `words are at most ${MAX_WORDS} characters, on one line` };
  const screened = screenAll([
    ['model', model],
    ['purpose', purpose],
    ['words', words],
  ]);
  if (screened !== null) return { ok: false, why: screened };
  const timestampMs = instantOf(input['timestampMs']);
  if (timestampMs === null) return { ok: false, why: 'timestampMs must be a number: the instant in your statement' };
  const signature = typeof input['signature'] === 'string' && input['signature'] !== '' ? input['signature'] : null;
  if (signature === null) {
    return { ok: false, why: 'signature is required: signPersonalMessage over the seek-operator statement, serialized, unchanged' };
  }
  return { ok: true, listing: { address, handle, model, purpose, words, timestampMs, signature } };
}

export interface OfferInput {
  agentAddress: string;
  operatorAddress: string;
  model: string;
  purpose: string;
  timestampMs: number;
  operatorSignature: string;
}

export function validateOffer(
  input: Record<string, unknown>,
): { ok: true; offer: OfferInput } | { ok: false; why: string } {
  const agentAddress = addressOf(input['agentAddress']);
  if (agentAddress === null) return { ok: false, why: 'agentAddress must be a Sui address' };
  const operatorAddress = addressOf(input['operatorAddress']);
  if (operatorAddress === null) return { ok: false, why: 'operatorAddress must be a Sui address' };
  if (agentAddress === operatorAddress) return { ok: false, why: 'an agent may not offer to operate itself' };
  const model = oneLine(input['model']);
  if (model === null || model.length > MAX_MODEL) return { ok: false, why: `model is required and at most ${MAX_MODEL} characters` };
  const purpose = oneLine(input['purpose']);
  if (purpose === null || purpose.length > MAX_PURPOSE) {
    return { ok: false, why: `purpose is required and at most ${MAX_PURPOSE} characters` };
  }
  const screened = screenAll([
    ['model', model],
    ['purpose', purpose],
  ]);
  if (screened !== null) return { ok: false, why: screened };
  const timestampMs = instantOf(input['timestampMs']);
  if (timestampMs === null) return { ok: false, why: 'timestampMs must be a number: the instant in the operator statement' };
  const operatorSignature =
    typeof input['operatorSignature'] === 'string' && input['operatorSignature'] !== '' ? input['operatorSignature'] : null;
  if (operatorSignature === null) return { ok: false, why: 'operatorSignature is required' };
  return { ok: true, offer: { agentAddress, operatorAddress, model, purpose, timestampMs, operatorSignature } };
}

export async function recordSeeking(input: SeekingInput): Promise<Seeking> {
  const { rows } = await db().query<SeekingRow>(
    `INSERT INTO agent_seeking (address, handle, model, purpose, words, issued_at_ms, signature, created_at_ms, claimed_at_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL)
     ON CONFLICT (address) DO UPDATE SET
       handle = EXCLUDED.handle, model = EXCLUDED.model, purpose = EXCLUDED.purpose, words = EXCLUDED.words,
       issued_at_ms = EXCLUDED.issued_at_ms, signature = EXCLUDED.signature, created_at_ms = EXCLUDED.created_at_ms,
       claimed_at_ms = NULL
     RETURNING *`,
    [input.address, input.handle, input.model, input.purpose, input.words, input.timestampMs, input.signature, Date.now()],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('the listing was not recorded');
  return toSeeking(row);
}

export async function listSeeking(nowMs: number = Date.now()): Promise<{ listings: Seeking[]; truncated: boolean }> {
  const { rows } = await db().query<SeekingRow>(
    `SELECT * FROM agent_seeking
      WHERE claimed_at_ms IS NULL AND created_at_ms > $1
      ORDER BY created_at_ms DESC
      LIMIT $2`,
    [nowMs - SEEKING_TTL_MS, SEEKING_PAGE + 1],
  );
  return { listings: rows.slice(0, SEEKING_PAGE).map(toSeeking), truncated: rows.length > SEEKING_PAGE };
}

export async function seekingFor(address: string): Promise<Seeking | null> {
  const { rows } = await db().query<SeekingRow>(`SELECT * FROM agent_seeking WHERE address = $1`, [normaliseAddress(address)]);
  const row = rows[0];
  return row === undefined ? null : toSeeking(row);
}

export async function markSeekingClaimed(address: string): Promise<boolean> {
  const { rowCount } = await db().query(
    `UPDATE agent_seeking SET claimed_at_ms = $2 WHERE address = $1 AND claimed_at_ms IS NULL`,
    [normaliseAddress(address), Date.now()],
  );
  return (rowCount ?? 0) > 0;
}

export async function recordOffer(input: OfferInput): Promise<OperatorOffer> {
  const { rows } = await db().query<OfferRow>(
    `INSERT INTO agent_operator_offers (agent_address, operator_address, model, purpose, issued_at_ms, operator_signature, created_at_ms, filed_at_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NULL)
     ON CONFLICT (agent_address, operator_address) DO UPDATE SET
       model = EXCLUDED.model, purpose = EXCLUDED.purpose, issued_at_ms = EXCLUDED.issued_at_ms,
       operator_signature = EXCLUDED.operator_signature, created_at_ms = EXCLUDED.created_at_ms, filed_at_ms = NULL
     RETURNING *`,
    [input.agentAddress, input.operatorAddress, input.model, input.purpose, input.timestampMs, input.operatorSignature, Date.now()],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('the offer was not recorded');
  return toOffer(row);
}

export async function offersFor(agentAddress: string, nowMs: number = Date.now()): Promise<OperatorOffer[]> {
  const { rows } = await db().query<OfferRow>(
    `SELECT * FROM agent_operator_offers
      WHERE agent_address = $1 AND filed_at_ms IS NULL AND issued_at_ms > $2
      ORDER BY issued_at_ms DESC
      LIMIT $3`,
    [normaliseAddress(agentAddress), nowMs - operatorOfferTtlMs(), SEEKING_PAGE],
  );
  return rows.map(toOffer);
}

export async function markOfferFiled(agentAddress: string, operatorAddress: string, issuedAtMs: number): Promise<boolean> {
  const { rowCount } = await db().query(
    `UPDATE agent_operator_offers SET filed_at_ms = $4
      WHERE agent_address = $1 AND operator_address = $2 AND issued_at_ms = $3 AND filed_at_ms IS NULL`,
    [normaliseAddress(agentAddress), normaliseAddress(operatorAddress), issuedAtMs, Date.now()],
  );
  return (rowCount ?? 0) > 0;
}
