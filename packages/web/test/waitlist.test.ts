// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MIN_HANDLE_LEN, MAX_HANDLE_LEN } from '@projectx-social/sdk';
import {
  canonicalEmail,
  canonicalHandle,
  handleShapeProblem,
  isPlausibleEmail,
  isWaitlistRole,
  isWaitlistSource,
  WAITLIST_ROLES,
} from '@/lib/waitlist';

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
    expect(handleShapeProblem('a'.repeat(MIN_HANDLE_LEN - 1))).not.toBeNull();
    expect(handleShapeProblem('a'.repeat(MAX_HANDLE_LEN + 1))).not.toBeNull();
    expect(handleShapeProblem('has-a-dash')).not.toBeNull();
    expect(handleShapeProblem('has space')).not.toBeNull();
    expect(handleShapeProblem('emoji🙂')).not.toBeNull();
  });

  it('accepts what the contract accepts', () => {
    for (const handle of ['abc', 'alice', 'bob_99', 'a'.repeat(MAX_HANDLE_LEN)]) {
      expect(handleShapeProblem(handle), handle).toBeNull();
    }
  });

  it('is pinned to the contract ceiling of 30', () => {
    expect(MAX_HANDLE_LEN).toBe(30);
    expect(MIN_HANDLE_LEN).toBe(3);
    expect(handleShapeProblem('a'.repeat(30))).toBeNull();
    expect(handleShapeProblem('a'.repeat(31))).toBe('A handle is at most 30 characters.');
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

describe('the route never turns a failure into a success', () => {
  const route = readFileSync(join(process.cwd(), 'app/api/waitlist/route.ts'), 'utf8');

  it('answers every rejection with a 4xx or 5xx', () => {
    const created = route.match(/status:\s*201/g) ?? [];
    expect(created).toHaveLength(2);

    for (const status of ['400', '422', '424', '503']) {
      expect(route, `status ${status} is unreachable`).toContain(`status: ${status}`);
    }
  });

  it('separates an unconfigured deployment from a failed write', () => {
    expect(route).toContain('waitlist-unconfigured');
    expect(route).toContain('waitlist-store-failed');
  });

  it('does not return the database error to an unauthenticated caller', () => {
    const returnsRaw = /NextResponse\.json\(\s*\{\s*error:\s*(?:error|String\(error\))/.test(route);
    expect(returnsRaw).toBe(false);
    expect(route).toContain('console.error');
  });

  it('matches the handle conflict on both the SQLSTATE and the constraint name', () => {
    expect(route).toContain("'23505'");
    expect(route).toContain('waitlist_signups_handle_idx');
  });
});
