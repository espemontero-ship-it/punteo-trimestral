import { defineConfig } from 'vitest/config';
import { transformWithOxc } from 'vite';

const jsxDentroDeJs = {
  name: 'jsx-dentro-de-js',
  async transform(code, id) {
    if (id.includes('node_modules')) return null;
    const ruta = id.split('?')[0];
    if (!/\.js$/.test(ruta)) return null;
    if (!/<[A-Za-z/]/.test(code)) return null;
    return transformWithOxc(code, ruta.replace(/\.js$/, '.jsx'), {
      jsx: { runtime: 'automatic' },
    });
  },
};

export default defineConfig({
  plugins: [jsxDentroDeJs],
  test: {
    include: ['pruebas/**/*-pantalla.test.js'],
    environment: 'happy-dom',
    setupFiles: ['./pruebas/preparar-pantalla.js'],
  },
});
