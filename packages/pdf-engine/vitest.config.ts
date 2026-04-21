import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
    setupFiles: ['__tests__/vitest-setup.ts'],
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
    server: {
      deps: {
        external: ['pdfjs-dist'],
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/**/index.ts'],
      thresholds: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80,
        },
        // Seuils spécifiques pour les fichiers critiques Wave 2 fonts.
        // Ces seuils sont activés après le fix (les fichiers n'existent pas encore sur main).
        // Décommenter après le merge Wave 2 :
        //
        // 'src/utils/font-map.ts': {
        //   statements: 90,
        //   branches: 85,
        //   functions: 90,
        //   lines: 90,
        // },
        // 'src/render/text-renderer.ts': {
        //   statements: 85,
        //   branches: 80,
        //   functions: 85,
        //   lines: 85,
        // },
      },
    },
    // Timeout plus long pour les tests round-trip avec gros PDFs (ex: large-100pages.pdf)
    testTimeout: 60000,
  },
});
