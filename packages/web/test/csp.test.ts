// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
//
// The content policy, and the session token that used to be handed to everybody.
//
// Two findings, one file, because they are one blast radius: a bearer token in a response body is
// only reachable by script running on this origin, and a content policy is what bounds what script
// can run there. Neither is much use to an attacker without the other, and neither fix is complete
// on its own.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8');

/**
 * The inline script exactly as the browser receives it, rebuilt from the layout source.
 *
 * Extracted rather than pasted, so this cannot agree with a stale copy of itself.
 */
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
    // Guards against a vacuous pass: an empty script hashes to something, and every assertion
    // below would then compare two confident wrong values.
    const script = inlineThemeScript();
    expect(script.length).toBeGreaterThan(40);
    expect(script).toContain('localStorage');
  });

  it('is the hash the policy actually carries', () => {
    /*
      The drift this exists for: edit the theme script, forget the config, and the policy blocks the
      one script it was written to allow. In report-only that is a console full of violations for a
      page that works; enforced later, it is a page that does not.
    */
    const digest = createHash('sha256').update(inlineThemeScript()).digest('base64');
    expect(config()).toContain(digest);
  });
});

describe('what is enforced now, and what is only observed', () => {
  const headers = config();

  it('enforces the four directives that cannot break this application', () => {
    /*
      These govern surfaces this application does not use, so they need no report period. `base-uri`
      is the one worth naming: it stops injected markup rewriting every relative URL on the page,
      which is the XSS primitive that survives an otherwise good script policy.
    */
    const enforced = /key: 'Content-Security-Policy',\s*value: \[([\s\S]*?)\]/.exec(headers)?.[1] ?? '';
    expect(enforced).toContain("object-src 'none'");
    expect(enforced).toContain("base-uri 'none'");
    expect(enforced).toContain("form-action 'self'");
    expect(enforced).toContain("frame-ancestors 'none'");
  });

  it('does NOT enforce a script policy yet, which is the honest state', () => {
    // Enforcing a guess about a framework's own inline script takes the site down for everybody
    // rather than for an attacker. The report-only header is the measurement that comes first.
    const enforced = /key: 'Content-Security-Policy',\s*value: \[([\s\S]*?)\]/.exec(headers)?.[1] ?? '';
    expect(enforced).not.toContain('script-src');
    expect(headers).toContain('Content-Security-Policy-Report-Only');
  });

  it('names no report endpoint, because nothing collects reports', () => {
    /*
      A `report-uri` pointing nowhere looks like collection and drops every report on the floor.

      Comments stripped first: the config's own note explains that there is no `report-uri`, and the
      first version of this assertion matched that sentence and failed against a policy that was
      correct. A source assertion that cannot tell code from a comment about code is matched by
      nothing that runs — the third time that exact trap has been hit tonight.
    */
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
    /*
      The browser never read it. `SessionBridge` fires this POST and calls `router.refresh()`; the
      cookie does the work. So the exposure had no beneficiary: script on this origin could lift a
      day-long credential out of a response nobody was reading.
    */
    expect(route).toContain("x-weir-bearer");
    expect(route).toMatch(/wantsBearer\s*\?\s*\{\s*token/);
  });

  it('still sets the cookie unconditionally', () => {
    // The cookie is the browser's credential and is untouched — same attributes, same lifetime.
    expect(route).toContain('set-cookie');
    expect(route).toContain('readSessionCookie(');
  });

  it('the agent asks for it', () => {
    // The caller the body token exists for: it holds a key, has no cookie jar, and would otherwise
    // parse Set-Cookie for a credential we just minted for it.
    const agent = readFileSync(
      join(process.cwd(), '..', 'agent', 'src', 'session.ts'),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '');
    expect(agent).toContain("'x-weir-bearer': '1'");
  });
});
