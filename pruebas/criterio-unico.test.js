import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const raiz = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function archivosDeCodigo(dir, encontrados = []) {
  for (const nombre of readdirSync(dir)) {
    if (['node_modules', '.next', '.git', 'pruebas', 'scripts'].includes(nombre)) continue;
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) archivosDeCodigo(ruta, encontrados);
    else if (/\.(js|cjs)$/.test(nombre)) encontrados.push(ruta);
  }
  return encontrados;
}

describe('un solo criterio', () => {
  it('5. el lector de texto ya no existe y nadie lo llama', () => {
    expect(existsSync(join(raiz, 'lib/facturas.cjs'))).toBe(false);

    const llamantes = archivosDeCodigo(raiz)
      .filter(f => /require\(.*facturas\.cjs|from '.*facturas\.cjs/.test(readFileSync(f, 'utf8')))
      .map(f => f.replace(raiz, ''));
    expect(llamantes).toEqual([]);
  });

  it('18. solo hay un sitio que calcule cuánto vale una factura', () => {

    const culpables = [];
    for (const ruta of archivosDeCodigo(raiz)) {
      const codigo = readFileSync(ruta, 'utf8');
      const corto = ruta.replace(raiz, '');
      if (corto.endsWith('lib/importeFactura.cjs')) continue;
      if (/Math\.max\(\.\.\.[^)]*totales/.test(codigo)) culpables.push(corto + ' (coge el mayor)');
      if (/totales\[1\]|totales\[0\]/.test(codigo)) culpables.push(corto + ' (coge el primero)');
    }
    expect(culpables).toEqual([]);
  });
});
