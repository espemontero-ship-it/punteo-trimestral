import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import XLSX from 'xlsx';
import { POST as subirExcel } from '../app/api/excels/route.js';
import { GET as verArchivo } from '../app/api/facturas/[id]/archivo/route.js';
import { POST as cubrir } from '../app/api/facturas/[id]/cubrir/route.js';

const peticionConArchivo = (archivo, campos = {}) => {
  const datos = new FormData();
  if (archivo) datos.append('file', archivo);
  for (const [k, v] of Object.entries(campos)) datos.append(k, v);
  return new Request('http://pruebas/api/excels', { method: 'POST', body: datos });
};

async function xlsxSinBanco() {
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Hoja').addRows([['Nombre', 'Edad'], ['Ana', 31]]);
  return new File([await wb.xlsx.writeBuffer()], 'cualquiera.xlsx');
}

describe('la ruta de subir el excel del banco', () => {
  it('420. sin archivo da 400', async () => {
    const r = await subirExcel(peticionConArchivo(null));

    expect(r.status).toBe(400);
    expect((await r.json()).error).toContain('Falta el archivo');
  });

  it('421. un excel que no se parece a ningún banco da 422 y dice cómo indicarlo, sin guardar nada', async () => {
    const r = await subirExcel(peticionConArchivo(await xlsxSinBanco()));

    expect(r.status).toBe(422);
    expect((await r.json()).error).toContain('No se ha reconocido ninguna pestaña');
  });

  it('422. un CSV que no es de ningún banco también da 422', async () => {
    const r = await subirExcel(peticionConArchivo(new File(['uno,dos\r\n1,2'], 'datos.csv')));

    expect(r.status).toBe(422);
  });

  it('423. un CSV vacío o un .xls estropeado dan un mensaje claro en vez de un error de servidor', async () => {
    const vacio = await subirExcel(peticionConArchivo(new File([''], 'vacio.csv')));
    expect(vacio.status).toBe(422);
    expect((await vacio.json()).error).toContain('No se ha podido leer el archivo CSV');

    const estropeado = new File([Buffer.concat([Buffer.from([0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1]), Buffer.alloc(600, 7)])], 'roto.xls');
    const malo = await subirExcel(peticionConArchivo(estropeado));
    expect(malo.status).toBe(422);
    expect((await malo.json()).error).toContain('No se ha podido abrir el archivo .xls');
  });

  it('424. un .xls antiguo con otra pestaña se convierte y se lee antes de decir que no lo reconoce', async () => {
    const libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, XLSX.utils.aoa_to_sheet([['Nombre', 'Edad'], ['Ana', 31]]), 'Otra');
    const xls = new File([XLSX.write(libro, { type: 'buffer', bookType: 'biff8' })], 'otra.xls');

    const r = await subirExcel(peticionConArchivo(xls));

    expect(r.status).toBe(422);
    expect((await r.json()).error).toContain('No se ha reconocido ninguna pestaña');
  });
});

describe('otras rutas de facturas', () => {
  const conId = id => ({ params: Promise.resolve({ id: String(id) }) });

  it('425. pedir el archivo de una factura que no existe da 404', async () => {
    const r = await verArchivo(new Request('http://pruebas/'), conId(987654321));

    expect(r.status).toBe(404);
  });

  it('426. enlazar una factura a un solo movimiento (o a ninguno) por la vía de "cubre varios" da error 400', async () => {
    const llamar = cuerpo => cubrir(new Request('http://pruebas/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) }), conId(1));

    expect((await llamar({ movimientoIds: [5] })).status).toBe(400);
    expect((await llamar({ movimientoIds: [] })).status).toBe(400);
    expect((await llamar({})).status).toBe(400);
  });
});
