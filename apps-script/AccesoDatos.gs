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
    limpio.id = limpio.id && String(limpio.id).trim() ? String(limpio.id).trim() : generarId_();

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
