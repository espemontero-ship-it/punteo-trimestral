#!/usr/bin/env node
// Bloquea (pide confirmacion explicita, real, en la interfaz -- no algo que
// Claude pueda decidir por su cuenta) cualquier escritura sobre un archivo
// visual (CSS, componente, pagina), venga de Edit/Write O de Bash/PowerShell
// (cp, mv, sed -i, >, >>, tee, Set-Content, Out-File...). Antes solo vigilaba
// Edit/Write, y un `cp` por Bash lo esquivaba sin que saltara nada -- fallo
// real detectado y corregido 2026-08-13. Ver CLAUDE.md y
// feedback_nunca_editar_diseno_directamente.

let raw = '';
process.stdin.on('data', d => { raw += d; });
process.stdin.on('end', () => {
  let input;
  try { input = JSON.parse(raw); } catch { process.exit(0); }

  const esRutaVisual = (ruta) =>
    /\.css$/i.test(ruta) || /(^|[\\/])app[\\/]components[\\/]/i.test(ruta) || /page\.js$/i.test(ruta);

  const tool = input?.tool_name || '';
  let rutaDetectada = null;

  if (tool === 'Edit' || tool === 'Write') {
    const f = input?.tool_input?.file_path;
    if (f && esRutaVisual(f)) rutaDetectada = f;
  } else if (tool === 'Bash' || tool === 'PowerShell') {
    const cmd = input?.tool_input?.command || '';
    // ¿el comando escribe algo (cp/mv/sed -i/>/>>/tee/Set-Content/Out-File/Copy-Item)
    // Y menciona una ruta que parece un archivo visual?
    const escribe = /\bcp\b|\bmv\b|sed\s+-i|>>?|(?<!<)\btee\b|Set-Content|Out-File|Copy-Item|Move-Item/i.test(cmd);
    if (escribe) {
      const candidatos = cmd.match(/[^\s"']*\.(css|js)\b|"[^"]*\.(css|js)"/gi) || [];
      rutaDetectada = candidatos.find(esRutaVisual) || null;
    }
  }

  if (!rutaDetectada) process.exit(0);

  const reason = `Archivo visual detectado ("${rutaDetectada}"), herramienta usada: ${tool}. ` +
    'Norma: no se toca codigo real sin mockup ensenado y aprobado explicitamente antes -- ' +
    'esto cubre Edit/Write Y Bash/PowerShell (cp, sed -i, >, etc.), no solo Edit/Write. ' +
    'Confirma que ya se aprobo un mockup para este cambio concreto.';
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: reason },
  }));
});
