import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { limpiar, subir, sembrarLinea, lector, facturaPorNombre, HOJA } from './ayuda.js';
import { GET as listarFacturas } from '../app/api/facturas/route.js';
import { registrarRechazo } from '../lib/memoria.cjs';
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

// Lo que devuelve la pantalla de Facturas para una factura concreta.
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
    // Sin esto la pantalla no puede descartarla de verdad, solo esconderla.
    expect(candidato.hoja).toBe(HOJA);
    expect(candidato.clave).toBeTruthy();
  });

  it('21. una vez descartada, no vuelve a salir', async () => {
    await sembrarLinea({ importe: -45 });
    const { archivo } = await subir({ leer: unaDe(45) });

    const antes = await comoLaVeLaPantalla(archivo);
    const candidato = antes.motivo_candidatos.candidatos[0];
    expect(candidato).toBeTruthy();

    // Es lo mismo que hace la ✕ de la pantalla.
    await registrarRechazo(candidato.hoja, candidato.clave, 'combo', String(antes.id));

    const despues = await comoLaVeLaPantalla(archivo);
    expect(despues.motivo_candidatos).toBeNull();
  });
});
