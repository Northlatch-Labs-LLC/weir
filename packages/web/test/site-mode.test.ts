// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const PROXY = readFileSync(resolve(process.cwd(), 'proxy.ts'), 'utf8');
const DOOR = readFileSync(resolve(process.cwd(), 'lib/front-door.ts'), 'utf8');
const ADMIN = readFileSync(resolve(process.cwd(), 'lib/site-admin.ts'), 'utf8');
const MODE = readFileSync(resolve(process.cwd(), 'lib/site-mode.ts'), 'utf8');
const ROUTE = readFileSync(resolve(process.cwd(), 'app/api/site-mode/route.ts'), 'utf8');

function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('the gate', () => {
  it('is a proxy, because middleware is deprecated in Next 16', () => {
    expect(PROXY).toContain('export async function proxy');
  });

  it('lets the waiting list, sign-in and the API through', () => {
    for (const path of ['/waitlist', '/signin', '/auth/callback', '/api/']) {
      expect(DOOR).toContain(`'${path}'`);
    }
    expect(PROXY).toContain("from '@/lib/front-door'");
    expect(PROXY).toContain('isAlwaysOpen(pathname)');
  });

  it('lets the site administrator through, so closing cannot lock them out', () => {
    expect(PROXY).toContain('isSiteAdmin');
  });

  it('identifies that administrator from a proved session, never from ?reader=', () => {
    expect(PROXY).toContain('provenReaderFor');
    expect(PROXY).not.toContain('searchParams.get');
  });

  it('redirects temporarily, so a reopened site is not cached shut', () => {
    expect(PROXY).toContain('307');
    expect(PROXY).not.toMatch(/redirect\([^)]*,\s*308\)/);
  });

  it('gates by exclusion, so a page added later is covered by default', () => {
    expect(PROXY).toMatch(/matcher/);
    expect(PROXY).toContain('?!_next/static');
  });
});

describe('who may close the site', () => {
  it('is asked of the chain, not of a table or an environment variable', () => {
    expect(ADMIN).toContain('listOwnedObjects');
    expect(code(ADMIN)).not.toMatch(/ADMIN_ADDRESS|allowlist|isAdmin\s*=\s*\[/);
  });

  it('checks the Publisher belongs to THIS package', () => {
    expect(ADMIN).toContain('0x2::package::Publisher');
    expect(ADMIN).toContain('samePackage');
    expect(ADMIN).toContain('config.value.packageId');
  });

  it('treats a failed read as "no", never as permission', () => {
    expect(ADMIN).toMatch(/catch\s*{[^}]*return false/s);
  });

  it('is not the PlatformCap', () => {
    expect(code(ADMIN)).not.toContain('PlatformCap');
  });
});

describe('the API', () => {
  it('proves both who is asking and whether they may', () => {
    expect(ROUTE).toContain('provenReaderFor');
    expect(ROUTE).toContain('isSiteAdmin');
  });

  it('refuses a non-boolean rather than coercing it', () => {
    expect(ROUTE).toContain("typeof waitlistMode !== 'boolean'");
  });

  it('answers a refusal identically whoever asked', () => {
    const refusals = ROUTE.match(/does not administer the site/g) ?? [];
    expect(refusals.length).toBe(1);
  });
});

describe('reading the mode', () => {
  it('fails open: an unreadable mode serves the site rather than shutting it', () => {
    // A read that fails is not a decision to gate. Returning the gated value on an error would take
    // the whole site down on one bad query, which is the larger failure of the two.
    expect(MODE).toMatch(/catch\s*{[\s\S]{0,200}return OPEN/);
  });

  it('does not check authority itself', () => {
    expect(MODE).not.toContain('isSiteAdmin');
  });
});
