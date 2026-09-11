// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { beforeEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { testDb, useTestDatabase } from './helpers/database';
import { AGENT_DISCLOSURE, AGENT_MANIFEST_PATH } from '../lib/agent-manifest';

function decode(html: string): string {
  return html
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#x27;', "'");
}

useTestDatabase();

const AGENT = `0x${'11'.repeat(32)}`;
const OPERATOR = `0x${'22'.repeat(32)}`;
const RETIRED = `0x${'33'.repeat(32)}`;

async function declare(address: string, revokedAtMs: number | null = null): Promise<void> {
  await testDb().query(
    `INSERT INTO agent_accounts
       (address, operator_address, agent_signature, operator_signature, model, purpose,
        declared_at_ms, revoked_at_ms)
     VALUES ($1, $2, $3, $4, 'claude-opus-5', 'writes the estate notes', 1788566400000, $5)`,
    [address, OPERATOR, `agent-sig-${address}`, `operator-sig-${address}`, revokedAtMs],
  );
}

async function render(): Promise<string> {
  const Page = (await import('../app/disclosure/page')).default;
  return renderToStaticMarkup(await Page());
}

describe('the disclosure register at /disclosure', () => {
  beforeEach(async () => {
    await testDb().query('TRUNCATE agent_accounts, agent_declaration_requests RESTART IDENTITY CASCADE');
  });

  it('renders on an empty register, and says it is empty rather than broken', async () => {
    const html = await render();
    expect(html).toContain('No agent has been declared yet');
  });

  it('an entry names both parties', async () => {
    await declare(AGENT);
    const html = await render();
    expect(html).toContain(AGENT);
    expect(html).toContain(OPERATOR);
  });

  it('an entry carries what was declared, and links to the evidence', async () => {
    await declare(AGENT);
    const html = await render();
    expect(html).toContain('claude-opus-5');
    expect(html).toContain('writes the estate notes');
    expect(html).toContain(`/api/agents/${AGENT}`);
  });

  it('a revoked declaration is not listed', async () => {
    await declare(AGENT);
    await declare(RETIRED, 1788566400001);
    const html = await render();
    expect(html).toContain(AGENT);
    expect(html).not.toContain(RETIRED);
  });

  it('the count in the caption is the number of rows', async () => {
    await declare(AGENT);
    expect(await render()).toContain('1 declared agent');
    await declare(RETIRED);
    expect(await render()).toContain('2 declared agents');
  });

  it('dates the entry by the instant both parties signed, in UTC', async () => {
    await declare(AGENT);
    expect(await render()).toContain('2026-09-05');
  });
});

describe('the rules are on the page, and are the manifest’s own', () => {
  it('publishes every clause an agent is held to', async () => {
    const html = await render();
    for (const clause of [
      AGENT_DISCLOSURE.requirement,
      AGENT_DISCLOSURE.userAgent,
      AGENT_DISCLOSURE.principal,
      AGENT_DISCLOSURE.impersonation,
      AGENT_DISCLOSURE.backoff,
      AGENT_DISCLOSURE.basis,
    ]) {
      expect(decode(html)).toContain(clause);
    }
  });

  it('publishes the limit beside the list of what is checked', async () => {
    const html = decode(await render());
    for (const item of AGENT_DISCLOSURE.enforced) expect(html).toContain(item);
    expect(html).toContain(AGENT_DISCLOSURE.notEnforced);
  });

  it('sends a reader to the signed document the clauses come from', async () => {
    expect(await render()).toContain(AGENT_MANIFEST_PATH);
  });
});
