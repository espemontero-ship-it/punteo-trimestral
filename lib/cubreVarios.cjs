const { centimosDeMovimiento } = require('./importeFactura.cjs');

const MAX_MOVIMIENTOS_A_COMBINAR = 22;

function idDeGrupo(m) {
  return m.proveedor ? `prov::${String(m.proveedor).trim().toLowerCase()}` : `${m.hoja}::${m.clave}`;
}

function claveDeCubre(facturaId, movimientoIds) {
  const ids = [...movimientoIds].map(Number).sort((a, b) => a - b);
  return `${facturaId}>${ids.join(',')}`;
}

function subconjuntosExactos(items, objetivo, limite = 2) {
  const orden = items.filter(i => i.centimos > 0).sort((a, b) => b.centimos - a.centimos);
  const restante = new Array(orden.length + 1).fill(0);
  for (let i = orden.length - 1; i >= 0; i--) restante[i] = restante[i + 1] + orden[i].centimos;

  const halladas = [];
  const elegidos = [];
  function buscar(i, suma) {
    if (halladas.length >= limite) return;
    if (suma === objetivo) {
      if (elegidos.length >= 2) halladas.push([...elegidos]);
      return;
    }
    if (suma > objetivo || i >= orden.length || suma + restante[i] < objetivo) return;
    elegidos.push(orden[i]);
    buscar(i + 1, suma + orden[i].centimos);
    elegidos.pop();
    buscar(i + 1, suma);
  }
  buscar(0, 0);
  return halladas;
}

function diasEntre(a, b) {
  if (!a || !b) return 9999;
  return Math.abs((new Date(a).getTime() - new Date(b).getTime()) / 86400000);
}

function buscarCubreVarios(pendientes, objetivoCentimos, fechaFactura) {
  const objetivo = Math.abs(objetivoCentimos);
  if (!objetivo) return null;

  const grupos = new Map();
  for (const m of pendientes) {
    const centimos = Math.abs(centimosDeMovimiento(m) || 0);
    if (!centimos || centimos > objetivo) continue;
    const id = idDeGrupo(m);
    if (!grupos.has(id)) grupos.set(id, []);
    grupos.get(id).push({ ...m, centimos });
  }

  const unicas = [];
  for (const [grupoId, items] of grupos) {
    if (items.length < 2) continue;
    if (items.reduce((s, i) => s + i.centimos, 0) < objetivo) continue;
    const cercanos = [...items]
      .sort((a, b) => diasEntre(a.fecha, fechaFactura) - diasEntre(b.fecha, fechaFactura))
      .slice(0, MAX_MOVIMIENTOS_A_COMBINAR);
    const soluciones = subconjuntosExactos(cercanos, objetivo, 2);
    if (soluciones.length > 1) return null;
    if (soluciones.length === 1) unicas.push({ grupoId, movimientos: soluciones[0] });
  }
  if (unicas.length !== 1) return null;

  const { grupoId, movimientos } = unicas[0];
  const marca = m => (m.fecha ? new Date(m.fecha).getTime() : 0);
  const ordenados = [...movimientos].sort((a, b) => marca(a) - marca(b) || Number(a.id) - Number(b.id));
  return {
    grupoId,
    hoja: ordenados[0].hoja,
    clave: ordenados[0].clave,
    movimientoIds: ordenados.map(m => Number(m.id)),
    movimientos: ordenados.map(m => ({ id: Number(m.id), fecha: m.fecha, importe: m.importe, concepto: m.concepto })),
    suma: objetivo / 100,
  };
}

module.exports = { idDeGrupo, claveDeCubre, subconjuntosExactos, buscarCubreVarios, MAX_MOVIMIENTOS_A_COMBINAR };
