import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { existsSync } from 'fs';
import bcrypt from 'bcryptjs';
import { limpiar, lector, lectorRoto, sembrarLinea, lineaPorId, subir, facturaPorNombre } from './ayuda.js';
import { query } from '../lib/db.cjs';
import { POST as entrar } from '../app/api/login/route.js';
import { subirFacturaLote, calcularTotales, corregirFacturaColaborador, retirarFacturaColaborador } from '../lib/lotes.cjs';
import { analizarFactura, reintentarPendientes } from '../lib/facturaMatcher.cjs';
import { importeDeFactura } from '../lib/importeFactura.cjs';

const CORREO = 'prueba-colaborador@ejemplo.test';
const CLAVE = 'contraseña-de-prueba';
const raiz = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

async function limpiarColaborador() {
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
}

async function sembrarColaborador(estado = 'activo') {
  const hash = await bcrypt.hash(CLAVE, 10);
  const { rows } = await query(
    `INSERT INTO colaboradores (nombre, usuario, password_hash, rol, estado)
     VALUES ('Colaborador de prueba', $1, $2, 'colaborador', $3) RETURNING id`,
    [CORREO, hash, estado]
  );
  return rows[0].id;
}

async function sembrarLote(colaboradorId) {
  const { rows } = await query(
    `INSERT INTO lotes (trimestre_id, colaborador_id, evento, proyecto_id)
     VALUES ((SELECT id FROM trimestres LIMIT 1), $1, 'LOTE DE PRUEBA', (SELECT id FROM proyectos LIMIT 1))
     RETURNING id`,
    [colaboradorId]
  );
  return rows[0].id;
}

const peticion = cuerpo => new Request('http://pruebas/', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo),
});

const unaDe = importe => lector([{ importe, fecha: '2026-07-19', proveedor: 'Proveedor' }]);
let contador = 0;
// Igual que hace la ruta: primero se lee el archivo, luego se guarda.
async function subirDeLote(loteId, leer, contenido = null) {
  contador++;
  const nombre = `PRUEBA-colab-${contador}.pdf`;
  const analisis = await analizarFactura(
    Buffer.from(contenido || `colab-${contador}-${Math.random()}`), true, nombre, leer
  );
  return subirFacturaLote({
    loteId, rutaBlob: `https://ejemplo/${nombre}`, nombreOriginal: nombre,
    concepto: 'gasolina', analisis,
  });
}

beforeEach(async () => { await limpiar(); await limpiarColaborador(); });
afterAll(async () => { await limpiar(); await limpiarColaborador(); });

describe('entrar en la app', () => {
  it('C1. un colaborador inactivo no entra, y se le dice que está inactivo', async () => {
    await sembrarColaborador('inactivo');
    const r = await entrar(peticion({ usuario: CORREO, password: CLAVE }));
    expect(r.status).toBe(403);
    const { error } = await r.json();
    expect(error).toMatch(/inactiv/i);
  });

  it('C2. un colaborador activo entra y va a su pantalla', async () => {
    await sembrarColaborador('activo');
    const r = await entrar(peticion({ usuario: CORREO, password: CLAVE }));
    expect(r.status).toBe(200);
    const datos = await r.json();
    expect(datos.redirect).toBe('/colaborador');
  });

  it('C3. no queda ninguna forma de entrar sin usuario', async () => {
    const r = await entrar(peticion({ password: process.env.AUTH_PASSWORD || 'lo-que-sea' }));
    expect(r.status).toBe(401);
  });

  it('C4. el alta con contraseña dictada ya no existe', () => {
    expect(existsSync(`${raiz}/app/api/colaboradores/route.js`)).toBe(false);
  });
});

describe('facturas que paga el colaborador', () => {
  it('C5. se leen con IA: importe, proveedor y fecha', async () => {
    const colaboradorId = await sembrarColaborador();
    const loteId = await sembrarLote(colaboradorId);
    const { id } = await subirDeLote(loteId, unaDe(45));

    const { rows } = await query(
      "SELECT *, to_char(fechas[1], 'YYYY-MM-DD') AS fecha_texto FROM facturas WHERE id = $1", [id]
    );
    expect(importeDeFactura(rows[0])).toBe(45);
    expect(rows[0].proveedor).toBe('Proveedor');
    expect(rows[0].fecha_texto).toBe('2026-07-19');
  });

  it('C6. no se cruzan con el banco', async () => {
    const linea = await sembrarLinea({ importe: -45 });
    const colaboradorId = await sembrarColaborador();
    const loteId = await sembrarLote(colaboradorId);
    await subirDeLote(loteId, unaDe(45));

    expect((await lineaPorId(linea.id)).estado).toBe('sin_resolver');
  });

  it('C7. si la IA falla, se guarda sin importe y se dice por qué', async () => {
    const colaboradorId = await sembrarColaborador();
    const loteId = await sembrarLote(colaboradorId);
    const { id, motivoIA } = await subirDeLote(loteId, lectorRoto('your credit balance is too low'));

    const { rows } = await query('SELECT * FROM facturas WHERE id = $1', [id]);
    expect(rows[0]).toBeTruthy();
    expect(importeDeFactura(rows[0])).toBeNull();
    expect(motivoIA).toMatch(/saldo/i);
  });

  it('C8. no llevan trimestre, igual que las suyas', async () => {
    const colaboradorId = await sembrarColaborador();
    const loteId = await sembrarLote(colaboradorId);
    const { id } = await subirDeLote(loteId, unaDe(45));

    const { rows } = await query('SELECT trimestre_id FROM facturas WHERE id = $1', [id]);
    expect(rows[0].trimestre_id).toBeNull();
  });

  it('C9. no se usan para completar una combinación del flujo principal', async () => {
    // Una línea de 90 y dos facturas de 45: una suya, de lote, y otra del
    // flujo normal. Si la de lote entrara en el cruce, la app propondría
    // juntarlas para explicar los 90 -- y ese dinero no salió de la cuenta.
    await sembrarLinea({ importe: -90 });
    const colaboradorId = await sembrarColaborador();
    const loteId = await sembrarLote(colaboradorId);
    const { id: idDeLote } = await subirDeLote(loteId, unaDe(45));
    const { archivo } = await subir({ leer: unaDe(45) });

    await reintentarPendientes();

    const suya = await facturaPorNombre(archivo);
    const otras = suya.motivo_candidatos?.otrasFacturas?.map(o => String(o.id)) || [];
    expect(otras).not.toContain(String(idDeLote));

    // Y a la de lote no se le calcula ninguna propuesta.
    const { rows } = await query('SELECT motivo_candidatos FROM facturas WHERE id = $1', [idDeLote]);
    expect(rows[0].motivo_candidatos).toBeNull();
  });

  it('C10. los totales del lote salen del importe leído', async () => {
    const colaboradorId = await sembrarColaborador();
    const loteId = await sembrarLote(colaboradorId);
    await subirDeLote(loteId, unaDe(45));
    await subirDeLote(loteId, unaDe(30));

    const totales = await calcularTotales(loteId);
    expect(totales.totalSinRevisar).toBe(75);
  });
});

describe('el colaborador corrige y retira lo suyo', () => {
  it('C11. corrige el importe de una sin revisar, y queda marcada como tocada a mano', async () => {
    const colaboradorId = await sembrarColaborador();
    const loteId = await sembrarLote(colaboradorId);
    const { id } = await subirDeLote(loteId, unaDe(45));

    await corregirFacturaColaborador(colaboradorId, id, { importe: 50 });

    const { rows } = await query('SELECT * FROM facturas WHERE id = $1', [id]);
    expect(importeDeFactura(rows[0])).toBe(50);
    expect(rows[0].importe_a_mano).toBe(true);
  });

  it('C12. retira una sin revisar: desaparece y puede volver a subir ese archivo', async () => {
    const colaboradorId = await sembrarColaborador();
    const loteId = await sembrarLote(colaboradorId);
    const { id } = await subirDeLote(loteId, unaDe(45), 'el mismo archivo');

    await retirarFacturaColaborador(colaboradorId, id);

    const { rows } = await query('SELECT * FROM facturas WHERE id = $1', [id]);
    expect(rows).toHaveLength(0);

    // El mismo archivo se puede volver a subir: su huella ya no está ocupada.
    const otra = await subirDeLote(loteId, unaDe(45), 'el mismo archivo');
    expect(otra.id).toBeTruthy();
  });

  it('C13. no puede tocar ni retirar una ya aceptada, rechazada o cerrada', async () => {
    for (const estado of ['aceptada', 'rechazada', 'cerrada']) {
      const colaboradorId = await sembrarColaborador();
      const loteId = await sembrarLote(colaboradorId);
      const { id } = await subirDeLote(loteId, unaDe(45));
      await query('UPDATE facturas SET estado_revision = $2 WHERE id = $1', [id, estado]);

      await expect(corregirFacturaColaborador(colaboradorId, id, { importe: 99 })).rejects.toThrow();
      await expect(retirarFacturaColaborador(colaboradorId, id)).rejects.toThrow();
      await limpiarColaborador();
    }
  });

  it('C13b. no puede tocar la factura de otro colaborador', async () => {
    const colaboradorId = await sembrarColaborador();
    const loteId = await sembrarLote(colaboradorId);
    const { id } = await subirDeLote(loteId, unaDe(45));

    await expect(corregirFacturaColaborador(999999, id, { importe: 99 })).rejects.toThrow();
  });
});
