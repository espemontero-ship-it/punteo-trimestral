#!/usr/bin/env node
// Bloquea (pide confirmacion explicita) cualquier Edit/Write sobre un archivo
// visual (CSS, componente, pagina) hasta que la usuaria lo apruebe a mano,
// cada vez -- nunca en silencio. Ver CLAUDE.md y feedback_nunca_editar_diseno_directamente.

let raw = '';
process.stdin.on('data', d => { raw += d; });
process.stdin.on('end', () => {
  let input;
  try { input = JSON.parse(raw); } catch { process.exit(0); }
  const f = input?.tool_input?.file_path;
  if (!f) process.exit(0);

  const esVisual = /\.css$/i.test(f) || /(^|[\\/])app[\\/]components[\\/]/i.test(f) || /page\.js$/i.test(f);
  if (!esVisual) process.exit(0);

  const reason = 'Archivo visual (CSS, componente o pagina). Norma: no se toca codigo real sin mockup ensenado y aprobado explicitamente antes. Confirma que ya se aprobo un mockup para este cambio concreto.';
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: reason },
  }));
});
