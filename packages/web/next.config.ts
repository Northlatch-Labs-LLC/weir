// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import type { NextConfig } from 'next';

/*
  No `transpilePackages`, and no bundler resolution overrides.

  Building the library is the fix rather than the workaround. It also keeps the SDK honest for its
  other consumer, the daemon, which runs under Node where extensionless imports are not valid ESM.
*/
/*
  There is deliberately no `output: 'standalone'` here, and the container is why.

  Standalone traces the files the server imports and copies those. pnpm exposes a package to its
  dependents through a symlink into `node_modules/.pnpm/<name>@<version>/`, and the tracer copies
  the resolved files without the symlink — so the image booted and died on MODULE_NOT_FOUND for
  `@swc/helpers`, which was present in the image the entire time, one directory away, unreachable
  by the path Next's own code resolves. `packages/web/Dockerfile` records the three fixes measured
  and why shipping the installed workspace beats all of them.
*/
/*
  The build directory is overridable, so a verification build cannot break a running dev server.

  `NEXT_DIST_DIR=.next-verify next build` now leaves the dev server's directory untouched. Unset,
  the default is exactly what it was.
*/
/**
 * SHA-256 of the one inline script this application serves: the theme restore in `app/layout.tsx`.
 *
 * A hash rather than a nonce because the script is static, so there is nothing per-request to
 * generate and no middleware to thread it through. `test/csp.test.ts` recomputes this from the
 * layout source, so a change to that script fails a test rather than silently producing a policy
 * that blocks it.
 */
const INLINE_THEME_SCRIPT_SHA256 = 'xOzuRG2yFs86iI5GqL/OQiIlHl49POOgQv+m9I8u4o0=';

const config: NextConfig = {
  distDir: process.env['NEXT_DIST_DIR'] ?? '.next',

  /*
    `X-Powered-By: Next.js` is free reconnaissance and buys the reader nothing. Off.
  */
  poweredByHeader: false,

  /*
    Every response says which commit built it.

    `VERCEL_GIT_COMMIT_SHA` is set by the platform at build time. A header rather than a route,
    deliberately: a `/api/version` endpoint nothing calls would be unreachable surface, which the
    reachability guard exists to refuse — and its allowlist is empty, which is worth keeping.

    Locally the variable is unset and this reads `local`, which is true and visibly not a SHA.
  */
  /*
    There is no legacy-host redirect here, and that is a decision rather than an omission.

    A redirect was written and tested before that was settled, and removed once it was: a permanent
    redirect from a host nobody links to is configuration that can only ever be wrong later. If the
    old host is ever revived, the redirect belongs in the DNS layer where the host lives, not in
    this application — which would otherwise carry a rule for a domain it never serves.
  */
  /*
    `/treasuries` was the route's first name; the page, the header and every title call it the
    Treasury. Permanent, because the old address was shared while it was the only one.
  */
  async redirects() {
    return [
      { source: '/treasuries', destination: '/treasury', permanent: true },
      // Same story: the nav, the tab title and the page all say Alerts.
      { source: '/notifications', destination: '/alerts', permanent: true },
      // `/legal` has no index route; only the three sub-pages exist, so a typed URL landed on the 404.
      { source: '/legal', destination: '/legal/terms', permanent: true },
    ];
  },

  /*
    Four headers this origin had none of, and the session cookie is why they matter here more than
    anywhere else in the estate.

    `X-Frame-Options: DENY` — /signin can otherwise be framed by an attacker page and clicked
    through by a visitor who thinks they are clicking something else. The consequence is not a
    defaced page: it is a sign-in, or a wallet approval, that the visitor authorised without
    knowing what they authorised. DENY rather than SAMEORIGIN because nothing here frames itself —
    there is no iframe and no embed route in this package.

    `X-Content-Type-Options: nosniff` — without it a response served with a loose content type can
    be sniffed into `text/html` and executed *on this origin*, which is the origin holding the
    HttpOnly session cookie. HttpOnly stops a script reading the cookie; it does nothing about a
    script that simply makes requests the cookie authorises.

    `Referrer-Policy` and `Permissions-Policy` are the cheap two: stop the full URL leaving on
    outbound links, and refuse four device capabilities this app never calls. Verified against the
    source rather than assumed — nothing here touches getUserMedia, the Geolocation API or
    PaymentRequest, so denying them costs nothing today and denies them by default to whatever is
    written next.

    Deliberately not here: `Content-Security-Policy`, which needs a report-only period against real
    traffic before it can be enforced, and `Strict-Transport-Security`, whose `preload` is a
    one-way door and the operator's call, not this file's.

    The values match `projectx-website/next.config.mjs` and `projectx-raffle/web/vercel.json` on
    purpose — one estate should not have three answers to the same question.

    Caveat, which cannot be settled from this tree: weir.social is fronted by Cloudflare. What Next
    emits is what the origin sends, not necessarily what the edge finally serves — the edge may add
    to these or override them. Prove it on the live response, not on this file.
  */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'x-projectx-commit',
            value: process.env['VERCEL_GIT_COMMIT_SHA'] ?? 'local',
          },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=()',
          },
          /*
            Two policies, and the split is the point.

            The note above says a Content-Security-Policy "needs a report-only period against real
            traffic before it can be enforced". That is true of the directives that govern scripts
            and styles: this is a Next application, the framework injects its own inline script and
            style, and enforcing a guess about them takes the site down for everybody rather than
            for an attacker. It is NOT true of the four directives below, which govern surfaces this
            application does not use at all — so they are enforced now rather than waiting behind a
            report period they do not need.

            ENFORCED. `object-src 'none'` removes plugin embedding; `base-uri 'none'` stops injected
            markup rewriting every relative URL on the page, which is the one XSS primitive that
            survives a good script policy; `form-action 'self'` stops an injected form posting
            somewhere else; `frame-ancestors 'none'` is the modern `X-Frame-Options: DENY`, kept
            beside it because the old header is what older browsers read. Nothing here can break a
            page that was not already doing one of those four things, and this one does none.
          */
          {
            key: 'Content-Security-Policy',
            value: [
              "object-src 'none'",
              "base-uri 'none'",
              "form-action 'self'",
              "frame-ancestors 'none'",
            ].join('; '),
          },
          /*
            REPORT-ONLY, and it enforces nothing. It is the report period the note asked for, made
            concrete: a browser evaluates this policy, breaks nothing, and names every violation in
            the console. What it buys is the list of exceptions this application actually needs,
            measured rather than guessed, so enforcement later is an edit to a string rather than a
            new investigation.

            `script-src` carries the SHA-256 of the one inline script in this application — the
            theme restore in `app/layout.tsx`, which is static and therefore hashable, so no nonce
            and no middleware are needed. `test/csp.test.ts` recomputes that hash from the layout
            source and fails if the two drift, because a stale hash here would be a policy that
            blocks the very script it was written to allow.

            There is no `report-uri`: nothing collects reports yet, and naming an endpoint that does
            not exist would look like collection while dropping every report on the floor.
          */
          {
            key: 'Content-Security-Policy-Report-Only',
            value: [
              "default-src 'self'",
              `script-src 'self' 'sha256-${INLINE_THEME_SCRIPT_SHA256}'`,
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "connect-src 'self'",
              "font-src 'self'",
              "object-src 'none'",
              "base-uri 'none'",
              "form-action 'self'",
              "frame-ancestors 'none'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default config;
