const Anthropic = require('@anthropic-ai/sdk');

// Solo se usa como último recurso, cuando el regex de lib/facturas.cjs no ha
// podido sacar ningún importe (imagen escaneada, PDF corrupto, tabla mal
// extraída) — no se llama en la subida normal, solo al reprocesar una
// factura sin resolver, para no gastar en cada subida.
// Haiku 4.5: leer el importe total de una factura no necesita el modelo caro.
// Cuesta 1 $ por millón de palabras de entrada y 5 por millón de salida,
// frente a los 5 y 25 de Opus -- unas cinco veces menos por factura.
const MODEL = 'claude-haiku-4-5';

// Se pide una LISTA de facturas, no una sola. Un mismo PDF puede traer varias
// dentro -- Amazon manda una por vendedor cuando el pedido lleva productos de
// varios-- y el banco las cobra juntas. El regex nunca podía saber si había
// una o dos: solo veía números sueltos y probaba a sumarlos entre sí, lo que
// acababa inventándose facturas (la base imponible más el IVA dan otra vez el
// total). El modelo sí ve el documento y puede contarlas.
const ESQUEMA_FACTURA = {
  type: 'object',
  properties: {
    legible: {
      type: 'boolean',
      description: 'true si el documento es una factura o recibo legible; false si está en blanco, ilegible, o no es una factura/recibo.',
    },
    facturas: {
      type: 'array',
      description: 'Una entrada por cada factura o recibo DISTINTO que contenga el documento. Lo normal es que sea una sola. Solo hay varias si el documento contiene de verdad varias facturas independientes, cada una con su propio total. NUNCA desglosar una misma factura en base imponible e IVA: eso es una sola factura.',
      items: {
        type: 'object',
        properties: {
          importe: {
            type: 'number',
            description: 'Importe TOTAL de esta factura, IVA incluido, en euros y CON SU SIGNO: positivo en una factura normal (ej. 45.00) y NEGATIVO en una factura rectificativa o abono (ej. -30.00).',
          },
          fecha: {
            type: ['string', 'null'],
            description: 'Fecha de emisión en formato YYYY-MM-DD. null si no se puede determinar.',
          },
          proveedor: {
            type: ['string', 'null'],
            description: 'Nombre del proveedor o emisor. null si no se puede determinar.',
          },
        },
        required: ['importe', 'fecha', 'proveedor'],
        additionalProperties: false,
      },
    },
  },
  required: ['legible', 'facturas'],
  additionalProperties: false,
};

// Las facturas legibles de lo que ha devuelto la IA. Se queda con las que
// traen un importe distinto de cero, EN POSITIVO O EN NEGATIVO: una factura
// rectificativa (un abono) es negativa, y antes se tiraba aqui mismo -- por
// eso una rectificativa no llegaba nunca a guardarse.
function facturasDeLaRespuesta(datos) {
  if (!datos || !datos.legible) return [];
  return (datos.facturas || []).filter(
    f => typeof f.importe === 'number' && !isNaN(f.importe) && f.importe !== 0
  );
}

function extensionAMediaType(nombreOriginal) {
  const ext = (nombreOriginal || '').split('.').pop().toLowerCase();
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  return null;
}

// Lee una factura con IA cuando el regex no ha podido. Devuelve
// { ok: true, importe, fecha, proveedor } o { ok: false, error }.
async function leerFacturaConIA(buffer, esPdf, nombreOriginal) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, error: 'Falta configurar ANTHROPIC_API_KEY.' };
  }

  const data = buffer.toString('base64');
  const bloqueArchivo = esPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
    : { type: 'image', source: { type: 'base64', media_type: extensionAMediaType(nombreOriginal) || 'image/jpeg', data } };

  try {
    const client = new Anthropic();
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 1024,
      // Sin `effort`: ese parámetro da error en Haiku 4.5 (solo lo admiten los
      // modelos de la familia Opus/Sonnet nuevos). El esquema de salida sí.
      output_config: {
        format: { type: 'json_schema', schema: ESQUEMA_FACTURA },
      },
      messages: [{
        role: 'user',
        content: [
          bloqueArchivo,
          {
            type: 'text',
            text: 'Este documento es una factura o recibo de gastos de una asociación. Para cada factura que contenga, extrae el importe TOTAL (IVA incluido), la fecha de emisión y el nombre del proveedor. El importe lleva su signo: positivo en una factura normal, y NEGATIVO si es una factura rectificativa, un abono o una devolución. Casi siempre habrá una sola: devuelve varias únicamente si el documento contiene de verdad facturas independientes con totales distintos. No devuelvas la base imponible ni el IVA como si fueran facturas aparte. Si no puedes leer el documento o no es una factura, indica legible=false y devuelve la lista vacía.',
          },
        ],
      }],
    });

    if (response.stop_reason === 'refusal') {
      return { ok: false, error: 'El modelo no ha podido procesar el archivo (rechazado).' };
    }

    const facturas = facturasDeLaRespuesta(response.parsed_output);
    if (facturas.length === 0) {
      return { ok: false, error: 'La IA no ha podido leer un importe en el documento.' };
    }

    return { ok: true, facturas };
  } catch (err) {
    return { ok: false, error: err.message || 'Error al leer la factura con IA.' };
  }
}

module.exports = { leerFacturaConIA, facturasDeLaRespuesta };
