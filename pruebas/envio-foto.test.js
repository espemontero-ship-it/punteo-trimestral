import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { marcarComoEnviado, deshacerEnvio } from '../lib/exportar.cjs';
import { query } from '../lib/db.cjs';
import { PREFIJO, limpiarExportar, subida, facturaEnlazada } from './ayuda-exportar.js';

const HASTA = '2026-12-31';
const ETIQUETA = `${PREFIJO}-foto`;
const USUARIO = `${PREFIJO}-colaboradora`;
const PROYECTO = `${PREFIJO}-proyecto`;

async function limpiar() {
  await query(`DELETE FROM pagos WHERE lote_id IN (SELECT id FROM lotes WHERE colaborador_id IN (SELECT id FROM colaboradores WHERE usuario = $1))`, [USUARIO]);
  await limpiarExportar();
  await query(`DELETE FROM colaboradores WHERE usuario = $1`, [USUARIO]);
  await query(`DELETE FROM proyectos WHERE nombre = $1`, [PROYECTO]);
  await query(`DROP TABLE IF EXISTS envios_foto`);
}

beforeEach(limpiar);
afterAll(limpiar);

async function todoLoQueSeGuarda() {
  const lineas = await subida({ lineas: [
    { fecha: [7, 1], concepto: 'ENVIADA UNO', importe: -10, nota: 'nota uno' },
    { fecha: [7, 2], concepto: 'SIN RESOLVER', importe: -20, estado: 'sin_resolver' },
  ] });
  const facturaId = await facturaEnlazada(lineas[0].id, 990011);
  const { rows: [c] } = await query(
    `INSERT INTO colaboradores (nombre, usuario, password_hash) VALUES ('Colaboradora de prueba', $1, 'hash-secreto-que-no-debe-copiarse') RETURNING id`, [USUARIO]
  );
  const { rows: [p] } = await query(`INSERT INTO proyectos (nombre) VALUES ($1) RETURNING id`, [PROYECTO]);
  const { rows: [l] } = await query(`INSERT INTO lotes (colaborador_id, evento, proyecto_id) VALUES ($1, 'Evento de prueba', $2) RETURNING id`, [c.id, p.id]);
  const { rows: [pago] } = await query(
    `INSERT INTO pagos (lote_id, importe, fecha, movimiento_id) VALUES ($1, 55.5, '2026-07-02', $2) RETURNING id`, [l.id, lineas[0].id]
  );
  const { rows: [lm] } = await query(
    `INSERT INTO larpmanager_pagos (nombre_real, evento, importe, fecha, movimiento_id) VALUES ($1, 'Evento LM', 33, '2026-07-03', $2) RETURNING id`,
    [`${PREFIJO} Jugadora`, lineas[0].id]
  );
  return { lineas, facturaId, colaboradorId: c.id, proyectoId: p.id, loteId: l.id, pagoId: pago.id, lmId: lm.id };
}

const fotoDe = async envioId => (await query(`SELECT datos FROM envios_foto WHERE envio_id = $1`, [envioId])).rows[0]?.datos;
const ids = filas => filas.map(f => String(f.id));

describe('al marcar como enviado se guarda una copia de todo', () => {
  it('450. la copia lleva movimientos, facturas, pagos de LarpManager y pagos a colaboradores completos, también lo que no entra en el envío', async () => {
    const t = await todoLoQueSeGuarda();

    const envio = await marcarComoEnviado({ hasta: HASTA, etiqueta: ETIQUETA });
    const foto = await fotoDe(envio.envioId);

    expect(Object.keys(foto).sort()).toEqual(['colaboradores', 'facturas', 'larpmanager_pagos', 'lotes', 'movimiento_facturas', 'movimientos', 'pagos', 'proyectos']);
    expect(ids(foto.movimientos)).toEqual(expect.arrayContaining(t.lineas.map(l => String(l.id))));
    const enviada = foto.movimientos.find(m => String(m.id) === String(t.lineas[0].id));
    const sinResolver = foto.movimientos.find(m => String(m.id) === String(t.lineas[1].id));
    expect(enviada).toMatchObject({ concepto: 'ENVIADA UNO', nota_final: 'nota uno', estado: 'resuelta', envio_id: envio.envioId });
    expect(sinResolver).toMatchObject({ concepto: 'SIN RESOLVER', estado: 'sin_resolver', envio_id: null });
    const total = Number((await query(`SELECT COUNT(*) AS n FROM movimientos`)).rows[0].n);
    expect(foto.movimientos).toHaveLength(total);
    expect(ids(foto.facturas)).toContain(String(t.facturaId));
    expect(foto.facturas.find(f => String(f.id) === String(t.facturaId))).toMatchObject({ numero: 990011, envio_id: envio.envioId });
    expect(foto.movimiento_facturas).toEqual(expect.arrayContaining([expect.objectContaining({ movimiento_id: Number(t.lineas[0].id), factura_id: t.facturaId })]));
    expect(foto.larpmanager_pagos.find(p => String(p.id) === String(t.lmId))).toMatchObject({ evento: 'Evento LM', movimiento_id: Number(t.lineas[0].id) });
    expect(foto.pagos.find(p => String(p.id) === String(t.pagoId))).toMatchObject({ importe: 55.5, movimiento_id: Number(t.lineas[0].id) });
    expect(ids(foto.lotes)).toContain(String(t.loteId));
    expect(ids(foto.proyectos)).toContain(String(t.proyectoId));
    expect(ids(foto.colaboradores)).toContain(String(t.colaboradorId));
  });

  it('451. la copia de los colaboradores no lleva su contraseña', async () => {
    await todoLoQueSeGuarda();

    const envio = await marcarComoEnviado({ hasta: HASTA, etiqueta: ETIQUETA });
    const foto = await fotoDe(envio.envioId);

    const ella = foto.colaboradores.find(c => c.usuario === USUARIO);
    expect(ella).toMatchObject({ nombre: 'Colaboradora de prueba' });
    expect(ella).not.toHaveProperty('password_hash');
    expect(JSON.stringify(foto)).not.toContain('hash-secreto-que-no-debe-copiarse');
  });

  it('452. deshacer el envío borra su copia, y al marcar de nuevo se guarda otra', async () => {
    await todoLoQueSeGuarda();
    const primero = await marcarComoEnviado({ hasta: HASTA, etiqueta: ETIQUETA });
    expect(await fotoDe(primero.envioId)).toBeDefined();

    await deshacerEnvio(primero.envioId);

    expect(await fotoDe(primero.envioId)).toBeUndefined();
    const segundo = await marcarComoEnviado({ hasta: HASTA, etiqueta: ETIQUETA });
    expect(await fotoDe(segundo.envioId)).toBeDefined();
    expect((await query(`SELECT COUNT(*) AS n FROM envios_foto`)).rows[0].n).toBe('1');
  });

  it('453. si no se puede guardar la copia, no queda nada marcado como enviado', async () => {
    const t = await todoLoQueSeGuarda();
    await query(`CREATE TABLE envios_foto (envio_id BIGINT PRIMARY KEY REFERENCES envios_gestoria(id) ON DELETE CASCADE, datos JSONB NOT NULL CHECK (false), creado_en TIMESTAMPTZ NOT NULL DEFAULT now())`);

    await expect(marcarComoEnviado({ hasta: HASTA, etiqueta: ETIQUETA })).rejects.toThrow();

    const { rows } = await query(`SELECT envio_id FROM movimientos WHERE id = ANY($1::bigint[])`, [t.lineas.map(l => l.id)]);
    expect(rows.every(r => r.envio_id === null)).toBe(true);
    expect((await query(`SELECT envio_id FROM facturas WHERE id = $1`, [t.facturaId])).rows[0].envio_id).toBeNull();
    expect((await query(`SELECT COUNT(*) AS n FROM envios_gestoria WHERE etiqueta = $1`, [ETIQUETA])).rows[0].n).toBe('0');
  });
});
