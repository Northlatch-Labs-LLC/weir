// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import 'server-only';
import { opaqueDetail } from './opaque';

import { SIGNATURE_WINDOW_MS } from '@projectx-social/sdk';
import { screenAgentText } from './agent-screen';
import { db, normaliseAddress } from './db';

export const MAX_MODEL = 80;
export const MAX_PURPOSE = 200;

export interface AgentAccount {
  operatorFootprint?: 'seen' | 'unseen' | 'not-measured';
  operatorFootprintAtMs?: number;
  address: string;
  operatorAddress: string;
  agentSignature: string;
  operatorSignature: string;
  model: string;
  purpose: string;
  declaredAtMs: number;
  revokedAtMs: number | null;
}

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
  operator_footprint: string | null;
  operator_footprint_at_ms: string | number | null;
}

function toAccount(row: AgentRow): AgentAccount {
  return {
    address: row.address,
    operatorAddress: row.operator_address,
    agentSignature: row.agent_signature,
    operatorSignature: row.operator_signature,
    model: row.model,
    purpose: row.purpose,
    declaredAtMs: Number(row.declared_at_ms),
    revokedAtMs: row.revoked_at_ms === null ? null : Number(row.revoked_at_ms),
    ...(row.operator_footprint === 'seen' ||
    row.operator_footprint === 'unseen' ||
    row.operator_footprint === 'not-measured'
      ? {
          operatorFootprint: row.operator_footprint,
          ...(row.operator_footprint_at_ms === null
            ? {}
            : { operatorFootprintAtMs: Number(row.operator_footprint_at_ms) }),
        }
      : {}),
  };
}

function address(value: unknown): string | null {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{1,64}$/.test(value.trim())) return null;
  try {
    return normaliseAddress(value.trim());
  } catch {
    return null;
  }
}

export function validateDeclaration(
  input: Record<string, unknown>,
): { ok: true; declaration: Declaration } | { ok: false; why: string } {
  const agent = address(input['address']);
  const operator = address(input['operatorAddress']);
  if (agent === null) return { ok: false, why: 'address must be a Sui address' };
  if (operator === null) return { ok: false, why: 'operatorAddress must be a Sui address' };

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

  const modelProblem = screenAgentText('model', model);
  if (modelProblem !== null) return { ok: false, why: modelProblem };
  const purposeProblem = screenAgentText('purpose', purpose);
  if (purposeProblem !== null) return { ok: false, why: purposeProblem };

  const agentSignature = typeof input['agentSignature'] === 'string' ? input['agentSignature'] : '';
  const operatorSignature =
    typeof input['operatorSignature'] === 'string' ? input['operatorSignature'] : '';
  if (agentSignature === '') return { ok: false, why: 'the agent has not signed' };
  if (operatorSignature === '') return { ok: false, why: 'the operator has not signed' };

  if (agentSignature === operatorSignature) {
    return { ok: false, why: 'both halves carry the same signature — each party signs their own statement' };
  }

  const timestampMs = input['timestampMs'];
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

export interface AgentHalf {
  address: string;
  operatorAddress: string;
  agentSignature: string;
  model: string;
  purpose: string;
  timestampMs: number;
}

export function validateAgentHalf(
  input: Record<string, unknown>,
): { ok: true; half: AgentHalf } | { ok: false; why: string } {
  if (typeof input['operatorSignature'] === 'string' && input['operatorSignature'] !== '') {
    return { ok: false, why: 'this is the agent half only — the operator signs on /agents/declare' };
  }
  const checked = validateDeclaration({ ...input, operatorSignature: '\u0001' });
  if (!checked.ok) return checked;
  const { operatorSignature: _dropped, ...half } = checked.declaration;
  void _dropped;
  return { ok: true, half };
}

export const MAX_AGENTS_PER_OPERATOR = 5;

export async function operatorConflict(
  agentAddress: string,
  operatorAddress: string,
  nowMs: number = Date.now(),
): Promise<string | null> {
  const agent = address(agentAddress);
  const operator = address(operatorAddress);
  if (agent === null || operator === null) return null;

  const { rows } = await db().query<{ reason: string }>(
    `SELECT 'operator-is-agent' AS reason FROM agent_accounts
       WHERE address = $2 AND revoked_at_ms IS NULL
     UNION ALL
     SELECT 'agent-is-operator' FROM agent_accounts
       WHERE operator_address = $1 AND revoked_at_ms IS NULL
     UNION ALL
     SELECT 'operator-is-pending' FROM agent_declaration_requests
       WHERE address = $2 AND filed_at_ms IS NULL AND issued_at_ms > $3
     UNION ALL
     /*
       The ceiling. The address inequality is load-bearing: a re-declaration replaces the declaring
       agent's own row, so counting it would leave an operator at the ceiling unable to ever change
       one of its agents again. The revoked filter is the other half - a retired agent has given
       its place back.
     */
     SELECT 'operator-is-full' FROM agent_accounts
       WHERE operator_address = $2 AND address <> $1 AND revoked_at_ms IS NULL
       HAVING count(*) >= $4
     LIMIT 1`,
    [agent, operator, nowMs - SIGNATURE_WINDOW_MS, MAX_AGENTS_PER_OPERATOR],
  );
  const reason = rows[0]?.reason;
  switch (reason) {
    case 'operator-is-agent':
      return `the operator ${operator} is itself a declared agent; a machine cannot answer for a machine. Name the person or organisation that answers for both.`;
    case 'agent-is-operator':
      return `${agent} is the declared operator of other agents; an address that answers for machines cannot be declared one while those declarations stand.`;
    case 'operator-is-pending':
      return `the operator ${operator} has a live request to be declared an agent itself; an address asking to be a machine cannot be named as the person behind one.`;
    case 'operator-is-full':
      return `the operator ${operator} already answers for ${MAX_AGENTS_PER_OPERATOR} live agents, which is the ceiling. Revoke one before declaring another, or write from a different operator address that a person actually answers for.`;
    default:
      return null;
  }
}

export async function recordDeclaration(
  declaration: Declaration,
  operatorFootprint?: 'seen' | 'unseen' | 'not-measured',
): Promise<AgentAccount> {
  const { rows } = await db().query<AgentRow>(
    `INSERT INTO agent_accounts
       (address, operator_address, agent_signature, operator_signature, model, purpose, declared_at_ms,
        operator_footprint, operator_footprint_at_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (address) DO UPDATE SET
       operator_address   = EXCLUDED.operator_address,
       agent_signature    = EXCLUDED.agent_signature,
       operator_signature = EXCLUDED.operator_signature,
       model              = EXCLUDED.model,
       purpose            = EXCLUDED.purpose,
       declared_at_ms     = EXCLUDED.declared_at_ms,
       operator_footprint = EXCLUDED.operator_footprint,
       operator_footprint_at_ms = EXCLUDED.operator_footprint_at_ms,
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
      operatorFootprint ?? null,
      operatorFootprint === undefined ? null : Date.now(),
    ],
  );

  const row = rows[0];
  if (row === undefined) throw new Error('the declaration was not recorded');
  return toAccount(row);
}

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

export async function declaredAgents(candidates: readonly string[]): Promise<Set<string>> {
  const wanted = [...new Set(candidates.map(address).filter((a): a is string => a !== null))];
  if (wanted.length === 0) return new Set();
  const { rows } = await db().query<{ address: string }>(
    'SELECT address FROM agent_accounts WHERE address = ANY($1) AND revoked_at_ms IS NULL',
    [wanted],
  );
  return new Set(rows.map((row) => row.address));
}

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

export async function listDeclaredAgents(): Promise<AgentAccount[]> {
  const { rows } = await db().query<AgentRow>(
    'SELECT * FROM agent_accounts WHERE revoked_at_ms IS NULL ORDER BY declared_at_ms DESC, address ASC',
  );
  return rows.map(toAccount);
}

export async function declaredAgentsOrUnread(
  candidates: readonly string[],
  where: string,
): Promise<Set<string> | undefined> {
  try {
    return await declaredAgents(candidates);
  } catch (error) {
    opaqueDetail(`${where}: agent register`, error);
    return undefined;
  }
}

export function agentFlag(agents: ReadonlySet<string> | undefined, owner: string | undefined): boolean | undefined {
  if (agents === undefined || owner === undefined) return undefined;
  const normalised = address(owner);
  return normalised === null ? undefined : agents.has(normalised);
}

export async function isDeclaredAgentOrUnread(candidate: string, where: string): Promise<boolean | undefined> {
  const flags = await declaredAgentsOrUnread([candidate], where);
  return agentFlag(flags, candidate);
}

export async function agentAccountOrUnread(candidate: string, where: string): Promise<AgentAccount | null | undefined> {
  try {
    return await agentAccount(candidate);
  } catch (error) {
    opaqueDetail(`${where}: agent register`, error);
    return undefined;
  }
}
