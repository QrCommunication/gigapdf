import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/__tests__/**/*.test.ts', 'src/**/__tests__/**/*.test.tsx'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    setupFiles: ['src/__tests__/vitest-setup.ts'],
    pool: 'forks',
    isolate: false,
    fileParallelism: false,
    maxConcurrency: 1,
    maxWorkers: 1,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/index.ts', 'src/**/__tests__/**'],
      // Seuils globaux directement sous `thresholds` : une clé `global` y serait
      // lue comme un motif de fichier (aucun fichier ne correspond → jamais appliqué).
      // Cliquet : couverture mesurée le 2026-10-29 (arrondie à l'entier inférieur),
      // à relever à chaque progrès. L'objectif de 80 % est suivi en dette technique.
      thresholds: {
        branches: 30,
        functions: 17,
        lines: 29,
        statements: 28,
      },
    },
  },
});
