// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { defineConfig } from 'vitest/config';

/*
  The include pattern is written down rather than left to the default, for the same reason
  packages/signer writes its own down: adding a hook here must not silently change which files run.

  `globalSetup` is the workspace's SDK freshness check. `@projectx-social/sdk` and
  `@projectx-social/signer` are consumed as compiled JavaScript whose `dist` is gitignored, so a
  branch switch can leave another commit's behaviour in place. The root `test` script rebuilds them
  first; running `vitest` inside this package alone does not.
*/
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['../../scripts/sdk-freshness.mjs'],
    testTimeout: 20_000,
  },
});
