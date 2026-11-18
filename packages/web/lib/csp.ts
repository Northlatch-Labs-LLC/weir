// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
//
// One module owns the document Content-Security-Policy so the two places that need it —
// the proxy that writes the header per request, and the tests that assert the header —
// can never disagree about what the policy says.
//
// Why a nonce, and why the flip was never a header change. The production document HTML
// carries five inline <script> tags: two static (the theme pick and the service-worker
// registration, allowed here by their own hashes) and three RSC flight-data payloads that
// React writes as self.__next_f.push(...) with page-content bytes inside — different on
// every request, impossible to hash. A hash-pinned policy enforced over that would have
// blocked hydration on every page. A nonce turns per-request content from a liability
// into the allow-list: the proxy mints one nonce per document request, Next.js applies
// it to the scripts it renders — bootstrap and flight payloads included — and layout
// passes it to the two handwritten scripts. Anything without the nonce still does not run.

import { createHash } from 'node:crypto';

/// The two handwritten inline scripts in app/layout.tsx, allowed by hash as well as by
/// nonce: a page rendered through a path that missed the nonce header still runs them,
/// and the tests here fail if either script changes without these hashes changing.
const INLINE_THEME_SCRIPT_SHA256 = 'xOzuRG2yFs86iI5GqL/OQiIlHl49POOgQv+m9I8u4o0=';
const INLINE_SW_SCRIPT_SHA256 = 'uLL3CQubsanfRr5a5efKchfddDFP/G7jwCha6hB0cu4=';

/// Header the proxy uses to hand the minted nonce to the server components that need it.
export const CSP_NONCE_HEADER = 'x-csp-nonce';

/// sha256 of a literal inline script, base64 — for asserting the hashes match the source.
export function inlineScriptHash(script: string): string {
  return createHash('sha256').update(script).digest('base64');
}

/// The document policy, enforced. Violations still report, so a script that renders
/// without its nonce is visible in error_events rather than silently blank.
export function cspFor(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'sha256-${INLINE_THEME_SCRIPT_SHA256}' 'sha256-${INLINE_SW_SCRIPT_SHA256}'`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // Report violations of the ENFORCED policy: something tried to run without a nonce
    // and was blocked. The endpoint exists (app/api/csp-report) and writes error_events,
    // where the hourly alarm already counts.
    'report-uri /api/csp-report',
    'report-to csp-endpoint',
  ].join('; ');
}

/// The directives enforced on every response including API routes and static assets,
/// where a document policy with a per-request nonce has nothing to say.
export const BASE_CSP = [
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export { INLINE_THEME_SCRIPT_SHA256, INLINE_SW_SCRIPT_SHA256 };
