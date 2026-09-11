// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
  },
});
