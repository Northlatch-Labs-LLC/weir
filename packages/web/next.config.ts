// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import type { NextConfig } from 'next';

const INLINE_THEME_SCRIPT_SHA256 = 'xOzuRG2yFs86iI5GqL/OQiIlHl49POOgQv+m9I8u4o0=';

const config: NextConfig = {
  distDir: process.env['NEXT_DIST_DIR'] ?? '.next',

  poweredByHeader: false,

  async redirects() {
    return [
      { source: '/treasuries', destination: '/treasury', permanent: true },
      { source: '/notifications', destination: '/alerts', permanent: true },
      { source: '/legal', destination: '/legal/terms', permanent: true },
    ];
  },

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
          {
            key: 'Content-Security-Policy',
            value: [
              "object-src 'none'",
              "base-uri 'none'",
              "form-action 'self'",
              "frame-ancestors 'none'",
            ].join('; '),
          },
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
