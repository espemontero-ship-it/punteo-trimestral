import ExcelJS from 'exceljs';
import { query } from '../lib/db.cjs';

export const PREFIJO = 'PRUEBA-exportar';

export const limpiarExportar = async () => {
  await query(`DELETE FROM movimiento_facturas WHERE factura_id IN (SELECT id FROM facturas WHERE nombre_original LIKE $1)`, [`${PREFIJO}%`]);
  await query(`DELETE FROM facturas WHERE nombre_original LIKE $1`, [`${PREFIJO}%`]);
  await query(`DELETE FROM movimientos WHERE importacion_id IN (SELECT id FROM importaciones WHERE nombre_archivo LIKE $1)`, [`${PREFIJO}%`]);
  await query(`DELETE FROM importaciones WHERE nombre_archivo LIKE $1`, [`${PREFIJO}%`]);
  await query(`DELETE FROM envios_gestoria WHERE etiqueta LIKE $1`, [`${PREFIJO}%`]);
  await query(`DELETE FROM larpmanager_pagos WHERE nombre_real LIKE $1`, [`${PREFIJO}%`]);
};

export const dia = (mes, d) => new Date(Date.UTC(2026, mes - 1, d));
export const CABECERA_BBVA = ['F. CONTABLE', 'CONCEPTO', 'IMPORTE', 'SALDO'];
export const CABECERA_PAYPAL = ['FECHA', 'NOMBRE', 'NETO'];

async function libroDe({ hoja, cabecera, filas, titulo, combinarTitulo }) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(hoja);
  if (titulo) ws.addRow([titulo]);
  if (titulo && combinarTitulo) ws.mergeCells('A1:D1');
  ws.addRow(cabecera);
  for (const f of filas) ws.addRow(f).getCell(1).numFmt = 'dd/mm/yyyy';
  ws.getColumn(2).width = 40;
  return wb.xlsx.writeBuffer();
}

let contador = 0;
export const archivos = {};

export async function subida({ hoja = 'bbva', cabecera = CABECERA_BBVA, titulo = 'Movimientos', combinarTitulo = false, lineas }) {
  contador++;
  const ruta = `https://ejemplo/${PREFIJO}-${contador}.xlsx`;
  archivos[ruta] = await libroDe({ hoja, cabecera, titulo, combinarTitulo, filas: lineas.map(l => [dia(...l.fecha), l.concepto, l.importe, l.saldo ?? 100]) });
  const { rows: [imp] } = await query(
    `INSERT INTO importaciones (hoja, ruta_blob, nombre_archivo) VALUES ($1, $2, $3) RETURNING id`,
    [hoja, ruta, `${PREFIJO}-${contador}.xlsx`]
  );
  const creados = [];
  for (const [i, l] of lineas.entries()) {
    if (l.repetida) continue;
    const { rows: [m] } = await query(
      `INSERT INTO movimientos (hoja, fila, importacion_id, fecha, concepto, importe, clave, estado)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'resuelta') RETURNING id, importacion_id`,
      [hoja, (titulo ? 3 : 2) + i, imp.id, `2026-${String(l.fecha[0]).padStart(2, '0')}-${String(l.fecha[1]).padStart(2, '0')}`, l.concepto, l.importe, l.concepto.toLowerCase()]
    );
    if (l.nota) await query(`UPDATE movimientos SET nota_final = $2 WHERE id = $1`, [m.id, l.nota]);
    creados.push({
      id: m.id, importacion_id: m.importacion_id, concepto: l.concepto, nota_final: l.nota ?? null, proveedor: l.proveedor ?? null,
      proyecto_nombre: null, facturas: l.facturas ?? '', jugador_larpmanager: null, larpmanager: null,
    });
  }
  return creados;
}

export async function facturaEnlazada(movimientoId, numero) {
  const nombre = `${PREFIJO}-factura-${numero}.pdf`;
  const ruta = `https://ejemplo/${nombre}`;
  archivos[ruta] = Buffer.from(`pdf de la factura ${numero}`);
  const { rows: [f] } = await query(
    `INSERT INTO facturas (ruta_blob, nombre_original, numero, estado) VALUES ($1, $2, $3, 'matcheada') RETURNING id`,
    [ruta, nombre, numero]
  );
  await query(`INSERT INTO movimiento_facturas (movimiento_id, factura_id) VALUES ($1, $2)`, [movimientoId, f.id]);
  return Number(f.id);
}

export const descargar = async ruta => archivos[ruta];

export async function leer(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  return wb;
}

export const columna = (ws, n, desde) => {
  const valores = [];
  ws.eachRow({ includeEmpty: false }, (fila, r) => { if (r >= desde) valores.push(fila.getCell(n).value); });
  return valores;
};
