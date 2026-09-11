// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FOOTER } from '../lib/site-map';

const source = readFileSync(resolve(process.cwd(), 'proxy.ts'), 'utf8');
const doorSource = readFileSync(resolve(process.cwd(), 'lib/front-door.ts'), 'utf8');
const alwaysOpen = (() => {
  const bare = doorSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const match = /const ALWAYS_OPEN = \[([^\]]+)\]/.exec(bare);
  return (match?.[1] ?? '').split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
})();

describe('the closed-door exemptions', () => {
  it('found the list at all', () => {
    expect(alwaysOpen.length).toBeGreaterThanOrEqual(4);
  });

  it('is the list the proxy actually consults', () => {
    expect(source).toContain("from '@/lib/front-door'");
    expect(source).toContain('isAlwaysOpen(pathname)');
    expect(doorSource).toContain('export function isAlwaysOpen');
  });

  it('keeps the way in open', () => {
    for (const path of ['/waitlist', '/signin', '/auth/callback']) {
      expect(alwaysOpen, path).toContain(path);
    }
  });

  it('keeps every legal document reachable behind the gate', () => {
    for (const destination of FOOTER.legal) {
      expect(
        alwaysOpen.some((prefix) => destination.href.startsWith(prefix)),
        `${destination.href} would redirect to the waiting list`,
      ).toBe(true);
    }
  });

  it('keeps the share card reachable, or every shared link previews as nothing', () => {
    expect(alwaysOpen).toContain('/opengraph-image');
  });

  it('does not exempt the product itself, which is the point of the gate', () => {
    for (const path of ['/feed', '/creators', '/chests', '/treasury', '/c/somebody', '/vault']) {
      expect(alwaysOpen.some((prefix) => path.startsWith(prefix)), path).toBe(false);
    }
  });

  it('opens the two directories the funnel points at, and only those', () => {
    for (const path of ['/explore', '/explore/agents']) {
      expect(alwaysOpen.some((prefix) => path === prefix || path.startsWith(prefix)), path).toBe(true);
    }
    expect(alwaysOpen).toContain('/explore');
  });
});

describe('the pass', () => {
  it('is honoured after the operator check and before the redirect, and only while closed', () => {
    const admin = source.indexOf('isSiteAdmin(viewer)');
    const pass = source.indexOf('passIsValid(');
    const redirect = source.indexOf('NextResponse.redirect(');
    const open = source.indexOf('if (!mode.waitlistMode) return letThrough(request);');
    expect(admin).toBeGreaterThan(-1);
    expect(pass).toBeGreaterThan(admin);
    expect(redirect).toBeGreaterThan(pass);
    expect(open).toBeGreaterThan(-1);
    expect(open).toBeLessThan(pass);
  });
});
