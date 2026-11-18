// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import type { NextConfig } from 'next';
import { BASE_CSP } from './lib/csp';

const config: NextConfig = {
  distDir: process.env['NEXT_DIST_DIR'] ?? '.next',

  poweredByHeader: false,

  async redirects() {
    return [
      { source: '/treasuries', destination: '/treasury', permanent: true },
      { source: '/notifications', destination: '/alerts', permanent: true },
      { source: '/legal', destination: '/legal/terms', permanent: true },
      { source: '/terms', destination: '/legal/terms', permanent: true },
      { source: '/privacy', destination: '/legal/privacy', permanent: true },
    ];
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'x-projectx-commit',
            /*
              || and not ??

              On a build where the variable exists but is empty, ?? keeps the empty string, and a
              header with an empty value is dropped entirely rather than sent as blank. That is how
              this provenance header silently vanished from production between commit 859d659 and
              the Next 16.4.1 build: the only header that says which build is live disappeared while
              every other security header kept working, so nothing looked wrong.
            */
            value:
              process.env['PROJECTX_BUILD_COMMIT'] ||
              process.env['VERCEL_GIT_COMMIT_SHA'] ||
              'local',
          },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=()',
          },
          {
            // The base policy for everything that is not a rendered document — API routes,
            // static files, worker scripts. Documents get the full nonce policy from the
            // proxy (lib/csp.ts owns the text), which supersedes this header for those
            // responses; the same four break-proof directives are repeated there.
            key: 'Content-Security-Policy',
            value: BASE_CSP,
          },
          {
            // The modern spelling of the same thing. `report-uri` is deprecated but still the
            // only one Chrome, Safari and Firefox all honour today, so both are sent and the
            // endpoint accepts both payload shapes. The document policy names the same
            // endpoint, so enforced-policy violations land in error_events too.
            key: 'Reporting-Endpoints',
            value: 'csp-endpoint="/api/csp-report"',
          },
        ],
      },
    ];
  },
};

export default config;
