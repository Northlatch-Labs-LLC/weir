// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/*
  How many agents one operator may declare.

  The register was built to allow a fleet — `operator_address` carries no unique constraint and
  `023_agent_accounts.sql` says so in as many words. That is still the right design: an operator
  running several agents is an ordinary thing, and forbidding it would forbid the customer this
  platform is for. What is not ordinary is an UNBOUNDED fleet, and the difference is the whole
  distance between this register and the one that collapsed elsewhere at 88 agents per human.

  So the bound belongs here and not in the schema: a constraint would make a fleet illegal for ever,
  while a checked ceiling makes it a number somebody chose and can change when the platform knows
  more than it does today.

  Mutations predicted: drop the `<>` on the declaring agent → "an agent at the ceiling may
  re-declare" red (a re-declaration would count itself and be refused); drop the
  `revoked_at_ms IS NULL` filter → "a revoked agent does not occupy a place" red; make the
  comparison `>` instead of `>=` → "the operator at the ceiling is refused" red (one too many would
  be admitted).
*/
import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_AGENTS_PER_OPERATOR, operatorConflict } from '@/lib/agents';
import { testDb, useTestDatabase } from './helpers/database';

useTestDatabase();

/** A distinct, well-formed Sui address per index, so no two fixtures collide. */
const addr = (n: number): string => `0x${n.toString(16).padStart(64, '0')}`;

const OPERATOR = addr(0xaa);

/**
 * File one live declaration directly, bypassing the route.
 *
 * The route's job is the two signatures; this file's subject is the counting, so the rows are
 * written here rather than signed into existence. The columns still satisfy every CHECK in 023 —
 * a fixture that could not exist in production would prove nothing about production.
 * @param agent - the agent's address.
 * @param operator - the operator's address.
 * @param revokedAtMs - set to retire the row.
 */
async function declare(agent: string, operator = OPERATOR, revokedAtMs: number | null = null): Promise<void> {
  await testDb().query(
    `INSERT INTO agent_accounts
       (address, operator_address, agent_signature, operator_signature, model, purpose,
        declared_at_ms, revoked_at_ms)
     VALUES ($1, $2, $3, $4, 'test-model', 'test purpose', 1, $5)`,
    [agent, operator, `agent-sig-${agent}`, `operator-sig-${agent}`, revokedAtMs],
  );
}

describe('the ceiling on agents per operator', () => {
  beforeEach(async () => {
    /*
      The shared `resetDatabase` truncates six tables and deliberately not this one — its own
      comment explains that the list is narrow because suites share a database in parallel and one
      file's TRUNCATE has ended another file's row mid-assertion. So this file clears exactly the
      two tables it writes, rather than widening a helper that every other suite depends on.
    */
    await testDb().query('TRUNCATE agent_accounts, agent_declaration_requests RESTART IDENTITY CASCADE');
  });

  it('admits an operator below the ceiling', async () => {
    for (let i = 0; i < MAX_AGENTS_PER_OPERATOR - 1; i += 1) await declare(addr(i + 1));
    expect(await operatorConflict(addr(0x100), OPERATOR)).toBeNull();
  });

  it('refuses the operator at the ceiling, and names the number', async () => {
    for (let i = 0; i < MAX_AGENTS_PER_OPERATOR; i += 1) await declare(addr(i + 1));
    const why = await operatorConflict(addr(0x100), OPERATOR);
    expect(why).not.toBeNull();
    expect(why).toContain(String(MAX_AGENTS_PER_OPERATOR));
    expect(why).toContain(OPERATOR);
  });

  it('an agent at the ceiling may re-declare, because replacing is not adding', async () => {
    // Re-declaration replaces the row rather than writing a second one, so the agent already
    // holding a place must not be counted against itself — otherwise an operator at the ceiling
    // could never change an agent's model or purpose again.
    for (let i = 0; i < MAX_AGENTS_PER_OPERATOR; i += 1) await declare(addr(i + 1));
    expect(await operatorConflict(addr(1), OPERATOR)).toBeNull();
  });

  it('a revoked agent does not occupy a place', async () => {
    for (let i = 0; i < MAX_AGENTS_PER_OPERATOR; i += 1) await declare(addr(i + 1));
    await testDb().query('UPDATE agent_accounts SET revoked_at_ms = 2 WHERE address = $1', [addr(1)]);
    expect(await operatorConflict(addr(0x100), OPERATOR)).toBeNull();
  });

  it('counts per operator, not across the register', async () => {
    // A busy neighbour must not spend somebody else's allowance.
    const other = addr(0xbb);
    for (let i = 0; i < MAX_AGENTS_PER_OPERATOR; i += 1) await declare(addr(i + 1), other);
    expect(await operatorConflict(addr(0x100), OPERATOR)).toBeNull();
  });

  it('still refuses the role confusions it refused before', async () => {
    // The ceiling is added beside the existing checks, not in place of them.
    await declare(addr(1));
    expect(await operatorConflict(addr(0x100), addr(1))).toContain('itself a declared agent');
  });
});
