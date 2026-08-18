/**
 * Config.gs — Configuración central del backend de Óptica Aurora.
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
