// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
//
// The cap is only real if claims are settled against the chain.
//
// `confirmClaimsFromChain` existed, was documented as "called before counting seats", and was
// called by nothing. Seats are released by their hold expiring, so with nothing ever setting
// `claimed_at_ms` a registration that SUCCEEDED — gas spent, handle live on chain — had its seat
// recycled fifteen minutes later. The offer would not have been fifty; it would have been fifty
// every fifteen minutes until the sponsor wallet was empty.
//
// A unit test cannot catch that: every function involved was individually correct. What was wrong
// was that one of them was never invoked. So this asserts the WIRING, by reading the route.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const route = readFileSync(join(process.cwd(), 'app/api/agents/sponsor/route.ts'), 'utf8');

/** Source with comments stripped, so a mention in prose is never mistaken for a call. */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('the sponsorship route settles claims before it counts seats', () => {
  const code = codeOf(route);

  it('calls confirmClaimsFromChain, and not only in a comment', () => {
    expect(code).toContain('confirmClaimsFromChain(');
  });

  it('calls it in both the POST and the GET path', () => {
    // Two call sites: one before reserving a seat, one before publishing the public counter.
    const calls = code.match(/confirmClaimsFromChain\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
  });

  it('settles before it reserves, not after', () => {
    // Order is the whole point. Confirming after the reservation would count this request's own
    // seat against a stale picture and hand out a seat that was already spent.
    const settle = code.indexOf('confirmClaimsFromChain(');
    const reserve = code.indexOf('reserveSeat(');
    expect(settle).toBeGreaterThan(-1);
    expect(reserve).toBeGreaterThan(-1);
    expect(settle).toBeLessThan(reserve);
  });

  it('settles before it reads the count it publishes', () => {
    const lastSettle = code.lastIndexOf('confirmClaimsFromChain(');
    const count = code.indexOf('seatsRemaining(');
    expect(lastSettle).toBeLessThan(count);
  });
});
