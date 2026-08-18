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
