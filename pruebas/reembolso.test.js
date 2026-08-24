import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import bcrypt from 'bcryptjs';
import { query } from '../lib/db.cjs';
import {
  buscarOCrearLote, subirFacturaLote, corregirFacturaColaborador, retirarFacturaColaborador,
  calcularTotales,
} from '../lib/lotes.cjs';
import { crearAnticipo, pagarFacturas, listarPagosDeLote, vincularPago, desvincularPago, pagosSinConciliar, pagosParaEnvio } from '../lib/pagos.cjs';
import { cerrarProyecto } from '../lib/proyectos.cjs';
import { analizarFactura } from '../lib/facturaMatcher.cjs';
import { construirProveedores } from '../lib/agrupador.cjs';
import { importeDeFactura } from '../lib/importeFactura.cjs';
import { lector, sembrarLinea, lineaPorId } from './ayuda.js';

const CORREO = 'prueba-reembolso@ejemplo.test';
const CLAVE = 'contraseña-de-prueba';
const NOMBRE_PROYECTO = 'PROYECTO DE PRUEBA REEMBOLSO';

async function limpiarTodo() {
  await query(
    `DELETE FROM movimiento_facturas WHERE factura_id IN (
       SELECT f.id FROM facturas f JOIN lotes l ON l.id = f.lote_id JOIN colaboradores c ON c.id = l.colaborador_id
       WHERE c.usuario = $1)`,
    [CORREO]
  );
  await query(
    `DELETE FROM pagos WHERE lote_id IN (
       SELECT l.id FROM lotes l JOIN colaboradores c ON c.id = l.colaborador_id WHERE c.usuario = $1)`,
    [CORREO]
  );
  await query(
    `DELETE FROM movimientos WHERE hoja = 'pruebas' AND clave = 'reembolso'`,
  );
  await query(
    `DELETE FROM facturas WHERE lote_id IN (
       SELECT l.id FROM lotes l JOIN colaboradores c ON c.id = l.colaborador_id WHERE c.usuario = $1)`,
    [CORREO]
  );
  await query(
    `DELETE FROM lotes WHERE colaborador_id IN (SELECT id FROM colaboradores WHERE usuario = $1)`,
    [CORREO]
  );
  await query('DELETE FROM colaboradores WHERE usuario = $1', [CORREO]);
  await query('DELETE FROM proyectos WHERE nombre = $1', [NOMBRE_PROYECTO]);
}

async function sembrarColaborador() {
  const hash = await bcrypt.hash(CLAVE, 10);
  const { rows } = await query(
    `INSERT INTO colaboradores (nombre, usuario, password_hash, rol, estado)
     VALUES ('Pepito de prueba', $1, $2, 'colaborador', 'activo') RETURNING id`,
    [CORREO, hash]
  );
  return rows[0].id;
}

async function sembrarProyecto() {
  const { rows } = await query(
    `INSERT INTO proyectos (nombre) VALUES ($1)
     ON CONFLICT (nombre) DO UPDATE SET nombre = EXCLUDED.nombre RETURNING id`,
    [NOMBRE_PROYECTO]
  );
  return rows[0].id;
}

const unaDe = importe => lector([{ importe, fecha: '2026-07-19', proveedor: 'Proveedor' }]);
let contador = 0;
async function subirFactura(loteId, importe) {
  contador++;
  const nombre = `PRUEBA-reembolso-${contador}.pdf`;
  const analisis = await analizarFactura(
    Buffer.from(`reembolso-${contador}-${Math.random()}`), true, nombre, unaDe(importe)
  );
  return subirFacturaLote({
    loteId, rutaBlob: `https://ejemplo/${nombre}`, nombreOriginal: nombre, concepto: 'material', analisis,
  });
}

async function facturaPorId(id) {
  const { rows } = await query('SELECT * FROM facturas WHERE id = $1', [id]);
  return rows[0];
}

async function pagoPorId(id) {
  const { rows } = await query('SELECT * FROM pagos WHERE id = $1', [id]);
  return rows[0];
}

let loteId, colaboradorId, proyectoId;
beforeEach(async () => {
  await limpiarTodo();
  colaboradorId = await sembrarColaborador();
  proyectoId = await sembrarProyecto();
  loteId = await buscarOCrearLote(colaboradorId, proyectoId);
});
afterAll(async () => { await limpiarTodo(); });

describe('las facturas', () => {
  it('1. una factura entra aceptada', async () => {
    const { id } = await subirFactura(loteId, 45);
    const f = await facturaPorId(id);
    expect(f.estado_revision).toBe('aceptada');
  });

  it('2. el estado revisar no existe en ninguna parte', async () => {
    const { rows } = await query(
      `SELECT DISTINCT estado_revision FROM facturas WHERE estado_revision IS NOT NULL`
    );
    expect(rows.map(r => r.estado_revision)).not.toContain('subida');
    expect(rows.map(r => r.estado_revision)).not.toContain('revisar');
  });

  it('3. nada lleva trimestre, ni la carpeta ni la factura', async () => {
    const { rows } = await query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name IN ('lotes', 'facturas') AND column_name = 'trimestre_id'`
    );
    expect(rows).toHaveLength(0);
    const { rows: tabla } = await query(
      `SELECT 1 FROM information_schema.tables WHERE table_name = 'trimestres'`
    );
    expect(tabla).toHaveLength(0);
  });

  it('4. él corrige y retira con el proyecto abierto; con el proyecto cerrado, no', async () => {
    const { id } = await subirFactura(loteId, 45);
    await corregirFacturaColaborador(colaboradorId, id, { importe: 50 });
    expect(importeDeFactura(await facturaPorId(id))).toBe(50);

    await cerrarProyecto(proyectoId);
    await expect(corregirFacturaColaborador(colaboradorId, id, { importe: 99 })).rejects.toThrow();
    await expect(retirarFacturaColaborador(colaboradorId, id)).rejects.toThrow();
  });

  it('5. con el proyecto cerrado no puede subir más facturas', async () => {
    await cerrarProyecto(proyectoId);
    await expect(subirFactura(loteId, 45)).rejects.toThrow();
  });
});

describe('los anticipos', () => {
  it('6. un anticipo guarda cuánto y su forma de pago', async () => {
    const id = await crearAnticipo(loteId, { importe: 100, fecha: '2026-07-01', esEfectivo: false });
    const p = await pagoPorId(id);
    expect(Number(p.importe)).toBe(100);
    expect(p.es_efectivo).toBe(false);
  });

  it('7. el de banco espera línea, y al aceptarla queda resuelta con la nota "anticipo Pepito"', async () => {
    const anticipoId = await crearAnticipo(loteId, { importe: 100, fecha: '2026-07-01', esEfectivo: false });
    const linea = await sembrarLinea({ importe: -100, concepto: 'linea de prueba', fecha: '2026-07-02' });
    await query(`UPDATE movimientos SET hoja = 'pruebas', clave = 'reembolso' WHERE id = $1`, [linea.id]);

    await vincularPago(anticipoId, linea.id);
    const m = await lineaPorId(linea.id);
    expect(m.estado).toBe('resuelta');
    expect(m.nota_final).toMatch(/anticipo Pepito de prueba/);
  });

  it('8. el de efectivo no espera ninguna línea', async () => {
    const id = await crearAnticipo(loteId, { importe: 40, fecha: '2026-07-01', esEfectivo: true });
    const p = await pagoPorId(id);
    expect(p.movimiento_id).toBeNull();
    const pendientes = await pagosSinConciliar();
    expect(pendientes.map(x => x.id)).not.toContain(p.id);
  });

  it('9. un anticipo se puede dar aunque él no tenga ninguna factura subida todavía', async () => {
    const id = await crearAnticipo(loteId, { importe: 30, fecha: '2026-07-01', esEfectivo: true });
    expect(id).toBeTruthy();
  });

  it('9b. calcularTotales enseña lo que se le debe de verdad, ya descontado el anticipo', async () => {
    await crearAnticipo(loteId, { importe: 20, fecha: '2026-07-01', esEfectivo: true });
    await subirFactura(loteId, 45.60);
    await subirFactura(loteId, 12.30);

    const totales = await calcularTotales(loteId);
    expect(totales.pendienteDePagar).toBe(37.9);
  });
});

describe('el pago', () => {
  it('10. al pulsar Pagar, las facturas elegidas quedan pagadas, asociadas a ese pago con su fecha', async () => {
    const { id: f1 } = await subirFactura(loteId, 45);
    const { id: f2 } = await subirFactura(loteId, 30);

    const pago = await pagarFacturas(loteId, { facturaIds: [f1, f2], fecha: '2026-07-20' });

    const factura1 = await facturaPorId(f1);
    const factura2 = await facturaPorId(f2);
    expect(factura1.estado_revision).toBe('pagada');
    expect(factura2.estado_revision).toBe('pagada');
    expect(factura1.pago_id).toBe(pago.id);
    expect(factura2.pago_id).toBe(pago.id);

    const { rows: [conFecha] } = await query(
      `SELECT to_char(fecha, 'YYYY-MM-DD') AS fecha_texto, importe FROM pagos WHERE id = $1`, [pago.id]
    );
    expect(conFecha.fecha_texto).toBe('2026-07-20');
    expect(Number(conFecha.importe)).toBe(75);
  });

  it('11. se puede pagar varias veces en el mismo proyecto', async () => {
    const { id: f1 } = await subirFactura(loteId, 45);
    await pagarFacturas(loteId, { facturaIds: [f1], fecha: '2026-07-10' });

    const { id: f2 } = await subirFactura(loteId, 30);
    const segundo = await pagarFacturas(loteId, { facturaIds: [f2], fecha: '2026-08-10' });

    expect(Number((await pagoPorId(segundo.id)).importe)).toBe(30);
    const pagos = await listarPagosDeLote(loteId);
    expect(pagos).toHaveLength(2);
  });

  it('12. un pago sin su línea todavía engancha cuando aparece, y queda conciliado sin cambiar el estado de sus facturas', async () => {
    const { id: f1 } = await subirFactura(loteId, 45);
    const pago = await pagarFacturas(loteId, { facturaIds: [f1], fecha: '2026-07-20' });

    const linea = await sembrarLinea({ importe: -45, fecha: '2026-07-21' });
    await query(`UPDATE movimientos SET hoja = 'pruebas', clave = 'reembolso' WHERE id = $1`, [linea.id]);

    await vincularPago(pago.id, linea.id);

    expect((await pagoPorId(pago.id)).movimiento_id).toBe(linea.id);
    expect((await facturaPorId(f1)).estado_revision).toBe('pagada');
    expect((await lineaPorId(linea.id)).estado).toBe('resuelta');
  });

  it('13. un pago espera un ingreso suyo cuando se le anticipó de más', async () => {
    await crearAnticipo(loteId, { importe: 100, fecha: '2026-07-01', esEfectivo: true });
    const { id: f1 } = await subirFactura(loteId, 30);

    const pago = await pagarFacturas(loteId, { facturaIds: [f1], fecha: '2026-07-20' });
    expect(Number((await pagoPorId(pago.id)).importe)).toBe(-70);
  });

  it('14. el cuadre de esa línea es el mismo que el del resto del banco', async () => {
    const { id: f1 } = await subirFactura(loteId, 100);
    const pago = await pagarFacturas(loteId, { facturaIds: [f1], fecha: '2026-07-20' });

    await sembrarLinea({ importe: -100.5, concepto: 'no debe proponerse', fecha: '2026-07-21' });
    const linea = await sembrarLinea({ importe: -99.5, concepto: 'linea de prueba', fecha: '2026-07-21' });
    await query(`UPDATE movimientos SET hoja = 'pruebas', clave = 'reembolso'`);

    const grupos = await construirProveedores();
    const movimiento = grupos.flatMap(g => g.movimientos).find(m => m.id === linea.id);
    expect(movimiento.pago_sugerido).toBeTruthy();
    expect(movimiento.pago_sugerido.pagoId).toBe(pago.id);
    expect(movimiento.pago_sugerido.exacto).toBe(false);
    expect(movimiento.pago_sugerido.diferencia).toBeCloseTo(-0.5, 2);
  });

  it('15. la ✕ descarta la propuesta y no vuelve', async () => {
    const { id: f1 } = await subirFactura(loteId, 100);
    const pago = await pagarFacturas(loteId, { facturaIds: [f1], fecha: '2026-07-20' });
    const linea = await sembrarLinea({ importe: -100, fecha: '2026-07-21' });
    await query(`UPDATE movimientos SET hoja = 'pruebas', clave = 'reembolso' WHERE id = $1`, [linea.id]);

    const { registrarRechazo } = await import('../lib/memoria.cjs');
    await registrarRechazo('pruebas', 'reembolso', 'pago', String(pago.id));

    const grupos = await construirProveedores();
    const movimiento = grupos.flatMap(g => g.movimientos).find(m => m.id === linea.id);
    expect(movimiento.pago_sugerido).toBeNull();
  });

  it('16. si una factura ya colgaba de otro movimiento, avisa', async () => {
    const { id: f1 } = await subirFactura(loteId, 45);
    const pago1 = await pagarFacturas(loteId, { facturaIds: [f1], fecha: '2026-07-20' });
    const linea1 = await sembrarLinea({ importe: -45, fecha: '2026-07-21' });
    await query(`UPDATE movimientos SET hoja = 'pruebas', clave = 'reembolso' WHERE id = $1`, [linea1.id]);
    await vincularPago(pago1.id, linea1.id);

    await query(`UPDATE facturas SET pago_id = NULL, estado_revision = 'aceptada' WHERE id = $1`, [f1]);
    const pago2 = await pagarFacturas(loteId, { facturaIds: [f1], fecha: '2026-07-25' });
    const linea2 = await sembrarLinea({ importe: -45, fecha: '2026-07-26' });
    await query(`UPDATE movimientos SET hoja = 'pruebas', clave = 'reembolso' WHERE id = $1`, [linea2.id]);

    await expect(vincularPago(pago2.id, linea2.id)).rejects.toThrow();
    expect((await lineaPorId(linea2.id)).estado).toBe('sin_resolver');
  });
});

describe('deshacer un pago', () => {
  it('16b. un pago se puede desvincular: la línea vuelve a pendiente y sus facturas siguen pagadas', async () => {
    const { id: f1 } = await subirFactura(loteId, 45);
    const pago = await pagarFacturas(loteId, { facturaIds: [f1], fecha: '2026-07-20' });
    const linea = await sembrarLinea({ importe: -45, fecha: '2026-07-21' });
    await query(`UPDATE movimientos SET hoja = 'pruebas', clave = 'reembolso' WHERE id = $1`, [linea.id]);
    await vincularPago(pago.id, linea.id);

    await desvincularPago(pago.id);

    expect((await pagoPorId(pago.id)).movimiento_id).toBeNull();
    expect((await lineaPorId(linea.id)).estado).toBe('sin_resolver');
    expect((await facturaPorId(f1)).estado_revision).toBe('pagada');
    const { rows } = await query(`SELECT COUNT(*) AS n FROM movimiento_facturas WHERE movimiento_id = $1`, [linea.id]);
    expect(Number(rows[0].n)).toBe(0);
  });
});

describe('cerrar el proyecto', () => {
  it('17. las facturas pagadas llegan a la gestoría por el movimiento', async () => {
    const { id: f1 } = await subirFactura(loteId, 45);
    const pago = await pagarFacturas(loteId, { facturaIds: [f1], fecha: '2026-07-20' });
    const linea = await sembrarLinea({ importe: -45, fecha: '2026-07-21' });
    await query(`UPDATE movimientos SET hoja = 'pruebas', clave = 'reembolso' WHERE id = $1`, [linea.id]);
    await vincularPago(pago.id, linea.id);

    const { rows } = await query(
      `SELECT f.numero FROM movimiento_facturas mf JOIN facturas f ON f.id = mf.factura_id WHERE mf.movimiento_id = $1`,
      [linea.id]
    );
    expect(rows.map(r => r.numero)).toContain((await facturaPorId(f1)).numero);
  });

  it('18. cada pago lleva su hoja en el excel: sus facturas, sus anticipos y el total', async () => {
    await crearAnticipo(loteId, { importe: 20, fecha: '2026-07-01', esEfectivo: true });
    const { id: f1 } = await subirFactura(loteId, 45);
    const pago = await pagarFacturas(loteId, { facturaIds: [f1], fecha: '2026-07-20' });
    const linea = await sembrarLinea({ importe: -25, fecha: '2026-07-21' });
    await query(`UPDATE movimientos SET hoja = 'pruebas', clave = 'reembolso' WHERE id = $1`, [linea.id]);
    await vincularPago(pago.id, linea.id);

    const [datos] = await pagosParaEnvio([linea.id]);
    expect(datos.facturas.map(f => f.numero)).toContain((await facturaPorId(f1)).numero);
    expect(datos.anticipos).toHaveLength(1);
    expect(Number(datos.anticipos[0].importe)).toBe(20);
    expect(Number(datos.importe)).toBe(25);
  });

  it('18b. cerrar un proyecto lo cierra para todos sus colaboradores', async () => {
    await cerrarProyecto(proyectoId);
    const { rows } = await query('SELECT estado FROM proyectos WHERE id = $1', [proyectoId]);
    expect(rows[0].estado).toBe('cerrado');
    await expect(subirFactura(loteId, 10)).rejects.toThrow();
  });

  it('19. él ve sus facturas y pagos de un proyecto cerrado, sin poder tocarlos', async () => {
    const { id: f1 } = await subirFactura(loteId, 45);
    await cerrarProyecto(proyectoId);

    const { listarFacturasDeLote } = await import('../lib/lotes.cjs');
    const facturas = await listarFacturasDeLote(loteId);
    expect(facturas.map(f => f.id)).toContain(f1);
    await expect(retirarFacturaColaborador(colaboradorId, f1)).rejects.toThrow();
  });
});
