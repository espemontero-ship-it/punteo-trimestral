import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import JSZip from 'jszip';
import {
  previsualizarEnvio, descargarEnvio, marcarComoEnviado, listarEnvios, descargarEnvioHecho, deshacerEnvio,
} from '../lib/exportar.cjs';
import { POST as marcarRuta } from '../app/api/envios/route.js';
import { POST as deshacerRuta } from '../app/api/envios/[id]/deshacer/route.js';
import { query } from '../lib/db.cjs';
import { PREFIJO, limpiarExportar, subida, facturaEnlazada, descargar, leer, columna } from './ayuda-exportar.js';

beforeEach(limpiarExportar);
afterAll(limpiarExportar);

const HASTA = '2026-12-31';
const ETIQUETA = `${PREFIJO}-trimestre`;

async function enviableConUnaFactura() {
  const lineas = await subida({ lineas: [
    { fecha: [7, 1], concepto: 'COMPRA UNO', importe: -10, nota: 'nota uno' },
    { fecha: [7, 2], concepto: 'COMPRA DOS', importe: -20, nota: 'nota dos' },
  ] });
  const facturaId = await facturaEnlazada(lineas[0].id, 990001);
  return { lineas, facturaId };
}

const marca = async id => (await query(`SELECT envio_id FROM movimientos WHERE id = $1`, [id])).rows[0].envio_id;
const marcaFactura = async id => (await query(`SELECT envio_id FROM facturas WHERE id = $1`, [id])).rows[0].envio_id;

async function contenidoDelZip(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const nombres = Object.keys(zip.files).sort();
  const xlsx = nombres.find(n => n.endsWith('.xlsx'));
  const libro = await leer(await zip.files[xlsx].async('nodebuffer'));
  return { nombres, libro };
}

describe('la columna LarpManager del excel que va a la gestoría', () => {
  it('79b. enseña el pago realmente enlazado a la línea, no el texto guardado; sin pago enlazado, el texto guardado de siempre', async () => {
    const lineas = await subida({ lineas: [
      { fecha: [7, 1], concepto: 'INGRESO UNO', importe: 13 },
      { fecha: [7, 2], concepto: 'INGRESO DOS', importe: 20 },
      { fecha: [7, 3], concepto: 'INGRESO TRES', importe: 30 },
    ] });
    await query(`UPDATE movimientos SET datos_originales = '{"larpmanager": "no encontrada"}'::jsonb WHERE id = $1`, [lineas[0].id]);
    await query(`UPDATE movimientos SET datos_originales = '{}'::jsonb WHERE id = $1`, [lineas[1].id]);
    await query(`UPDATE movimientos SET datos_originales = '{"larpmanager": "texto de siempre sin pago"}'::jsonb WHERE id = $1`, [lineas[2].id]);
    await query(
      `INSERT INTO larpmanager_pagos (nombre_real, evento, importe, fecha, movimiento_id, estado)
       VALUES ($1, 'Glitz', 13, '2026-07-01', $2, 'resuelta'), ($3, NULL, 20, '2026-07-02', $4, 'resuelta')`,
      [`${PREFIJO} Pepito Pérez`, lineas[0].id, `${PREFIJO} Sin Evento`, lineas[1].id]
    );

    const { libro } = await contenidoDelZip(await descargarEnvio({ hasta: HASTA, etiqueta: ETIQUETA }, { descargar }));
    const hoja = libro.getWorksheet('bbva');
    let columnaLm = null;
    hoja.getRow(2).eachCell((celda, n) => { if (celda.value === 'LarpManager') columnaLm = n; });

    expect(columna(hoja, columnaLm, 3)).toEqual([`${PREFIJO} Pepito Pérez — Glitz`, `${PREFIJO} Sin Evento`, 'texto de siempre sin pago']);
  });
});

describe('descargar el archivo no marca nada', () => {
  it('71. se puede descargar varias veces, siempre igual, y nada queda marcado como enviado', async () => {
    const { lineas, facturaId } = await enviableConUnaFactura();

    const primera = await contenidoDelZip(await descargarEnvio({ hasta: HASTA, etiqueta: ETIQUETA }, { descargar }));
    const segunda = await contenidoDelZip(await descargarEnvio({ hasta: HASTA, etiqueta: ETIQUETA }, { descargar }));

    expect(primera.nombres).toEqual([`${PREFIJO}-trimestre.xlsx`, 'facturas/', 'facturas/990001.pdf']);
    expect(segunda.nombres).toEqual(primera.nombres);
    expect(columna(primera.libro.getWorksheet('bbva'), 2, 3)).toEqual(['COMPRA UNO', 'COMPRA DOS']);
    for (const l of lineas) expect(await marca(l.id)).toBeNull();
    expect(await marcaFactura(facturaId)).toBeNull();
    expect((await previsualizarEnvio(HASTA)).movimientos).toBeGreaterThanOrEqual(2);
    expect((await listarEnvios()).filter(e => e.etiqueta === ETIQUETA)).toEqual([]);
  });
});

describe('marcar como enviado', () => {
  it('72. marca los movimientos y las facturas, y lo marcado deja de salir como pendiente', async () => {
    const { lineas, facturaId } = await enviableConUnaFactura();

    const envio = await marcarComoEnviado({ hasta: HASTA, etiqueta: ETIQUETA });

    expect(envio.movimientos).toBeGreaterThanOrEqual(2);
    expect(envio.facturas).toBeGreaterThanOrEqual(1);
    for (const l of lineas) expect(String(await marca(l.id))).toBe(String(envio.envioId));
    expect(String(await marcaFactura(facturaId))).toBe(String(envio.envioId));
    expect((await previsualizarEnvio(HASTA)).movimientos).toBe(0);
    await expect(descargarEnvio({ hasta: HASTA, etiqueta: ETIQUETA }, { descargar })).rejects.toMatchObject({ status: 409 });
    await expect(marcarComoEnviado({ hasta: HASTA, etiqueta: ETIQUETA })).rejects.toMatchObject({ status: 409 });
  });

  it('73. aparece en la lista de envíos anteriores con su etiqueta y sus cuentas', async () => {
    await enviableConUnaFactura();
    const envio = await marcarComoEnviado({ hasta: HASTA, etiqueta: ETIQUETA });

    const lista = await listarEnvios();
    const suyo = lista.find(e => e.id === envio.envioId);

    expect(suyo).toMatchObject({ etiqueta: ETIQUETA, hasta: HASTA, movimientos: envio.movimientos, facturas: envio.facturas });
    expect(lista[0].id).toBeGreaterThanOrEqual(suyo.id);
  });

  it('74. la ruta responde con lo marcado y no descarga ningún archivo', async () => {
    await enviableConUnaFactura();

    const respuesta = await marcarRuta(new Request('http://pruebas/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hasta: HASTA, etiqueta: ETIQUETA }),
    }));

    expect(respuesta.status).toBe(200);
    expect(respuesta.headers.get('content-type')).toContain('application/json');
    expect(await respuesta.json()).toMatchObject({ ok: true });
  });
});

describe('volver a descargar un envío anterior', () => {
  it('75. regenera el mismo archivo cuantas veces haga falta, sin cambiar nada de lo marcado', async () => {
    const { lineas, facturaId } = await enviableConUnaFactura();
    const envio = await marcarComoEnviado({ hasta: HASTA, etiqueta: ETIQUETA });

    const una = await descargarEnvioHecho(envio.envioId, { descargar });
    const otra = await descargarEnvioHecho(envio.envioId, { descargar });
    const primera = await contenidoDelZip(una.zip);
    const segunda = await contenidoDelZip(otra.zip);

    expect(una.nombre).toBe(ETIQUETA);
    expect(primera.nombres).toEqual([`${PREFIJO}-trimestre.xlsx`, 'facturas/', 'facturas/990001.pdf']);
    expect(segunda.nombres).toEqual(primera.nombres);
    expect(columna(primera.libro.getWorksheet('bbva'), 2, 3)).toEqual(['COMPRA UNO', 'COMPRA DOS']);
    for (const l of lineas) expect(String(await marca(l.id))).toBe(String(envio.envioId));
    expect(String(await marcaFactura(facturaId))).toBe(String(envio.envioId));
  });

  it('76. un envío que ya no existe da error claro', async () => {
    await expect(descargarEnvioHecho(987654321, { descargar })).rejects.toMatchObject({ status: 404 });
  });
});

describe('deshacer un envío', () => {
  it('77. sus movimientos y facturas vuelven a pendientes, el envío desaparece de la lista y se puede volver a descargar', async () => {
    const { lineas, facturaId } = await enviableConUnaFactura();
    const envio = await marcarComoEnviado({ hasta: HASTA, etiqueta: ETIQUETA });

    const resultado = await deshacerEnvio(envio.envioId);

    expect(resultado.movimientos).toBe(envio.movimientos);
    expect(resultado.facturas).toBe(envio.facturas);
    for (const l of lineas) expect(await marca(l.id)).toBeNull();
    expect(await marcaFactura(facturaId)).toBeNull();
    expect((await listarEnvios()).some(e => e.id === envio.envioId)).toBe(false);
    const de_nuevo = await contenidoDelZip(await descargarEnvio({ hasta: HASTA, etiqueta: ETIQUETA }, { descargar }));
    expect(columna(de_nuevo.libro.getWorksheet('bbva'), 2, 3)).toEqual(['COMPRA UNO', 'COMPRA DOS']);
  });

  it('78. no se borra ni se cambia nada más: los movimientos siguen resueltos y con su nota', async () => {
    const { lineas } = await enviableConUnaFactura();
    const envio = await marcarComoEnviado({ hasta: HASTA, etiqueta: ETIQUETA });

    await deshacerEnvio(envio.envioId);

    const { rows } = await query(`SELECT estado, nota_final FROM movimientos WHERE id = ANY($1::bigint[]) ORDER BY id`, [lineas.map(l => l.id)]);
    expect(rows).toEqual([{ estado: 'resuelta', nota_final: 'nota uno' }, { estado: 'resuelta', nota_final: 'nota dos' }]);
  });

  it('79. la ruta lo deshace, y un envío que ya no existe devuelve 404 sin tocar nada', async () => {
    await enviableConUnaFactura();
    const envio = await marcarComoEnviado({ hasta: HASTA, etiqueta: ETIQUETA });

    const bien = await deshacerRuta(new Request('http://pruebas/', { method: 'POST' }), { params: Promise.resolve({ id: String(envio.envioId) }) });
    expect(bien.status).toBe(200);
    expect(await bien.json()).toMatchObject({ ok: true });

    const mal = await deshacerRuta(new Request('http://pruebas/', { method: 'POST' }), { params: Promise.resolve({ id: String(envio.envioId) }) });
    expect(mal.status).toBe(404);
  });
});
