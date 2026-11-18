import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: import.meta.dirname,
  test: { include: ['compose/test/**/*.test.tsx'], environment: 'happy-dom' },
});
