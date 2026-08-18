/**
 * Auth.gs — Autenticación, cambio de contraseña y administración de usuarios.
 * Todas las funciones devuelven objetos {ok, ...} listos para responderJson_.
 * El mensaje de error de login es siempre genérico: nunca revela si el
 * usuario existe, si está inactivo o si fue la contraseña la que falló.
 */

var MENSAJE_LOGIN_INVALIDO = 'Usuario o contraseña incorrectos.';
var MENSAJE_BLOQUEADO = 'Demasiados intentos. Intenta de nuevo en unos minutos.';

function manejarLogin_(payload) {
  var usuarioTexto = String(payload && payload.usuario || '');
  var password = String(payload && payload.contrasena || '');
  var usuarioNorm = normalizarUsuario_(usuarioTexto);

  if (!usuarioNorm || !password || usuarioNorm.length > 100 || password.length > 300) {
    return { ok: false, error: MENSAJE_LOGIN_INVALIDO };
  }

  if (estaBloqueado_(usuarioNorm)) {
    registrarEvento_(usuarioTexto, 'Login bloqueado', 'Demasiados intentos fallidos.');
    return { ok: false, error: MENSAJE_BLOQUEADO };
  }

  var usuarios = leerFilas_(CONFIG.HOJAS.USUARIOS);
  var fila = usuarios.filas.filter(function (u) { return normalizarUsuario_(u.usuario) === usuarioNorm; })[0];

  if (!fila || !fila.hash || !fila.salt) {
    registrarIntentoFallido_(usuarioNorm);
    return { ok: false, error: MENSAJE_LOGIN_INVALIDO };
  }

  var iteraciones = parseInt(fila.iteraciones, 10) || CONFIG.PBKDF2_ITERACIONES;
  var hashCalculado = calcularHashPassword_(password, String(fila.salt), iteraciones);
  var coincide = compararConstante_(hashCalculado, String(fila.hash));

  var activo = !(fila.activo === false || fila.activo === 'FALSE' || fila.activo === 'false');

  if (!coincide || !activo) {
    registrarIntentoFallido_(usuarioNorm);
    return { ok: false, error: MENSAJE_LOGIN_INVALIDO };
  }

  limpiarIntentos_(usuarioNorm);
  var sesion = crearSesion_(fila);
  registrarEvento_(fila.nombre, 'Login', 'Inicio de sesión correcto.');

  return {
    ok: true,
    token: sesion.token,
    expira: sesion.expira,
    usuario: {
      nombre: fila.nombre,
      rol: fila.rol,
      debeCambiarPassword: fila.debeCambiarPassword === true || fila.debeCambiarPassword === 'TRUE' || fila.debeCambiarPassword === 'true',
    },
  };
}

function manejarLogout_(token) {
  revocarSesion_(token);
  return { ok: true };
}

/** Cambio de la propia contraseña (requiere conocer la contraseña actual). */
function manejarCambioPassword_(sesionUsuario, tokenActual, payload) {
  var actual = String(payload && payload.actual || '');
  var nueva = String(payload && payload.nueva || '');

  var validacion = validarPasswordNueva_(nueva);
  if (!validacion.ok) return validacion;

  var usuarios = leerFilas_(CONFIG.HOJAS.USUARIOS);
  var fila = usuarios.filas.filter(function (u) { return String(u.id) === String(sesionUsuario.id); })[0];
  if (!fila) return { ok: false, error: 'No se encontró el usuario.' };

  var iteraciones = parseInt(fila.iteraciones, 10) || CONFIG.PBKDF2_ITERACIONES;
  var hashActual = calcularHashPassword_(actual, String(fila.salt), iteraciones);
  if (!compararConstante_(hashActual, String(fila.hash))) {
    return { ok: false, error: 'La contraseña actual no es correcta.' };
  }

  guardarNuevaPassword_(usuarios, fila, nueva, false);
  revocarSesionesExceptoActual_(fila.id, tokenActual);
  registrarEvento_(fila.nombre, 'Cambio de contraseña', 'El usuario cambió su propia contraseña.');
  return { ok: true };
}

/** Un administrador restablece la contraseña de otro usuario (queda marcada como temporal). */
function manejarAdminResetPassword_(admin, payload) {
  if (!esAdmin_(admin)) return { ok: false, error: 'No tienes permisos para esta acción.' };
  var usuarioObjetivo = normalizarUsuario_(payload && payload.usuario);
  var nueva = String(payload && payload.nueva || '');
  var validacion = validarPasswordNueva_(nueva);
  if (!validacion.ok) return validacion;

  var usuarios = leerFilas_(CONFIG.HOJAS.USUARIOS);
  var fila = usuarios.filas.filter(function (u) { return normalizarUsuario_(u.usuario) === usuarioObjetivo; })[0];
  if (!fila) return { ok: false, error: 'El usuario no existe.' };

  guardarNuevaPassword_(usuarios, fila, nueva, true);
  revocarTodasLasSesionesDe_(fila.id);
  registrarEvento_(admin.nombre, 'Restablecimiento de contraseña', 'Restableció la contraseña de ' + fila.nombre + '.');
  return { ok: true };
}

function validarPasswordNueva_(password) {
  if (!password || password.length < 8) {
    return { ok: false, error: 'La nueva contraseña debe tener al menos 8 caracteres.' };
  }
  if (password.length > 300) {
    return { ok: false, error: 'La contraseña es demasiado larga.' };
  }
  return { ok: true };
}

function guardarNuevaPassword_(usuarios, fila, nuevaPassword, debeCambiar) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var salt = generarSalt_();
    var hash = calcularHashPassword_(nuevaPassword, salt, CONFIG.PBKDF2_ITERACIONES);
    var encabezados = usuarios.encabezados;
    var colHash = encabezados.indexOf('hash') + 1;
    var colSalt = encabezados.indexOf('salt') + 1;
    var colIter = encabezados.indexOf('iteraciones') + 1;
    var colDebeCambiar = encabezados.indexOf('debeCambiarPassword') + 1;
    var colActualizado = encabezados.indexOf('actualizado') + 1;

    usuarios.hoja.getRange(fila._fila, colHash).setValue(hash);
    usuarios.hoja.getRange(fila._fila, colSalt).setValue(salt);
    usuarios.hoja.getRange(fila._fila, colIter).setValue(CONFIG.PBKDF2_ITERACIONES);
    usuarios.hoja.getRange(fila._fila, colDebeCambiar).setValue(!!debeCambiar);
    usuarios.hoja.getRange(fila._fila, colActualizado).setValue(new Date().toISOString());
  } finally {
    lock.releaseLock();
  }
}

function revocarSesionesExceptoActual_(usuarioId, tokenActual) {
  var tokenHashActual = tokenActual ? sha256Hex_(tokenActual) : null;
  var hoja = obtenerHoja_(CONFIG.HOJAS.SESIONES);
  var datos = leerFilas_(CONFIG.HOJAS.SESIONES);
  var filasABorrar = datos.filas
    .filter(function (s) { return String(s.usuarioId) === String(usuarioId) && s.tokenHash !== tokenHashActual; })
    .map(function (s) { return s._fila; })
    .sort(function (a, b) { return b - a; });
  filasABorrar.forEach(function (fila) { hoja.deleteRow(fila); });
}

/* ────────────────────────────────────────────────────────────
   Administración de usuarios (solo administradores autenticados)
──────────────────────────────────────────────────────────── */

function manejarAdminListarUsuarios_(admin) {
  if (!esAdmin_(admin)) return { ok: false, error: 'No tienes permisos para esta acción.' };
  var usuarios = leerFilas_(CONFIG.HOJAS.USUARIOS);
  var lista = usuarios.filas.map(function (u) {
    return {
      id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol,
      activo: !(u.activo === false || u.activo === 'FALSE' || u.activo === 'false'),
      debeCambiarPassword: u.debeCambiarPassword === true || u.debeCambiarPassword === 'TRUE' || u.debeCambiarPassword === 'true',
    };
  });
  return { ok: true, usuarios: lista };
}

function manejarAdminCrearUsuario_(admin, payload) {
  if (!esAdmin_(admin)) return { ok: false, error: 'No tienes permisos para esta acción.' };
  var usuarioTexto = String(payload && payload.usuario || '').trim();
  var nombre = String(payload && payload.nombre || '').trim();
  var rol = String(payload && payload.rol || '').trim().toLowerCase();
  var passwordInicial = String(payload && payload.passwordInicial || '');

  if (!usuarioTexto || !nombre) return { ok: false, error: 'Usuario y nombre son obligatorios.' };
  if (['admin', 'administrador', 'empleado'].indexOf(rol) === -1) {
    return { ok: false, error: 'Rol inválido. Usa "empleado" o "admin".' };
  }
  var validacion = validarPasswordNueva_(passwordInicial);
  if (!validacion.ok) return validacion;

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var usuarios = leerFilas_(CONFIG.HOJAS.USUARIOS);
    var usuarioNorm = normalizarUsuario_(usuarioTexto);
    var yaExiste = usuarios.filas.some(function (u) { return normalizarUsuario_(u.usuario) === usuarioNorm; });
    if (yaExiste) return { ok: false, error: 'Ya existe un usuario con ese nombre de acceso.' };

    var salt = generarSalt_();
    var hash = calcularHashPassword_(passwordInicial, salt, CONFIG.PBKDF2_ITERACIONES);
    var ahoraIso = new Date().toISOString();
    var id = generarId_();

    usuarios.hoja.appendRow([
      id, usuarioTexto, nombre, rol, hash, salt, CONFIG.PBKDF2_ITERACIONES,
      true, true, ahoraIso, ahoraIso,
    ]);
    registrarEvento_(admin.nombre, 'Crear usuario', 'Creó la cuenta "' + usuarioTexto + '" (' + rol + ').');
    return { ok: true, id: id };
  } finally {
    lock.releaseLock();
  }
}

function manejarAdminSetActivo_(admin, payload) {
  if (!esAdmin_(admin)) return { ok: false, error: 'No tienes permisos para esta acción.' };
  var usuarioObjetivo = normalizarUsuario_(payload && payload.usuario);
  var activo = !!(payload && payload.activo);

  var usuarios = leerFilas_(CONFIG.HOJAS.USUARIOS);
  var fila = usuarios.filas.filter(function (u) { return normalizarUsuario_(u.usuario) === usuarioObjetivo; })[0];
  if (!fila) return { ok: false, error: 'El usuario no existe.' };
  if (normalizarUsuario_(fila.usuario) === normalizarUsuario_(admin.usuario) && !activo) {
    return { ok: false, error: 'No puedes desactivar tu propia cuenta.' };
  }

  var colActivo = usuarios.encabezados.indexOf('activo') + 1;
  usuarios.hoja.getRange(fila._fila, colActivo).setValue(activo);
  if (!activo) revocarTodasLasSesionesDe_(fila.id);
  registrarEvento_(admin.nombre, activo ? 'Activar usuario' : 'Desactivar usuario', 'Usuario "' + fila.usuario + '".');
  return { ok: true };
}

function manejarAdminRevocarSesiones_(admin, payload) {
  if (!esAdmin_(admin)) return { ok: false, error: 'No tienes permisos para esta acción.' };
  var usuarioObjetivo = normalizarUsuario_(payload && payload.usuario);
  var usuarios = leerFilas_(CONFIG.HOJAS.USUARIOS);
  var fila = usuarios.filas.filter(function (u) { return normalizarUsuario_(u.usuario) === usuarioObjetivo; })[0];
  if (!fila) return { ok: false, error: 'El usuario no existe.' };

  revocarTodasLasSesionesDe_(fila.id);
  registrarEvento_(admin.nombre, 'Revocar sesiones', 'Revocó todas las sesiones de "' + fila.usuario + '".');
  return { ok: true };
}
