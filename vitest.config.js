import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['pruebas/**/*.test.js'],
    exclude: ['pruebas/**/*-pantalla.test.js'],
    setupFiles: ['./pruebas/preparar.js'],
    fileParallelism: false,
    testTimeout: 20000,
    server: {
      deps: { inline: [/lib[\/].*\.cjs$/] },
    },
  },
});
