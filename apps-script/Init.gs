/**
 * Init.gs — Inicialización idempotente de la hoja de cálculo y alta segura
 * del primer administrador. Ejecutar `inicializarHojas` varias veces nunca
 * duplica pestañas, encabezados, usuarios ni registros.
 *
 * Procedimiento recomendado para poner el sistema en marcha (ver README):
 *   1. Ejecutar inicializarHojas() una vez desde el editor de Apps Script.
 *   2. Ejecutar generarTokenDeConfiguracion() una vez desde el editor; guarda
 *      un token de un solo uso en Script Properties y lo imprime en el log.
 *   3. Llamar a la acción "setup_admin" del endpoint (doPost) con ese token,
 *      un usuario y una contraseña inicial — así el primer hash/salt se
 *      genera en el servidor y la contraseña jamás queda escrita en el código.
 */

/** Crea (si faltan) todas las pestañas y sus encabezados. Segura de re-ejecutar. */
function inicializarHojas() {
  var libro = obtenerLibro_();
  Object.keys(CONFIG.HOJAS).forEach(function (clave) {
    var nombre = CONFIG.HOJAS[clave];
    var hoja = libro.getSheetByName(nombre);
    var encabezadosEsperados = CONFIG.ENCABEZADOS[clave];
    if (!hoja) {
      hoja = libro.insertSheet(nombre);
      hoja.getRange(1, 1, 1, encabezadosEsperados.length).setValues([encabezadosEsperados]);
      hoja.setFrozenRows(1);
      console.log('Pestaña creada: ' + nombre);
      return;
    }
    // Idempotencia: si la pestaña ya existe pero está vacía, solo se asegura el encabezado.
    var primeraFila = hoja.getRange(1, 1, 1, Math.max(1, hoja.getLastColumn())).getValues()[0];
    var encabezadoVacio = primeraFila.every(function (v) { return v === '' || v === null; });
    if (encabezadoVacio) {
      hoja.getRange(1, 1, 1, encabezadosEsperados.length).setValues([encabezadosEsperados]);
      hoja.setFrozenRows(1);
      console.log('Encabezado restaurado en pestaña existente vacía: ' + nombre);
    } else {
      console.log('Pestaña ya inicializada, sin cambios: ' + nombre);
    }
  });

  // Hoja predeterminada "Hoja 1"/"Sheet1" que Sheets crea por defecto: se deja intacta
  // si contiene datos; si está totalmente vacía y no es ninguna de las nuestras, se
  // podría eliminar manualmente — no se automatiza el borrado para no arriesgar datos.
}

/**
 * Genera y guarda en Script Properties un token de configuración de un solo
 * uso, necesario para crear al primer administrador. Ejecutar manualmente
 * desde el editor de Apps Script (Ejecutar > generarTokenDeConfiguracion) y
 * copiar el valor impreso en el log — no queda guardado en ningún archivo.
 */
function generarTokenDeConfiguracion() {
  var token = generarTokenSesion_();
  PropertiesService.getScriptProperties().setProperty('SETUP_TOKEN', sha256Hex_(token));
  console.log('Token de configuración (guárdalo, no se volverá a mostrar): ' + token);
  return 'Revisa los registros de ejecución (Ver > Registros) para copiar el token.';
}

/**
 * Acción pública protegida por el token de configuración: crea el primer
 * administrador. Solo funciona si la pestaña USUARIOS está vacía y si el
 * token coincide con el generado por generarTokenDeConfiguracion(). El
 * token se invalida (de un solo uso) en cuanto se usa con éxito.
 */
function manejarSetupAdmin_(payload) {
  var tokenRecibido = String(payload && payload.setupToken || '');
  var usuarioTexto = String(payload && payload.usuario || '').trim();
  var nombre = String(payload && payload.nombre || '').trim();
  var passwordInicial = String(payload && payload.passwordInicial || '');

  var props = PropertiesService.getScriptProperties();
  var tokenGuardadoHash = props.getProperty('SETUP_TOKEN');
  if (!tokenGuardadoHash) {
    return { ok: false, error: 'No hay token de configuración activo. Genera uno desde el editor de Apps Script.' };
  }
  if (!tokenRecibido || !compararConstante_(sha256Hex_(tokenRecibido), tokenGuardadoHash)) {
    return { ok: false, error: 'Token de configuración inválido.' };
  }

  var usuarios = leerFilas_(CONFIG.HOJAS.USUARIOS);
  if (usuarios.filas.length > 0) {
    return { ok: false, error: 'Ya existen usuarios; el alta inicial solo funciona con la pestaña USUARIOS vacía.' };
  }
  if (!usuarioTexto || !nombre) return { ok: false, error: 'Usuario y nombre son obligatorios.' };
  var validacion = validarPasswordNueva_(passwordInicial);
  if (!validacion.ok) return validacion;

  var salt = generarSalt_();
  var hash = calcularHashPassword_(passwordInicial, salt, CONFIG.PBKDF2_ITERACIONES);
  var ahoraIso = new Date().toISOString();

  usuarios.hoja.appendRow([
    generarId_(), usuarioTexto, nombre, 'admin', hash, salt, CONFIG.PBKDF2_ITERACIONES,
    true, true, ahoraIso, ahoraIso,
  ]);

  props.deleteProperty('SETUP_TOKEN'); // de un solo uso
  registrarEvento_(nombre, 'Configuración inicial', 'Alta del primer administrador.');
  return { ok: true };
}
