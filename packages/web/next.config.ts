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
const config: NextConfig = {
  distDir: process.env['NEXT_DIST_DIR'] ?? '.next',

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
        ],
      },
    ];
  },
};

export default config;
