// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { DATABASE_TEST_FILES } from './vitest.database-files';

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
          exclude: ['**/node_modules/**', ...DATABASE_TEST_FILES],
        },
      },
      {
        extends: true,
        test: {
          name: 'database',
          include: [...DATABASE_TEST_FILES],
          fileParallelism: false,
        },
      },
    ],
    globalSetup: ['../../scripts/sdk-freshness.mjs'],
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
      'server-only': fileURLToPath(new URL('./test/stubs/server-only.ts', import.meta.url)),
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
});
