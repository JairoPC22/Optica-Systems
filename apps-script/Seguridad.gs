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
