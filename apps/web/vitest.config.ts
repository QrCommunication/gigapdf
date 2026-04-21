/**
 * Configuration Vitest pour apps/web.
 *
 * Prérequis — installer avant de lancer les tests :
 *   pnpm add -D --filter web vitest @vitest/coverage-v8 @testing-library/react @testing-library/user-event jsdom
 *
 * Lancer les tests :
 *   pnpm --filter web test
 *   pnpm --filter web test:coverage
 */
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['src/hooks/__tests__/vitest-setup.ts'],
    include: ['src/**/__tests__/**/*.test.{ts,tsx}'],
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
        minForks: 1,
        maxForks: 1,
        execArgv: ['--max-old-space-size=1024'],
      },
    },
    fileParallelism: false,
    maxConcurrency: 1,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/__tests__/**',
        'src/**/index.{ts,tsx}',
        'src/app/**', // Next.js pages/layouts — tester via E2E
      ],
      thresholds: {
        global: {
          branches: 70,
          functions: 75,
          lines: 75,
          statements: 75,
        },
        // Seuil spécifique pour le hook critique
        'src/hooks/use-document-save.ts': {
          branches: 80,
          functions: 90,
          lines: 85,
          statements: 85,
        },
      },
    },
    testTimeout: 10000,
  },
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname ?? __dirname, './src'),
    },
  },
});
