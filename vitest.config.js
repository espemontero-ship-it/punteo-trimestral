import { defineConfig } from 'vitest/config';

// Las pruebas hablan con la base de DESARROLLO (.env.local), nunca con la de
// producción. pruebas/preparar.js lo carga antes de que arranque ninguna.
export default defineConfig({
  test: {
    setupFiles: ['./pruebas/preparar.js'],
    // Una detrás de otra, no a la vez: comparten la misma base de datos y
    // varias sembrando y borrando en paralelo se pisarían entre ellas.
    fileParallelism: false,
    testTimeout: 20000,
    server: {
      // Sin esto, los archivos .cjs de la app se cargan por su cuenta y no se
      // puede sustituir la llamada a la IA: se llamaría a la de verdad, que
      // cuesta dinero y depende de internet.
      deps: { inline: [/lib[\/].*\.cjs$/] },
    },
  },
});
