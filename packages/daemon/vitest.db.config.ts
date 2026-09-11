// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['test/**/*.db.test.ts'], fileParallelism: false, testTimeout: 20_000 },
});
