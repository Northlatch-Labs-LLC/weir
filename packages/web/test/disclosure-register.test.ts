// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/*
  The disclosure register renders, at the address people will try.

  The defect this closes was not a wrong page — it was no page. `/disclosure` answered 404 while the
  compliance posture said a public register existed, and the register did exist, in an API and in
  per-agent pages, at neither of the two addresses a person checking would type. So the assertion
  that matters here is the dull one: the route resolves and the rows are on it.

  Rendered rather than read as source, because "the file exists" is exactly the claim that was true
  the whole time this was broken.

  Mutations predicted: drop the revoked filter inside `listDeclaredAgents` → "a revoked declaration
  is not listed" red; render `model` where `operatorAddress` belongs → "an entry names both parties"
  red; return early with an empty list → "the count in the caption is the number of rows" red.
*/
import { beforeEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { testDb, useTestDatabase } from './helpers/database';
import { AGENT_DISCLOSURE, AGENT_MANIFEST_PATH } from '../lib/agent-manifest';

/**
 * Undo the HTML entity escaping `renderToStaticMarkup` applies, so a clause can be compared as the
 * sentence it is.
 *
 * The clauses carry typographic apostrophes and em dashes. Without this the assertions would be
 * testing the escaper rather than testing whether the rule was published.
 * @param html - rendered markup.
 * @returns the same markup with the five escapes React emits turned back into characters.
 */
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

/**
 * File one declaration straight into the register.
 *
 * The two signatures are the route's subject, not this file's; what is under test is whether the
 * page shows what the register holds. Every column still satisfies 023's CHECKs, so nothing here
 * could exist on this page that could not exist in production.
 * @param address - the agent.
 * @param revokedAtMs - set to retire it.
 */
async function declare(address: string, revokedAtMs: number | null = null): Promise<void> {
  await testDb().query(
    `INSERT INTO agent_accounts
       (address, operator_address, agent_signature, operator_signature, model, purpose,
        declared_at_ms, revoked_at_ms)
     VALUES ($1, $2, $3, $4, 'claude-opus-5', 'writes the estate notes', 1788566400000, $5)`,
    [address, OPERATOR, `agent-sig-${address}`, `operator-sig-${address}`, revokedAtMs],
  );
}

/**
 * Render the page the way a request would, and return its markup.
 * @returns the static HTML of `/disclosure`.
 */
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
    // The link goes to the record that carries both signatures, so the claim is checkable.
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
    // 1788566400000 is 2026-09-05T00:00:00Z — a record two readers must read identically.
    expect(await render()).toContain('2026-09-05');
  });
});

/*
  The other half of a disclosure posture.

  A register answers "who declared". It does not answer "what were they held to", and the rules
  that answer that were readable only as JSON inside the signed manifest — a machine could read
  them, a person could not. They are on the page now, and these checks read the expected text OUT
  of the manifest rather than repeating it, so an edit to the terms that skips this page turns them
  red instead of publishing two versions of one obligation.

  Mutations predicted: drop the <dl> from the page → every clause check red; render
  `AGENT_DISCLOSURE.enforced` without `notEnforced` → "publishes the limit beside the list" red;
  copy the clauses into the page as literals → the identity pin in agent-manifest.test.ts red
  (checked there, where the manifest is built, rather than here).
*/
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
      /*
        Compared after entity-decoding, because the clauses contain typographic apostrophes and em
        dashes that `renderToStaticMarkup` escapes. Comparing the raw markup would pass or fail on
        the escaping rather than on whether the sentence is published.
      */
      expect(decode(html)).toContain(clause);
    }
  });

  it('publishes the limit beside the list of what is checked', async () => {
    const html = decode(await render());
    for (const item of AGENT_DISCLOSURE.enforced) expect(html).toContain(item);
    /*
      The load-bearing one. A page carrying only the enforced list reads as a promise that anything
      absent from it is enforced elsewhere, which is the reading the manifest's own `notEnforced`
      sentence exists to refuse.
    */
    expect(html).toContain(AGENT_DISCLOSURE.notEnforced);
  });

  it('sends a reader to the signed document the clauses come from', async () => {
    expect(await render()).toContain(AGENT_MANIFEST_PATH);
  });
});
