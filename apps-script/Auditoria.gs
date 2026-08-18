/**
 * Auditoria.gs — Registro de eventos. Nunca debe recibir ni escribir
 * contraseñas, hashes, salts o tokens de sesión.
 */

function registrarEvento_(usuarioNombre, tipo, descripcion) {
  try {
    var hoja = obtenerHoja_(CONFIG.HOJAS.AUDITORIA);
    var ahora = new Date();
    var fecha = Utilities.formatDate(ahora, CONFIG_TZ_(), 'dd/MM/yyyy');
    var hora = Utilities.formatDate(ahora, CONFIG_TZ_(), 'hh:mm a');
    hoja.appendRow([
      generarId_(), String(usuarioNombre || 'Sistema').substring(0, 200),
      String(tipo || '').substring(0, 100),
      String(descripcion || '').substring(0, CONFIG.TEXTO_LARGO_MAXIMO),
      fecha, hora, ahora.toISOString(),
    ]);
  } catch (err) {
    // La auditoría nunca debe tumbar la operación principal.
    console.error('No se pudo registrar auditoría: ' + err);
  }
}
