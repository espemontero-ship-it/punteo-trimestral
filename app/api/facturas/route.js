const { query } = require('../../../lib/db.cjs');
const { descargarBlob } = require('../../../lib/blob.cjs');
const { eliminarBlob } = require('../../../lib/blob.cjs');
const { analizarBuffer } = require('../../../lib/facturas.cjs');
const { procesarFacturaSubida, asegurarColumnasMotivo } = require('../../../lib/facturaMatcher.cjs');
const { obtenerSesion } = require('../../../lib/auth.cjs');

// Analizar un PDF (descarga + pdf-parse) puede tardar más de los 10s por
// defecto de una función serverless, sobre todo con archivos escaneados o
// grandes — con la subida en lote, decenas de archivos seguidos hacían que
// algunos fallaran por tiempo. Se sube el límite explícitamente.
export const maxDuration = 60;

// Facturas del flujo principal (no de lote) -- histórico continuo.
export async function GET() {
  await asegurarColumnasMotivo();
  const { rows } = await query(
    `SELECT f.id, f.numero, f.nombre_original, f.proveedor_clave, f.estado, f.es_imagen,
            f.importes, f.totales, f.fechas, f.concepto, f.creado_en, f.motivo_tipo, f.motivo_detalle, f.motivo_candidatos,
            c.nombre AS subido_por_nombre,
            m.id AS movimiento_id, m.fecha AS movimiento_fecha, m.concepto AS movimiento_concepto, m.importe AS movimiento_importe
     FROM facturas f
     LEFT JOIN colaboradores c ON c.id = f.subido_por
     LEFT JOIN movimiento_facturas mf ON mf.factura_id = f.id
     LEFT JOIN movimientos m ON m.id = mf.movimiento_id
     WHERE f.trimestre_id IS NULL AND f.lote_id IS NULL
     ORDER BY f.numero`
  );
  return Response.json({ facturas: rows });
}

export async function POST(request) {
  const sesion = await obtenerSesion(request);
  const { hoja, clave, rutaBlob, nombreOriginal, concepto, importe, fecha } = await request.json();
  if (!rutaBlob) {
    return Response.json({ error: 'Faltan datos (rutaBlob).' }, { status: 400 });
  }

  // Nunca dejar que un fallo aquí devuelva una respuesta vacía o HTML de
  // error — la subida en lote necesita JSON siempre, incluso al fallar, para
  // poder mostrar por qué falló esa factura en concreto en vez de un
  // "Unexpected end of JSON input" genérico sin información real.
  try {
    const buffer = await descargarBlob(rutaBlob);
    const esPdf = /\.pdf($|\?)/i.test(nombreOriginal || rutaBlob) || rutaBlob.toLowerCase().includes('.pdf');
    const analisis = await analizarBuffer(buffer, esPdf);

    // Si quien sube la factura ya sabe el importe/fecha (a mano, cuando no
    // se puede leer del PDF), esos datos mandan sobre lo que haya extraído
    // el regex — evita depender de la lectura automática para poder emparejar.
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

// Borra facturas sueltas (ej. duplicadas de una subida repetida). Si alguna
// estaba emparejada con una línea del banco y era la única factura que la
// resolvía, esa línea vuelve a quedar pendiente en vez de "resuelta a medias".
export async function DELETE(request) {
  const { ids } = await request.json();
  if (!Array.isArray(ids) || ids.length === 0) {
    return Response.json({ error: 'Nada que borrar.' }, { status: 400 });
  }

  const { rows: aBorrar } = await query(
    `SELECT id, ruta_blob FROM facturas WHERE id = ANY($1::bigint[]) AND trimestre_id IS NULL`,
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
    try { await eliminarBlob(f.ruta_blob); } catch { /* archivo ya no existe o falla el borrado — no bloquea */ }
  }

  return Response.json({ ok: true, borradas: idsReales.length });
}
