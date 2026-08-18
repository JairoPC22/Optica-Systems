/**
 * Sesiones.gs — Sesiones temporales basadas en token aleatorio. El token en
 * texto plano solo existe en la respuesta de login (una vez) y en memoria
 * del cliente; en el servidor únicamente se guarda su hash SHA-256.
 */

/** Crea una sesión nueva para un usuario y devuelve el token en texto plano. */
function crearSesion_(usuarioFila) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var hoja = obtenerHoja_(CONFIG.HOJAS.SESIONES);
    var token = generarTokenSesion_();
    var tokenHash = sha256Hex_(token);
    var ahora = new Date();
    var expira = new Date(ahora.getTime() + CONFIG.SESION_DURACION_MS);

    limpiarSesionesExpiradas_(hoja);
    limitarSesionesActivas_(hoja, usuarioFila.id);

    hoja.appendRow([
      tokenHash, usuarioFila.id, usuarioFila.usuario, usuarioFila.rol,
      ahora.toISOString(), expira.toISOString(), ahora.toISOString(),
    ]);

    return { token: token, expira: expira.toISOString() };
  } finally {
    lock.releaseLock();
  }
}

/** Valida un token de sesión. Devuelve {valido, usuario:{id,usuario,nombre,rol}} o {valido:false, motivo}. */
function validarSesion_(token) {
  if (!token || typeof token !== 'string' || token.length < 32) {
    return { valido: false, motivo: 'Sesión inválida.' };
  }
  var tokenHash = sha256Hex_(token);
  var datos = leerFilas_(CONFIG.HOJAS.SESIONES);
  var ahora = new Date();

  for (var i = 0; i < datos.filas.length; i++) {
    var s = datos.filas[i];
    if (s.tokenHash === tokenHash) {
      if (new Date(s.expira) < ahora) {
        return { valido: false, motivo: 'La sesión ha expirado. Inicia sesión nuevamente.' };
      }
      var usuarios = leerFilas_(CONFIG.HOJAS.USUARIOS);
      var usuarioActual = usuarios.filas.filter(function (u) { return String(u.id) === String(s.usuarioId); })[0];
      if (!usuarioActual || usuarioActual.activo === false || usuarioActual.activo === 'FALSE') {
        return { valido: false, motivo: 'El usuario está inactivo.' };
      }
      // Renovación deslizante del último uso (no de la expiración total).
      datos.hoja.getRange(s._fila, 7).setValue(ahora.toISOString());
      return {
        valido: true,
        usuario: { id: usuarioActual.id, usuario: usuarioActual.usuario, nombre: usuarioActual.nombre, rol: usuarioActual.rol },
      };
    }
  }
  return { valido: false, motivo: 'Sesión inválida.' };
}

/** Revoca una sesión concreta (logout). */
function revocarSesion_(token) {
  if (!token) return;
  var tokenHash = sha256Hex_(token);
  var hoja = obtenerHoja_(CONFIG.HOJAS.SESIONES);
  var datos = leerFilas_(CONFIG.HOJAS.SESIONES);
  var filasABorrar = datos.filas
    .filter(function (s) { return s.tokenHash === tokenHash; })
    .map(function (s) { return s._fila; })
    .sort(function (a, b) { return b - a; }); // de mayor a menor fila
  filasABorrar.forEach(function (fila) { hoja.deleteRow(fila); });
}

/** Revoca todas las sesiones activas de un usuario (usado tras cambio de contraseña o por un administrador). */
function revocarTodasLasSesionesDe_(usuarioId) {
  var hoja = obtenerHoja_(CONFIG.HOJAS.SESIONES);
  var datos = leerFilas_(CONFIG.HOJAS.SESIONES);
  // Se recorren de abajo hacia arriba para que borrar no desplace los índices pendientes.
  for (var i = datos.filas.length - 1; i >= 0; i--) {
    if (String(datos.filas[i].usuarioId) === String(usuarioId)) {
      hoja.deleteRow(datos.filas[i]._fila);
    }
  }
}

/** Elimina de la hoja toda sesión ya expirada (limpieza general, se ejecuta en cada login). */
function limpiarSesionesExpiradas_(hoja) {
  var datos = leerFilas_(CONFIG.HOJAS.SESIONES);
  var ahora = new Date();
  for (var i = datos.filas.length - 1; i >= 0; i--) {
    var s = datos.filas[i];
    if (new Date(s.expira) < ahora) hoja.deleteRow(s._fila);
  }
}

/** Si el usuario ya tiene demasiadas sesiones activas, elimina las más antiguas. */
function limitarSesionesActivas_(hoja, usuarioId) {
  var datos = leerFilas_(CONFIG.HOJAS.SESIONES);
  var propias = datos.filas
    .filter(function (s) { return String(s.usuarioId) === String(usuarioId); })
    .sort(function (a, b) { return new Date(a.creado) - new Date(b.creado); });

  var excedente = propias.length - (CONFIG.SESION_MAX_ACTIVAS_POR_USUARIO - 1);
  if (excedente <= 0) return;
  // Borrar siempre de mayor a menor número de fila para no invalidar índices pendientes.
  var filasABorrar = propias.slice(0, excedente)
    .map(function (s) { return s._fila; })
    .sort(function (a, b) { return b - a; });
  filasABorrar.forEach(function (fila) { hoja.deleteRow(fila); });
}
