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
    // isolate: true → chaque fichier de test obtient un registre de modules ET
    // des globals frais. C'est INDISPENSABLE ici : 17 fichiers mockent
    // `next-intl` (et d'autres modules) avec des factories DIFFÉRENTES, et
    // certains posent des globals (`global.fetch = vi.fn()`). Sous isolate:false
    // (ancien réglage), ces mocks/globals fuitaient entre fichiers selon l'ordre
    // d'exécution → un "set flaky rotatif" (share-dialog, click-outside-touch,
    // add-page-menu, mobile-sheet…) rouge en CI mais vert en isolation. Le seul
    // test qui mute process.env globalement (env.test.ts) le restaure déjà dans
    // son propre afterEach, donc isolate:true ne casse rien.
    // On garde l'exécution séquentielle (un seul worker) pour un pic mémoire
    // borné sur le runner CI ; forks + isolate GC le graphe de modules entre
    // fichiers.
    isolate: true,
    fileParallelism: false,
    maxWorkers: 1,
    maxConcurrency: 1,
    // Hygiène de mocks après CHAQUE test (défense en profondeur intra-fichier) :
    // restaure les spies, vide les .mock.calls, et retire les stubs de globals
    // et d'env posés via vi.stubGlobal / vi.stubEnv.
    clearMocks: true,
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/__tests__/**',
        'src/**/index.{ts,tsx}',
        'src/app/**', // Next.js pages/layouts — tester via E2E
      ],
      // Seuils globaux directement sous `thresholds` : une clé `global` y serait
      // lue comme un motif de fichier (aucun fichier ne correspond → jamais appliqué).
      // Cliquet : couverture mesurée le 2026-10-29 (arrondie à l'entier inférieur),
      // à relever à chaque progrès. L'objectif de 80 % est suivi en dette technique.
      thresholds: {
        branches: 27,
        functions: 23,
        lines: 30,
        statements: 30,
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
