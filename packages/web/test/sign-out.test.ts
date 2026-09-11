// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const PROVIDER = readFileSync(resolve(process.cwd(), 'components/SignerProvider.tsx'), 'utf8');

const SIGN_OUT = (() => {
  const start = PROVIDER.indexOf('const signOut = useCallback(');
  if (start === -1) throw new Error('signOut was not found on the provider');
  const end = PROVIDER.indexOf('const exportRecovery', start);
  return PROVIDER.slice(start, end === -1 ? start + 4000 : end);
})();

describe('signing out', () => {
  it('revokes the session on the server, not just in the browser', () => {
    expect(SIGN_OUT).toContain("fetch('/api/session'");
    expect(SIGN_OUT).toContain("method: 'DELETE'");
  });

  it('re-renders the server components afterwards', () => {
    expect(SIGN_OUT).toContain("window.location.assign('/')");
  });

  it('clears the browser first, so the UI never waits on the network', () => {
    const local = SIGN_OUT.indexOf('setZkSigner(null)');
    const remote = SIGN_OUT.indexOf("fetch('/api/session'");
    expect(local).toBeGreaterThan(-1);
    expect(remote).toBeGreaterThan(local);
  });

  it('does not let a failed revoke throw', () => {
    expect(SIGN_OUT).toMatch(/\.catch\(/);
  });
});

describe('the endpoint it calls', () => {
  const ROUTE = readFileSync(resolve(process.cwd(), 'app/api/session/route.ts'), 'utf8');

  it('exists and revokes by address as well as clearing the cookie', () => {
    expect(ROUTE).toContain('export async function DELETE');
    expect(ROUTE).toContain('revokeReadSessions');
  });
});
