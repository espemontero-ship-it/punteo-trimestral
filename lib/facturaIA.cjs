const Anthropic = require('@anthropic-ai/sdk');

const MODEL = 'claude-haiku-4-5';

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
