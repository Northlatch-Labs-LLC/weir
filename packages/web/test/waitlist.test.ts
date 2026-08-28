// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  canonicalEmail,
  canonicalHandle,
  handleShapeProblem,
  isPlausibleEmail,
  isWaitlistRole,
  isWaitlistSource,
  WAITLIST_ROLES,
} from '@/lib/waitlist';

/*
  The list is the only unauthenticated write on this platform, so the guards around it are the whole
  of its security. These tests pin the pure half; the route's status contract is asserted
  structurally at the foot of the file.
*/

describe('an address has to be one we could actually send to', () => {
  it('accepts ordinary addresses', () => {
    for (const address of ['a@b.co', 'someone@example.com', 'first.last+tag@sub.domain.org']) {
      expect(isPlausibleEmail(address), address).toBe(true);
    }
  });

  it('rejects what cannot deliver', () => {
    for (const address of [
      '',
      'nope',
      'no-at-sign.com',
      'two@@example.com',
      'trailing@dot.',
      '@example.com',
      'user@',
      'user@nodot',
      'user@empty..label',
      'has space@example.com',
    ]) {
      expect(isPlausibleEmail(address), address).toBe(false);
    }
  });

  it('rejects an address longer than one can be', () => {
    expect(isPlausibleEmail(`${'a'.repeat(250)}@example.com`)).toBe(false);
  });

  it('stores one person as one row regardless of how they typed it', () => {
    expect(canonicalEmail('  Someone@Example.COM ')).toBe('someone@example.com');
  });
});

describe('a handle is checked for shape before it is ever looked up', () => {
  it('treats an absent handle as fine, because the field is optional', () => {
    expect(handleShapeProblem('')).toBeNull();
    expect(handleShapeProblem('   ')).toBeNull();
    expect(canonicalHandle('   ')).toBeNull();
  });

  it('strips the @ and lower-cases, matching the CHECK in 014', () => {
    expect(canonicalHandle('@Alice')).toBe('alice');
    expect(canonicalHandle('BOB_99')).toBe('bob_99');
  });

  it('rejects handles the contract would reject', () => {
    expect(handleShapeProblem('ab')).not.toBeNull();
    expect(handleShapeProblem('a'.repeat(33))).not.toBeNull();
    expect(handleShapeProblem('has-a-dash')).not.toBeNull();
    expect(handleShapeProblem('has space')).not.toBeNull();
    expect(handleShapeProblem('emoji🙂')).not.toBeNull();
  });

  it('accepts what the contract accepts', () => {
    for (const handle of ['abc', 'alice', 'bob_99', 'a'.repeat(32)]) {
      expect(handleShapeProblem(handle), handle).toBeNull();
    }
  });
});

describe('closed sets, because both are written to our table from a request body', () => {
  it('accepts only the three roles', () => {
    for (const role of WAITLIST_ROLES) expect(isWaitlistRole(role)).toBe(true);
    for (const bad of ['admin', '', 'CREATOR', null, 7, {}]) expect(isWaitlistRole(bad)).toBe(false);
  });

  it('accepts only known sources', () => {
    expect(isWaitlistSource('waitlist')).toBe(true);
    for (const bad of ['anything', '', null, 3]) expect(isWaitlistSource(bad)).toBe(false);
  });
});

/*
  The invariant that matters most, asserted against the source rather than by calling the route.

  Every failure branch has to be reachable and distinct, and none of them may return a 2xx. A route
  that answered 201 on a failed write would tell somebody they had joined a list that never received
  them — the single outcome this feature exists to prevent, and the one no test of the pure functions
  would catch.
*/
describe('the route never turns a failure into a success', () => {
  const route = readFileSync(join(process.cwd(), 'app/api/waitlist/route.ts'), 'utf8');

  it('answers every rejection with a 4xx or 5xx', () => {
    // The only 201s permitted: a real insert, and the honeypot — which stores nothing and must not
    // reveal that it tripped.
    const created = route.match(/status:\s*201/g) ?? [];
    expect(created).toHaveLength(2);

    // 424 rather than 502 for the failed write: the edge in front of this deployment
    // replaces 502 bodies with its own HTML error page, which the browser then fails to
    // parse as JSON — 424 carries the route's honest message through untouched.
    for (const status of ['400', '422', '424', '503']) {
      expect(route, `status ${status} is unreachable`).toContain(`status: ${status}`);
    }
  });

  it('separates an unconfigured deployment from a failed write', () => {
    expect(route).toContain('waitlist-unconfigured');
    expect(route).toContain('waitlist-store-failed');
  });

  it('does not return the database error to an unauthenticated caller', () => {
    // The message is logged; the response says only that it failed. A Postgres error names tables,
    // columns and constraints, which is a description of our schema handed to anyone who asks.
    const returnsRaw = /NextResponse\.json\(\s*\{\s*error:\s*(?:error|String\(error\))/.test(route);
    expect(returnsRaw).toBe(false);
    expect(route).toContain('console.error');
  });

  it('matches the handle conflict on both the SQLSTATE and the constraint name', () => {
    expect(route).toContain("'23505'");
    expect(route).toContain('waitlist_signups_handle_idx');
  });
});
