import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { limpiar, subir, sembrarLinea, lector, facturaPorNombre, HOJA } from './ayuda.js';
import { GET as listarFacturas } from '../app/api/facturas/route.js';
import { POST as rechazarSugerencia } from '../app/api/sugerencias/rechazar/route.js';
import { registrarRechazo, cargarRechazos, estaRechazada } from '../lib/memoria.cjs';
import { query } from '../lib/db.cjs';

beforeEach(async () => {
  await limpiar();
  await query("DELETE FROM sugerencias_rechazadas WHERE hoja = $1", [HOJA]);
});
afterAll(async () => {
  await limpiar();
  await query("DELETE FROM sugerencias_rechazadas WHERE hoja = $1", [HOJA]);
});

const unaDe = importe => lector([{ importe, fecha: '2026-07-19', proveedor: 'Proveedor' }]);

async function comoLaVeLaPantalla(archivo) {
  const respuesta = await listarFacturas();
  const { facturas } = await respuesta.json();
  return facturas.find(f => f.nombre_original === archivo) || null;
}

describe('descartar una sugerencia', () => {
  it('20. la sugerencia se ve, y trae la línea del banco a la que apunta', async () => {
    const linea = await sembrarLinea({ importe: -45 });
    const { archivo } = await subir({ leer: unaDe(45) });

    const f = await comoLaVeLaPantalla(archivo);
    expect(f.motivo_candidatos).not.toBeNull();
    const candidato = f.motivo_candidatos.candidatos[0];
    expect(String(candidato.movimientoId)).toBe(String(linea.id));

    expect(candidato.hoja).toBe(HOJA);
    expect(candidato.clave).toBeTruthy();
  });

  it('21. una vez descartada, no vuelve a salir', async () => {
    await sembrarLinea({ importe: -45 });
    const { archivo } = await subir({ leer: unaDe(45) });

    const antes = await comoLaVeLaPantalla(archivo);
    const candidato = antes.motivo_candidatos.candidatos[0];
    expect(candidato).toBeTruthy();

    await registrarRechazo(candidato.hoja, candidato.clave, 'combo', String(antes.id));

    const despues = await comoLaVeLaPantalla(archivo);
    expect(despues.motivo_candidatos).toBeNull();
  });

  it('22. la API de rechazo acepta todos los tipos que usa la pantalla', async () => {
    const tipos = ['nota', 'proveedor', 'proyecto', 'devolucion', 'jugador', 'combo', 'pago'];
    for (const tipo of tipos) {
      const r = await rechazarSugerencia(new Request('http://pruebas/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hoja: HOJA, clave: `clave-${tipo}`, tipo, valor: '123' }),
      }));
      expect(r.status).toBe(200);
    }
  });

  it('23. rechazar un combo o un pago se guarda de verdad, y no vuelve a salir', async () => {
    for (const tipo of ['proyecto', 'devolucion', 'jugador', 'combo', 'pago']) {
      await rechazarSugerencia(new Request('http://pruebas/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hoja: HOJA, clave: `clave-${tipo}`, tipo, valor: '123' }),
      }));
      const rechazos = await cargarRechazos();
      expect(estaRechazada(rechazos, HOJA, `clave-${tipo}`, tipo, '123')).toBe(true);
    }
  });
});
