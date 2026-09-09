// Built-by: @projectx.sui · Co-authored-by: Claude
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
  },
  esbuild: { jsx: 'automatic' },
});
