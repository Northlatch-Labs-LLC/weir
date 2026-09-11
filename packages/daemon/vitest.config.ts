// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/**/*.chain.test.ts', 'test/**/*.db.test.ts'],
    globalSetup: ['../../scripts/sdk-freshness.mjs'],
  },
});
