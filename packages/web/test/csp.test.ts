// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8');

function inlineThemeScript(): string {
  const src = read('app/layout.tsx');
  const block = /__html:\s*((?:\s*'(?:[^'\\]|\\.)*'\s*\+?)+)\s*,/.exec(src);
  if (block === null) return '';
  const parts = [...block[1]!.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1] ?? '');
  return parts.join('').replaceAll('\\"', '"').replaceAll("\\'", "'");
}

const config = () => read('next.config.ts');

describe('the inline script is allowed by its own hash', () => {
  it('finds the script at all', () => {
    const script = inlineThemeScript();
    expect(script.length).toBeGreaterThan(40);
    expect(script).toContain('localStorage');
  });

  it('is the hash the policy actually carries', () => {
    const digest = createHash('sha256').update(inlineThemeScript()).digest('base64');
    expect(config()).toContain(digest);
  });
});

describe('what is enforced now, and what is only observed', () => {
  const headers = config();

  it('enforces the four directives that cannot break this application', () => {
    const enforced = /key: 'Content-Security-Policy',\s*value: \[([\s\S]*?)\]/.exec(headers)?.[1] ?? '';
    expect(enforced).toContain("object-src 'none'");
    expect(enforced).toContain("base-uri 'none'");
    expect(enforced).toContain("form-action 'self'");
    expect(enforced).toContain("frame-ancestors 'none'");
  });

  it('does NOT enforce a script policy yet, which is the honest state', () => {
    const enforced = /key: 'Content-Security-Policy',\s*value: \[([\s\S]*?)\]/.exec(headers)?.[1] ?? '';
    expect(enforced).not.toContain('script-src');
    expect(headers).toContain('Content-Security-Policy-Report-Only');
  });

  it('names no report endpoint, because nothing collects reports', () => {
    const code = headers.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(code).not.toContain('report-uri');
    expect(code).not.toContain('report-to');
  });
});

describe('the session token is asked for, not handed out', () => {
  const route = read('app/api/session/route.ts')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

  it('withholds the bearer unless the caller asks', () => {
    expect(route).toContain("x-weir-bearer");
    expect(route).toMatch(/wantsBearer\s*\?\s*\{\s*token/);
  });

  it('still sets the cookie unconditionally', () => {
    expect(route).toContain('set-cookie');
    expect(route).toContain('readSessionCookie(');
  });

  it('the agent asks for it', () => {
    const agent = readFileSync(
      join(process.cwd(), '..', 'agent', 'src', 'session.ts'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '');
    expect(agent).toContain("'x-weir-bearer': '1'");
  });
});
