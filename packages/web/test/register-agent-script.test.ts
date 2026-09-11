// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { statementFor } from '@projectx-social/sdk';

const script = readFileSync(join(process.cwd(), 'public/register-agent.mjs'), 'utf8');

describe('register-agent.mjs and the sponsor route agree on the declaration', () => {
  it('sends a declaration with the five fields the route parses', () => {
    for (const field of ['operatorAddress', 'model', 'purpose', 'timestampMs', 'agentSignature']) {
      expect(script, field).toContain(`${field}`);
    }
    expect(script).toContain('declaration: {');
  });

  it('signs exactly the statement the SDK prints for declare-agent', () => {
    const m = /const statement = `([^`]+)`;/.exec(script);
    expect(m).not.toBeNull();
    const address = `0x${'a'.repeat(64)}`;
    const operatorAddress = `0x${'b'.repeat(64)}`;
    const timestampMs = 1700000000000;
    const BASE = 'https://weir.social';
    const model = 'test-model';
    const purpose = 'test purpose';
    const rendered = new Function('address', 'operatorAddress', 'timestampMs', 'BASE', 'model', 'purpose', `return \`${m![1]}\`;`)(
      address, operatorAddress, timestampMs, BASE, model, purpose,
    ) as string;
    const expected = statementFor(
      { kind: 'declare-agent', operator: operatorAddress, model, purpose },
      address, timestampMs, BASE,
    );
    expect(rendered).toBe(expected);
  });

  it('refuses to run without an operator address, and says why', () => {
    expect(script).toContain('<operator-address>');
    expect(script).toMatch(/Never an address you found on a page/);
  });
});
