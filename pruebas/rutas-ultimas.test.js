import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import bcrypt from 'bcryptjs';
import { limpiar, sembrarLinea, lineaPorId, lector, HOJA } from './ayuda.js';
import { GET as descargarEnvioRuta } from '../app/api/envios/[id]/descargar/route.js';
import { POST as descargarPendienteRuta } from '../app/api/envios/descargar/route.js';
import { GET as enviosAnterioresRuta } from '../app/api/envios/anteriores/route.js';
import { POST as subirLarpManager } from '../app/api/larpmanager/route.js';
import { GET as listarMovimientos } from '../app/api/movimientos/route.js';
import { GET as listarPendientes } from '../app/api/movimientos-pendientes/route.js';
import { POST as desvincularLm } from '../app/api/larpmanager-pagos/[id]/desvincular/route.js';
import { GET as candidatosDeMovimiento } from '../app/api/movimientos/[id]/larpmanager-candidatos/route.js';
import { POST as resolverLm } from '../app/api/movimientos/[id]/resolver-larpmanager/route.js';
import { POST as crearAnticipoRuta } from '../app/api/lotes/[id]/anticipos/route.js';
import { POST as pagarRuta } from '../app/api/lotes/[id]/pagar/route.js';
import { parsearCSV, emparejarIngresosConLarpManager, vincularPagoAMano, asegurarTablaPagosLarpManager } from '../lib/larpmanager.cjs';
import { analizarFactura } from '../lib/facturaMatcher.cjs';
import { buscarOCrearLote, subirFacturaLote } from '../lib/lotes.cjs';
import { query } from '../lib/db.cjs';

const CORREO = 'prueba-ultimas@ejemplo.test';
const PROYECTO = 'Proyecto de prueba de últimas rutas';
const ZAPHOD = 'Zaphod Beeblebrox';

async function limpiarTodo() {
  await asegurarTablaPagosLarpManager();
  await limpiar();
  await query(`DELETE FROM larpmanager_pagos WHERE nombre_real = $1`, [ZAPHOD]);
  await query(`DELETE FROM pagos WHERE lote_id IN (SELECT id FROM lotes WHERE colaborador_id IN (SELECT id FROM colaboradores WHERE usuario = $1))`, [CORREO]);
  await query(`DELETE FROM facturas WHERE nombre_original LIKE 'PRUEBA-ultimas%'`);
  await query(`DELETE FROM lotes WHERE colaborador_id IN (SELECT id FROM colaboradores WHERE usuario = $1)`, [CORREO]);
  await query(`DELETE FROM colaboradores WHERE usuario = $1`, [CORREO]);
  await query(`DELETE FROM proyectos WHERE nombre = $1`, [PROYECTO]);
}
beforeEach(limpiarTodo);
afterAll(limpiarTodo);

const post = (cuerpo = {}) => new Request('http://pruebas/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
const conId = id => ({ params: Promise.resolve({ id: String(id) }) });

describe('las rutas de los envíos a la gestoría', () => {
  it('430. sin fecha "hasta" no se genera nada; con nada pendiente da 409 con su mensaje', async () => {
    const sinFecha = await descargarPendienteRuta(post({}));
    expect(sinFecha.status).toBe(400);

    const nadaPendiente = await descargarPendienteRuta(post({ hasta: '2000-01-01' }));
    expect(nadaPendiente.status).toBe(409);
    expect((await nadaPendiente.json()).error).toContain('No hay nada pendiente');
  });

  it('431. volver a descargar un envío que no existe da 404, y la lista de envíos anteriores sale como lista', async () => {
    const r = await descargarEnvioRuta(new Request('http://pruebas/'), conId(987654321));
    expect(r.status).toBe(404);

    const { envios } = await (await enviosAnterioresRuta()).json();
    expect(Array.isArray(envios)).toBe(true);
  });
});

describe('la ruta de subir los pagos de LarpManager', () => {
  const subir = (contenido, nombre = 'pagos.csv') => {
    const datos = new FormData();
    if (contenido !== null) datos.append('file', new File([contenido], nombre));
    return subirLarpManager(new Request('http://pruebas/api/larpmanager', { method: 'POST', body: datos }));
  };

  it('432. sin archivo, con un archivo sin filas, o con filas que no se pueden cruzar con el banco, da 400 y explica por qué', async () => {
    const sinArchivo = await subir(null);
    expect(sinArchivo.status).toBe(400);

    const sinFilas = await subir('Member,Method,Event,Net,Date,Info\r\n');
    expect(sinFilas.status).toBe(400);
    expect((await sinFilas.json()).error).toContain('ninguna fila');

    const soloPasarela = await subir('Member,Method,Event,Net,Date,Info\r\n"Zaphod Beeblebrox - Z",Stripe,Wield #2,13,29/09/2026,\r\n');
    expect(soloPasarela.status).toBe(400);
    expect((await soloPasarela.json()).error).toContain('Ninguna fila del archivo se puede cruzar');
  });
});

describe('los listados de movimientos', () => {
  it('433. los pendientes son solo los sin resolver o pedidos, con lo justo para elegir', async () => {
    const a = await sembrarLinea({ importe: -10, concepto: 'PENDIENTE UNO' });
    const b = await sembrarLinea({ importe: -20, estado: 'pedida_pendiente' });
    await sembrarLinea({ importe: -30, estado: 'resuelta' });
    await sembrarLinea({ importe: -40, estado: 'ignorada' });

    const { movimientos } = await (await listarPendientes()).json();
    const suyos = movimientos.filter(m => m.hoja === HOJA);

    expect(suyos.map(m => String(m.id)).sort()).toEqual([a.id, b.id].map(String).sort());
    expect(Object.keys(suyos[0]).sort()).toEqual(['concepto', 'fecha', 'hoja', 'id', 'importe']);
  });

  it('434. los movimientos salen agrupados por proveedor y se pueden acotar por fechas', async () => {
    await sembrarLinea({ importe: -10, fecha: '2026-09-10', concepto: 'COMPRA DENTRO' });
    await sembrarLinea({ importe: -20, fecha: '2026-07-10', concepto: 'COMPRA FUERA' });

    const todos = await (await listarMovimientos(new Request('http://pruebas/api/movimientos'))).json();
    const acotados = await (await listarMovimientos(new Request('http://pruebas/api/movimientos?desde=2026-09-01&hasta=2026-09-30'))).json();
    const conceptos = datos => datos.proveedores.flatMap(g => g.movimientos.map(m => m.concepto)).filter(c => c.startsWith('COMPRA '));

    expect(conceptos(todos).sort()).toEqual(['COMPRA DENTRO', 'COMPRA FUERA']);
    expect(conceptos(acotados)).toEqual(['COMPRA DENTRO']);
  });
});

describe('las rutas que enlazan pagos de LarpManager a mano', () => {
  const subirPago = async () => {
    const csv = Buffer.from(`Member,Method,Event,Net,Date,Info\r\n"${ZAPHOD} - Zaph",Wire,Wield #2,13,29/09/2026,`);
    await emparejarIngresosConLarpManager(parsearCSV(csv), null);
    return (await query(`SELECT * FROM larpmanager_pagos WHERE nombre_real = $1`, [ZAPHOD])).rows[0];
  };

  it('435. desvincular un pago sin línea da el mensaje claro, y uno vinculado se desvincula', async () => {
    const linea = await sembrarLinea({ importe: 13, concepto: 'TRANSFERENCIAS BEEBLEBROX ZAPHOD 14000', fecha: '2026-09-29' });
    const pago = await subirPago();

    const sin = await desvincularLm(post(), conId(pago.id));
    expect((await sin.json()).error).toContain('no está vinculado');

    await vincularPagoAMano(pago.id, linea.id);
    const r = await desvincularLm(post(), conId(pago.id));
    expect(String((await r.json()).movimientoId)).toBe(String(linea.id));
  });

  it('436. los pagos candidatos de una línea salen por su ruta, y una línea de gasto da el mensaje claro', async () => {
    const ingreso = await sembrarLinea({ importe: 13, concepto: 'TRANSFERENCIAS BEEBLEBROX ZAPHOD 14000', fecha: '2026-09-29' });
    const gasto = await sembrarLinea({ importe: -13, concepto: 'UN GASTO' });
    await subirPago();

    const { candidatos } = await (await candidatosDeMovimiento(new Request('http://pruebas/'), conId(ingreso.id))).json();
    expect(candidatos.map(c => c.nombreReal)).toContain(ZAPHOD);

    const mal = await candidatosDeMovimiento(new Request('http://pruebas/'), conId(gasto.id));
    expect((await mal.json()).error).toContain('no es un ingreso');
  });

  it('437. resolver una línea con el candidato elegido la resuelve; una línea que no existe da el mensaje claro', async () => {
    const linea = await sembrarLinea({ importe: 13, concepto: 'TRANSFERENCIAS BEEBLEBROX ZAPHOD 14000', fecha: '2026-09-29' });
    await subirPago();

    const r = await resolverLm(post({ nombreReal: ZAPHOD, evento: 'Wield #2', importe: 13, fecha: '2026-09-29', proyectoSugerido: null }), conId(linea.id));

    expect((await r.json()).ok).toBe(true);
    expect((await lineaPorId(linea.id)).estado).toBe('resuelta');
    const mal = await resolverLm(post({ nombreReal: ZAPHOD }), conId(987654321));
    expect((await mal.json()).error).toContain('Movimiento no encontrado');
  });
});

describe('los anticipos y pagos a colaboradoras', () => {
  const montar = async () => {
    const hash = await bcrypt.hash('x', 4);
    const { rows: [c] } = await query(`INSERT INTO colaboradores (nombre, usuario, password_hash) VALUES ('Persona de prueba', $1, $2) RETURNING id`, [CORREO, hash]);
    const { rows: [p] } = await query(`INSERT INTO proyectos (nombre) VALUES ($1) RETURNING id`, [PROYECTO]);
    const loteId = await buscarOCrearLote(c.id, p.id);
    const facturas = [];
    for (const [i, importe] of [45, 20].entries()) {
      const nombre = `PRUEBA-ultimas-${i}.pdf`;
      const analisis = await analizarFactura(Buffer.from(`${nombre}-${Math.random()}`), true, nombre, lector([{ importe, fecha: '2026-07-19', proveedor: 'X' }]));
      facturas.push((await subirFacturaLote({ loteId, rutaBlob: `https://ejemplo/${nombre}`, nombreOriginal: nombre, concepto: 'material', analisis })).id);
    }
    return { loteId, facturas };
  };

  it('438. un anticipo necesita un importe mayor que cero y devuelve su número', async () => {
    const { loteId } = await montar();

    const sinImporte = await crearAnticipoRuta(post({ importe: 0 }), conId(loteId));
    expect(sinImporte.status).toBe(400);

    const bien = await crearAnticipoRuta(post({ importe: 30, fecha: '2026-09-01', esEfectivo: true }), conId(loteId));
    expect(bien.status).toBe(200);
    expect((await bien.json()).anticipoId).toBeTruthy();
  });

  it('439. pagar descuenta los anticipos que había, y deja las facturas como pagadas', async () => {
    const { loteId, facturas } = await montar();
    await crearAnticipoRuta(post({ importe: 25 }), conId(loteId));

    const r = await pagarRuta(post({ facturaIds: facturas, fecha: '2026-10-01' }), conId(loteId));

    expect(r.status).toBe(200);
    expect((await r.json()).pago.importe).toBe(40);
    const { rows } = await query(`SELECT estado_revision FROM facturas WHERE id = ANY($1::bigint[])`, [facturas]);
    expect(rows.every(f => f.estado_revision === 'pagada')).toBe(true);
  });

  it('440. no se puede pagar sin elegir facturas, ni facturas de otro lote, ni facturas que ya están pagadas', async () => {
    const { loteId, facturas } = await montar();

    expect((await pagarRuta(post({ facturaIds: [] }), conId(loteId))).status).toBe(400);
    expect((await pagarRuta(post({ facturaIds: [facturas[0], 987654321] }), conId(loteId))).status).toBe(400);
    await pagarRuta(post({ facturaIds: facturas }), conId(loteId));
    expect((await pagarRuta(post({ facturaIds: facturas }), conId(loteId))).status).toBe(409);
  });
});
