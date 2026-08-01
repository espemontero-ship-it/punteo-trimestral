const Anthropic = require('@anthropic-ai/sdk');

// Solo se usa como último recurso, cuando el regex de lib/facturas.cjs no ha
// podido sacar ningún importe (imagen escaneada, PDF corrupto, tabla mal
// extraída) — no se llama en la subida normal, solo al reprocesar una
// factura sin resolver, para no gastar en cada subida.
const MODEL = 'claude-opus-5';

const ESQUEMA_FACTURA = {
  type: 'object',
  properties: {
    legible: {
      type: 'boolean',
      description: 'true si el documento es una factura o recibo legible; false si está en blanco, ilegible, o no es una factura/recibo.',
    },
    importe: {
      type: ['number', 'null'],
      description: 'Importe TOTAL a pagar de la factura/recibo, en euros, como número positivo (ej. 45.00). null si no se puede determinar con confianza.',
    },
    fecha: {
      type: ['string', 'null'],
      description: 'Fecha de emisión de la factura en formato YYYY-MM-DD. null si no se puede determinar.',
    },
    proveedor: {
      type: ['string', 'null'],
      description: 'Nombre del proveedor o emisor de la factura. null si no se puede determinar.',
    },
  },
  required: ['legible', 'importe', 'fecha', 'proveedor'],
  additionalProperties: false,
};

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
      output_config: {
        effort: 'low',
        format: { type: 'json_schema', schema: ESQUEMA_FACTURA },
      },
      messages: [{
        role: 'user',
        content: [
          bloqueArchivo,
          {
            type: 'text',
            text: 'Esta es una factura o recibo de gastos de una asociación. Extrae el importe TOTAL a pagar, la fecha de emisión y el nombre del proveedor/emisor. Si no puedes leer el documento o no es una factura/recibo, indica legible=false y deja el resto en null.',
          },
        ],
      }],
    });

    if (response.stop_reason === 'refusal') {
      return { ok: false, error: 'El modelo no ha podido procesar el archivo (rechazado).' };
    }

    const datos = response.parsed_output;
    if (!datos || !datos.legible || datos.importe === null) {
      return { ok: false, error: 'La IA no ha podido leer un importe en el documento.' };
    }

    return { ok: true, importe: datos.importe, fecha: datos.fecha || null, proveedor: datos.proveedor || null };
  } catch (err) {
    return { ok: false, error: err.message || 'Error al leer la factura con IA.' };
  }
}

module.exports = { leerFacturaConIA };
