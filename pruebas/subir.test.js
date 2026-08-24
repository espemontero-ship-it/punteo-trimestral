import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { limpiar, subir, lector, MARCA } from './ayuda.js';
import { query } from '../lib/db.cjs';
import { siguienteNumero } from '../lib/facturaMatcher.cjs';

beforeEach(limpiar);
afterAll(limpiar);

const unaDe = importe => lector([{ importe, fecha: '2026-07-19', proveedor: 'Proveedor' }]);

describe('subir facturas', () => {
  it('6. el mismo archivo dos veces no se guarda, y dice de qué fecha era el primero', async () => {
    const primera = await subir({ leer: unaDe(45), contenido: 'mismo-archivo' });
    expect(primera.resultado.tipo).not.toBe('duplicada');

    const segunda = await subir({ leer: unaDe(45), contenido: 'mismo-archivo', nombre: MARCA + 'otro-nombre.pdf' });
    expect(segunda.resultado.tipo).toBe('duplicada');

    expect(segunda.resultado.detalle).toMatch(/\d{1,2}\/\d{1,2}\/\d{4}/);

    const { rows } = await query('SELECT COUNT(*)::int n FROM facturas WHERE nombre_original LIKE $1', [MARCA + '%']);
    expect(rows[0].n).toBe(1);
  });

  it('7. tres archivos distintos crean tres facturas', async () => {
    await subir({ leer: unaDe(10) });
    await subir({ leer: unaDe(20) });
    await subir({ leer: unaDe(30) });
    const { rows } = await query('SELECT COUNT(*)::int n FROM facturas WHERE nombre_original LIKE $1', [MARCA + '%']);
    expect(rows[0].n).toBe(3);
  });

  it('8. dos subidas a la vez no cogen el mismo número', async () => {
    const [a, b] = await Promise.all([subir({ leer: unaDe(11) }), subir({ leer: unaDe(12) })]);
    const { rows } = await query(
      'SELECT numero FROM facturas WHERE nombre_original IN ($1, $2)', [a.archivo, b.archivo]
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].numero).not.toBe(rows[1].numero);
  });

  it('8b. el número no sale de mirar el más alto: dos seguidos son distintos', async () => {

    const primero = await siguienteNumero();
    const segundo = await siguienteNumero();
    expect(segundo).toBe(primero + 1);
  });
});
