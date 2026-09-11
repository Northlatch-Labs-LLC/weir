// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
/**
 * Signing out has to reach the server.
 *
 * # The defect this pins
 *
 * `signOut` cleared `sessionStorage`, forgot the remembered wallet, and reset React state. All of
 * that is the *browser's* copy of the session. Nothing told the server, so the read-session cookie
 * survived and `provenReader()` went on returning a proved address.
 *
 * Reported as: sign in, sign out, still in the dashboard. That was the visible half and the smaller
 * one. `AppFrame` chooses guest-or-dashboard from that same proved session — but so does
 * `readEntitlements`, so a reader who believed they had signed out still had their paid bodies
 * released by the server. On a shared machine, to whoever sat down next.
 *
 * `DELETE /api/session` revokes by address and clears the cookie. It was written and tested. Nothing
 * called it.
 *
 * # Why the existing tests did not catch it
 *
 * `shell-chrome.test.tsx` mocks the whole provider — `const signOut = vi.fn()` — and asserts the
 * account menu calls it. That proves the *menu* is wired and says nothing about what signing out
 * does, which is how a security-relevant gap sat behind a green suite.
 *
 * # Why this asserts on source
 *
 * Rendering `SignerProvider` for real means standing up the wallet standard, `sessionStorage`, an
 * epoch read and the zkLogin session shape — a lot of scaffolding to observe one `fetch`. What can
 * go wrong here is the call being removed or quietly made conditional, and that is visible in the
 * source.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const PROVIDER = readFileSync(resolve(process.cwd(), 'components/SignerProvider.tsx'), 'utf8');

/** The body of `signOut`, from its declaration to the end of its `useCallback`. */
const SIGN_OUT = (() => {
  const start = PROVIDER.indexOf('const signOut = useCallback(');
  if (start === -1) throw new Error('signOut was not found on the provider');
  const end = PROVIDER.indexOf('const exportRecovery', start);
  return PROVIDER.slice(start, end === -1 ? start + 4000 : end);
})();

describe('signing out', () => {
  it('revokes the session on the server, not just in the browser', () => {
    /*
      The exact regression. Everything else in this function is local state; without this line the
      server never learns, and "signed out" is a statement the browser makes about itself.
    */
    expect(SIGN_OUT).toContain("fetch('/api/session'");
    expect(SIGN_OUT).toContain("method: 'DELETE'");
  });

  it('re-renders the server components afterwards', () => {
    /*
      The frame decided guest-or-dashboard on the previous request. Without a full load it keeps
      rendering the signed-in shell until something else navigates — which is exactly what "I signed
      out and stayed in the dashboard" looks like, even once the cookie is gone.
    */
    expect(SIGN_OUT).toContain("window.location.assign('/')");
  });

  it('clears the browser first, so the UI never waits on the network', () => {
    // A sign-out that appears to do nothing until a request returns is a sign-out people click
    // twice, then distrust.
    // `setZkSigner`, since the wallet half is dapp-kit's `disconnect()` and no longer local state.
    const local = SIGN_OUT.indexOf('setZkSigner(null)');
    const remote = SIGN_OUT.indexOf("fetch('/api/session'");
    expect(local).toBeGreaterThan(-1);
    expect(remote).toBeGreaterThan(local);
  });

  it('does not let a failed revoke throw', () => {
    // The browser is already signed out by then. An unhandled rejection would surface as an error
    // for an action that, locally, succeeded.
    expect(SIGN_OUT).toMatch(/\.catch\(/);
  });
});

describe('the endpoint it calls', () => {
  const ROUTE = readFileSync(resolve(process.cwd(), 'app/api/session/route.ts'), 'utf8');

  it('exists and revokes by address as well as clearing the cookie', () => {
    /*
      Clearing the cookie alone would leave the session row live: anybody holding a copy of that
      token — from a shared machine, a synced browser, a log — could still present it.
    */
    expect(ROUTE).toContain('export async function DELETE');
    expect(ROUTE).toContain('revokeReadSessions');
  });
});
