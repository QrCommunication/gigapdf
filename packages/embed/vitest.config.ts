import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/__tests__/**/*.test.ts', 'src/__tests__/**/*.test.tsx'],
    pool: 'forks',
    // `test.poolOptions` a été retiré en Vitest 4 (ignoré depuis) : ses réglages
    // sont désormais des options de premier niveau. Un seul worker, heap borné.
    // L'isolation par fichier reste celle par défaut (isolate: true), qui est le
    // comportement effectif depuis Vitest 4 puisque `singleFork` était ignoré.
    execArgv: ['--max-old-space-size=1024'],
    fileParallelism: false,
    maxWorkers: 1,
    maxConcurrency: 1,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/__tests__/**'],
      // Seuils globaux directement sous `thresholds` : une clé `global` y serait
      // lue comme un motif de fichier (aucun fichier ne correspond → jamais appliqué).
      // Cliquet : couverture mesurée le 2026-10-29 (arrondie à l'entier inférieur),
      // à relever à chaque progrès. L'objectif de 80 % est suivi en dette technique.
      thresholds: {
        branches: 46,
        functions: 38,
        lines: 55,
        statements: 51,
      },
    },
  },
});
