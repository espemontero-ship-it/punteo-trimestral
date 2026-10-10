import { describe, it, expect, beforeEach, afterAll, afterEach } from 'vitest';
import { limpiar, sembrarLinea, lineaPorId, HOJA } from './ayuda.js';
import {
  parsearCSV, emparejarIngresosConLarpManager, listarPagosLarpManagerSinEmparejar, vincularPagoAMano, desvincularPago,
  cambiarEstadoPago, rechazarSugerenciaLarpManager, listarCandidatosParaPago, listarPagosCandidatosParaMovimiento,
  historialDeJugador, resolverPagoLarpManager, asegurarTablaPagosLarpManager, asegurarTablaAlias, corregirPagosQueNoLlegan,
} from '../lib/larpmanager.cjs';
import { POST as vincularRuta } from '../app/api/larpmanager-pagos/[id]/vincular/route.js';
import { POST as rechazarRuta } from '../app/api/larpmanager-pagos/[id]/rechazar/route.js';
import { POST as estadoRuta } from '../app/api/larpmanager-pagos/[id]/estado/route.js';
import { GET as candidatosRuta } from '../app/api/larpmanager-pagos/[id]/candidatos/route.js';
import { GET as sinEmparejarRuta } from '../app/api/larpmanager-sin-emparejar/route.js';
import { query } from '../lib/db.cjs';

const ZAPHOD = 'Zaphod Beeblebrox';
const TRILLIAN = 'Trillian Astra';

async function limpiarTodo() {
  await asegurarTablaPagosLarpManager();
  await asegurarTablaAlias();
  await limpiar();
  await query(`DELETE FROM larpmanager_pagos WHERE nombre_real IN ($1, $2)`, [ZAPHOD, TRILLIAN]);
  await query(`DELETE FROM larpmanager_alias WHERE nombre LIKE 'ZAPHOD%' OR nombre LIKE 'TRILLIAN%'`);
}
beforeEach(limpiarTodo);
afterEach(() => {});
afterAll(limpiarTodo);

const fila = ({ nombre = ZAPHOD, metodo = 'Wire', evento = 'Wield #2', neto = 13, fecha = '29/09/2026', info = '' }) =>
  `"${nombre} - ${nombre.split(' ')[0]}",${metodo},${evento},${neto},${fecha},${info}`;

async function subirPagos(...filas) {
  const csv = Buffer.from(['Member,Method,Event,Net,Date,Info', ...filas.map(f => (typeof f === 'string' ? f : fila(f)))].join('\r\n'));
  const parseadas = parsearCSV(csv);
  const resultados = await emparejarIngresosConLarpManager(parseadas, null);
  return { parseadas, resultados };
}

const conceptoDe = (apellido, nombre = '') => `TRANSFERENCIAS ${apellido} ${nombre} 140000071`.replace(/\s+/g, ' ');
const resultadoDe = (resultados, linea) => resultados.find(r => String(r.movimientoId) === String(linea.id));
const pagoDe = async (nombre = ZAPHOD, fecha = null) => (await query(
  `SELECT * FROM larpmanager_pagos WHERE nombre_real = $1 ${fecha ? `AND fecha = '${fecha}'` : ''} ORDER BY id`, [nombre]
)).rows;

describe('cómo propone la app los pagos de LarpManager para las líneas del banco', () => {
  it('210. una línea pendiente que cuadra de nombre e importe recibe una propuesta, y NO se resuelve ni se enlaza sola', async () => {
    const linea = await sembrarLinea({ importe: 13, concepto: conceptoDe('BEEBLEBROX', 'ZAPHOD'), fecha: '2026-09-29' });

    const { resultados } = await subirPagos({});

    expect(resultadoDe(resultados, linea)).toMatchObject({ tipo: 'match', sugerenciaNota: `LarpManager: ${ZAPHOD} — Wield #2` });
    const m = await lineaPorId(linea.id);
    expect(m.estado).toBe('sin_resolver');
    expect(m.datos_originales.larpmanager).toBe(`${ZAPHOD} — Wield #2`);
    expect(m.larpmanager_candidatos.tipo).toBe('match');
    const [pago] = await pagoDe();
    expect(pago.movimiento_id).toBeNull();
    expect(pago.estado).toBe('pendiente');
  });

  it('211. si el nombre coincide pero el importe no, dice que el importe no cuadra y no propone ninguna línea', async () => {
    const linea = await sembrarLinea({ importe: 20, concepto: conceptoDe('BEEBLEBROX', 'ZAPHOD'), fecha: '2026-09-29' });

    const { resultados } = await subirPagos({ neto: 13 });

    expect(resultadoDe(resultados, linea)).toMatchObject({ tipo: 'importe_no_cuadra', candidatos: [] });
    expect((await lineaPorId(linea.id)).datos_originales.larpmanager).toBe('el importe no cuadra');
  });

  it('212. si ningún pago se parece al concepto de la línea, dice que no lo encuentra', async () => {
    const linea = await sembrarLinea({ importe: 13, concepto: conceptoDe('PERFECTLYUNRELATED'), fecha: '2026-09-29' });

    const { resultados } = await subirPagos({});

    expect(resultadoDe(resultados, linea)).toMatchObject({ tipo: 'no_encontrado' });
  });

  it('213. dos pagos iguales y una sola línea: la línea recibe una propuesta, no una duda entre las dos', async () => {
    const linea = await sembrarLinea({ importe: 13, concepto: conceptoDe('BEEBLEBROX', 'ZAPHOD'), fecha: '2026-09-29' });

    const { resultados } = await subirPagos({}, {});

    expect(resultadoDe(resultados, linea).tipo).toBe('match');
    expect((await pagoDe())).toHaveLength(2);
  });

  it('214. con dos líneas iguales y un solo pago, la propuesta es para la más cercana en fecha', async () => {
    const cerca = await sembrarLinea({ importe: 13, concepto: conceptoDe('BEEBLEBROX', 'ZAPHOD'), fecha: '2026-09-29' });
    const lejos = await sembrarLinea({ importe: 13, concepto: conceptoDe('BEEBLEBROX', 'ZAPHOD'), fecha: '2026-07-01' });

    const { resultados } = await subirPagos({ fecha: '29/09/2026' });

    expect(resultadoDe(resultados, cerca).tipo).toBe('match');
    expect(resultadoDe(resultados, lejos).tipo).toBe('no_encontrado');
  });

  it('215. un pago que ya rechazaste para esa línea no se vuelve a proponer', async () => {
    const linea = await sembrarLinea({ importe: 13, concepto: conceptoDe('BEEBLEBROX', 'ZAPHOD'), fecha: '2026-09-29' });
    await subirPagos({});
    const [pago] = await pagoDe();

    await rechazarSugerenciaLarpManager(pago.id, linea.id);
    const { resultados } = await subirPagos({});

    expect(resultadoDe(resultados, linea).tipo).not.toBe('match');
  });

  it('216. subir el mismo archivo dos veces no duplica los pagos, pero dos filas idénticas dentro del archivo cuentan como dos', async () => {
    await subirPagos({});
    await subirPagos({});
    expect(await pagoDe()).toHaveLength(1);

    await subirPagos({ nombre: TRILLIAN, neto: 7 }, { nombre: TRILLIAN, neto: 7 });
    await subirPagos({ nombre: TRILLIAN, neto: 7 }, { nombre: TRILLIAN, neto: 7 });
    expect(await pagoDe(TRILLIAN)).toHaveLength(2);
  });

  it('217. los pagos que no pasan por el banco (Stripe) se guardan pero no se cruzan', async () => {
    const linea = await sembrarLinea({ importe: 13, concepto: conceptoDe('BEEBLEBROX', 'ZAPHOD'), fecha: '2026-09-29' });

    const { resultados } = await subirPagos({ metodo: 'Stripe' });

    expect(resultadoDe(resultados, linea).tipo).toBe('no_encontrado');
    const [pago] = await pagoDe();
    expect(pago.entra_en_cruce).toBe(false);
  });

  it('218. un pago que cuadra con una línea que ya estaba resuelta se enlaza solo (decidido con la usuaria), sin tocar la nota ni el estado de la línea', async () => {
    const linea = await sembrarLinea({ importe: 13, concepto: conceptoDe('BEEBLEBROX', 'ZAPHOD'), fecha: '2026-09-29', estado: 'resuelta' });
    await query(`UPDATE movimientos SET nota_final = 'ya la había confirmado' WHERE id = $1`, [linea.id]);

    const { resultados } = await subirPagos({});

    expect(resultadoDe(resultados, linea)).toMatchObject({ tipo: 'match_ya_resuelta', sugerenciaNota: null });
    const [pago] = await pagoDe();
    expect(String(pago.movimiento_id)).toBe(String(linea.id));
    expect(pago.estado).toBe('resuelta');
    expect(await lineaPorId(linea.id)).toMatchObject({ estado: 'resuelta', nota_final: 'ya la había confirmado' });
  });
});

describe('los pagos que no llegan al banco', () => {
  it('217b. un pago con "lm" en Info es un apunte interno: se guarda pero no se cruza con el banco', async () => {
    const linea = await sembrarLinea({ importe: 13, concepto: conceptoDe('BEEBLEBROX', 'ZAPHOD'), fecha: '2026-09-29' });

    const { resultados } = await subirPagos({ metodo: '', info: 'lm' });

    const [pago] = await pagoDe();
    expect(pago.entra_en_cruce).toBe(false);
    expect(resultadoDe(resultados, linea).tipo).toBe('no_encontrado');
  });

  it('217c. un pago ya guardado con "lm" que aún entraba en el cruce se corrige, sin tocar los enlazados ni los que llegan por transferencia', async () => {
    await subirPagos({ metodo: '', info: 'x' }, { nombre: TRILLIAN, metodo: 'Wire', neto: 7 }, { nombre: TRILLIAN, metodo: '', info: 'y', neto: 20 });
    const linea = await sembrarLinea({ importe: 20, concepto: 'LINEA DE PRUEBA' });
    await query(`UPDATE larpmanager_pagos SET datos_originales = jsonb_set(datos_originales, '{Info}', '"lm"'), entra_en_cruce = true WHERE nombre_real IN ($1, $2)`, [ZAPHOD, TRILLIAN]);
    await query(`UPDATE larpmanager_pagos SET movimiento_id = $1 WHERE nombre_real = $2 AND importe = 20`, [linea.id, TRILLIAN]);

    await corregirPagosQueNoLlegan();

    const { rows } = await query(`SELECT nombre_real, importe::float AS importe, entra_en_cruce FROM larpmanager_pagos WHERE nombre_real IN ($1, $2) ORDER BY nombre_real, importe`, [ZAPHOD, TRILLIAN]);
    expect(rows).toEqual([
      { nombre_real: TRILLIAN, importe: 7, entra_en_cruce: true },
      { nombre_real: TRILLIAN, importe: 20, entra_en_cruce: true },
      { nombre_real: ZAPHOD, importe: 13, entra_en_cruce: false },
    ]);
  });
});

describe('un movimiento del banco solo justifica un pago', () => {
  it('218b. una línea que ya tiene su pago no recibe otro al subir un archivo nuevo: el pago nuevo se propone a la línea pendiente que le corresponde', async () => {
    const yaEnlazada = await sembrarLinea({ importe: 160, concepto: conceptoDe('BEEBLEBROX', 'ZAPHOD'), fecha: '2026-10-09', estado: 'resuelta' });
    await subirPagos({ neto: 160, fecha: '15/08/2026' });
    const [primero] = await pagoDe();
    expect(String(primero.movimiento_id)).toBe(String(yaEnlazada.id));
    const pendiente = await sembrarLinea({ importe: 160, concepto: conceptoDe('BEEBLEBROX', 'ZAPHOD'), fecha: '2026-08-18' });

    const { resultados } = await subirPagos({ neto: 160, fecha: '15/08/2026' }, { neto: 160, fecha: '10/10/2026' });

    const pagos = await pagoDe();
    expect(pagos).toHaveLength(2);
    expect(pagos.filter(p => String(p.movimiento_id) === String(yaEnlazada.id))).toHaveLength(1);
    expect(pagos.find(p => String(p.id) !== String(primero.id)).movimiento_id).toBeNull();
    expect(resultadoDe(resultados, yaEnlazada)).toBeUndefined();
    expect(resultadoDe(resultados, pendiente)).toMatchObject({ tipo: 'match' });
    expect((await lineaPorId(pendiente.id)).estado).toBe('sin_resolver');
  });

  it('218c. un pago nunca se enlaza solo a una línea que ya tiene otro pago, aunque se llame directamente', async () => {
    const linea = await sembrarLinea({ importe: 160, concepto: conceptoDe('BEEBLEBROX', 'ZAPHOD'), fecha: '2026-09-29', estado: 'resuelta' });
    await subirPagos({ neto: 160, fecha: '28/09/2026' });
    await subirPagos({ neto: 160, fecha: '28/09/2026' }, { neto: 160, fecha: '30/09/2026' });

    const enlazados = (await pagoDe()).filter(p => String(p.movimiento_id) === String(linea.id));

    expect(enlazados).toHaveLength(1);
  });
});

describe('la lista de pagos sin emparejar', () => {
  it('219. cada pago dice por qué está así: con propuesta, importe que no cuadra, sin nada en el banco, ignorado, dado por bueno o emparejado', async () => {
    await sembrarLinea({ importe: 13, concepto: conceptoDe('BEEBLEBROX', 'ZAPHOD'), fecha: '2026-09-29' });
    await sembrarLinea({ importe: 99, concepto: conceptoDe('ASTRA', 'TRILLIAN'), fecha: '2026-09-20' });
    await subirPagos({}, { nombre: TRILLIAN, neto: 7, fecha: '20/09/2026' }, { nombre: 'Marvin Paranoid', neto: 5, fecha: '01/09/2026' });
    const porNombre = async nombre => (await listarPagosLarpManagerSinEmparejar()).find(p => p.nombre_real === nombre);

    expect(await porNombre(ZAPHOD)).toMatchObject({ motivo: 'sin_confirmar', motivoTexto: 'Ok' });
    expect((await porNombre(ZAPHOD)).sugerencia.importe).toBe(13);
    expect(await porNombre(TRILLIAN)).toMatchObject({ motivo: 'importe_no_cuadra', motivoTexto: 'El importe no cuadra' });
    expect(await porNombre('Marvin Paranoid')).toMatchObject({ motivo: 'no_esta' });

    const [marvin] = await pagoDe('Marvin Paranoid');
    await cambiarEstadoPago(marvin.id, 'ignorada');
    expect(await porNombre('Marvin Paranoid')).toMatchObject({ motivo: 'ignorada' });
    await cambiarEstadoPago(marvin.id, 'resuelta');
    expect(await porNombre('Marvin Paranoid')).toMatchObject({ motivo: 'resuelta_a_mano' });
    await query(`DELETE FROM larpmanager_pagos WHERE nombre_real = 'Marvin Paranoid'`);
  });
});

describe('emparejar un pago a mano', () => {
  const montar = async (concepto = conceptoDe('BEEBLEBROX', 'ZAPHOD'), importe = 13) => {
    const linea = await sembrarLinea({ importe, concepto, fecha: '2026-09-29' });
    await subirPagos({});
    const [pago] = await pagoDe();
    return { linea, pago };
  };

  it('220. vincular resuelve la línea, marca el pago como resuelto y deja escrito de quién es', async () => {
    const { linea, pago } = await montar();

    const r = await vincularPagoAMano(pago.id, linea.id);

    expect(r.estadoCambiado).toBe(true);
    const m = await lineaPorId(linea.id);
    expect(m.estado).toBe('resuelta');
    expect(m.datos_originales.larpmanager).toBe(`${ZAPHOD} — Wield #2`);
    const [despues] = await pagoDe();
    expect(String(despues.movimiento_id)).toBe(String(linea.id));
    expect(despues.estado).toBe('resuelta');
  });

  it('221. no se puede vincular un pago ya vinculado, ni a una línea que no es un ingreso, ni a algo que no existe', async () => {
    const { linea, pago } = await montar();
    const gasto = await sembrarLinea({ importe: -13, concepto: 'COMPRA CUALQUIERA' });
    await vincularPagoAMano(pago.id, linea.id);

    await expect(vincularPagoAMano(pago.id, linea.id)).rejects.toThrow(/ya está vinculado/);
    await subirPagos({ nombre: TRILLIAN, neto: 7 });
    const [otro] = await pagoDe(TRILLIAN);
    await expect(vincularPagoAMano(otro.id, gasto.id)).rejects.toThrow(/no es un ingreso/);
    await expect(vincularPagoAMano(otro.id, 987654321)).rejects.toThrow(/Movimiento no encontrado/);
    await expect(vincularPagoAMano(987654321, linea.id)).rejects.toThrow(/Pago no encontrado/);
  });

  it('222. desvincular devuelve el pago a pendiente y quita de quién era, pero no toca el estado de la línea', async () => {
    const { linea, pago } = await montar();
    await vincularPagoAMano(pago.id, linea.id);

    const r = await desvincularPago(pago.id);

    expect(String(r.movimientoId)).toBe(String(linea.id));
    const [despues] = await pagoDe();
    expect(despues).toMatchObject({ movimiento_id: null, estado: 'pendiente' });
    const m = await lineaPorId(linea.id);
    expect(m.estado).toBe('resuelta');
    expect(m.datos_originales.larpmanager).toBeUndefined();
    await expect(desvincularPago(pago.id)).rejects.toThrow(/no está vinculado/);
  });

  it('223. el estado de un pago solo puede ser pendiente, resuelta o ignorada, y no se cambia si ya tiene línea', async () => {
    const { linea, pago } = await montar();

    expect(await cambiarEstadoPago(pago.id, 'ignorada')).toEqual({ estado: 'ignorada' });
    await expect(cambiarEstadoPago(pago.id, 'borrada')).rejects.toThrow(/Estado no válido/);
    await expect(cambiarEstadoPago(987654321, 'ignorada')).rejects.toThrow(/Pago no encontrado/);

    await cambiarEstadoPago(pago.id, 'pendiente');
    await vincularPagoAMano(pago.id, linea.id);
    await expect(cambiarEstadoPago(pago.id, 'ignorada')).rejects.toThrow(/quítale el vínculo/);
  });

  it('224. resolver una línea desde su propuesta la resuelve y enlaza el pago que coincide exactamente', async () => {
    const { linea } = await montar();
    const { resultados } = await subirPagos({});
    const propuesta = resultadoDe(resultados, linea).candidatos[0];

    await resolverPagoLarpManager(linea.id, propuesta);

    expect((await lineaPorId(linea.id)).estado).toBe('resuelta');
    const [pago] = await pagoDe();
    expect(String(pago.movimiento_id)).toBe(String(linea.id));
    expect(pago.estado).toBe('resuelta');
  });
});

describe('las listas de candidatos', () => {
  it('225. para un pago: primero las líneas que llevan su nombre, luego las del mismo importe; sin las ya ocupadas, los gastos ni las remesas', async () => {
    const conNombre = await sembrarLinea({ importe: 50, concepto: conceptoDe('BEEBLEBROX', 'ZAPHOD'), fecha: '2026-09-01' });
    const mismoImporte = await sembrarLinea({ importe: 13, concepto: 'INGRESO SIN NOMBRE', fecha: '2026-09-29' });
    const otra = await sembrarLinea({ importe: 99, concepto: 'INGRESO OTRO', fecha: '2026-08-01' });
    await sembrarLinea({ importe: -13, concepto: 'UN GASTO' });
    await sembrarLinea({ importe: 13, concepto: 'LIQUIDACION REMESA DE COMERCIOS 123' });
    const ocupada = await sembrarLinea({ importe: 13, concepto: 'OTRO INGRESO OCUPADO', fecha: '2026-09-29' });
    await subirPagos({ nombre: TRILLIAN, neto: 13, fecha: '29/09/2026' });
    const [ajeno] = await pagoDe(TRILLIAN);
    await vincularPagoAMano(ajeno.id, ocupada.id);
    await subirPagos({});
    const [pago] = await pagoDe();

    const candidatas = await listarCandidatosParaPago(pago.id);

    expect(candidatas.map(c => String(c.id))).toEqual([conNombre.id, mismoImporte.id, otra.id].map(String));
    expect(candidatas[0]).toMatchObject({ suNombre: true, mismoImporte: false });
    expect(candidatas[1]).toMatchObject({ suNombre: false, mismoImporte: true, diasDeDiferencia: 0 });
  });

  it('226. para una línea: primero los pagos con su nombre, y se niega si no es un ingreso o ya justifica un pago', async () => {
    const linea = await sembrarLinea({ importe: 13, concepto: conceptoDe('BEEBLEBROX', 'ZAPHOD'), fecha: '2026-09-29' });
    await subirPagos({}, { nombre: TRILLIAN, neto: 40, fecha: '01/08/2026' });

    const candidatos = await listarPagosCandidatosParaMovimiento(linea.id);

    expect(candidatos.map(c => c.nombreReal)).toEqual([ZAPHOD, TRILLIAN]);
    expect(candidatos[0]).toMatchObject({ suNombre: true, mismoImporte: true });

    const gasto = await sembrarLinea({ importe: -5, concepto: 'GASTO' });
    await expect(listarPagosCandidatosParaMovimiento(gasto.id)).rejects.toThrow(/no es un ingreso/);
    const [pago] = await pagoDe();
    await vincularPagoAMano(pago.id, linea.id);
    await expect(listarPagosCandidatosParaMovimiento(linea.id)).rejects.toThrow(/ya justifica un pago/);
  });

  it('227. el historial de un jugador dice qué pasó con cada pago suyo', async () => {
    const linea = await sembrarLinea({ importe: 13, concepto: conceptoDe('BEEBLEBROX', 'ZAPHOD'), fecha: '2026-09-29' });
    await subirPagos({}, { neto: 20, fecha: '10/09/2026' }, { neto: 30, fecha: '11/09/2026', metodo: 'Stripe' }, { neto: 40, fecha: '12/09/2026' });
    const pagos = await pagoDe();
    await vincularPagoAMano(pagos.find(p => Number(p.importe) === 13).id, linea.id);
    await cambiarEstadoPago(pagos.find(p => Number(p.importe) === 40).id, 'ignorada');

    const historial = await historialDeJugador(pagos[0].id);
    const nota = importe => historial.find(h => h.importe === importe).nota;

    expect(historial.find(h => h.importe === 13).movimiento.id.toString()).toBe(String(linea.id));
    expect(nota(20)).toBe('Sin emparejar');
    expect(nota(30)).toBe('No pasa por el banco (Stripe)');
    expect(nota(40)).toBe('Ignorado a mano');
  });
});

describe('las rutas de los pagos de LarpManager', () => {
  const post = (cuerpo = {}) => new Request('http://pruebas/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
  const conId = id => ({ params: Promise.resolve({ id: String(id) }) });

  it('228. vincular o rechazar sin decir el movimiento dan error 400', async () => {
    expect((await vincularRuta(post({}), conId(1))).status).toBe(400);
    expect((await rechazarRuta(post({}), conId(1))).status).toBe(400);
  });

  it('229. un estado que no vale o un pago que no existe devuelven el mensaje claro', async () => {
    await subirPagos({});
    const [pago] = await pagoDe();

    const malo = await estadoRuta(post({ estado: 'borrada' }), conId(pago.id));
    expect((await malo.json()).error).toMatch(/Estado no válido/);
    const noExiste = await candidatosRuta(new Request('http://pruebas/'), conId(987654321));
    expect((await noExiste.json()).error).toMatch(/Pago no encontrado/);
  });

  it('230. la lista de pagos sin emparejar y los candidatos de un pago salen por su ruta', async () => {
    await sembrarLinea({ importe: 13, concepto: conceptoDe('BEEBLEBROX', 'ZAPHOD'), fecha: '2026-09-29' });
    await subirPagos({});
    const [pago] = await pagoDe();

    const { pagos } = await (await sinEmparejarRuta()).json();
    const { candidatos, historial } = await (await candidatosRuta(new Request('http://pruebas/'), conId(pago.id))).json();

    expect(pagos.some(p => p.nombre_real === ZAPHOD)).toBe(true);
    expect(candidatos).toHaveLength(1);
    expect(historial).toHaveLength(1);
  });
});
