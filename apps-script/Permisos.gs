/**
 * Permisos.gs — Autorización server-side. El rol y los permisos NUNCA se
 * confían desde el cliente: aquí se recalculan siempre a partir del usuario
 * ya validado por la sesión (ver Sesiones.gs).
 */

function esAdmin_(usuario) {
  var rol = String(usuario && usuario.rol || '').toLowerCase();
  return rol === 'admin' || rol === 'administrador';
}

/**
 * Verifica si `usuario` puede ejecutar `accion` sobre `hoja`.
 * Refleja las mismas reglas de negocio que ya existían en el frontend
 * (solo un administrador puede eliminar registros o ver auditoría), ahora
 * aplicadas también del lado del servidor.
 */
function tienePermiso_(usuario, hoja, accion) {
  if (!usuario) return false;

  if (hoja === CONFIG.HOJAS.AUDITORIA) {
    if (accion === 'get') return esAdmin_(usuario);
    if (accion === 'create') return true; // se registra automáticamente en cada operación
    return false;
  }

  if (HOJAS_LECTURA_PERMITIDA.indexOf(hoja) === -1) return false;

  if (accion === 'get') return true;
  if (accion === 'create' || accion === 'update') return true;
  if (accion === 'delete') return esAdmin_(usuario);

  return false;
}
