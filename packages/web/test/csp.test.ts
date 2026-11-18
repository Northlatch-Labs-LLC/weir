// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8');

function inlineScripts(): string[] {
  const src = read('app/layout.tsx');
  // The first quoted string is mandatory and every further one must begin with a literal '+', so
  // the engine can never split the same text two ways — the earlier form, with an optional '+'
  // inside a repeated group, could backtrack exponentially and CodeQL flagged it (js/redos).
  const blocks = [...src.matchAll(/__html:\s*('(?:[^'\\\n]|\\.)*'(?:\s*\+\s*'(?:[^'\\\n]|\\.)*')*)\s*,/g)];
  return blocks.map((block) => {
    const parts = [...block[1]!.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1] ?? '');
    return parts.join('').replaceAll('\\"', '"').replaceAll("\\'", "'");
  });
}

function inlineThemeScript(): string {
  return inlineScripts()[0] ?? '';
}

function inlineServiceWorkerScript(): string {
  return inlineScripts()[1] ?? '';
}

const cspModule = () => read('lib/csp.ts');
const config = () => read('next.config.ts');
const proxy = () => read('proxy.ts');
const layout = () => read('app/layout.tsx');

describe('the inline script is allowed by its own hash', () => {
  it('finds the script at all', () => {
    const script = inlineThemeScript();
    expect(script.length).toBeGreaterThan(40);
    expect(script).toContain('localStorage');
  });

  it('is the hash the policy actually carries', () => {
    const digest = createHash('sha256').update(inlineThemeScript()).digest('base64');
    expect(cspModule()).toContain(`'${digest}'`);
  });
});

describe('the service worker registration script is allowed by its own hash', () => {
  it('finds the second inline script at all', () => {
    const script = inlineServiceWorkerScript();
    expect(script.length).toBeGreaterThan(40);
    expect(script).toContain('serviceWorker');
  });

  it('is the hash the policy actually carries', () => {
    const digest = createHash('sha256').update(inlineServiceWorkerScript()).digest('base64');
    expect(cspModule()).toContain(`'${digest}'`);
  });
});

describe('the document policy is enforced with a per-request nonce', () => {
  const moduleSrc = cspModule();

  it('builds a script policy from a nonce plus the two hashes', () => {
    expect(moduleSrc).toContain("'nonce-${nonce}'");
    const theme = createHash('sha256').update(inlineThemeScript()).digest('base64');
    const sw = createHash('sha256').update(inlineServiceWorkerScript()).digest('base64');
    expect(moduleSrc).toContain(theme);
    expect(moduleSrc).toContain(sw);
  });

  it('enforces the four directives that cannot break this application', () => {
    expect(moduleSrc).toContain("object-src 'none'");
    expect(moduleSrc).toContain("base-uri 'none'");
    expect(moduleSrc).toContain("form-action 'self'");
    expect(moduleSrc).toContain("frame-ancestors 'none'");
  });

  it('reports violations of the ENFORCED policy to the endpoint that exists', () => {
    expect(moduleSrc).toContain('report-uri /api/csp-report');
    expect(config()).toContain('Reporting-Endpoints');
  });

  it('the report-only header is gone — enforcement superseded it, not joined it', () => {
    expect(config()).not.toContain('Content-Security-Policy-Report-Only');
  });
});

describe('the proxy mints and the layout consumes the nonce', () => {
  it('the proxy mints one nonce per request and writes the policy on the response', () => {
    const src = proxy();
    expect(src).toContain('crypto.randomUUID()');
    expect(src).toContain('headers.set(CSP_NONCE_HEADER, nonce)');
    expect(src).toContain("response.headers.set('Content-Security-Policy', cspFor(nonce))");
  });

  it('layout reads the nonce and passes it to BOTH handwritten scripts', () => {
    const src = layout();
    expect(src).toContain('CSP_NONCE_HEADER');
    expect(src.match(/nonce=\{nonce\}/g)?.length ?? 0).toBe(2);
  });
});

describe('the base policy still guards what documents do not cover', () => {
  it('next.config enforces the four directives on API routes and static files', () => {
    expect(config()).toContain('BASE_CSP');
    expect(cspModule()).toContain('BASE_CSP');
  });
});

describe('the CSP report endpoint', () => {
  const route = read('app/api/csp-report/route.ts');
  it('exists and writes where the alarm already counts', () => {
    expect(route).toContain('error_events');
  });
});
