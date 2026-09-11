// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sources = join(import.meta.dirname, '../../../sui-contracts/sources');
const vault = readFileSync(join(sources, 'stake_vault.move'), 'utf8');

const EXPECTED_CALLERS: Record<string, string> = {
  withdraw:
    'unwinds a tranche when the liquid buffer is short; unwinding realises staking rewards, ' +
    'which are split like any other yield',
  harvest: 'the ordinary path — rewards from matured tranches',
};

const LADDER_CALL = /stake_ladder::[a-z_]+\s*\(/;

function functions(source: string): Map<string, string> {
  const declaration = /^(?:public(?:\([a-z]+\))?\s+)?(?:entry\s+)?fun\s+([a-z_0-9]+)/gm;
  const starts: { name: string; at: number }[] = [];
  for (const match of source.matchAll(declaration)) {
    const name = match[1];
    if (name === undefined || match.index === undefined) continue;
    starts.push({ name, at: match.index });
  }
  const out = new Map<string, string>();
  starts.forEach((start, i) => {
    const next = starts[i + 1];
    out.set(start.name, source.slice(start.at, next ? next.at : source.length));
  });
  return out;
}

const bodies = functions(vault);

function code(body: string): string[] {
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('//') && !line.startsWith('/*'));
}

describe('the rebate pool is funded by staking yield only', () => {
  it('parsed the module', () => {
    expect(bodies.has('credit_proceeds')).toBe(true);
    expect(bodies.has('harvest')).toBe(true);
    expect(bodies.has('withdraw')).toBe(true);
    expect(bodies.size).toBeGreaterThan(20);
  });

  it('adds to rebate_pool at exactly one place, inside credit_proceeds', () => {
    const adding: { fn: string; line: string }[] = [];
    for (const [name, body] of bodies) {
      for (const line of code(body)) {
        if (/rebate_pool\s*\.\s*join\s*\(/.test(line)) adding.push({ fn: name, line });
      }
    }

    expect(adding.map((a) => a.fn)).toEqual(['credit_proceeds']);
    expect(adding[0]?.line).toContain('rebate_cut');
  });

  it('calls credit_proceeds only from the expected functions', () => {
    const callers = [...bodies]
      .filter(([name, body]) =>
        name !== 'credit_proceeds' && code(body).some((l) => l.includes('credit_proceeds(')),
      )
      .map(([name]) => name)
      .sort();

    expect(callers).toEqual(Object.keys(EXPECTED_CALLERS).sort());
  });

  it('hands credit_proceeds a balance that came from the staking ladder', () => {
    for (const caller of Object.keys(EXPECTED_CALLERS)) {
      const body = bodies.get(caller);
      expect(body, `${caller} is missing`).toBeDefined();
      const lines = code(body ?? '');

      const call = lines.find((l) => l.includes('credit_proceeds('));
      expect(call, `${caller} does not call credit_proceeds`).toBeDefined();

      const balance = call?.match(/credit_proceeds\s*\(\s*[a-z_]+\s*,\s*([a-z_0-9]+)/)?.[1];
      expect(balance, `could not read the balance argument in ${caller}`).toBeDefined();

      const binding = lines.find(
        (l) => l.includes(`let (`) && l.includes(balance!) && LADDER_CALL.test(l),
      );
      expect(
        binding,
        `${caller} passes '${balance}' to credit_proceeds without binding it from stake_ladder`,
      ).toBeDefined();
    }
  });

  it('is the only module that names the rebate pool', () => {
    const others = readdirSync(sources)
      .filter((f) => f.endsWith('.move') && f !== 'stake_vault.move')
      .filter((f) => readFileSync(join(sources, f), 'utf8').includes('rebate_pool'));

    expect(others).toEqual([]);
  });
});
