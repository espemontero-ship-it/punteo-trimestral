const { query } = require('../../../lib/db.cjs');
const { descargarBlob } = require('../../../lib/blob.cjs');
const { eliminarBlob } = require('../../../lib/blob.cjs');
const { analizarFactura } = require('../../../lib/facturaMatcher.cjs');
const { procesarFacturaSubida, asegurarColumnasMotivo } = require('../../../lib/facturaMatcher.cjs');
const { obtenerSesion } = require('../../../lib/auth.cjs');
const { cargarRechazos, estaRechazada } = require('../../../lib/memoria.cjs');

export const maxDuration = 60;

export async function GET() {
  await asegurarColumnasMotivo();
  const { rows } = await query(
    `SELECT f.id, f.numero, f.nombre_original, f.proveedor_clave, f.estado, f.es_imagen,
            f.importes, f.totales, f.fechas, f.concepto, f.creado_en, f.motivo_tipo, f.motivo_detalle, f.motivo_candidatos, f.lectura_regex, f.leido_con_ia,
            f.proveedor, f.huella,
            c.nombre AS subido_por_nombre,
            m.id AS movimiento_id, m.fecha AS movimiento_fecha, m.concepto AS movimiento_concepto, m.importe AS movimiento_importe
     FROM facturas f
     LEFT JOIN colaboradores c ON c.id = f.subido_por
     LEFT JOIN movimiento_facturas mf ON mf.factura_id = f.id
     LEFT JOIN movimientos m ON m.id = mf.movimiento_id
     WHERE f.lote_id IS NULL
     ORDER BY f.numero`
  );
  return Response.json({ facturas: await sinLasRechazadas(rows) });
}

async function sinLasRechazadas(facturas) {
  const conCandidatos = facturas.filter(f => f.motivo_candidatos);
  if (conCandidatos.length === 0) return facturas;

  const ids = new Set();
  for (const f of conCandidatos) {
    const c = f.motivo_candidatos;
    if (c.movimientoId) ids.add(Number(c.movimientoId));
    for (const x of c.candidatos || []) if (x.movimientoId) ids.add(Number(x.movimientoId));
  }
  if (ids.size === 0) return facturas;

  const { rows: lineas } = await query(
    `SELECT id, hoja, clave, importe, concepto FROM movimientos WHERE id = ANY($1::bigint[])`, [[...ids]]
  );
  const porId = new Map(lineas.map(l => [String(l.id), l]));
  const rechazos = await cargarRechazos();

  const valorDe = (facturaId, otras) =>
    [facturaId, ...(otras || []).map(o => o.id)].join(',');

  return facturas.map(f => {
    const c = f.motivo_candidatos;
    if (!c) return f;

    if (c.movimientoId) {
      const linea = porId.get(String(c.movimientoId));
      if (!linea) return f;
      if (estaRechazada(rechazos, linea.hoja, linea.clave, 'combo', valorDe(f.id, c.otrasFacturas))) {
        return { ...f, motivo_candidatos: null };
      }
      return {
        ...f,
        motivo_candidatos: {
          ...c, hoja: linea.hoja, clave: linea.clave,
          lineaImporte: linea.importe, lineaConcepto: linea.concepto,
        },
      };
    }

    const vivos = (c.candidatos || [])
      .map(x => {
        const linea = porId.get(String(x.movimientoId));
        return linea ? { ...x, hoja: linea.hoja, clave: linea.clave } : x;
      })
      .filter(x => !x.hoja || !estaRechazada(rechazos, x.hoja, x.clave, 'combo', valorDe(f.id, null)));

    if (vivos.length === 0) return { ...f, motivo_candidatos: null };
    return { ...f, motivo_candidatos: { ...c, candidatos: vivos } };
  });
}

export async function POST(request) {
  const sesion = await obtenerSesion(request);
  const { hoja, clave, rutaBlob, nombreOriginal, concepto, importe, fecha } = await request.json();
  if (!rutaBlob) {
    return Response.json({ error: 'Faltan datos (rutaBlob).' }, { status: 400 });
  }

  try {
    const buffer = await descargarBlob(rutaBlob);
    const esPdf = /\.pdf($|\?)/i.test(nombreOriginal || rutaBlob) || rutaBlob.toLowerCase().includes('.pdf');
    const analisis = await analizarFactura(buffer, esPdf, nombreOriginal);

    const importeManual = importe ? Number(importe) : null;
    if (importeManual) {
      analisis.totales = [importeManual];
      analisis.importes = [importeManual];
    }
    if (fecha) analisis.fechas = [new Date(fecha), ...analisis.fechas];

    const resultado = await procesarFacturaSubida({
      hoja, clave, rutaBlob, nombreOriginal, concepto, analisis, subidoPor: sesion?.colaboradorId || null,
    });

    return Response.json(resultado);
  } catch (err) {
    return Response.json({ tipo: 'error', detalle: `Fallo al procesar el archivo: ${err.message}` });
  }
}

export async function DELETE(request) {
  const { ids } = await request.json();
  if (!Array.isArray(ids) || ids.length === 0) {
    return Response.json({ error: 'Nada que borrar.' }, { status: 400 });
  }

  const { rows: aBorrar } = await query(
    `SELECT id, ruta_blob FROM facturas WHERE id = ANY($1::bigint[]) AND lote_id IS NULL`,
    [ids]
  );
  const idsReales = aBorrar.map(f => f.id);
  if (idsReales.length === 0) return Response.json({ ok: true, borradas: 0 });

  const { rows: movimientosAfectados } = await query(
    `SELECT DISTINCT movimiento_id FROM movimiento_facturas WHERE factura_id = ANY($1::bigint[])`,
    [idsReales]
  );

  await query(`DELETE FROM facturas WHERE id = ANY($1::bigint[])`, [idsReales]);

  for (const { movimiento_id } of movimientosAfectados) {
    const { rows: restantes } = await query(
      `SELECT 1 FROM movimiento_facturas WHERE movimiento_id = $1 LIMIT 1`,
      [movimiento_id]
    );
    if (restantes.length === 0) {
      await query(`UPDATE movimientos SET estado = 'sin_resolver', nota_final = NULL WHERE id = $1`, [movimiento_id]);
    }
  }

  for (const f of aBorrar) {
    try { await eliminarBlob(f.ruta_blob); } catch {  }
  }

  return Response.json({ ok: true, borradas: idsReales.length });
}
