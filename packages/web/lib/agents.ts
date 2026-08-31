// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import 'server-only';

/**
 * The register of which accounts are machines, and who operates them.
 *
 * # The one rule this module exists to hold
 *
 * **A declaration needs two signatures, from two different addresses, and a declaration carrying
 * one is refused.** The agent signs that it is operated by the operator; the operator signs that
 * they operate the agent. Neither party can put the other in this register alone.
 *
 * Everything else here is bookkeeping around that rule. It is worth being blunt about why the rule
 * is the product: a register written on one party's word records what people said about each other.
 * A human could file a competitor's address as a bot; a human could decline to file their own bot
 * and pass as a person. Both directions were live in the network that was compromised this month,
 * and the second one is the one that did the damage.
 *
 * With both halves required, the row is **self-certifying**. It carries both signatures and the
 * exact instant they were issued, so a third party rebuilds the two statements from the row alone
 * and checks them against two public keys — trusting this deployment for nothing, and needing no
 * contract to have been deployed and no capability to have been granted. That is why this whole
 * feature costs zero Move changes: it stores evidence, not permission.
 *
 * # What it does NOT do
 *
 * It does not decide anything. Nothing here gates money, entitlement or publication — those are
 * decided by objects on Sui, as `db/README.md` says, and a register that started refusing writes
 * would be a second source of truth for a question the chain already answers.
 *
 * It does not prove the model named is the model running. Nothing could. `model` and `purpose` are
 * the parties' own signed description of themselves, and the register presents them as exactly
 * that.
 *
 * See `db/023_agent_accounts.sql` for the schema, and `lib/identity.ts` for the signed bytes.
 */

import { db, normaliseAddress } from './db';

/**
 * Bounds on the two free-text fields.
 *
 * Short on purpose. Both are interpolated straight into the statement a wallet displays — see the
 * `declare-agent` doc block in `lib/identity.ts` for why they are not hashed — and a prompt that
 * runs past the end of the dialog is a prompt nobody reads to the bottom.
 */
export const MAX_MODEL = 80;
export const MAX_PURPOSE = 200;

/** One row of the register. */
export interface AgentAccount {
  /** The machine's address, normalised. */
  address: string;
  /** Who answers for it, normalised. Never equal to `address`. */
  operatorAddress: string;
  /** Base64, over `statementFor({ kind: 'declare-agent', … })`. */
  agentSignature: string;
  /** Base64, over `statementFor({ kind: 'declare-operator', … })`. */
  operatorSignature: string;
  model: string;
  purpose: string;
  /** The `issued:` value inside BOTH statements — not when the row was written. */
  declaredAtMs: number;
  /** `null` while the declaration stands. */
  revokedAtMs: number | null;
}

/** A declaration that has been checked for shape, but not yet for signatures. */
export interface Declaration {
  address: string;
  operatorAddress: string;
  agentSignature: string;
  operatorSignature: string;
  model: string;
  purpose: string;
  timestampMs: number;
}

interface AgentRow {
  address: string;
  operator_address: string;
  agent_signature: string;
  operator_signature: string;
  model: string;
  purpose: string;
  declared_at_ms: string;
  revoked_at_ms: string | null;
}

function toAccount(row: AgentRow): AgentAccount {
  return {
    address: row.address,
    operatorAddress: row.operator_address,
    agentSignature: row.agent_signature,
    operatorSignature: row.operator_signature,
    model: row.model,
    purpose: row.purpose,
    // `bigint` arrives from `pg` as a decimal string. Both are millisecond epochs, comfortably
    // inside 2^53, so `Number` loses nothing here — unlike the coin amounts elsewhere in this
    // codebase, which is why those stay strings and these do not.
    declaredAtMs: Number(row.declared_at_ms),
    revokedAtMs: row.revoked_at_ms === null ? null : Number(row.revoked_at_ms),
  };
}

/** A Sui address in canonical form, or `null` when it is not an address at all. */
function address(value: unknown): string | null {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{1,64}$/.test(value.trim())) return null;
  try {
    return normaliseAddress(value.trim());
  } catch {
    return null;
  }
}

/**
 * What a caller may declare, and the reason behind each refusal.
 *
 * Returns the cleaned declaration, or a sentence naming what is wrong — the same shape and the same
 * reasoning as `validatePerks`: the database has these limits as constraints, and this is the layer
 * that can explain them to whoever is holding the wallet.
 */
export function validateDeclaration(
  input: Record<string, unknown>,
): { ok: true; declaration: Declaration } | { ok: false; why: string } {
  const agent = address(input['address']);
  const operator = address(input['operatorAddress']);
  if (agent === null) return { ok: false, why: 'address must be a Sui address' };
  if (operator === null) return { ok: false, why: 'operatorAddress must be a Sui address' };

  /*
    An agent may not be its own operator.

    This is the one line that would otherwise defeat the whole design. With the two addresses equal,
    a single keypair produces both signatures; both verify honestly; and the pair that was supposed
    to require two parties is one party signing twice. Refused again as a CHECK constraint in 023,
    because a constraint outlives the route that fed it.
  */
  if (agent === operator) {
    return { ok: false, why: 'an agent may not declare itself its own operator — that is one signature written twice' };
  }

  const model = typeof input['model'] === 'string' ? input['model'].trim() : '';
  const purpose = typeof input['purpose'] === 'string' ? input['purpose'].trim() : '';
  if (model === '') return { ok: false, why: 'model is required — say what is running' };
  if (model.length > MAX_MODEL) return { ok: false, why: `model is at most ${MAX_MODEL} characters` };
  if (purpose === '') return { ok: false, why: 'purpose is required — say what it is for' };
  if (purpose.length > MAX_PURPOSE) {
    return { ok: false, why: `purpose is at most ${MAX_PURPOSE} characters` };
  }

  /*
    No line breaks in either field, and this is not tidiness.

    The signed statement is line-oriented: `model: {model}` on one line and `purpose: {purpose}` on
    the next. A model containing a newline can therefore produce bytes identical to a different
    split of the same two fields — `model: "a\npurpose: b"` with an empty purpose signs exactly what
    `model: "a"` with `purpose: "b"` signs. Both verify, because both ARE the same bytes.

    So without this the two parties could sign one thing and have a different pair of values filed
    against their signatures, by whoever carried the declaration here. The signatures would check
    out and the register would still be wrong, which is the worst failure available to a register
    that asks to be trusted on its signatures. The statement format is the reason; the fix belongs
    beside it.
  */
  if (/[\r\n]/.test(model) || /[\r\n]/.test(purpose)) {
    return { ok: false, why: 'model and purpose must be a single line each' };
  }

  const agentSignature = typeof input['agentSignature'] === 'string' ? input['agentSignature'] : '';
  const operatorSignature =
    typeof input['operatorSignature'] === 'string' ? input['operatorSignature'] : '';
  if (agentSignature === '') return { ok: false, why: 'the agent has not signed' };
  if (operatorSignature === '') return { ok: false, why: 'the operator has not signed' };

  /*
    Two different parties signing two different statements cannot produce identical bytes, so equal
    signatures mean one signature was submitted twice. `verifyAction` would refuse the second one
    anyway — its digest is already spent by then — but the message it gives is "this signature has
    already been used", which sends the caller looking for a replay that never happened. Refusing it
    here says the true thing instead.
  */
  if (agentSignature === operatorSignature) {
    return { ok: false, why: 'both halves carry the same signature — each party signs their own statement' };
  }

  const timestampMs = input['timestampMs'];
  /*
    ONE timestamp for both halves, and it is stored as `declared_at_ms`.

    Both statements carry `issued: {ms}` in their head, so the instant is part of what each party
    signed. Storing one value is what lets a third party rebuild both statements from the row alone;
    two independent timestamps with only one column would leave the row unverifiable, which would
    make the self-certifying claim in `db/023_agent_accounts.sql` a claim rather than a fact.

    The cost is that the two parties must agree on the instant. They are already agreeing on the
    model, the purpose and each other's addresses — this is one act performed together, and it has
    one time. `verifyAction` still applies the ten-minute window to each half independently.
  */
  if (typeof timestampMs !== 'number' || !Number.isSafeInteger(timestampMs) || timestampMs <= 0) {
    return { ok: false, why: 'timestampMs must be the epoch millisecond both parties signed' };
  }

  return {
    ok: true,
    declaration: {
      address: agent,
      operatorAddress: operator,
      agentSignature,
      operatorSignature,
      model,
      purpose,
      timestampMs,
    },
  };
}

/**
 * File a declaration whose two signatures have already been verified.
 *
 * **Call this only after both halves have passed `verifyAction`.** It writes what it is given: the
 * check lives in the route, where both signatures can be verified against the statements this
 * server rebuilt, and this function's job is to record the result of that check rather than to
 * repeat half of it badly.
 *
 * # Re-declaration replaces, and that is deliberate
 *
 * An agent whose operator changes declares again, and the new row replaces the old — including
 * clearing `revoked_at_ms`, because a fresh declaration is a live one. It is authorised by exactly
 * what authorised the first: two fresh, in-window, single-use signatures naming this exact pair.
 *
 * Two consequences, stated plainly rather than discovered later. There is **no history table**, so
 * the register says who operates an agent now and cannot say who did before. And an attacker
 * holding the agent's key can move it to an operator of their choosing — which is true of every
 * key-based system and is not a hole this register can close, since at that point they are the
 * agent.
 */
export async function recordDeclaration(declaration: Declaration): Promise<AgentAccount> {
  const { rows } = await db().query<AgentRow>(
    `INSERT INTO agent_accounts
       (address, operator_address, agent_signature, operator_signature, model, purpose, declared_at_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (address) DO UPDATE SET
       operator_address   = EXCLUDED.operator_address,
       agent_signature    = EXCLUDED.agent_signature,
       operator_signature = EXCLUDED.operator_signature,
       model              = EXCLUDED.model,
       purpose            = EXCLUDED.purpose,
       declared_at_ms     = EXCLUDED.declared_at_ms,
       revoked_at_ms      = NULL
     RETURNING *`,
    [
      declaration.address,
      declaration.operatorAddress,
      declaration.agentSignature,
      declaration.operatorSignature,
      declaration.model,
      declaration.purpose,
      declaration.timestampMs,
    ],
  );

  // `RETURNING *` on an upsert always yields the row. A missing one would mean the statement did
  // not run, and reporting a declaration that was not filed is the one outcome not worth risking.
  const row = rows[0];
  if (row === undefined) throw new Error('the declaration was not recorded');
  return toAccount(row);
}

/**
 * One agent's record, or `null`.
 *
 * A revoked declaration is still returned, with `revokedAtMs` set. Withholding it would make a
 * withdrawn declaration indistinguishable from one that never existed, and those are different
 * facts — the first is a relationship that ended and the reader is entitled to know it happened.
 * Callers deciding whether an address is an agent *right now* read `revokedAtMs`, or use
 * `declaredAgents` below, which does it for them.
 */
export async function agentAccount(candidate: string): Promise<AgentAccount | null> {
  const normalised = address(candidate);
  if (normalised === null) return null;
  const { rows } = await db().query<AgentRow>(
    'SELECT * FROM agent_accounts WHERE address = $1',
    [normalised],
  );
  const row = rows[0];
  return row === undefined ? null : toAccount(row);
}

/**
 * Which of these addresses are declared agents, live, in one query.
 *
 * A feed names a dozen authors. Asking per author would be a dozen round trips to answer one
 * question about a set — the same shape `readEntityTypes` avoids, and for the same reason.
 *
 * Revoked declarations are excluded: this answers "is this a machine now".
 */
export async function declaredAgents(candidates: readonly string[]): Promise<Set<string>> {
  const wanted = [...new Set(candidates.map(address).filter((a): a is string => a !== null))];
  if (wanted.length === 0) return new Set();
  const { rows } = await db().query<{ address: string }>(
    'SELECT address FROM agent_accounts WHERE address = ANY($1) AND revoked_at_ms IS NULL',
    [wanted],
  );
  return new Set(rows.map((row) => row.address));
}

/**
 * The same list with declared agents dropped — the human view, which is the default view.
 *
 * # Why hidden by default rather than shown with a badge
 *
 * The badge on `PostCard` is for when a reader has *chosen* to look at a mixed feed: it labels what
 * is in front of them. This function is for the feed nobody chose, which is most of them. A machine
 * can publish faster than a person can read, so a feed that ranks by recency and includes agents is
 * a feed of agents with people underneath — the ordering does the excluding, quietly, and no policy
 * decision is ever visibly made. Dropping them by default puts that decision somewhere a reader can
 * see it and reverse it.
 *
 * Undeclared machines are of course not filtered, and nothing here pretends otherwise. This filters
 * what was honestly declared. That is a floor, not a wall, and the register's value is that the
 * honest declaration is now cheap to make and impossible to fake.
 */
export async function withoutDeclaredAgents<T>(
  items: readonly T[],
  addressOf: (item: T) => string,
): Promise<T[]> {
  if (items.length === 0) return [];
  const agents = await declaredAgents(items.map(addressOf));
  if (agents.size === 0) return [...items];
  return items.filter((item) => {
    const normalised = address(addressOf(item));
    return normalised === null || !agents.has(normalised);
  });
}
