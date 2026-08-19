/**
 * Codigo.gs — Backend completo de Óptica-Systems (Google Apps Script).
 * ==================================================================
 * Archivo único: todo el backend cabe aquí para poder copiarlo y
 * pegarlo de una sola vez en el editor de Apps Script (Extensiones >
 * Apps Script), reemplazando el contenido del archivo Codigo.gs (o el
 * archivo por defecto, si aún se llama Code.gs — puedes renombrarlo).
 * No borres el manifiesto appsscript.json: se configura aparte, en la
 * vista de "appsscript.json" del editor (ícono de engranaje >
 * "Mostrar archivo de manifiesto").
 * Ver apps-script/README.md para el procedimiento completo de
 * despliegue e inicialización.
 */


/* ═══════════════════════════════════════════════════════════════
   Sección: Config.gs
═══════════════════════════════════════════════════════════════ */

/**
 * Config.gs — Configuración central del backend de Óptica-Systems.
 *
 * Este archivo NO contiene secretos. El ID de implementación y la URL de la
 * app web no se consideran información sensible (la seguridad real está en
 * la validación de sesión y permisos del servidor, no en ocultar la URL).
 */

var CONFIG = {
  // Nombre exacto de la hoja de cálculo (Google Sheets) que usa el sistema.
  NOMBRE_HOJA_CALCULO: 'Optica-System',

  // Nombres de pestañas — deben coincidir con CONFIG.HOJAS del frontend (script.js).
  HOJAS: {
    USUARIOS:   'USUARIOS',
    CLIENTES:   'CLIENTES',
    VENTAS:     'VENTAS',
    PAGOS:      'PAGOS',
    HISTORIAL:  'HISTORIAL',
    AUDITORIA:  'AUDITORÍA',
    INVENTARIO: 'INVENTARIO',
    SESIONES:   'SESIONES',
  },

  // Definición de encabezados por pestaña (orden = orden de columnas).
  ENCABEZADOS: {
    USUARIOS:   ['id', 'usuario', 'nombre', 'rol', 'hash', 'salt', 'iteraciones', 'activo', 'debeCambiarPassword', 'creado', 'actualizado'],
    CLIENTES:   ['id', 'nombre', 'telefono', 'email', 'edad', 'ocupacion', 'direccion', 'escolaridad', 'actividades', 'creado', 'actualizado'],
    VENTAS:     ['id', 'clienteId', 'clienteNombre', 'tipo', 'tipoLente', 'totalFinal', 'fecha', 'registradoPor', 'creado', 'actualizado'],
    PAGOS:      ['id', 'clienteId', 'ventaId', 'monto', 'fecha', 'registradoPor', 'creado'],
    HISTORIAL:  ['id', 'clienteId', 'fecha', 'registradoPor', 'creado', 'actualizado'],
    AUDITORIA:  ['id', 'usuario', 'tipo', 'descripcion', 'fecha', 'hora', 'creado'],
    INVENTARIO: ['id', 'nombre', 'categoria', 'stock', 'creado', 'actualizado'],
    SESIONES:   ['tokenHash', 'usuarioId', 'usuario', 'rol', 'creado', 'expira', 'ultimoUso'],
  },

  // Parámetros de derivación de contraseñas (PBKDF2-HMAC-SHA256).
  // 10 000 iteraciones es un equilibrio entre la recomendación de OWASP y el
  // sobrecosto real de cada llamada a Utilities.computeHmacSha256Signature
  // dentro de los límites de ejecución de Apps Script (evita timeouts en el
  // login). Si en el futuro se mide holgura de tiempo real, puede subirse.
  PBKDF2_ITERACIONES: 10000,
  PBKDF2_LONGITUD_BYTES: 32,

  // Sesiones.
  SESION_DURACION_MS: 8 * 60 * 60 * 1000,   // 8 horas
  SESION_MAX_ACTIVAS_POR_USUARIO: 5,

  // Límite de intentos de login (fuerza bruta) — por usuario, ventana deslizante.
  LOGIN_MAX_INTENTOS: 6,
  LOGIN_VENTANA_BLOQUEO_SEGUNDOS: 15 * 60, // 15 minutos

  // Longitud máxima aceptada para campos de texto libres recibidos del cliente.
  TEXTO_LARGO_MAXIMO: 2000,
};

// Acciones de solo lectura permitidas sobre pestañas de datos (doGet).
var HOJAS_LECTURA_PERMITIDA = [
  CONFIG.HOJAS.CLIENTES, CONFIG.HOJAS.VENTAS, CONFIG.HOJAS.PAGOS,
  CONFIG.HOJAS.HISTORIAL, CONFIG.HOJAS.INVENTARIO,
];

// Pestañas de datos donde se permite create/update/delete vía doPost.
var HOJAS_ESCRITURA_PERMITIDA = [
  CONFIG.HOJAS.CLIENTES, CONFIG.HOJAS.VENTAS, CONFIG.HOJAS.PAGOS,
  CONFIG.HOJAS.HISTORIAL, CONFIG.HOJAS.INVENTARIO,
];

// USUARIOS y SESIONES nunca se exponen por el canal genérico get/create/update/delete;
// se gestionan exclusivamente mediante acciones administrativas explícitas.

/* ═══════════════════════════════════════════════════════════════
   Sección: Utilidades.gs
═══════════════════════════════════════════════════════════════ */

/**
 * Utilidades.gs — Funciones auxiliares compartidas: acceso a hojas,
 * respuestas JSON, generación de identificadores y saneamiento de datos.
 */

/** Devuelve la spreadsheet activa (script contenedor) o la abre por ID
 *  guardado en Script Properties si el script es independiente. */
function obtenerLibro_() {
  var activo = SpreadsheetApp.getActiveSpreadsheet();
  if (activo) return activo;
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) {
    throw new Error('No se encontró la hoja de cálculo. Vincula el script a "Optica-System" o define la propiedad de script SPREADSHEET_ID.');
  }
  return SpreadsheetApp.openById(id);
}

/** Obtiene una hoja por nombre; la crea con encabezados si no existe (idempotente). */
function obtenerHoja_(nombre) {
  var libro = obtenerLibro_();
  var hoja = libro.getSheetByName(nombre);
  if (!hoja) {
    hoja = libro.insertSheet(nombre);
    var encabezados = CONFIG.ENCABEZADOS[nombreClaveDesdeHoja_(nombre)];
    if (encabezados) {
      hoja.getRange(1, 1, 1, encabezados.length).setValues([encabezados]);
      hoja.setFrozenRows(1);
    }
  }
  return hoja;
}

function nombreClaveDesdeHoja_(nombreHoja) {
  for (var clave in CONFIG.HOJAS) {
    if (CONFIG.HOJAS[clave] === nombreHoja) return clave;
  }
  return null;
}

/** Lee todas las filas de una hoja como objetos {encabezado: valor}, en un solo batch. */
function leerFilas_(nombreHoja) {
  var hoja = obtenerHoja_(nombreHoja);
  var rango = hoja.getDataRange().getValues();
  if (rango.length < 2) return { hoja: hoja, encabezados: rango[0] || [], filas: [] };
  var encabezados = rango[0];
  var filas = [];
  for (var i = 1; i < rango.length; i++) {
    var obj = {};
    var vacio = true;
    for (var c = 0; c < encabezados.length; c++) {
      var valor = rango[i][c];
      if (valor !== '' && valor !== null && valor !== undefined) vacio = false;
      obj[encabezados[c]] = formatearValorSalida_(valor);
    }
    if (!vacio) { obj._fila = i + 1; filas.push(obj); }
  }
  return { hoja: hoja, encabezados: encabezados, filas: filas };
}

function formatearValorSalida_(valor) {
  if (Object.prototype.toString.call(valor) === '[object Date]') {
    return Utilities.formatDate(valor, CONFIG_TZ_(), 'yyyy-MM-dd');
  }
  return valor;
}

function CONFIG_TZ_() {
  return Session.getScriptTimeZone() || 'America/Mexico_City';
}

/** Genera un identificador único razonable para nuevas filas. */
function generarId_() {
  return 'id_' + new Date().getTime() + '_' + Utilities.getUuid().split('-')[0];
}

/** Respuesta JSON estándar para doGet/doPost. Nunca debe incluir hashes, salts ni tokens. */
function responderJson_(objeto) {
  return ContentService
    .createTextOutput(JSON.stringify(objeto))
    .setMimeType(ContentService.MimeType.JSON);
}

function respuestaError_(mensaje, detalleInterno) {
  if (detalleInterno) {
    console.error(mensaje + ' | ' + detalleInterno);
  }
  return responderJson_({ ok: false, error: mensaje });
}

/**
 * Neutraliza inyección de fórmulas: si un valor de texto comienza con
 * =, +, -, @ (o tab/CR, usados en variantes del ataque), se antepone un
 * apóstrofo para que Sheets lo trate como texto literal en lugar de fórmula.
 * Efecto secundario aceptado: el valor guardado incluirá el apóstrofo inicial
 * si el usuario realmente quería empezar su texto con ese carácter — se
 * prioriza la seguridad sobre la estética en ese caso límite.
 */
function neutralizarFormula_(valor) {
  if (typeof valor !== 'string' || valor.length === 0) return valor;
  var primerCaracter = valor.charAt(0);
  if (['=', '+', '-', '@', '\t', '\r'].indexOf(primerCaracter) !== -1) {
    return "'" + valor;
  }
  return valor;
}

/** Sanea un objeto de datos recibido del cliente antes de escribirlo en Sheets. */
function sanearDatos_(datos) {
  var limpio = {};
  for (var clave in datos) {
    if (!Object.prototype.hasOwnProperty.call(datos, clave)) continue;
    var valor = datos[clave];
    if (typeof valor === 'string') {
      if (valor.length > CONFIG.TEXTO_LARGO_MAXIMO) {
        valor = valor.substring(0, CONFIG.TEXTO_LARGO_MAXIMO);
      }
      valor = neutralizarFormula_(valor.trim());
    }
    limpio[clave] = valor;
  }
  return limpio;
}

/** Normaliza nombres de usuario para comparaciones consistentes (sin espacios extra, minúsculas). */
function normalizarUsuario_(usuario) {
  return String(usuario || '').trim().toLowerCase();
}

/* ═══════════════════════════════════════════════════════════════
   Sección: Seguridad.gs
═══════════════════════════════════════════════════════════════ */

/**
 * Seguridad.gs — Derivación de contraseñas (PBKDF2-HMAC-SHA256), generación
 * de valores aleatorios criptográficamente adecuados y comparación en tiempo
 * constante. Apps Script no ofrece PBKDF2 nativo ni crypto.subtle en el
 * servidor, por lo que se implementa manualmente sobre Utilities
 * (HMAC-SHA256), que sí usa una implementación criptográfica real.
 */

/**
 * PBKDF2-HMAC-SHA256 con longitud de salida igual a la del HMAC (32 bytes),
 * por lo que basta un único bloque (i = 1) según RFC 8018.
 * @param {string} password Contraseña en texto plano (solo existe en memoria durante esta llamada).
 * @param {number[]} saltBytes Salt en bytes.
 * @param {number} iteraciones Número de iteraciones.
 * @return {number[]} Hash derivado (bytes con signo, como los usa Apps Script).
 */
function pbkdf2Sha256_(password, saltBytes, iteraciones) {
  var passwordBytes = Utilities.newBlob(password).getBytes();
  var bloqueUno = [0, 0, 0, 1]; // INT32BE(1) — índice de bloque
  var mensajeInicial = saltBytes.concat(bloqueUno);

  var u = Utilities.computeHmacSha256Signature(mensajeInicial, passwordBytes);
  var t = u.slice();
  for (var i = 1; i < iteraciones; i++) {
    u = Utilities.computeHmacSha256Signature(u, passwordBytes);
    for (var b = 0; b < t.length; b++) t[b] = t[b] ^ u[b];
  }
  return t;
}

/** Convierte un byte sin signo (0-255) al byte con signo (-128..127) que usa Apps Script. */
function aByteConSigno_(valorSinSigno) {
  return valorSinSigno > 127 ? valorSinSigno - 256 : valorSinSigno;
}

/** Genera `n` bytes aleatorios combinando UUIDs (RNG criptográfico del entorno de Apps Script). */
function bytesAleatorios_(n) {
  var bytes = [];
  while (bytes.length < n) {
    var uuid = Utilities.getUuid().replace(/-/g, '');
    for (var i = 0; i < uuid.length && bytes.length < n; i += 2) {
      bytes.push(aByteConSigno_(parseInt(uuid.substr(i, 2), 16)));
    }
  }
  return bytes;
}

function bytesAHex_(bytes) {
  return bytes.map(function (b) {
    var v = (b + 256) % 256;
    return ('0' + v.toString(16)).slice(-2);
  }).join('');
}

function hexABytes_(hex) {
  var bytes = [];
  for (var i = 0; i < hex.length; i += 2) {
    bytes.push(aByteConSigno_(parseInt(hex.substr(i, 2), 16)));
  }
  return bytes;
}

/** Genera un salt aleatorio único (hex) para un usuario nuevo. */
function generarSalt_() {
  return bytesAHex_(bytesAleatorios_(16)); // 128 bits
}

/** Genera un token de sesión aleatorio de alta entropía (se entrega al cliente una sola vez). */
function generarTokenSesion_() {
  return bytesAHex_(bytesAleatorios_(32)); // 256 bits
}

/** Calcula el hash de contraseña a almacenar, en hex. */
function calcularHashPassword_(password, saltHex, iteraciones) {
  var hash = pbkdf2Sha256_(password, hexABytes_(saltHex), iteraciones);
  return bytesAHex_(hash);
}

/** Compara dos strings hex de igual longitud esperada en tiempo constante. */
function compararConstante_(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) {
    // Igual se recorre una comparación de longitud fija para no filtrar por timing
    // la diferencia de longitud de forma demasiado obvia, aunque el caso normal
    // (mismo algoritmo, misma longitud de salida) no debería darse nunca.
    var difLongitud = 1;
    for (var k = 0; k < Math.max(a.length, b.length); k++) difLongitud |= 1;
    return false;
  }
  var diferencia = 0;
  for (var i = 0; i < a.length; i++) {
    diferencia |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diferencia === 0;
}

/** SHA-256 de un texto, en hex — usado para almacenar solo el hash del token de sesión. */
function sha256Hex_(texto) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, texto);
  return bytesAHex_(bytes);
}

/* ═══════════════════════════════════════════════════════════════
   Sección: Sesiones.gs
═══════════════════════════════════════════════════════════════ */

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

    limpiarYLimitarSesiones_(hoja, usuarioFila.id);

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
      // Escribir en la hoja en CADA petición autenticada (login, cada carga
      // de datos, cada clic) hacía lenta a toda la app: cada escritura a
      // Sheets tiene un costo real en Apps Script. Con la sesión activa se
      // reciben muchas peticiones por minuto; basta con refrescar el valor
      // cada pocos minutos para que la expiración por inactividad siga
      // funcionando igual, sin pagar ese costo en cada petición.
      var ultimoUsoPrevio = s.ultimoUso ? new Date(s.ultimoUso) : null;
      if (!ultimoUsoPrevio || (ahora - ultimoUsoPrevio) > 3 * 60 * 1000) {
        datos.hoja.getRange(s._fila, 7).setValue(ahora.toISOString());
      }
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

/** Elimina sesiones expiradas y, si el usuario ya tiene demasiadas activas,
 *  las suyas más antiguas — en UNA sola lectura y UNA sola reescritura
 *  masiva de la hoja. Antes eran dos funciones separadas que releían la
 *  hoja completa cada una y borraban fila por fila con deleteRow() (la
 *  operación más lenta de Sheets, ~ decenas a cientos de ms cada llamada);
 *  con sesiones acumuladas a lo largo del tiempo eso dominaba el tiempo
 *  de respuesta del login. Se ejecuta en cada login. */
function limpiarYLimitarSesiones_(hoja, usuarioId) {
  var datos = leerFilas_(CONFIG.HOJAS.SESIONES);
  if (!datos.filas.length) return;
  var ahora = new Date();

  var propiasVigentesOrdenadas = datos.filas
    .filter(function (s) { return String(s.usuarioId) === String(usuarioId) && !(new Date(s.expira) < ahora); })
    .sort(function (a, b) { return new Date(a.creado) - new Date(b.creado); });
  var excedente = propiasVigentesOrdenadas.length - (CONFIG.SESION_MAX_ACTIVAS_POR_USUARIO - 1);
  var descartarFilas = {};
  if (excedente > 0) {
    propiasVigentesOrdenadas.slice(0, excedente).forEach(function (s) { descartarFilas[s._fila] = true; });
  }

  var sobreviven = datos.filas.filter(function (s) {
    return !(new Date(s.expira) < ahora) && !descartarFilas[s._fila];
  });
  if (sobreviven.length === datos.filas.length) return; // nada que limpiar

  var encabezados = datos.encabezados;
  var ultimaFilaOriginal = datos.filas[datos.filas.length - 1]._fila;
  hoja.getRange(2, 1, ultimaFilaOriginal - 1, encabezados.length).clearContent();
  if (sobreviven.length) {
    var filasSalida = sobreviven.map(function (s) {
      return encabezados.map(function (col) { return s[col]; });
    });
    hoja.getRange(2, 1, filasSalida.length, encabezados.length).setValues(filasSalida);
  }
}

/* ═══════════════════════════════════════════════════════════════
   Sección: Permisos.gs
═══════════════════════════════════════════════════════════════ */

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

/* ═══════════════════════════════════════════════════════════════
   Sección: AccesoDatos.gs
═══════════════════════════════════════════════════════════════ */

/**
 * AccesoDatos.gs — Capa de acceso a datos del lado del servidor. El cliente
 * nunca decide directamente rangos ni columnas; solo puede invocar estas
 * operaciones sobre una hoja de la lista blanca (ver Config.gs/Permisos.gs).
 */

function dataObtener_(hoja) {
  var datos = leerFilas_(hoja);
  // _fila es un detalle interno de almacenamiento; no se expone al cliente.
  var filas = datos.filas.map(function (f) {
    var copia = {};
    for (var k in f) if (k !== '_fila') copia[k] = f[k];
    return copia;
  });
  return filas;
}

function dataCrear_(hoja, payload, usuario) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var datosHoja = leerFilas_(hoja);
    var encabezados = datosHoja.encabezados;
    var limpio = sanearDatos_(payload || {});
    var idPropuesto = limpio.id && String(limpio.id).trim();
    if (idPropuesto && !/^[A-Za-z0-9_.-]{1,100}$/.test(idPropuesto)) {
      // Un id con comillas, símbolos u otros caracteres fuera de esta lista
      // podría inyectar HTML/JS al insertarse sin escapar en atributos del
      // cliente (p. ej. value="${id}"). Los ids reales que genera esta app
      // siempre cumplen este patrón; cualquier otra cosa se rechaza.
      throw new Error('Identificador con formato inválido.');
    }
    limpio.id = idPropuesto || generarId_();

    var yaExiste = datosHoja.filas.some(function (f) { return String(f.id) === String(limpio.id); });
    if (yaExiste) throw new Error('Ya existe un registro con ese identificador.');

    var ahoraIso = new Date().toISOString();
    if (encabezados.indexOf('creado') !== -1) limpio.creado = ahoraIso;
    if (encabezados.indexOf('registradoPor') !== -1 && !limpio.registradoPor) limpio.registradoPor = usuario.nombre;

    var fila = encabezados.map(function (col) { return limpio.hasOwnProperty(col) ? limpio[col] : ''; });
    datosHoja.hoja.appendRow(fila);
    return { id: limpio.id };
  } finally {
    lock.releaseLock();
  }
}

function dataActualizar_(hoja, payload, usuario) {
  if (!payload || !payload.id) throw new Error('Falta el identificador del registro a actualizar.');
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var datosHoja = leerFilas_(hoja);
    var encabezados = datosHoja.encabezados;
    var existente = datosHoja.filas.filter(function (f) { return String(f.id) === String(payload.id); })[0];
    if (!existente) throw new Error('El registro que intentas editar ya no existe.');

    var limpio = sanearDatos_(payload);
    if (encabezados.indexOf('actualizado') !== -1) limpio.actualizado = new Date().toISOString();

    var filaActual = encabezados.map(function (col) {
      return limpio.hasOwnProperty(col) ? limpio[col] : (existente.hasOwnProperty(col) ? existente[col] : '');
    });
    datosHoja.hoja.getRange(existente._fila, 1, 1, encabezados.length).setValues([filaActual]);
    return { id: payload.id };
  } finally {
    lock.releaseLock();
  }
}

function dataEliminar_(hoja, payload) {
  if (!payload || !payload.id) throw new Error('Falta el identificador del registro a eliminar.');
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var datosHoja = leerFilas_(hoja);
    var existente = datosHoja.filas.filter(function (f) { return String(f.id) === String(payload.id); })[0];
    if (!existente) throw new Error('El registro ya no existe (puede que otro usuario ya lo haya eliminado).');
    datosHoja.hoja.deleteRow(existente._fila);
    return { id: payload.id };
  } finally {
    lock.releaseLock();
  }
}

/* ═══════════════════════════════════════════════════════════════
   Sección: Auditoria.gs
═══════════════════════════════════════════════════════════════ */

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

/* ═══════════════════════════════════════════════════════════════
   Sección: LimiteIntentos.gs
═══════════════════════════════════════════════════════════════ */

/**
 * LimiteIntentos.gs — Freno a fuerza bruta usando CacheService (compartido
 * entre ejecuciones, con expiración automática — no requiere limpieza
 * manual). El bloqueo es temporal y por clave (usuario, o usuario+acción),
 * para no permitir que un atacante bloquee una cuenta de forma permanente.
 * Se usa tanto para login como para verificar la contraseña actual al
 * cambiarla (mismo riesgo de fuerza bruta si alguien roba una sesión).
 */

function claveIntentos_(espacio, clave) {
  return espacio + '_intentos_' + clave;
}

function estaBloqueado_(espacio, clave, maxIntentos) {
  var cache = CacheService.getScriptCache();
  var valor = cache.get(claveIntentos_(espacio, clave));
  var intentos = valor ? parseInt(valor, 10) : 0;
  return intentos >= maxIntentos;
}

function registrarIntentoFallido_(espacio, clave, ventanaSegundos) {
  var cache = CacheService.getScriptCache();
  var claveCache = claveIntentos_(espacio, clave);
  var valor = cache.get(claveCache);
  var intentos = (valor ? parseInt(valor, 10) : 0) + 1;
  cache.put(claveCache, String(intentos), ventanaSegundos);
}

function limpiarIntentos_(espacio, clave) {
  CacheService.getScriptCache().remove(claveIntentos_(espacio, clave));
}

/* ═══════════════════════════════════════════════════════════════
   Sección: Auth.gs
═══════════════════════════════════════════════════════════════ */

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

  if (estaBloqueado_('login', usuarioNorm, CONFIG.LOGIN_MAX_INTENTOS)) {
    registrarEvento_(usuarioTexto, 'Login bloqueado', 'Demasiados intentos fallidos.');
    return { ok: false, error: MENSAJE_BLOQUEADO };
  }

  var usuarios = leerFilas_(CONFIG.HOJAS.USUARIOS);
  var fila = usuarios.filas.filter(function (u) { return normalizarUsuario_(u.usuario) === usuarioNorm; })[0];

  if (!fila || !fila.hash || !fila.salt) {
    registrarIntentoFallido_('login', usuarioNorm, CONFIG.LOGIN_VENTANA_BLOQUEO_SEGUNDOS);
    return { ok: false, error: MENSAJE_LOGIN_INVALIDO };
  }

  var iteraciones = parseInt(fila.iteraciones, 10) || CONFIG.PBKDF2_ITERACIONES;
  var hashCalculado = calcularHashPassword_(password, String(fila.salt), iteraciones);
  var coincide = compararConstante_(hashCalculado, String(fila.hash));

  var activo = !(fila.activo === false || fila.activo === 'FALSE' || fila.activo === 'false');

  if (!coincide || !activo) {
    registrarIntentoFallido_('login', usuarioNorm, CONFIG.LOGIN_VENTANA_BLOQUEO_SEGUNDOS);
    return { ok: false, error: MENSAJE_LOGIN_INVALIDO };
  }

  limpiarIntentos_('login', usuarioNorm);
  var sesion = crearSesion_(fila);
  registrarEvento_(fila.nombre, 'Login', 'Inicio de sesión correcto.');

  return {
    ok: true,
    token: sesion.token,
    expira: sesion.expira,
    usuario: {
      usuario: fila.usuario,
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
  var claveIntento = String(sesionUsuario.id);

  // Freno a fuerza bruta: alguien con una sesión robada (p. ej. token
  // copiado de sessionStorage) pero sin la contraseña real podría intentar
  // adivinarla probando muchos valores de "actual" — sin este límite, este
  // endpoint no tenía ninguna protección contra eso.
  if (estaBloqueado_('cambiopw', claveIntento, CONFIG.LOGIN_MAX_INTENTOS)) {
    registrarEvento_(sesionUsuario.nombre, 'Cambio de contraseña bloqueado', 'Demasiados intentos fallidos al verificar la contraseña actual.');
    return { ok: false, error: MENSAJE_BLOQUEADO };
  }

  var validacion = validarPasswordNueva_(nueva);
  if (!validacion.ok) return validacion;

  var usuarios = leerFilas_(CONFIG.HOJAS.USUARIOS);
  var fila = usuarios.filas.filter(function (u) { return String(u.id) === String(sesionUsuario.id); })[0];
  if (!fila) return { ok: false, error: 'No se encontró el usuario.' };

  var iteraciones = parseInt(fila.iteraciones, 10) || CONFIG.PBKDF2_ITERACIONES;
  var hashActual = calcularHashPassword_(actual, String(fila.salt), iteraciones);
  if (!compararConstante_(hashActual, String(fila.hash))) {
    registrarIntentoFallido_('cambiopw', claveIntento, CONFIG.LOGIN_VENTANA_BLOQUEO_SEGUNDOS);
    return { ok: false, error: 'La contraseña actual no es correcta.' };
  }

  // La nueva contraseña debe ser distinta de la actual. La verificación de
  // arriba ya confirmó que "actual" ES la contraseña real vigente, así que
  // basta comparar los dos textos planos directamente — evita correr un
  // segundo PBKDF2 completo (10,000 iteraciones) solo para esta comparación,
  // que duplicaba el tiempo de respuesta de todo el endpoint sin necesidad.
  if (compararConstante_(actual, nueva)) {
    return { ok: false, error: 'La nueva contraseña debe ser distinta de la actual.' };
  }

  limpiarIntentos_('cambiopw', claveIntento);
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

/** Permite a cualquier usuario autenticado cambiar su PROPIO nombre visible.
 *  El objetivo se toma siempre de la sesión (nunca del payload), así que es
 *  imposible renombrar a otra persona con esta acción — y nunca toca "rol". */
function manejarActualizarNombrePropio_(usuario, payload) {
  var nombre = String(payload && payload.nombre || '').trim();
  if (!nombre) return { ok: false, error: 'El nombre no puede estar vacío.' };
  if (nombre.length > 80) return { ok: false, error: 'El nombre es demasiado largo.' };

  var usuarios = leerFilas_(CONFIG.HOJAS.USUARIOS);
  var fila = usuarios.filas.filter(function (u) { return normalizarUsuario_(u.usuario) === normalizarUsuario_(usuario.usuario); })[0];
  if (!fila) return { ok: false, error: 'Usuario no encontrado.' };

  var colNombre = usuarios.encabezados.indexOf('nombre') + 1;
  usuarios.hoja.getRange(fila._fila, colNombre).setValue(nombre);
  registrarEvento_(usuario.nombre, 'Actualizar perfil', 'Cambió su nombre a "' + nombre + '".');
  return { ok: true, nombre: nombre };
}

/** Cambia el rol de OTRO usuario. Un admin nunca puede cambiar su propio rol (evita que se autodegrade y se quede sin acceso). */
function manejarAdminCambiarRol_(admin, payload) {
  if (!esAdmin_(admin)) return { ok: false, error: 'No tienes permisos para esta acción.' };
  var usuarioObjetivo = normalizarUsuario_(payload && payload.usuario);
  var rol = String(payload && payload.rol || '').trim().toLowerCase();

  if (['admin', 'administrador', 'empleado'].indexOf(rol) === -1) {
    return { ok: false, error: 'Rol inválido. Usa "empleado" o "admin".' };
  }
  if (usuarioObjetivo === normalizarUsuario_(admin.usuario)) {
    return { ok: false, error: 'No puedes cambiar tu propio rol.' };
  }

  var usuarios = leerFilas_(CONFIG.HOJAS.USUARIOS);
  var fila = usuarios.filas.filter(function (u) { return normalizarUsuario_(u.usuario) === usuarioObjetivo; })[0];
  if (!fila) return { ok: false, error: 'El usuario no existe.' };

  var colRol = usuarios.encabezados.indexOf('rol') + 1;
  usuarios.hoja.getRange(fila._fila, colRol).setValue(rol);
  registrarEvento_(admin.nombre, 'Cambiar rol', 'Cambió el rol de "' + fila.usuario + '" a "' + rol + '".');
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

/* ═══════════════════════════════════════════════════════════════
   Sección: Init.gs
═══════════════════════════════════════════════════════════════ */

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

/* ═══════════════════════════════════════════════════════════════
   Sección: Codigo.gs
═══════════════════════════════════════════════════════════════ */

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
      case 'admin_cambiar_rol':
        return responderJson_(manejarAdminCambiarRol_(usuario, body.payload));
      case 'actualizar_nombre_propio':
        return responderJson_(manejarActualizarNombrePropio_(usuario, body.payload));
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
