/**
 * LimiteIntentos.gs — Freno a fuerza bruta en login usando CacheService
 * (compartido entre ejecuciones, con expiración automática — no requiere
 * limpieza manual). El bloqueo es temporal y por usuario, para no permitir
 * que un atacante bloquee una cuenta de forma permanente.
 */

function claveIntentos_(usuarioNormalizado) {
  return 'login_intentos_' + usuarioNormalizado;
}

function estaBloqueado_(usuarioNormalizado) {
  var cache = CacheService.getScriptCache();
  var valor = cache.get(claveIntentos_(usuarioNormalizado));
  var intentos = valor ? parseInt(valor, 10) : 0;
  return intentos >= CONFIG.LOGIN_MAX_INTENTOS;
}

function registrarIntentoFallido_(usuarioNormalizado) {
  var cache = CacheService.getScriptCache();
  var clave = claveIntentos_(usuarioNormalizado);
  var valor = cache.get(clave);
  var intentos = (valor ? parseInt(valor, 10) : 0) + 1;
  cache.put(clave, String(intentos), CONFIG.LOGIN_VENTANA_BLOQUEO_SEGUNDOS);
}

function limpiarIntentos_(usuarioNormalizado) {
  CacheService.getScriptCache().remove(claveIntentos_(usuarioNormalizado));
}
