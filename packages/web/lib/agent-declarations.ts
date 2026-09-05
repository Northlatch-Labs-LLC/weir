// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * The waiting room: an agent's half of a declaration, kept until its operator signs.
 *
 * See `db/035_declaration_requests.sql` for what a row is and is not. This module reads and writes
 * that table and nothing else; verification lives in the routes, with the rest of the register's
 * checks.
 */
import { SIGNATURE_WINDOW_MS } from '@projectx-social/sdk';
import { db, normaliseAddress } from '@/lib/db';

export interface DeclarationRequest {
  address: string;
  operatorAddress: string;
  model: string;
  purpose: string;
  /** The `issued:` instant the agent signed; the operator's half must carry the same one. */
  issuedAtMs: number;
  agentSignature: string;
  createdAtMs: number;
  /** When the declare route filed it, or null while it waits. */
  filedAtMs: number | null;
}

interface RequestRow {
  address: string;
  operator_address: string;
  model: string;
  purpose: string;
  issued_at_ms: string;
  agent_signature: string;
  created_at_ms: string;
  filed_at_ms: string | null;
}

function toRequest(row: RequestRow): DeclarationRequest {
  return {
    address: row.address,
    operatorAddress: row.operator_address,
    model: row.model,
    purpose: row.purpose,
    issuedAtMs: Number(row.issued_at_ms),
    agentSignature: row.agent_signature,
    createdAtMs: Number(row.created_at_ms),
    filedAtMs: row.filed_at_ms === null ? null : Number(row.filed_at_ms),
  };
}

/** The instant after which the declare route would refuse the agent's signature as expired. */
export function requestExpiresAtMs(request: Pick<DeclarationRequest, 'issuedAtMs'>): number {
  return request.issuedAtMs + SIGNATURE_WINDOW_MS;
}

/** Keep (or replace) the one live request for an agent. Call only after the agent half verified. */
export async function recordDeclarationRequest(input: {
  address: string;
  operatorAddress: string;
  model: string;
  purpose: string;
  issuedAtMs: number;
  agentSignature: string;
}): Promise<DeclarationRequest> {
  const { rows } = await db().query<RequestRow>(
    `INSERT INTO agent_declaration_requests
       (address, operator_address, model, purpose, issued_at_ms, agent_signature, created_at_ms, filed_at_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NULL)
     ON CONFLICT (address) DO UPDATE SET
       operator_address = EXCLUDED.operator_address,
       model            = EXCLUDED.model,
       purpose          = EXCLUDED.purpose,
       issued_at_ms     = EXCLUDED.issued_at_ms,
       agent_signature  = EXCLUDED.agent_signature,
       created_at_ms    = EXCLUDED.created_at_ms,
       filed_at_ms      = NULL
     RETURNING *`,
    [
      normaliseAddress(input.address),
      normaliseAddress(input.operatorAddress),
      input.model,
      input.purpose,
      input.issuedAtMs,
      input.agentSignature,
      Date.now(),
    ],
  );
  const row = rows[0];
  if (row === undefined) throw new Error('the declaration request was not recorded');
  return toRequest(row);
}

/** Bounded: an operator with more live requests than this sees the newest and is told the list is cut. */
export const REQUESTS_PAGE = 50;

/**
 * The live requests naming an operator: unfiled and inside the signing window, newest first.
 *
 * Expired rows are left in place and simply not returned — they are already refused by the declare
 * route, and a sweep is housekeeping, not a correctness need.
 */
export async function pendingDeclarationsFor(
  operatorAddress: string,
  nowMs: number = Date.now(),
): Promise<{ requests: DeclarationRequest[]; truncated: boolean }> {
  const { rows } = await db().query<RequestRow>(
    `SELECT * FROM agent_declaration_requests
      WHERE operator_address = $1 AND filed_at_ms IS NULL AND issued_at_ms > $2
      ORDER BY issued_at_ms DESC
      LIMIT $3`,
    [normaliseAddress(operatorAddress), nowMs - SIGNATURE_WINDOW_MS, REQUESTS_PAGE + 1],
  );
  const truncated = rows.length > REQUESTS_PAGE;
  return { requests: rows.slice(0, REQUESTS_PAGE).map(toRequest), truncated };
}

/** Mark the request for this agent at this instant as filed. A request at another instant is left alone. */
export async function markDeclarationRequestFiled(address: string, issuedAtMs: number): Promise<boolean> {
  const { rowCount } = await db().query(
    `UPDATE agent_declaration_requests SET filed_at_ms = $3
      WHERE address = $1 AND issued_at_ms = $2 AND filed_at_ms IS NULL`,
    [normaliseAddress(address), issuedAtMs, Date.now()],
  );
  return (rowCount ?? 0) > 0;
}
