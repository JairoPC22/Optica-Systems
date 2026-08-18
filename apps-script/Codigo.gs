/**
 * Codigo.gs — Punto de entrada del backend (doGet/doPost). Aplica una lista
 * blanca explícita de acciones: el cliente nunca decide dinámicamente qué
 * función del servidor se ejecuta ni a qué hoja/rango accede.
 */

function doGet(e) {
  try {
    var params = (e && e.parameter) || {};
    var accion = params.action;

    if (accion !== 'get') {
      return respuestaError_('Acción no soportada.');
    }

    var hoja = params.hoja;
    var sesion = validarSesion_(params.token);
    if (!sesion.valido) return responderJson_({ ok: false, error: sesion.motivo, sesionInvalida: true });

    if (!tienePermiso_(sesion.usuario, hoja, 'get')) {
      return respuestaError_('No tienes permisos para consultar esta información.');
    }

    return responderJson_({ ok: true, data: dataObtener_(hoja) });
  } catch (err) {
    return respuestaError_('Error del servidor al consultar la información.', err && err.stack || err);
  }
}

function doPost(e) {
  try {
    var body = {};
    try {
      body = JSON.parse(e.postData.contents || '{}');
    } catch (errParseo) {
      return respuestaError_('Solicitud mal formada.');
    }

    var accion = body.action;

    // ── Acciones públicas (sin sesión previa) ──
    if (accion === 'login') return responderJson_(manejarLogin_(body.payload));
    if (accion === 'setup_admin') return responderJson_(manejarSetupAdmin_(body.payload));

    // ── A partir de aquí se requiere una sesión válida ──
    var sesion = validarSesion_(body.token);
    if (!sesion.valido) return responderJson_({ ok: false, error: sesion.motivo, sesionInvalida: true });
    var usuario = sesion.usuario;

    switch (accion) {
      case 'logout':
        return responderJson_(manejarLogout_(body.token));
      case 'change_password':
        return responderJson_(manejarCambioPassword_(usuario, body.token, body.payload));
      case 'admin_reset_password':
        return responderJson_(manejarAdminResetPassword_(usuario, body.payload));
      case 'admin_crear_usuario':
        return responderJson_(manejarAdminCrearUsuario_(usuario, body.payload));
      case 'admin_set_activo':
        return responderJson_(manejarAdminSetActivo_(usuario, body.payload));
      case 'admin_revocar_sesiones':
        return responderJson_(manejarAdminRevocarSesiones_(usuario, body.payload));
      case 'admin_listar_usuarios':
        return responderJson_(manejarAdminListarUsuarios_(usuario));
      case 'get':
      case 'create':
      case 'update':
      case 'delete':
        return responderJson_(manejarOperacionDatos_(usuario, body.hoja, accion, body.payload));
      default:
        return respuestaError_('Acción no reconocida.');
    }
  } catch (err) {
    return respuestaError_('Error del servidor al procesar la solicitud.', err && err.stack || err);
  }
}

/** Enruta las operaciones CRUD genéricas validando lista blanca y permisos. */
function manejarOperacionDatos_(usuario, hoja, accion, payload) {
  var esAuditoria = hoja === CONFIG.HOJAS.AUDITORIA;
  var hojaValida = esAuditoria || HOJAS_ESCRITURA_PERMITIDA.indexOf(hoja) !== -1;
  if (!hojaValida) return { ok: false, error: 'Hoja no permitida.' };

  if (!tienePermiso_(usuario, hoja, accion)) {
    return { ok: false, error: 'No tienes permisos para realizar esta acción.' };
  }

  if (esAuditoria) {
    if (accion === 'get') return { ok: true, data: dataObtener_(hoja) };
    if (accion !== 'create') return { ok: false, error: 'Acción no permitida sobre auditoría.' };
    // El nombre de usuario del registro de auditoría siempre lo determina el
    // servidor a partir de la sesión — nunca el valor enviado por el cliente.
    var registro = sanearDatos_(payload || {});
    registro.usuario = usuario.nombre;
    return { ok: true, id: dataCrear_(CONFIG.HOJAS.AUDITORIA, registro, usuario).id };
  }

  switch (accion) {
    case 'get':    return { ok: true, data: dataObtener_(hoja) };
    case 'create':  return { ok: true, id: dataCrear_(hoja, payload, usuario).id };
    case 'update':  return { ok: true, id: dataActualizar_(hoja, payload, usuario).id };
    case 'delete':  return { ok: true, id: dataEliminar_(hoja, payload).id };
    default:        return { ok: false, error: 'Acción no reconocida.' };
  }
}
