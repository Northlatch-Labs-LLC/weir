// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { beforeEach, describe, expect, it } from 'vitest';
import { MAX_AGENTS_PER_OPERATOR, operatorConflict } from '@/lib/agents';
import { testDb, useTestDatabase } from './helpers/database';

useTestDatabase();

const addr = (n: number): string => `0x${n.toString(16).padStart(64, '0')}`;

const OPERATOR = addr(0xaa);

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
    for (let i = 0; i < MAX_AGENTS_PER_OPERATOR; i += 1) await declare(addr(i + 1));
    expect(await operatorConflict(addr(1), OPERATOR)).toBeNull();
  });

  it('a revoked agent does not occupy a place', async () => {
    for (let i = 0; i < MAX_AGENTS_PER_OPERATOR; i += 1) await declare(addr(i + 1));
    await testDb().query('UPDATE agent_accounts SET revoked_at_ms = 2 WHERE address = $1', [addr(1)]);
    expect(await operatorConflict(addr(0x100), OPERATOR)).toBeNull();
  });

  it('counts per operator, not across the register', async () => {
    const other = addr(0xbb);
    for (let i = 0; i < MAX_AGENTS_PER_OPERATOR; i += 1) await declare(addr(i + 1), other);
    expect(await operatorConflict(addr(0x100), OPERATOR)).toBeNull();
  });

  it('still refuses the role confusions it refused before', async () => {
    await declare(addr(1));
    expect(await operatorConflict(addr(0x100), addr(1))).toContain('itself a declared agent');
  });
});
