import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@semaphore-chat/shared': path.resolve(import.meta.dirname, '../shared/src'),
      'virtual:pwa-register': path.resolve(import.meta.dirname, 'src/__tests__/mocks/virtual-pwa-register.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/__tests__/**/*.test.{ts,tsx}'],
    // Coverage instrumentation (v8) plus CI worker contention can slow real
    // (non-fake) timers/network round-trips enough to blow past the 5s
    // default, even when the underlying assertion is not actually stuck —
    // see GifPicker/MessageInput flake investigation. Give tests headroom
    // rather than papering over it per-test.
    testTimeout: 15000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/__tests__/**', 'src/api-client/**', 'src/vite-env.d.ts'],
    },
  },
});
