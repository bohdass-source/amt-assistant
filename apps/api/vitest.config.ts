import { defineConfig } from 'vitest/config';

// Offline tests only: fakes instead of models and stores, network blocked in setup.ts.
// Checks against a real model live in src/live and run with `npm run live:*`.
export default defineConfig({
  test: {
    include: ['test/offline/**/*.test.ts'],
    setupFiles: ['test/offline/setup.ts'],
    environment: 'node',
  },
});
