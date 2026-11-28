import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // the app imports through @/; a route handler under test needs the same map
    alias: { '@': new URL('./src', import.meta.url).pathname },
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    reporters: 'default',
  },
});
