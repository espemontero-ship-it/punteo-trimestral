#!/usr/bin/env node
// Bloqueo REAL (deny, no ask) para publicar un mockup del scratchpad: no se
// puede ejecutar la herramienta Artifact sobre un archivo maqueta_*.html si
// no existe, al lado, un archivo <mismo-nombre>.auditoria.txt que:
//   1) se modifico DESPUES que el propio mockup (auditoria hecha sobre la
//      version actual, no una vieja), y
//   2) contiene la palabra AUDITORIA:PASA y no contiene FALLO ni SOSPECHOSO.
// No verifica que el contenido sea correcto de verdad (eso sigue siendo
// trabajo de Claude) -- lo que impide es el atajo de publicar sin siquiera
// haber generado un informe de auditoria. Motivo: 2026-08-13, varios
// mockups se publicaron esa noche declarados "verificados" sin haberlo
// hecho de verdad.

const fs = require('fs');
const path = require('path');

let raw = '';
process.stdin.on('data', d => { raw += d; });
process.stdin.on('end', () => {
  let input;
  try { input = JSON.parse(raw); } catch { process.exit(0); }

  if (input?.tool_name !== 'Artifact') process.exit(0);
  const accion = input?.tool_input?.action || 'publish';
  if (accion === 'list') process.exit(0);

  const filePath = input?.tool_input?.file_path;
  if (!filePath) process.exit(0);
  if (!/maqueta_.*\.html$/i.test(path.basename(filePath))) process.exit(0);

  const dir = path.dirname(filePath);
  const base = path.basename(filePath, '.html');
  const auditoriaPath = path.join(dir, base + '.auditoria.txt');

  function denegar(motivo) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: motivo },
    }));
  }

  if (!fs.existsSync(filePath)) process.exit(0); // lo bloqueara otra cosa, no es cosa de este hook
  if (!fs.existsSync(auditoriaPath)) {
    denegar(`Falta ${base}.auditoria.txt junto al mockup. No se publica sin un informe de auditoria real ` +
      `(ver PROYECTO.md / feedback_sin_excusas_trabajo_verificado). Genera el archivo con el resultado de la ` +
      `comparacion contra el codigo fuente real antes de publicar.`);
    return;
  }

  const mtimeMockup = fs.statSync(filePath).mtimeMs;
  const mtimeAuditoria = fs.statSync(auditoriaPath).mtimeMs;
  if (mtimeAuditoria < mtimeMockup) {
    denegar(`${base}.auditoria.txt es mas antiguo que el propio mockup -- el mockup se edito despues de la ` +
      `ultima auditoria. Vuelve a auditar la version actual antes de publicar.`);
    return;
  }

  const contenido = fs.readFileSync(auditoriaPath, 'utf8');
  const pasa = /AUDITORIA:PASA/i.test(contenido);
  const falla = /FALLO|SOSPECHOSO/i.test(contenido);
  if (!pasa || falla) {
    denegar(`${base}.auditoria.txt no contiene "AUDITORIA:PASA" (o contiene FALLO/SOSPECHOSO). ` +
      `No se publica hasta que la auditoria pase de verdad.`);
    return;
  }

  process.exit(0);
});
