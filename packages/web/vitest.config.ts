// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/*
  Unit tests only. Anything that needs Postgres, a running Next server or the chain lives in
  `scripts/` and is run deliberately — a network or database outage must not turn into a failing
  unit suite, because a suite that fails for reasons unrelated to the code is a suite people learn
  to ignore.
*/
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    /*
      Component tests declare their own environment with a `@vitest-environment happy-dom` docblock
      at the top of the file, so nothing is configured here.

      Per-file rather than global on purpose: the money and crypto suites run in plain Node, and a
      DOM they never touch is startup cost paid on every run for nothing. `environmentMatchGlobs`
      would do the same thing centrally but was removed in Vitest 4.

      happy-dom rather than jsdom — it starts in a fraction of the time, and nothing here needs the
      corners of the spec that jsdom covers and it does not.
    */
  },
  resolve: {
    alias: {
      /*
        `server-only` throws on import outside a React Server Component, which is exactly its job:
        it is a build-time tripwire that fails the bundle if server code is pulled into the browser.
        A test runner is not a bundler, so the tripwire fires on every server module a test imports.

        Stubbed rather than worked around. The alternative — moving `deriveUserSalt` and
        `zkLoginConfig` out of the server-only module so they can be imported — would take the
        guard off the two functions in this codebase that most need it: one holds the seed every
        address is derived from, the other reads it out of the environment.

        The guard stays on in every real build; only the test runner sees the stub.
      */
      'server-only': fileURLToPath(new URL('./test/stubs/server-only.ts', import.meta.url)),
      /*
        `@/…` is how the application imports itself, resolved by Next's tsconfig `paths`. The test
        runner is not Next, so component tests importing a component that imports `@/…` fail to
        resolve. Mapped here so a test's import graph matches the one the build produces.
      */
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
});
