'use strict';

/* ══════════════════════════════════════════════════════════════
   ⚙️  CONFIGURACIÓN GLOBAL
══════════════════════════════════════════════════════════════ */

const CONFIG = {
   APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbyFk7nNnhZAVrwsXBOrdK8RVit6r8-IYtmYE1j6Z3i8nB71red0dtC-xlo4WKC0txON2A/exec',

  EMAILJS: {
    PUBLIC_KEY:       '_3DU7Uv315ZzgAFJl',
    SERVICE_ID:       'service_m7c84bk',
    TEMPLATE_RECORDATORIO: 'template_wguwi6l',
    TEMPLATE_GRACIAS:      'template_boe4gs6',
  },

  // Hojas de Google Sheets
  HOJAS: {
    USUARIOS:   'USUARIOS',
    CLIENTES:   'CLIENTES',
    VENTAS:     'VENTAS',
    PAGOS:      'PAGOS',
    HISTORIAL:  'HISTORIAL',
    AUDITORIA:  'AUDITORÍA',
    INVENTARIO: 'INVENTARIO',
  },
};

/* ══════════════════════════════════════════════════════════════
   📦  ESTADO GLOBAL DE LA APLICACIÓN
══════════════════════════════════════════════════════════════ */

const STATE = {
  usuario:    null,
  clientes:   [],
  ventas:     [],
  pagos:      [],
  historial:  [],
  auditoria:   [],
  inventario:  [],
  clienteActivo: null,
  _filtroAdeudos: 'todos',
  _revisionesPendientes: [],
  _colaPendiente: 0,
  _filtroEmpleadoDash: null,
    paginacion: {
    clientes:  { pagina: 1, porPagina: 50 },
    ventas:    { pagina: 1, porPagina: 50 },
    pagos:     { pagina: 1, porPagina: 50 },
    historial: { pagina: 1, porPagina: 50 },
  }
};
/* ══════════════════════════════════════════════════════════════
   💾  MODO OFFLINE — IndexedDB + Cola de operaciones
══════════════════════════════════════════════════════════════ */

const _IDB = { nombre: 'aurora_offline', version: 1, db: null };

async function idbAbrir() {
  if (_IDB.db) return _IDB.db;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(_IDB.nombre, _IDB.version);
    req.onupgradeneeded = ({ target: { result: db } }) => {
      if (!db.objectStoreNames.contains('cache'))
        db.createObjectStore('cache', { keyPath: 'clave' });
      if (!db.objectStoreNames.contains('cola'))
        db.createObjectStore('cola', { keyPath: 'colId', autoIncrement: true });
    };
    req.onsuccess = ({ target: { result: db } }) => { _IDB.db = db; resolve(db); };
    req.onerror   = () => reject(req.error);
  });
}

async function idbGuardar(clave, valor) {
  try {
    const db = await idbAbrir();
    return new Promise((res, rej) => {
      const tx = db.transaction('cache', 'readwrite');
      tx.objectStore('cache').put({ clave, valor });
      tx.oncomplete = res;
      tx.onerror    = () => rej(tx.error);
    });
  } catch { /* sin IndexedDB disponible → ignorar */ }
}

async function idbLeer(clave) {
  try {
    const db = await idbAbrir();
    return new Promise((res, rej) => {
      const tx  = db.transaction('cache', 'readonly');
      const req = tx.objectStore('cache').get(clave);
      req.onsuccess = () => res(req.result?.valor ?? null);
      req.onerror   = () => rej(req.error);
    });
  } catch { return null; }
}

async function idbEncolar(hoja, action, data) {
  try {
    const db = await idbAbrir();
    return new Promise((res, rej) => {
      const tx  = db.transaction('cola', 'readwrite');
      const req = tx.objectStore('cola').add({ hoja, action, data, ts: Date.now() });
      req.onsuccess = () => res(req.result);
      req.onerror   = () => rej(req.error);
    });
  } catch { return null; }
}

async function idbCola() {
  try {
    const db = await idbAbrir();
    return new Promise((res, rej) => {
      const tx  = db.transaction('cola', 'readonly');
      const req = tx.objectStore('cola').getAll();
      req.onsuccess = () => res(req.result ?? []);
      req.onerror   = () => rej(req.error);
    });
  } catch { return []; }
}

async function idbEliminarDeCola(colId) {
  try {
    const db = await idbAbrir();
    return new Promise((res, rej) => {
      const tx = db.transaction('cola', 'readwrite');
      tx.objectStore('cola').delete(colId);
      tx.oncomplete = res;
      tx.onerror    = () => rej(tx.error);
    });
  } catch {}
}

function actualizarIndicadorOffline() {
  const online     = navigator.onLine;
  const pendientes = STATE._colaPendiente || 0;
  const el         = document.getElementById('offline-indicator');
  if (!el) return;

  if (!online) {
    el.innerHTML   = '⚡ Sin conexión' + (pendientes ? ` · ${pendientes} en cola` : '');
    el.className   = 'offline-badge offline-badge-warn';
    el.onclick     = null;
    el.style.display = '';
  } else if (pendientes > 0) {
    el.innerHTML   = `🔄 ${pendientes} pendiente${pendientes > 1 ? 's' : ''} — toca para sincronizar`;
    el.className   = 'offline-badge offline-badge-sync';
    el.onclick     = () => sincronizarCola();
    el.style.display = '';
  } else {
    el.style.display = 'none';
    el.onclick = null;
  }
}

async function sincronizarCola() {
  if (!navigator.onLine) { showToast('Aún sin conexión', 'warning'); return; }
  const cola = await idbCola();
  if (!cola.length) {
    STATE._colaPendiente = 0;
    actualizarIndicadorOffline();
    return;
  }

  showLoading(`Sincronizando ${cola.length} cambio${cola.length > 1 ? 's' : ''}...`);
  let ok = 0, fail = 0;

  for (const op of cola) {
    try {
      const ctrl  = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 25000);
      const res   = await fetch(CONFIG.APPS_SCRIPT_URL, {
        method: 'POST',
        signal: ctrl.signal,
        body: JSON.stringify({ hoja: op.hoja, action: op.action, payload: op.data, token: 'aurora_x9k2mZ8pQr' }),
      });
      clearTimeout(timer);
      const json = await res.json();
      if (json.ok !== false) { await idbEliminarDeCola(op.colId); ok++; }
      else fail++;
    } catch { fail++; }
  }

  hideLoading();
  STATE._colaPendiente = fail;
  actualizarIndicadorOffline();

  if (ok > 0) {
    showToast(`✓ ${ok} cambio${ok > 1 ? 's' : ''} guardado${ok > 1 ? 's' : ''} en Google Sheets`, 'success', 5000);
    await Promise.allSettled([
      cargarClientes(), cargarVentas(), cargarPagos(),
      cargarHistorial(), cargarAuditoria(), cargarInventario(),
    ]);
    renderDashboard();
    filterClientes(); filterVentas(); filterPagos();
    filterHistorial(); filterGarantias(); filterAdeudosBusqueda();
    filterInventario(); llenarSelectsClientes(); actualizarBadgeAdeudos();
    feather.replace();
  }
  if (fail > 0) {
    showToast(`⚠️ ${fail} cambio${fail > 1 ? 's' : ''} sin sincronizar — se reintentará al reconectar`, 'warning', 6000);
  }
}

/* ══════════════════════════════════════════════════════════════
   🚀  INICIALIZACIÓN
══════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
  // Registrar Service Worker (PWA)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .then(() => console.log('SW registrado ✓'))
      .catch(err => console.warn('SW error:', err));
  }

  // Inicializar iconos Feather
  feather.replace();

  // Inicializar EmailJS
  if (typeof emailjs !== 'undefined') {
    emailjs.init(CONFIG.EMAILJS.PUBLIC_KEY);
  }

  // Verificar sesión activa
  const sesion = sessionStorage.getItem('aurora_usuario');
  if (sesion) {
    try {
      STATE.usuario = JSON.parse(sesion);
      iniciarApp();
    } catch {
      sessionStorage.removeItem('aurora_usuario');
    }
  }

// Fecha en topbar
  actualizarFechaTopbar();
// Actualizar cada minuto
setInterval(actualizarFechaTopbar, 60000);

  // Fecha por defecto en campos de fecha
  setFechasHoy();

  // Timeout de sesión por inactividad (30 min)
  let _timerSesion;
  function resetearTimerSesion() {
    clearTimeout(_timerSesion);
    _timerSesion = setTimeout(() => {
      if (STATE.usuario) {
        showToast('Sesión cerrada por inactividad', 'warning', 5000);
        setTimeout(handleLogout, 1500);
      }
    }, 30 * 60 * 1000);
  }
  ['click','keydown','mousemove','touchstart'].forEach(ev =>
    document.addEventListener(ev, resetearTimerSesion, { passive: true })
  );
  resetearTimerSesion();
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const modalActivo = document.querySelector('.modal.active');
    if (modalActivo) cerrarModalConConfirmacion();
  }
});

// ── Eventos de conectividad ──
window.addEventListener('online', async () => {
  actualizarIndicadorOffline();
  showToast('Conexión restaurada', 'success', 3000);
  if (STATE.usuario) await sincronizarCola();
});

window.addEventListener('offline', () => {
  actualizarIndicadorOffline();
  showToast('Sin conexión — los cambios se guardarán localmente', 'warning', 5000);
});

// Estado inicial del indicador
actualizarIndicadorOffline();

}); 

function setFechasHoy() {
  const hoy = fechaLocal(new Date());
  ['historial-fecha', 'venta-fecha', 'pago-fecha'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = hoy;
  });
}

function actualizarFechaTopbar() {
  const el = document.getElementById('topbar-date');
  if (!el) return;
  const ahora = new Date();
  el.textContent = ahora.toLocaleDateString('es-MX', {
    weekday: 'short', day: '2-digit', month: 'short', year: 'numeric'
  });
}

/* ══════════════════════════════════════════════════════════════
   🔐  AUTENTICACIÓN
══════════════════════════════════════════════════════════════ */

async function handleLogin(e) {
  e.preventDefault();

  const usuario    = document.getElementById('login-user').value.trim();
  const contrasena = document.getElementById('login-pass').value;
  if (!usuario || !contrasena) return;

  const btn     = document.getElementById('login-btn');
  const btnText = document.getElementById('login-btn-text');
  const spinner = document.getElementById('login-spinner');
  const error   = document.getElementById('login-error');

  btn.disabled = true;
  btnText.textContent = 'Verificando...';
  spinner.classList.remove('hidden');
  error.classList.add('hidden');

  // ── Sin conexión → intentar sesión guardada localmente ──
  if (!navigator.onLine) {
    const raw = localStorage.getItem('aurora_sesion_local');
    if (raw) {
      try {
        const u = JSON.parse(raw);
        if (u._usuario === usuario) {
          STATE.usuario = u;
          sessionStorage.setItem('aurora_usuario', JSON.stringify(u));
          btn.disabled = false;
          btnText.textContent = 'Ingresar al Sistema';
          spinner.classList.add('hidden');
          showToast('Modo offline — usando sesión guardada', 'warning', 5000);
          iniciarApp();
          return;
        }
      } catch {}
    }
    error.querySelector('span').textContent = 'Sin conexión y no hay sesión guardada. Conéctate a internet para el primer inicio.';
    error.classList.remove('hidden');
    feather.replace();
    btn.disabled = false;
    btnText.textContent = 'Ingresar al Sistema';
    spinner.classList.add('hidden');
    return;
  }

  try {
    const res = await fetch(CONFIG.APPS_SCRIPT_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'login', payload: { usuario, contrasena } }),
    });
    const json = await res.json();

    if (!json.ok) {
      error.classList.remove('hidden');
      feather.replace();
    } else {
      STATE.usuario = json.usuario;
      sessionStorage.setItem('aurora_usuario', JSON.stringify(STATE.usuario));
      // Guardar sesión para uso offline (sin contraseña)
      localStorage.setItem('aurora_sesion_local', JSON.stringify({ ...STATE.usuario, _usuario: usuario }));
      iniciarApp();
    }
  } catch (err) {
    console.error('Error de login:', err);
    error.querySelector('span').textContent = 'Error de conexión. Verifica tu configuración.';
    error.classList.remove('hidden');
    feather.replace();
  } finally {
    btn.disabled = false;
    btnText.textContent = 'Ingresar al Sistema';
    spinner.classList.add('hidden');
  }
}

function handleLogout() {
  sessionStorage.removeItem('aurora_usuario');
  localStorage.removeItem('aurora_sesion_local');
  STATE.usuario = null;
  STATE.clientes = [];
  STATE.ventas   = [];
  STATE.pagos    = [];
  STATE.historial = [];
  STATE.auditoria = [];
  STATE.inventario = [];
  STATE.clienteActivo = null;
  STATE._filtroAdeudos = 'todos';
  STATE._revisionesPendientes = [];
  STATE._filtroEmpleadoDash = null;
  document.querySelectorAll('#filter-adeudos .filter-tab').forEach((t, i) => {
    t.classList.toggle('active', i === 0);
  });
  try { if (_chartVentas)    { _chartVentas.destroy();    _chartVentas = null; } } catch(e) {}
  try { if (_chartEstados)   { _chartEstados.destroy();   _chartEstados = null; } } catch(e) {}
  try { if (_chartNumVentas) { _chartNumVentas.destroy(); _chartNumVentas = null; } } catch(e) {}
  _periodoActual = 'semana';

  document.getElementById('app').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('login-form').reset();
  document.getElementById('login-error').classList.add('hidden');
}

function togglePassword() {
  const input = document.getElementById('login-pass');
  const icon  = document.getElementById('pass-eye');
  if (input.type === 'password') {
    input.type = 'text';
    icon.setAttribute('data-feather', 'eye-off');
  } else {
    input.type = 'password';
    icon.setAttribute('data-feather', 'eye');
  }
  feather.replace();
}

/* ══════════════════════════════════════════════════════════════
   🏠  INICIO DE APLICACIÓN
══════════════════════════════════════════════════════════════ */

async function iniciarApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');

  renderUsuarioUI();

  const colaInicial = await idbCola();
  STATE._colaPendiente = colaInicial.length;
  actualizarIndicadorOffline();

  if (!navigator.onLine) {
    showToast('Abriendo en modo offline — mostrando datos guardados', 'warning', 5000);
  }

  showLoading('Cargando datos del sistema...');
  try {
    const resultados = await Promise.allSettled([
    cargarClientes(),
    cargarVentas(),
    cargarPagos(),
    cargarHistorial(),
    cargarAuditoria(),
    cargarInventario(),
    ]);
    const modulos = ['Clientes','Ventas','Pagos','Historial','Auditoría','Inventario'];
    const fallidos = resultados
    .map((r, i) => r.status === 'rejected' ? modulos[i] : null)
    .filter(Boolean);
    if (fallidos.length) {
    showToast(`No se pudieron cargar: ${fallidos.join(', ')}. Refresca la página.`, 'warning', 7000);
    }
STATE._periodoKpi = 'mes';
    STATE._periodoKpiMes = null;
    renderDashboard();
    renderClientes();
    renderVentas();
    renderPagos();
    filterAdeudosBusqueda();
    renderHistorial();
    renderGarantias();
    renderAuditoria();
    llenarSelectsClientes();
    llenarSelectEmpleados();
    actualizarBadgeAdeudos();
    renderInventario();
    initImagenDropZone();
  } catch (err) {
    console.error('Error cargando datos:', err);
    showToast('Error al cargar datos. Verifica la conexión con Google Sheets.', 'error');
  } finally {
    hideLoading();
    feather.replace();
  }
}

function renderUsuarioUI() {
  const u = STATE.usuario;
  if (!u) return;
  const initials = u.nombre.split(' ').map(p => p[0]).join('').substring(0, 2).toUpperCase();

  setText('sidebar-username', u.nombre);
  setText('sidebar-role', u.rol);
  setHTML('sidebar-avatar', initials);
  setHTML('topbar-avatar', initials);
  setText('topbar-username', u.nombre.split(' ')[0]);

  const esAdmin = ['admin', 'administrador'].includes((u.rol || '').toLowerCase());

  const navAuditoria = document.getElementById('nav-item-auditoria');
  if (navAuditoria) navAuditoria.style.display = esAdmin ? '' : 'none';

  const ventasEmpleadoWrap = document.getElementById('ventas-empleado-wrap');
  if (ventasEmpleadoWrap) ventasEmpleadoWrap.classList.toggle('hidden', !esAdmin);

  const dashEmpleadoWrap = document.getElementById('dash-empleado-wrap');
  if (dashEmpleadoWrap) dashEmpleadoWrap.classList.toggle('hidden', !esAdmin);
}

/* ══════════════════════════════════════════════════════════════
   🌐  API — Google Apps Script (JSONP)
══════════════════════════════════════════════════════════════ */

async function apiGet(hoja, params = {}) {
  if (!STATE.usuario) { handleLogout(); return { data: [] }; }

  // ── Sin conexión → leer del caché IndexedDB ──
  if (!navigator.onLine) {
    const cached = await idbLeer(`hoja_${hoja}`);
    if (cached) return { data: cached };
    return { data: [] };
  }

  const url = new URL(CONFIG.APPS_SCRIPT_URL);
  url.searchParams.set('hoja', hoja);
  url.searchParams.set('action', 'get');
  url.searchParams.set('token', 'aurora_x9k2mZ8pQr');
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res  = await fetch(url.toString(), { signal: controller.signal });
    const json = await res.json();
    clearTimeout(timer);
    const data = json.data || [];
    // Guardar en IndexedDB para uso offline
    idbGuardar(`hoja_${hoja}`, data).catch(() => {});
    return { data };
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw new Error('Tiempo de espera agotado. Verifica tu conexión.');
    // Falló la red → intentar caché local
    const cached = await idbLeer(`hoja_${hoja}`);
    if (cached) {
      showToast('Sin conexión — mostrando datos guardados localmente', 'warning', 5000);
      return { data: cached };
    }
    throw err;
  }
}

async function apiPost(hoja, action, data) {
  if (!STATE.usuario && action !== 'login') { handleLogout(); return { ok: false }; }
  if (action === 'create' && !data.id) {
    data.id = 'id_' + Date.now() + '_' + Math.random().toString(36).substring(2, 11);
  }

  // ── Sin conexión → encolar operación ──
  if (!navigator.onLine && action !== 'login') {
    await idbEncolar(hoja, action, data);
    STATE._colaPendiente = (STATE._colaPendiente || 0) + 1;
    actualizarIndicadorOffline();
    return { ok: true, id: data.id, _offline: true };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(CONFIG.APPS_SCRIPT_URL, {
      method: 'POST',
      signal: controller.signal,
      body: JSON.stringify({ hoja, action, payload: data, token: 'aurora_x9k2mZ8pQr' }),
    });
    const json = await res.json();
    clearTimeout(timer);
    if (json.ok === false) throw new Error(json.error || 'Error del servidor');
    return { ok: true, id: json.id || data.id };
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw new Error('Tiempo de espera agotado. Verifica tu conexión.');
    // Red caída inesperadamente → encolar
    if (!navigator.onLine || err.message === 'Failed to fetch') {
      await idbEncolar(hoja, action, data);
      STATE._colaPendiente = (STATE._colaPendiente || 0) + 1;
      actualizarIndicadorOffline();
      showToast('Sin conexión — cambio guardado localmente', 'warning', 4000);
      return { ok: true, id: data.id, _offline: true };
    }
    throw err;
  }
}

/* Apps Script esperado — GET: { data: [ {...fila}, ...] }
   POST body:  { hoja, action: 'create'|'update'|'delete', data: {...} }
   POST resp:  { success: true, id: '...' }                             */

/* ══════════════════════════════════════════════════════════════
   📋  AUDITORÍA
══════════════════════════════════════════════════════════════ */

async function registrarAuditoria(tipo, descripcion) {
  const ahora = new Date();
  const registro = {
    usuario:     STATE.usuario?.nombre || 'Sistema',
    tipo,
    descripcion,
    fecha:       ahora.toLocaleDateString('es-MX'),
    hora:        ahora.toLocaleTimeString('es-MX', {hour:'2-digit', minute:'2-digit', hour12:true}),
    timestamp:   ahora.toISOString(),
  };
  // Guardar en Google Sheets
  try {
    await apiPost(CONFIG.HOJAS.AUDITORIA, 'create', registro);
  } catch (e) {
    console.warn('No se pudo guardar auditoría:', e);
  }
  // Agregar al estado local
  STATE.auditoria.unshift(registro);
  // Solo re-renderizar si el usuario está viendo la sección de auditoría
  if (document.getElementById('section-auditoria')?.classList.contains('active')) {
    renderAuditoria();
  }
}

async function cargarAuditoria() {
  try {
    const res = await apiGet(CONFIG.HOJAS.AUDITORIA);
    STATE.auditoria = [...(res.data || [])].reverse(); // más recientes primero
  } catch { STATE.auditoria = []; }
}

function renderAuditoria(lista = STATE.auditoria) {
  const tbody = document.getElementById('auditoria-body');
  if (!tbody) return;
  if (!lista.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-row">Sin registros de auditoría</td></tr>';
    return;
  }
  tbody.innerHTML = lista.map(a => {
    const tipoClase = (a.tipo || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return `
    <tr>
       <td data-label="Usuario"><strong>${esc(a.usuario)}</strong></td>
    <td data-label="Acción"><span class="accion-badge accion-${tipoClase}">${esc(a.tipo)}</span></td>
    <td data-label="Descripción">${esc(a.descripcion)}</td>
    <td data-label="Fecha" class="mono">${esc(a.fecha)}</td>
    <td data-label="Hora" class="mono">${formatHora(a.hora, a.timestamp)}</td>
    </tr>
  `;           
  }).join(''); 
  feather.replace();
}

function filterAuditoria() {
  const q      = val('search-auditoria').toLowerCase();
  const accion = val('filter-accion');
  const lista  = STATE.auditoria.filter(a =>
    (!q || a.usuario?.toLowerCase().includes(q) || a.descripcion?.toLowerCase().includes(q)) &&
    (!accion || a.tipo === accion)
  );
  renderAuditoria(lista);
}

function exportVentas() {
  // Usar la lista ya filtrada actualmente en pantalla
  const ventasFiltradas = _filtrarVentasLista();

  // Llenar select de empleados con los que aparecen en el filtro actual
  const empleados = [...new Set(STATE.ventas.map(v => v.registradoPor).filter(Boolean))].sort();
  const sel = document.getElementById('export-empleado');
  if (sel) {
    sel.innerHTML = '<option value="">— Todos los empleados —</option>'
      + empleados.map(e => `<option value="${esc(e)}">${esc(e)}</option>`).join('');
    // Preseleccionar el empleado activo si hay filtro
    const empActivo = val('filter-empleado-ventas');
    if (empActivo) sel.value = empActivo;
  }

  // Fechas: precargar con el rango activo en pantalla
  const fechaDesdeEl = document.getElementById('export-fecha-desde');
  const fechaHastaEl = document.getElementById('export-fecha-hasta');
  const hoy = new Date();

  if (_periodoVentas === 'rango') {
    if (fechaDesdeEl) fechaDesdeEl.value = document.getElementById('ventas-fecha-desde')?.value || '';
    if (fechaHastaEl) fechaHastaEl.value = document.getElementById('ventas-fecha-hasta')?.value || '';
  } else if (_periodoVentas === 'semana') {
    const ini = new Date(hoy); ini.setDate(hoy.getDate() - 6);
    if (fechaDesdeEl) fechaDesdeEl.value = fechaLocal(ini);
    if (fechaHastaEl) fechaHastaEl.value = fechaLocal(hoy);
  } else if (_periodoVentas === 'mes') {
    if (fechaDesdeEl) fechaDesdeEl.value = fechaLocal(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
    if (fechaHastaEl) fechaHastaEl.value = fechaLocal(hoy);
  } else if (_periodoVentas === 'año') {
    if (fechaDesdeEl) fechaDesdeEl.value = fechaLocal(new Date(hoy.getFullYear(), 0, 1));
    if (fechaHastaEl) fechaHastaEl.value = fechaLocal(hoy);
  } else {
    // 'todo' — sin fechas
    if (fechaDesdeEl) fechaDesdeEl.value = '';
    if (fechaHastaEl) fechaHastaEl.value = '';
  }

  // Mostrar preview inmediato con los filtros actuales
  actualizarExportPreview();

  ['export-fecha-desde','export-fecha-hasta'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.onchange = actualizarExportPreview;
      el.oninput  = actualizarExportPreview;
    }
  });
  const elEmpleado = document.getElementById('export-empleado');
  if (elEmpleado) elEmpleado.onchange = actualizarExportPreview;

  openModal('modal-export-ventas');
}

function actualizarExportPreview() {
  const desde    = document.getElementById('export-fecha-desde')?.value || '';
  const hasta    = document.getElementById('export-fecha-hasta')?.value || '';
  const empleado = document.getElementById('export-empleado')?.value   || '';
  const preview  = document.getElementById('export-preview');
  if (!preview) return;

  // Partir de los filtros activos en pantalla
  let ventas = _filtrarVentasLista();
  if (desde)    ventas = ventas.filter(v => v.fecha && v.fecha.trim() >= desde);
  if (hasta)    ventas = ventas.filter(v => v.fecha && v.fecha.trim() <= hasta);
  if (empleado) ventas = ventas.filter(v => v.registradoPor === empleado);

  const totalFiltrado = ventas.reduce((s, v) => s + parseFloat(v.totalFinal || 0), 0);
  preview.innerHTML = ventas.length > 0
    ? `Se exportarán <strong>${ventas.length}</strong> ventas por un total de <strong>${formatMoney(totalFiltrado)}</strong>`
    : '<span style="color:var(--rojo)">Sin ventas con esos filtros</span>';
}

function doExportVentas() {
  const desde    = document.getElementById('export-fecha-desde')?.value || '';
  const hasta    = document.getElementById('export-fecha-hasta')?.value || '';
  const empleado = document.getElementById('export-empleado')?.value   || '';

  // Partir de la lista ya filtrada por tipo/búsqueda/período activo en pantalla
  let ventas = _filtrarVentasLista();

  // Aplicar encima los filtros adicionales del modal de exportación
  if (desde)    ventas = ventas.filter(v => v.fecha && v.fecha.trim() >= desde);
  if (hasta)    ventas = ventas.filter(v => v.fecha && v.fecha.trim() <= hasta);
  if (empleado) ventas = ventas.filter(v => v.registradoPor === empleado);

  // Aplicar el mismo orden activo en pantalla
  ventas = [...ventas].sort((a, b) => {
    if (_ordenVentas.campo === 'fecha') {
      const fa = String(a.fecha || '0000-00-00');
      const fb = String(b.fecha || '0000-00-00');
      return _ordenVentas.dir === 'desc' ? fb.localeCompare(fa) : fa.localeCompare(fb);
    }
    return 0;
  });

  if (!ventas.length) {
    showToast('No hay ventas con esos filtros para exportar', 'warning');
    return;
  }

  const mapaP = {};
  STATE.pagos.forEach(p => {
    const key = String(p.ventaId || '').trim();
    mapaP[key] = (mapaP[key] || 0) + parseFloat(p.monto || 0);
  });

  const rows = [[
    'Cliente','Teléfono','Tipo Lente','Tipo Venta',
    'Total','Pagado','Restante','Fecha','Estado','Empleado','Notas'
  ]];

  ventas.forEach(v => {
    const c      = STATE.clientes.find(x => String(x.id) === String(v.clienteId));
    const pagado = mapaP[String(v.id).trim()] || 0;
    const saldo  = Math.max(0, parseFloat(v.totalFinal || 0) - pagado);
    const estado = calcularEstadoVenta(v);
    const estadoLabel = estado === 'pagado' ? 'Pagado' : estado === 'parcial' ? 'Parcial' : 'Con deuda';
    rows.push([
      c?.nombre          || v.clienteNombre || '',
      c?.telefono        || '',
      v.tipoLente        || '',
      capitalize(v.tipo  || 'normal'),
      parseFloat(v.totalFinal || 0).toFixed(2),
      pagado.toFixed(2),
      saldo.toFixed(2),
      v.fecha            || '',
      estadoLabel,
      v.registradoPor    || '',
      v.cambioDesc       || '',
    ]);
  });

  const csv  = rows.map(r => r.map(c => `"${String(c || '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href  = URL.createObjectURL(blob);

  let sufijo = '';
  if (desde && hasta) sufijo = `_${desde}_al_${hasta}`;
  else if (desde)     sufijo = `_desde_${desde}`;
  else if (hasta)     sufijo = `_hasta_${hasta}`;
  if (empleado)       sufijo += `_${empleado.replace(/\s+/g, '_')}`;

  link.download = `ventas_aurora${sufijo}.csv`;
  link.click();
  closeAllModals();
  showToast(`${ventas.length} ventas exportadas correctamente`, 'success');
}
function exportInventario() {
  if (!STATE.inventario.length) {
    showToast('No hay productos en inventario para exportar', 'warning');
    return;
  }

  const rows = [[
    'Nombre','SKU','Categoría','Marca','Color/Modelo',
    'Stock Actual','Stock Mínimo','Precio Costo','Precio Venta',
    'Valor en Inventario','Proveedor','Estado','Notas'
  ]];

  STATE.inventario.forEach(p => {
    const stock    = parseInt(p.stock    || 0);
    const stockMin = parseInt(p.stockMin || 3);
    const costo    = parseFloat(p.precioCosto || 0);
    const valorInv = (costo * stock).toFixed(2);

    let estado;
    if (stock === 0)            estado = 'Agotado';
    else if (stock <= stockMin) estado = 'Stock bajo';
    else                        estado = 'Disponible';

    rows.push([
      p.nombre      || '',
      p.sku         || '',
      capitalize(p.categoria || 'otro'),
      p.marca       || '',
      p.color       || '',
      stock,
      stockMin,
      costo.toFixed(2),
      parseFloat(p.precioVenta || 0).toFixed(2),
      valorInv,
      p.proveedor   || '',
      estado,
      p.notas       || '',
    ]);
  });

  // Fila de totales al final
  const totalStock = STATE.inventario.reduce((s, p) => s + parseInt(p.stock || 0), 0);
  const totalValor = STATE.inventario.reduce((s, p) =>
    s + (parseFloat(p.precioCosto || 0) * parseInt(p.stock || 0)), 0
  );
  rows.push(['','','','','',`TOTAL: ${totalStock}`,'','',``,`${totalValor.toFixed(2)}`,'','','']);

  const csv  = rows.map(r => r.map(c => `"${String(c || '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href  = URL.createObjectURL(blob);
  link.download = `inventario_aurora_${new Date().toISOString().split('T')[0]}.csv`;
  link.click();
  showToast(`${STATE.inventario.length} productos exportados`, 'success');
}
/* ══════════════════════════════════════════════════════════════
   👤  CLIENTES
══════════════════════════════════════════════════════════════ */

async function cargarClientes() {
  try {
    const res = await apiGet(CONFIG.HOJAS.CLIENTES);
    STATE.clientes = res.data || [];
  } catch { STATE.clientes = []; }
}

function renderClientes(lista = STATE.clientes) {
  const tbody = document.getElementById('clientes-body');
  if (!tbody) return;
  if (!lista.length) {
    const esFiltrando = val('search-clientes').trim() !== '';
    tbody.innerHTML = `<tr><td colspan="6" class="empty-row">
      ${esFiltrando ? 'Sin resultados para esa búsqueda' : 'No hay clientes registrados'}
    </td></tr>`;
    renderPaginacion(lista, 'clientes', 'cambiarPaginaClientes');
    return;
  }
  const paginados = paginar(lista, 'clientes');
  tbody.innerHTML = paginados.map(c => `
    <tr>
      <td data-label="Nombre"><strong>${esc(c.nombre)}</strong></td>
      <td data-label="Teléfono" class="mono">
  ${c.telefono
    ? `<a href="https://wa.me/52${sanitizarTelefono(c.telefono)}" target="_blank" style="color:var(--verde);text-decoration:none;">📱 ${esc(c.telefono)}</a>`
    : '—'
  }
</td>
      <td data-label="Correo">${esc(c.email || '—')}</td>
      <td data-label="Edad">${esc(c.edad || '—')}</td>
      <td data-label="Ocupación">${esc(c.ocupacion || '—')}</td>
      <td>
        <div class="action-btns">
          <button class="btn-action view"   onclick="verDetalleCliente('${c.id}')" title="Ver detalle"><i data-feather="eye"></i></button>
          <button class="btn-action edit"   onclick="editarCliente('${c.id}')"    title="Editar"><i data-feather="edit-2"></i></button>
          <button class="btn-action pay"    onclick="abrirPagoCliente('${c.id}')" title="Registrar pago"><i data-feather="dollar-sign"></i></button>
          <button class="btn-action delete" onclick="confirmarEliminar('cliente','${c.id}')" title="Eliminar"><i data-feather="trash-2"></i></button>
        </div>
      </td>
    </tr>
  `).join('');
  renderPaginacion(lista, 'clientes', 'cambiarPaginaClientes');
  feather.replace();
}

function filterClientes() {
  STATE.paginacion.clientes.pagina = 1
  const q = val('search-clientes').toLowerCase();
  renderClientes(STATE.clientes.filter(c =>
    c.nombre?.toLowerCase().includes(q) ||
    c.telefono?.toLowerCase().includes(q) ||
    c.email?.toLowerCase().includes(q)
  ));
}

function sortClientes() {
  STATE.paginacion.clientes.pagina = 1;
  const orden = val('sort-clientes');
  const q = val('search-clientes').toLowerCase();
  let lista = [...STATE.clientes];
  if (q) lista = lista.filter(c =>
    c.nombre?.toLowerCase().includes(q) ||
    c.telefono?.toLowerCase().includes(q) ||
    c.email?.toLowerCase().includes(q)
  );
  if (orden === 'nombre')      lista.sort((a,b) => (a.nombre||'').localeCompare(b.nombre||''));
  if (orden === 'nombre-desc') lista.sort((a,b) => (b.nombre||'').localeCompare(a.nombre||''));
  if (orden === 'reciente')    lista.reverse();
  renderClientes(lista);
}

function openModalCliente() {
  limpiarFormCliente();
  setHTML('modal-cliente-title', 'Nuevo Cliente');
  document.getElementById('cliente-id').value = '';
  openModal('modal-cliente');
}

function editarCliente(id) {
  const c = STATE.clientes.find(x => x.id == id);
  if (!c) return;
  // Poblar datos ANTES de abrir para evitar parpadeo
  setHTML('modal-cliente-title', 'Editar Cliente');
  document.getElementById('cliente-id').value       = c.id;
  document.getElementById('cliente-nombre').value   = c.nombre     || '';
  document.getElementById('cliente-telefono').value = c.telefono   || '';
  document.getElementById('cliente-email').value    = c.email      || '';
  document.getElementById('cliente-edad').value     = c.edad       || '';
  document.getElementById('cliente-ocupacion').value= c.ocupacion  || '';
  document.getElementById('cliente-direccion').value= c.direccion  || '';
  document.getElementById('cliente-escolaridad').value = c.escolaridad || '';
  document.getElementById('cliente-actividades').value = c.actividades || '';
  openModal('modal-cliente');
}

async function saveCliente() {
  const btnGuardar = document.querySelector('#modal-cliente .btn-primary');
  if (btnGuardar?.disabled) return;

  const id       = document.getElementById('cliente-id').value;
  const nombre   = document.getElementById('cliente-nombre').value.trim();
  const telefono = document.getElementById('cliente-telefono').value.trim();
  const email    = document.getElementById('cliente-email').value.trim();

  if (!nombre || !telefono) { showToast('Nombre y teléfono son requeridos', 'warning'); return; }
  const telefonoLimpio = telefono.replace(/[\s\-().+]/g, '');
  if (!/^\d{10,12}$/.test(telefonoLimpio)) {
    showToast('El teléfono debe tener entre 10 y 12 dígitos numéricos', 'warning');
    return;
  }
  // Validar teléfono duplicado
  const telefonoDuplicado = STATE.clientes.find(c =>
    sanitizarTelefono(c.telefono) === telefonoLimpio &&
    String(c.id) !== String(id)
  );
  if (telefonoDuplicado) {
    showToast(`El teléfono ya está registrado para "${telefonoDuplicado.nombre}"`, 'warning');
    return;
  }
  if (email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      showToast('El formato del correo electrónico no es válido', 'warning');
      return;
    }
    const duplicado = STATE.clientes.find(c =>
      c.email &&
      c.email.toLowerCase() === email.toLowerCase() &&
      String(c.id) !== String(id)
    );
    if (duplicado) { showToast(`El correo ya está registrado en ${duplicado.nombre}`, 'warning'); return; }
  }

  const data = {
    nombre,
    telefono,
    email,
    edad:       document.getElementById('cliente-edad').value,
    ocupacion:  document.getElementById('cliente-ocupacion').value.trim(),
    direccion:  document.getElementById('cliente-direccion').value.trim(),
    escolaridad:  document.getElementById('cliente-escolaridad').value.trim(),
    actividades:  document.getElementById('cliente-actividades').value.trim(),
  };

  if (btnGuardar) { btnGuardar.disabled = true; btnGuardar.textContent = 'Guardando...'; }
  showLoading(id ? 'Actualizando cliente...' : 'Guardando cliente...');
  try {
    if (id) {
      data.id = id;
      await apiPost(CONFIG.HOJAS.CLIENTES, 'update', data);
      const idx = STATE.clientes.findIndex(c => String(c.id) === String(id));
      if (idx > -1) STATE.clientes[idx] = { ...STATE.clientes[idx], ...data };
      await registrarAuditoria('Editar', `${STATE.usuario.nombre} editó al cliente ${nombre}`);
      showToast('Cliente actualizado correctamente', 'success');
    } else {
      const res = await apiPost(CONFIG.HOJAS.CLIENTES, 'create', data);
      data.id = res.id || data.id || Date.now().toString();
      STATE.clientes.push(data);
      await registrarAuditoria('Crear', `${STATE.usuario.nombre} creó al cliente ${nombre}`);
      showToast('Cliente creado correctamente', 'success');
    }
    STATE.paginacion.clientes.pagina = 1;
    if (!id) {
      // Limpiar búsqueda para que el cliente nuevo sea visible
      const se = document.getElementById('search-clientes');
      if (se) se.value = '';
    }
    closeAllModals();
    filterClientes();
    llenarSelectsClientes();
    renderDashboard();
  } catch (err) {
    console.error(err);
    showToast('Error al guardar cliente', 'error');
  } finally {
    hideLoading();
    if (btnGuardar) {
      btnGuardar.disabled = false;
      btnGuardar.innerHTML = '<i data-feather="save"></i> Guardar Cliente';
      feather.replace();
    }
  }
}

function limpiarFormCliente() {
  ['cliente-nombre','cliente-telefono','cliente-email',
   'cliente-edad','cliente-ocupacion','cliente-direccion', 
    'cliente-escolaridad', 'cliente-actividades'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
}

/* ── VER DETALLE CLIENTE ── */
function verDetalleCliente(id) {
  const c = STATE.clientes.find(x => x.id == id);
  if (!c) return;
  STATE.clienteActivo = c;

  setHTML('detalle-cliente-nombre', c.nombre);
  setHTML('d-nombre',    c.nombre    || '—');
  setHTML('d-telefono',  c.telefono  || '—');
  setHTML('d-email',     c.email     || '—');
  setHTML('d-edad',      c.edad      || '—');
  setHTML('d-ocupacion', c.ocupacion || '—');
  setHTML('d-direccion', c.direccion || '—');
  setHTML('d-escolaridad', c.escolaridad || '—');
  setHTML('d-actividades', c.actividades || '—');
  

  // Calcular balance
  const ventasCliente = STATE.ventas.filter(v => v.clienteId == id);
  const totalCompras = ventasCliente
    .filter(v => parseFloat(v.totalFinal || 0) > 0)
    .reduce((s, v) => s + parseFloat(v.totalFinal || 0), 0);
  const totalPagado = ventasCliente
    .filter(v => parseFloat(v.totalFinal || 0) > 0)
    .reduce((s, v) => s + calcularPagado(v.id), 0);
  const saldo = Math.max(0, totalCompras - totalPagado);

// Mostrar/ocultar botón recordatorio según saldo
const btnRec = document.getElementById('btn-recordatorio');
if (btnRec) btnRec.style.display = saldo > 0 ? '' : 'none';

const btnThanks = document.querySelector('#modal-detalle-cliente .btn-email-thanks');
if (btnThanks) btnThanks.style.display = saldo === 0 && totalCompras > 0 ? '' : 'none';

  setHTML('d-total-compras',  formatMoney(totalCompras));
  setHTML('d-total-pagado',   formatMoney(totalPagado));
  setHTML('d-saldo-pendiente',formatMoney(saldo));

  // Historial clínico del cliente
  renderDetalleHistorial(id);

  // Pagos del cliente
  renderDetallePagos(id);

  // Activar primera tab
  const primerTab = document.querySelector('#modal-detalle-cliente .detail-tab');
switchDetailTab('info', primerTab);

  openModal('modal-detalle-cliente');
}

function renderDetalleHistorial(clienteId) {
  const lista  = STATE.historial.filter(h => h.clienteId == clienteId);
  const cont   = document.getElementById('detail-historial-list');
  if (!lista.length) {
    cont.innerHTML = '<div class="empty-row">Sin registros clínicos</div>';
    return;
  }
  cont.innerHTML = lista.map(h => buildHistorialCard(h)).join('');
  feather.replace();
}

function renderDetallePagos(clienteId) {
  // Obtener IDs de ventas de este cliente para encontrar también pagos sin clienteId
  const ventasDelCliente = STATE.ventas
    .filter(v => String(v.clienteId) === String(clienteId))
    .map(v => String(v.id));
  const lista = STATE.pagos.filter(p =>
    String(p.clienteId || '') === String(clienteId) ||
    ventasDelCliente.includes(String(p.ventaId || '').trim())
  );
  const tbody  = document.getElementById('detail-pagos-body');
  if (!lista.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty-row">Sin pagos registrados</td></tr>';
    return;
  }
  tbody.innerHTML = lista.map(p => `
    <tr>
      <td class="mono">${esc(p.fecha)}</td>
      <td class="mono text-green"><strong>${formatMoney(p.monto)}</strong></td>
      <td>${esc(p.metodo || '—')}</td>
      <td>${esc(p.notas || '—')}</td>
    </tr>
  `).join('');
}

function switchDetailTab(tab, btn) {
  document.querySelectorAll('.detail-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.detail-tab-content').forEach(c => c.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const content = document.getElementById(`detail-tab-${tab}`);
  if (content) content.classList.add('active');
}

/* ── ELIMINAR CLIENTE ── */
async function eliminarCliente(id) {
  const c = STATE.clientes.find(x => x.id == id);
  showLoading('Eliminando cliente y todos sus registros...');

  const errores = [];

  try {
    // 1. Borrar historial clínico
    for (const h of STATE.historial.filter(h => h.clienteId == id)) {
      try {
        await apiPost(CONFIG.HOJAS.HISTORIAL, 'delete', { id: h.id });
      } catch { errores.push('historial:' + h.id); }
    }
    STATE.historial = STATE.historial.filter(h => h.clienteId != id);

    // 2. Borrar pagos
    const ventaIds = STATE.ventas.filter(v => v.clienteId == id).map(v => String(v.id));
    const pagosAEliminar = STATE.pagos.filter(p => {
      const porVenta   = ventaIds.includes(String(p.ventaId || '').trim());
      const porCliente = String(p.clienteId || '').trim() === String(id).trim();
      return porVenta || porCliente;
    });
    for (const p of pagosAEliminar) {
      try {
        await apiPost(CONFIG.HOJAS.PAGOS, 'delete', { id: p.id });
      } catch { errores.push('pago:' + p.id); }
    }
    STATE.pagos = STATE.pagos.filter(p =>
      !ventaIds.includes(String(p.ventaId || '').trim()) &&
      String(p.clienteId || '').trim() !== String(id).trim()
    );

    // 3. Borrar ventas — restaurar stock primero
    for (const v of STATE.ventas.filter(v => v.clienteId == id)) {
      if (v.productoId && v.tipo !== 'garantia') {
        const prodIdx = STATE.inventario.findIndex(p => String(p.id) === String(v.productoId));
        if (prodIdx > -1) {
          const prod = STATE.inventario[prodIdx];
          const stockRestaurado = parseInt(prod.stock || 0) + (parseInt(v.cantidad) || 1);
          try {
            await apiPost(CONFIG.HOJAS.INVENTARIO, 'update', { ...prod, stock: stockRestaurado });
            STATE.inventario[prodIdx].stock = stockRestaurado;
          } catch { errores.push('stock:' + v.productoId); }
        }
      }
      try {
        await apiPost(CONFIG.HOJAS.VENTAS, 'delete', { id: v.id });
      } catch { errores.push('venta:' + v.id); }
    }
    STATE.ventas = STATE.ventas.filter(v => v.clienteId != id);

    // 4. Borrar cliente
    try {
      await apiPost(CONFIG.HOJAS.CLIENTES, 'delete', { id });
      STATE.clientes = STATE.clientes.filter(x => x.id != id);
    } catch { errores.push('cliente:' + id); }

    await registrarAuditoria('Eliminar',
      `${STATE.usuario.nombre} eliminó al cliente ${c?.nombre} y todos sus registros`
    );

    if (errores.length > 0) {
      showToast(
        `Cliente eliminado con ${errores.length} error(es) menores. Recarga para verificar.`,
        'warning', 6000
      );
    } else {
      showToast('Cliente y todos sus registros eliminados', 'success');
    }

    STATE.paginacion.clientes.pagina  = 1;
    STATE.paginacion.ventas.pagina    = 1;
    STATE.paginacion.pagos.pagina     = 1;
    STATE.paginacion.historial.pagina = 1;
    closeAllModals();
    filterClientes();
    filterVentas();
    filterPagos();
    filterHistorial();
    filterAdeudosBusqueda();
    filterGarantias();
    renderDashboard();
    llenarSelectsClientes();
    actualizarBadgeAdeudos();
  } catch (err) {
    showToast('Error crítico al eliminar cliente. Recarga la página.', 'error');
  } finally { hideLoading(); }
}

/* ══════════════════════════════════════════════════════════════
   👁️  HISTORIAL CLÍNICO
══════════════════════════════════════════════════════════════ */

async function cargarHistorial() {
  try {
    const res = await apiGet(CONFIG.HOJAS.HISTORIAL);
    STATE.historial = res.data || [];
  } catch { STATE.historial = []; }
}

function renderHistorial(lista = STATE.historial) {
  const tbody = document.getElementById('historial-body');
  if (!tbody) return;
  if (!lista.length) {
    const esFiltrando = val('search-historial').trim() !== '';
    tbody.innerHTML = `<tr><td colspan="7" class="empty-row">
      ${esFiltrando ? 'Sin resultados para esa búsqueda' : 'No hay registros clínicos'}
    </td></tr>`;
    renderPaginacion(lista, 'historial', 'cambiarPaginaHistorial');
    return;
  }
  const paginados = paginar(lista, 'historial');
  tbody.innerHTML = paginados.map(h => {
    const cliente = STATE.clientes.find(c => c.id == h.clienteId);
    const sintomas = (h.sintomas || '').split(',').filter(Boolean).slice(0, 2).join(', ');
    return `
      <tr>
        <td data-label="Cliente"><strong>${esc(cliente?.nombre || h.clienteNombre || '—')}</strong></td>
        <td data-label="Fecha" class="mono">${esc(h.fecha || '—')}</td>
        <td data-label="AVL S/C" class="mono">${h.avlscOd ? '20/'+h.avlscOd : '—'}</td>
        <td data-label="AVL C/C" class="mono">${h.avlccOd ? '20/'+h.avlccOd : '—'}</td>
        <td data-label="Diagnóstico">${esc(h.diagnostico || '—')}</td>
        <td data-label="Síntomas"><span class="badge badge-blue">${esc(sintomas || 'Ninguno')}</span></td>
        <td>
          <div class="action-btns">
            <button class="btn-action view"   onclick="verHistorialCompleto('${h.id}')" title="Ver completo"><i data-feather="eye"></i></button>
            <button class="btn-action edit"   onclick="editarHistorial('${h.id}')" title="Editar"><i data-feather="edit-2"></i></button>
            <button class="btn-action print"  onclick="imprimirExpediente('${h.id}')" title="Imprimir expediente"><i data-feather="printer"></i></button>
            <button class="btn-action delete" onclick="confirmarEliminar('historial','${h.id}','')" title="Eliminar"><i data-feather="trash-2"></i></button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
  renderPaginacion(lista, 'historial', 'cambiarPaginaHistorial');
  feather.replace();
}

function filterHistorial() {
  STATE.paginacion.historial.pagina = 1;
  const q = val('search-historial').toLowerCase();
  const lista = STATE.historial.filter(h => {
    const c = STATE.clientes.find(x => x.id == h.clienteId);
    return !q || c?.nombre?.toLowerCase().includes(q) || h.clienteNombre?.toLowerCase().includes(q);
  });
  renderHistorial(lista);
}

async function saveHistorial() {
  const btnGuardarH = document.querySelector('#modal-historial .btn-primary');
  if (btnGuardarH?.disabled) return;

  const clienteId = val('historial-cliente');
  if (!clienteId) { showToast('Selecciona un cliente', 'warning'); return; }

  const cliente  = STATE.clientes.find(c => c.id == clienteId);
  const sintomas = [...document.querySelectorAll('input[name="sintoma"]:checked')]
    .map(i => i.value).join(',');

  const data = {
    clienteId,
    clienteNombre: cliente?.nombre || '',
    registradoPor: STATE.usuario?.nombre || '',
    fecha:      val('historial-fecha') || fechaLocal(new Date()),
    // AVL S/C
    avlscOd: val('avlsc-od'), avlscOi: val('avlsc-oi'), avlscAo: val('avlsc-ao'),
    // AVL C/C
    avlccOd: val('avlcc-od'), avlccOi: val('avlcc-oi'), avlccAo: val('avlcc-ao'),
    // VC S/C
    vcscOd:  val('vcsc-od'),  vcscOi:  val('vcsc-oi'),  vcscAo:  val('vcsc-ao'),
    // VC C/C
    vcccOd:  val('vccc-od'),  vcccOi:  val('vccc-oi'),  vcccAo:  val('vccc-ao'),
    sintomas,
    diagnostico:   val('historial-diagnostico'),
    observaciones: val('historial-observaciones'),
    // Motivo de consulta
    motivo:              val('historial-motivo'),
    desdeCuando:         val('historial-desde-cuando'),
    atribuye:            val('historial-atribuye'),
    haAumentado:         val('historial-aumento'),
    medicamento:         val('historial-medicamento'),
    // Antecedentes refractométricos
    ultimoExamen:        val('historial-ultimo-examen'),
    usaLentes:           val('historial-usa-lentes'),
    tiempoLentes:        val('historial-tiempo-lentes'),
    cambiosGraduacion:   val('historial-cambios-graduacion'),
    usaContacto:         val('historial-usa-contacto'),
    tiempoContacto:      val('historial-tiempo-contacto'),
    // Antecedentes heredofamiliares
    antecedentes:        [...document.querySelectorAll('input[name="antecedente"]:checked')].map(i => i.value).join(','),
    cirugia:             val('historial-cirugia'),
    // Toma AVD detallada
    phOd: val('ph-od'), phOi: val('ph-oi'),
    relojOd: val('reloj-od'), relojOi: val('reloj-oi'),
    bicroOd: val('bicro-od'), bicroOi: val('bicro-oi'),
    mppOd: val('mpp-od'), mppOi: val('mpp-oi'),
    altura: val('historial-altura'),
    dip: val('historial-dip'),
    dnpOd: val('historial-dnp-od'), dnpOi: val('historial-dnp-oi'),
    add: val('historial-add'),
    // Revisión de anexos
    parpados: val('historial-parpados'),
    pestanas: val('historial-pestanas'),
    cejas: val('historial-cejas'),
    conjuntiva: val('historial-conjuntiva'),
    oftalmoscopia: val('historial-oftalmoscopia'),
    // Graduación y RX
    gradAntOd: val('historial-grad-ant-od'),
    gradAntOi: val('historial-grad-ant-oi'),
    ejeOd: val('historial-eje-od'),
    ejeOi: val('historial-eje-oi'),
    pruebaAmb: val('historial-prueba-amb'),
    relojNeutralizado: val('historial-reloj-neutralizado'),
    bicroNeutralizado: val('historial-bicro-neutralizado'),
    material: val('historial-material'),
    rxOd: val('historial-rx-od'),
    rxOi: val('historial-rx-oi'),
    rxAdd: val('historial-rx-add'),
  };

  const id = val('historial-id');
  if (btnGuardarH) { btnGuardarH.disabled = true; btnGuardarH.textContent = 'Guardando...'; }
  showLoading('Guardando historial clínico...');
  try {
    if (id) {
      data.id = id;
      await apiPost(CONFIG.HOJAS.HISTORIAL, 'update', data);
      const idx = STATE.historial.findIndex(h => String(h.id) === String(id));
      if (idx > -1) STATE.historial[idx] = { ...STATE.historial[idx], ...data };
      await registrarAuditoria('Editar', `${STATE.usuario.nombre} editó historial clínico de ${cliente?.nombre}`);
      showToast('Historial actualizado', 'success');
    } else {
      const res = await apiPost(CONFIG.HOJAS.HISTORIAL, 'create', data);
      data.id = res.id || data.id || Date.now().toString();
      STATE.historial.push(data);
      await registrarAuditoria('Crear', `${STATE.usuario.nombre} registró historial clínico de ${cliente?.nombre}`);
      showToast('Historial clínico guardado', 'success');
    }
    STATE.paginacion.historial.pagina = 1;
    closeAllModals();
    filterHistorial();
  } catch (err) {
    showToast('Error al guardar historial', 'error');
  } finally {
    hideLoading();
    if (btnGuardarH) {
      btnGuardarH.disabled = false;
      btnGuardarH.innerHTML = '<i data-feather="save"></i> Guardar Registro';
      feather.replace();
    }
  }
}

function editarHistorial(id) {
  const h = STATE.historial.find(x => x.id == id);
  if (!h) return;

  // Setear ID ANTES de openModal para que openModal no limpie el formulario
  document.getElementById('historial-id').value = h.id;
  setHTML('modal-historial-title', 'Editar Registro Clínico');

  openModal('modal-historial');

  // Poblar DESPUÉS de abrir — openModal ya detectó historial-id y NO limpió
  document.getElementById('historial-cliente').value        = h.clienteId;
  document.getElementById('historial-fecha').value          = h.fecha || '';

  // AVL
  document.getElementById('avlsc-od').value = h.avlscOd || '';
  document.getElementById('avlsc-oi').value = h.avlscOi || '';
  document.getElementById('avlsc-ao').value = h.avlscAo || '';
  document.getElementById('avlcc-od').value = h.avlccOd || '';
  document.getElementById('avlcc-oi').value = h.avlccOi || '';
  document.getElementById('avlcc-ao').value = h.avlccAo || '';
  document.getElementById('vcsc-od').value  = h.vcscOd  || '';
  document.getElementById('vcsc-oi').value  = h.vcscOi  || '';
  document.getElementById('vcsc-ao').value  = h.vcscAo  || '';
  document.getElementById('vccc-od').value  = h.vcccOd  || '';
  document.getElementById('vccc-oi').value  = h.vcccOi  || '';
  document.getElementById('vccc-ao').value  = h.vcccAo  || '';

  // Diagnóstico / observaciones
  document.getElementById('historial-diagnostico').value   = h.diagnostico   || '';
  document.getElementById('historial-observaciones').value = h.observaciones || '';

  // Síntomas
  const sins = (h.sintomas || '').split(',');
  document.querySelectorAll('input[name="sintoma"]').forEach(cb => {
    cb.checked = sins.includes(cb.value);
  });

  // Antecedentes heredofamiliares
  const ants = (h.antecedentes || '').split(',');
  document.querySelectorAll('input[name="antecedente"]').forEach(cb => {
    cb.checked = ants.includes(cb.value);
  });

  // Motivo de consulta
  document.getElementById('historial-motivo').value         = h.motivo         || '';
  document.getElementById('historial-desde-cuando').value   = h.desdeCuando    || '';
  document.getElementById('historial-atribuye').value       = h.atribuye       || '';
  document.getElementById('historial-aumento').value        = h.haAumentado    || '';
  document.getElementById('historial-medicamento').value    = h.medicamento    || '';

  // Antecedentes refractométricos
  document.getElementById('historial-ultimo-examen').value     = h.ultimoExamen     || '';
  document.getElementById('historial-usa-lentes').value        = h.usaLentes        || '';
  document.getElementById('historial-tiempo-lentes').value     = h.tiempoLentes     || '';
  document.getElementById('historial-cambios-graduacion').value= h.cambiosGraduacion|| '';
  document.getElementById('historial-usa-contacto').value      = h.usaContacto      || '';
  document.getElementById('historial-tiempo-contacto').value   = h.tiempoContacto   || '';
  document.getElementById('historial-cirugia').value           = h.cirugia          || '';

  // Medidas
  document.getElementById('ph-od').value          = h.phOd    || '';
  document.getElementById('ph-oi').value          = h.phOi    || '';
  document.getElementById('reloj-od').value       = h.relojOd || '';
  document.getElementById('reloj-oi').value       = h.relojOi || '';
  document.getElementById('bicro-od').value       = h.bicroOd || '';
  document.getElementById('bicro-oi').value       = h.bicroOi || '';
  document.getElementById('mpp-od').value         = h.mppOd   || '';
  document.getElementById('mpp-oi').value         = h.mppOi   || '';
  document.getElementById('historial-altura').value  = h.altura || '';
  document.getElementById('historial-dip').value     = h.dip    || '';
  document.getElementById('historial-dnp-od').value  = h.dnpOd  || '';
  document.getElementById('historial-dnp-oi').value  = h.dnpOi  || '';
  document.getElementById('historial-add').value     = h.add    || '';

  // Revisión de anexos
  document.getElementById('historial-parpados').value      = h.parpados     || '';
  document.getElementById('historial-pestanas').value      = h.pestanas     || '';
  document.getElementById('historial-cejas').value         = h.cejas        || '';
  document.getElementById('historial-conjuntiva').value    = h.conjuntiva   || '';
  document.getElementById('historial-oftalmoscopia').value = h.oftalmoscopia|| '';

  // Graduación y RX
  document.getElementById('historial-grad-ant-od').value = h.gradAntOd || '';
  document.getElementById('historial-grad-ant-oi').value = h.gradAntOi || '';
  document.getElementById('historial-eje-od').value      = h.ejeOd     || '';
  document.getElementById('historial-eje-oi').value      = h.ejeOi     || '';
  document.getElementById('historial-prueba-amb').value  = h.pruebaAmb || '';
  document.getElementById('historial-material').value    = h.material  || '';
  document.getElementById('historial-rx-od').value       = h.rxOd      || '';
  document.getElementById('historial-rx-oi').value       = h.rxOi      || '';
  document.getElementById('historial-rx-add').value      = h.rxAdd     || '';

  // Neutralizados (campos opcionales que pueden no existir en el DOM)
  const relojN = document.getElementById('historial-reloj-neutralizado');
  if (relojN) relojN.value = h.relojNeutralizado || '';
  const bicroN = document.getElementById('historial-bicro-neutralizado');
  if (bicroN) bicroN.value = h.bicroNeutralizado || '';
}

function verHistorialCompleto(id) {
  const h = STATE.historial.find(x => x.id == id);
  if (!h) return;
  const cliente = STATE.clientes.find(c => c.id == h.clienteId);
  document.getElementById('ver-historial-content').innerHTML = buildHistorialCard(h, cliente?.nombre);
  feather.replace();
  openModal('modal-ver-historial');
}

function buildHistorialCard(h, nombreExtra) {
  const sintomas = (h.sintomas || '').split(',').filter(Boolean);
  const antecedentes = (h.antecedentes || '').split(',').filter(Boolean);

  const fila = (label, val) => val
    ? `<div class="info-item"><span class="info-label">${label}</span><span class="info-value">${esc(String(val))}</span></div>`
    : '';

  return `
    <div class="historial-card">
      <div class="historial-card-header">
        <strong>${esc(nombreExtra || h.clienteNombre || '')}</strong>
        <span class="historial-fecha">${esc(h.fecha || '—')}</span>
      </div>

      <table class="av-table">
        <thead><tr><th></th><th>AVL S/C</th><th>AVL C/C</th><th>VC S/C</th><th>VC C/C</th></tr></thead>
        <tbody>
          <tr><td><strong>OD</strong></td>
            <td>${h.avlscOd ? '20/'+h.avlscOd : '—'}</td>
            <td>${h.avlccOd ? '20/'+h.avlccOd : '—'}</td>
            <td>${h.vcscOd  ? '20/'+h.vcscOd  : '—'}</td>
            <td>${h.vcccOd  ? '20/'+h.vcccOd  : '—'}</td>
          </tr>
          <tr><td><strong>OI</strong></td>
            <td>${h.avlscOi ? '20/'+h.avlscOi : '—'}</td>
            <td>${h.avlccOi ? '20/'+h.avlccOi : '—'}</td>
            <td>${h.vcscOi  ? '20/'+h.vcscOi  : '—'}</td>
            <td>${h.vcccOi  ? '20/'+h.vcccOi  : '—'}</td>
          </tr>
          <tr><td><strong>AO</strong></td>
            <td>${h.avlscAo ? '20/'+h.avlscAo : '—'}</td>
            <td>${h.avlccAo ? '20/'+h.avlccAo : '—'}</td>
            <td>${h.vcscAo  ? '20/'+h.vcscAo  : '—'}</td>
            <td>${h.vcccAo  ? '20/'+h.vcccAo  : '—'}</td>
          </tr>
        </tbody>
      </table>

      ${h.motivo || h.desdeCuando || h.atribuye ? `
        <div class="clinica-title" style="margin-top:.8rem">Motivo de Consulta</div>
        <div class="info-grid">
          ${fila('Motivo', h.motivo)}
          ${fila('Desde cuándo', h.desdeCuando)}
          ${fila('Lo atribuye a', h.atribuye)}
          ${fila('¿Ha aumentado?', h.haAumentado)}
          ${fila('Medicamento', h.medicamento)}
        </div>` : ''}

      ${h.ultimoExamen || h.usaLentes || h.usaContacto ? `
        <div class="clinica-title" style="margin-top:.8rem">Antecedentes Refractométricos</div>
        <div class="info-grid">
          ${fila('Último examen', h.ultimoExamen)}
          ${fila('Usa lentes', h.usaLentes)}
          ${fila('Tiempo con lentes', h.tiempoLentes)}
          ${fila('Cambios graduación', h.cambiosGraduacion)}
          ${fila('Usa contacto', h.usaContacto)}
          ${fila('Tiempo con contacto', h.tiempoContacto)}
          ${fila('Cirugía ocular', h.cirugia)}
        </div>` : ''}

      ${antecedentes.length ? `
        <div class="clinica-title" style="margin-top:.8rem">Antecedentes Heredofamiliares</div>
        <div class="sintomas-tags">${antecedentes.map(a=>`<span class="sintoma-tag">${esc(a)}</span>`).join('')}</div>` : ''}

      ${h.phOd || h.dip || h.altura ? `
        <div class="clinica-title" style="margin-top:.8rem">Medidas</div>
        <div class="info-grid">
          ${fila('PH OD', h.phOd)} ${fila('PH OI', h.phOi)}
          ${fila('Reloj OD', h.relojOd)} ${fila('Reloj OI', h.relojOi)}
          ${fila('Bicro OD', h.bicroOd)} ${fila('Bicro OI', h.bicroOi)}
          ${fila('MPP OD', h.mppOd)} ${fila('MPP OI', h.mppOi)}
          ${fila('DIP', h.dip ? h.dip+' mm' : '')}
          ${fila('Altura', h.altura ? h.altura+' mm' : '')}
          ${fila('DNP OD', h.dnpOd)} ${fila('DNP OI', h.dnpOi)}
          ${fila('ADD', h.add)}
        </div>` : ''}

      ${h.parpados || h.conjuntiva ? `
        <div class="clinica-title" style="margin-top:.8rem">Revisión de Anexos</div>
        <div class="info-grid">
          ${fila('Párpados', h.parpados)} ${fila('Pestañas', h.pestanas)}
          ${fila('Cejas', h.cejas)} ${fila('Conjuntiva', h.conjuntiva)}
        </div>
        ${h.oftalmoscopia ? `<div class="diagnostico-text"><strong>Oftalmoscopía:</strong> ${esc(h.oftalmoscopia)}</div>` : ''}` : ''}

      ${h.rxOd || h.rxOi || h.material ? `
        <div class="clinica-title" style="margin-top:.8rem">Graduación y RX Final</div>
        <div class="info-grid">
          ${fila('Grad. ant. OD', h.gradAntOd)} ${fila('Grad. ant. OI', h.gradAntOi)}
          ${fila('Eje OD', h.ejeOd)} ${fila('Eje OI', h.ejeOi)}
          ${fila('Prueba ambulatoria', h.pruebaAmb)}
          ${fila('Reloj neutralizado', h.relojNeutralizado)}
          ${fila('Bicromática neutralizada', h.bicroNeutralizado)}
          ${fila('Material', h.material)}
          ${fila('RX Final OD', h.rxOd)} ${fila('RX Final OI', h.rxOi)}
          ${fila('ADD Final', h.rxAdd)}
        </div>` : ''}

      ${sintomas.length ? `<div class="sintomas-tags" style="margin-top:.6rem">${sintomas.map(s=>`<span class="sintoma-tag">${esc(s)}</span>`).join('')}</div>` : ''}
      ${h.diagnostico ? `<div class="diagnostico-text" style="margin-top:.5rem"><strong>Diagnóstico:</strong> ${esc(h.diagnostico)}</div>` : ''}
      ${h.observaciones ? `<div class="diagnostico-text mt-1"><strong>Observaciones:</strong> ${esc(h.observaciones)}</div>` : ''}
    </div>
  `;
}

async function eliminarHistorial(id) {
  showLoading('Eliminando registro...');
  try {
    await apiPost(CONFIG.HOJAS.HISTORIAL, 'delete', { id });
    STATE.historial = STATE.historial.filter(h => h.id != id);
    await registrarAuditoria('Eliminar', `${STATE.usuario.nombre} eliminó un registro clínico`);
    showToast('Registro eliminado', 'success');
    STATE.paginacion.historial.pagina = 1;
    closeAllModals();
    filterHistorial();
  } catch { showToast('Error al eliminar', 'error'); }
  finally  { hideLoading(); }
}

/* ══════════════════════════════════════════════════════════════
   💰  VENTAS
══════════════════════════════════════════════════════════════ */

async function cargarVentas() {
  try {
    const res = await apiGet(CONFIG.HOJAS.VENTAS);
    STATE.ventas = res.data || [];
  } catch { STATE.ventas = []; }
}

function calcularTotal() {
  const precio      = parseFloat(val('venta-precio'))    || 0;
  const cantidadRaw = parseInt(val('venta-cantidad'));
  const cantidad    = (!isNaN(cantidadRaw) && cantidadRaw > 0) ? cantidadRaw : 1;
  const descuento   = parseFloat(val('venta-descuento')) || 0;
  const tipo        = val('venta-tipo');
  const diferencia  = tipo === 'cambio' ? (parseFloat(val('venta-diferencia')) || 0) : 0;
  const subtotal    = (precio * cantidad) + diferencia;
  const total       = Math.max(0, subtotal - descuento);

  // Solo omitir el cálculo si el campo precio está literalmente vacío (usuario no lo llenó aún)
  const precioInput = document.getElementById('venta-precio');
  if (!precioInput?.value.trim() && !val('venta-id')) return;

  const descuentoInput = document.getElementById('venta-descuento');
  if (descuento < 0) {
    descuentoInput.style.borderColor = 'var(--rojo)';
    descuentoInput.title = 'El descuento no puede ser negativo';
  } else if (descuento > subtotal && subtotal > 0) {
    descuentoInput.style.borderColor = 'var(--rojo)';
    descuentoInput.title = 'El descuento supera el precio del producto';
  } else {
    descuentoInput.style.borderColor = '';
    descuentoInput.title = '';
  }

  document.getElementById('venta-total').value = formatMoney(total);
  calcularRestante();
}

function calcularRestante() {
  const totalStr = val('venta-total');
  if (!totalStr || totalStr.trim() === '') {
    document.getElementById('venta-restante').value = '';
    return;
  }
  const total    = parseMoney(totalStr);
  const anticipo = parseFloat(val('venta-anticipo')) || 0;
  const ventaId  = val('venta-id');
  const inputAnticipo = document.getElementById('venta-anticipo');

  // Solo consultar pagos reales si es edición con ID válido
  const yaPagado = (ventaId && ventaId.trim() !== '') ? calcularPagado(ventaId) : 0;
  const baseCalculo = Math.max(anticipo, yaPagado);

  // Validación visual
  if (anticipo > total && total > 0) {
    inputAnticipo.style.borderColor = 'var(--rojo)';
    inputAnticipo.title = 'El anticipo no puede ser mayor al total';
  } else if (ventaId && anticipo < yaPagado && yaPagado > 0) {
    // Advertir si el anticipo editado es menor a lo ya cobrado
    inputAnticipo.style.borderColor = 'var(--amarillo)';
    inputAnticipo.title = `Ya se registraron pagos por ${formatMoney(yaPagado)}`;
  } else {
    inputAnticipo.style.borderColor = '';
    inputAnticipo.title = '';
  }

  const exceso = baseCalculo > total && total > 0;
const restante = Math.max(0, Math.round((total - baseCalculo) * 100) / 100);
const restanteInput = document.getElementById('venta-restante');
restanteInput.value = exceso ? `⚠️ Exceso: ${formatMoney(baseCalculo - total)}` : formatMoney(restante);
restanteInput.style.color = exceso ? 'var(--rojo)' : '';
}
function handleTipoVenta() {
  const tipo = val('venta-tipo');
  const extra = document.getElementById('cambio-extra');
  if (tipo === 'cambio') extra.classList.remove('hidden');
  else extra.classList.add('hidden');
  calcularTotal();
}

let _ordenVentas = { campo: 'fecha', dir: 'desc' };

function renderVentas(lista = STATE.ventas) {
  const tbody = document.getElementById('ventas-body');
  if (!tbody) return;
  if (!lista.length) {
    const esFiltrando = val('search-ventas').trim() !== '';
    tbody.innerHTML = `<tr><td colspan="9" class="empty-row">
      ${esFiltrando ? 'Sin resultados para esa búsqueda' : 'No hay ventas registradas'}
    </td></tr>`;
    renderPaginacion(lista, 'ventas', 'cambiarPaginaVentas');
    // Resetear indicadores de orden en headers
    document.querySelectorAll('#section-ventas .sort-th').forEach(th => {
      th.querySelector('.sort-icon').textContent = '↕';
      th.classList.remove('sort-asc','sort-desc');
    });
    return;
  }

  // Aplicar orden
  const listaOrdenada = [...lista].sort((a, b) => {
    if (_ordenVentas.campo === 'fecha') {
      const fa = String(a.fecha || '0000-00-00');
      const fb = String(b.fecha || '0000-00-00');
      return _ordenVentas.dir === 'desc' ? fb.localeCompare(fa) : fa.localeCompare(fb);
    }
    return 0;
  });

  const mapaP = {};
  STATE.pagos.forEach(p => {
    const key = String(p.ventaId || '').trim();
    mapaP[key] = (mapaP[key] || 0) + parseFloat(p.monto || 0);
  });
  const paginados = paginar(listaOrdenada, 'ventas');
  tbody.innerHTML = paginados.map(v => {
    const cliente = STATE.clientes.find(c => String(c.id) === String(v.clienteId));
    const pagado  = mapaP[String(v.id).trim()] || 0;
    const total   = parseFloat(v.totalFinal || 0);
    const restante= Math.max(0, total - pagado);
    const estado  = getEstadoPago(total, pagado);
    return `
    <tr>
        <td data-label="Cliente"><strong>${esc(cliente?.nombre || v.clienteNombre || '—')}</strong></td>
        <td data-label="Tipo Lente">${esc(v.tipoLente || '—')}</td>
        <td data-label="Tipo Venta"><span class="badge tipo-${v.tipo || 'normal'}">${capitalize(v.tipo || 'normal')}</span></td>
        <td data-label="Total" class="mono">${formatMoney(v.totalFinal)}</td>
        <td data-label="Pagado" class="mono text-green">${formatMoney(pagado)}</td>
        <td data-label="Restante" class="mono ${restante > 0 ? 'text-red' : 'text-green'}">${formatMoney(restante)}</td>
        <td data-label="Fecha" class="mono">${esc(v.fecha || '—')}</td>
        <td data-label="Estado">${estadoBadge(estado)}</td>
        <td>
          <div class="action-btns">
            <button class="btn-action pay"    onclick="abrirPagoVenta('${v.id}')"               title="Registrar pago"><i data-feather="dollar-sign"></i></button>
            <button class="btn-action print"  onclick="imprimirTicket('${v.id}')"               title="Imprimir ticket"><i data-feather="printer"></i></button>
            <button class="btn-action email"  onclick="enviarTicketEmail('${v.id}')"            title="Enviar ticket por correo"><i data-feather="mail"></i></button>
            <button class="btn-action edit"   onclick="editarVenta('${v.id}')"                  title="Editar"><i data-feather="edit-2"></i></button>
            <button class="btn-action delete" onclick="confirmarEliminar('venta','${v.id}','')" title="Eliminar"><i data-feather="trash-2"></i></button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // Actualizar indicador visual en el th de Fecha
  document.querySelectorAll('#section-ventas .sort-th').forEach(th => {
    const icon = th.querySelector('.sort-icon');
    if (th.dataset.col === 'fecha') {
      icon.textContent = _ordenVentas.dir === 'desc' ? '↓' : '↑';
      th.classList.toggle('sort-asc',  _ordenVentas.dir === 'asc');
      th.classList.toggle('sort-desc', _ordenVentas.dir === 'desc');
    } else {
      if (icon) icon.textContent = '↕';
      th.classList.remove('sort-asc','sort-desc');
    }
  });

  renderPaginacion(listaOrdenada, 'ventas', 'cambiarPaginaVentas');
  feather.replace();
}

function toggleOrdenVentas(campo) {
  if (_ordenVentas.campo === campo) {
    _ordenVentas.dir = _ordenVentas.dir === 'desc' ? 'asc' : 'desc';
  } else {
    _ordenVentas.campo = campo;
    _ordenVentas.dir = 'desc';
  }
  STATE.paginacion.ventas.pagina = 1;
  renderVentas(_filtrarVentasLista());
}

let _periodoVentas = 'todo';

function cambiarPeriodoVentas(periodo, btn) {
  _periodoVentas = periodo;
  // Limpiar rango personalizado
  const desde = document.getElementById('ventas-fecha-desde');
  const hasta  = document.getElementById('ventas-fecha-hasta');
  if (desde) desde.value = '';
  if (hasta)  hasta.value = '';
  document.querySelectorAll('.ventas-periodo-tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  STATE.paginacion.ventas.pagina = 1;
  filterVentas();
}

function filtrarVentasRango() {
  const desde = document.getElementById('ventas-fecha-desde')?.value;
  const hasta  = document.getElementById('ventas-fecha-hasta')?.value;
  // Si ambas vacías, volver a modo "Todas"
  if (!desde && !hasta) {
    if (_periodoVentas === 'rango') limpiarFiltroVentasFecha();
    return;
  }
  if (desde && hasta && desde > hasta) {
    showToast('La fecha inicial no puede ser mayor a la final', 'warning');
    return;
  }
  _periodoVentas = 'rango';
  document.querySelectorAll('.ventas-periodo-tab').forEach(t => t.classList.remove('active'));
  STATE.paginacion.ventas.pagina = 1;
  filterVentas();
}

function limpiarFiltroVentasFecha() {
  const desde = document.getElementById('ventas-fecha-desde');
  const hasta  = document.getElementById('ventas-fecha-hasta');
  if (desde) desde.value = '';
  if (hasta)  hasta.value = '';
  _periodoVentas = 'todo';
  const primerTab = document.querySelector('.ventas-periodo-tab');
  if (primerTab) primerTab.classList.add('active');
  document.querySelectorAll('.ventas-periodo-tab').forEach((t, i) => t.classList.toggle('active', i === 0));
  STATE.paginacion.ventas.pagina = 1;
  filterVentas();
}
function _filtrarVentasLista() {
  const q        = val('search-ventas').toLowerCase();
  const tipo     = val('filter-tipo-venta');
  const empleado = val('filter-empleado-ventas');

  const hoy = new Date();
  hoy.setHours(23, 59, 59, 999);
  let desde = null, hasta = null;

  if (_periodoVentas === 'semana') {
    desde = new Date(hoy);
    desde.setDate(hoy.getDate() - 6);
    desde.setHours(0, 0, 0, 0);
    hasta = new Date(hoy);
  } else if (_periodoVentas === 'mes') {
    desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    hasta = new Date(hoy);
  } else if (_periodoVentas === 'año') {
    desde = new Date(hoy.getFullYear(), 0, 1);
    hasta = new Date(hoy);
  } else if (_periodoVentas === 'rango') {
    const desdeStr = document.getElementById('ventas-fecha-desde')?.value;
    const hastaStr = document.getElementById('ventas-fecha-hasta')?.value;
    if (desdeStr) { desde = new Date(desdeStr + 'T00:00:00'); }
    if (hastaStr) { hasta = new Date(hastaStr + 'T23:59:59'); }
  }

  return STATE.ventas.filter(v => {
    const c = STATE.clientes.find(x => x.id == v.clienteId);
    const matchQ       = (!q || c?.nombre?.toLowerCase().includes(q) || v.tipoLente?.toLowerCase().includes(q));
    const matchTipo    = (!tipo || v.tipo === tipo);
    const matchEmp     = (!empleado || v.registradoPor === empleado);
    let matchFecha     = true;
    if (desde || hasta) {
      if (!v.fecha) { matchFecha = false; }
      else {
        const fv = new Date(v.fecha + 'T12:00:00');
        if (desde && fv < desde) matchFecha = false;
        if (hasta && fv > hasta) matchFecha = false;
      }
    }
    return matchQ && matchTipo && matchEmp && matchFecha;
  });
}
function filterVentas() {
  STATE.paginacion.ventas.pagina = 1;
  renderVentas(_filtrarVentasLista());
}

async function saveVenta() {
  const btnGuardarVenta = document.querySelector('#modal-venta .btn-primary');
  if (btnGuardarVenta?.disabled) return;

  const clienteId = val('venta-cliente');
  if (!clienteId) { showToast('Selecciona un cliente', 'warning'); return; }
  if (!val('venta-lente').trim()) { showToast('Ingresa el tipo de lente', 'warning'); return; }
  const cliente = STATE.clientes.find(c => c.id == clienteId);
  if (!cliente) {
    showToast('El cliente seleccionado ya no existe. Recarga la página.', 'error');
    return;
  }
const precio   = parseFloat(val('venta-precio'))    || 0;
  const desc     = Math.max(0, parseFloat(val('venta-descuento')) || 0);
  const anticipo = parseFloat(val('venta-anticipo'))  || 0;
  const tipo     = val('venta-tipo');

  const cantidad   = parseInt(val('venta-cantidad')) || 1;
  const diferencia = tipo === 'cambio' ? (parseFloat(val('venta-diferencia')) || 0) : 0;
  const totalConDif = Math.max(0, (precio * cantidad) - desc + diferencia);

  // Validar precio ingresado
  const precioInputVal = document.getElementById('venta-precio')?.value?.trim();
  if (!precioInputVal || precioInputVal === '' || precioInputVal === '0') {
    if (tipo !== 'garantia') {
      showToast('Ingresa el precio del producto', 'warning');
      return;
    }
    // Garantía con precio 0: avisar explícitamente y confirmar
    if (tipo === 'garantia' && (precioInputVal === '' || precioInputVal === null)) {
      showToast('Garantía registrada sin costo para el cliente', 'info', 4000);
    }
  }

  if (tipo !== 'garantia' && totalConDif === 0) {
    showToast('El total no puede ser $0.00 en una venta normal o cambio', 'warning');
    return;
  }
  if (desc < 0) {
    showToast('El descuento no puede ser negativo', 'warning');
    return;
  }
  if (desc > precio * cantidad && precio * cantidad > 0) {
    showToast('El descuento no puede superar el precio total', 'warning');
    return;
  }
  if (tipo === 'garantia' && anticipo > 0 && totalConDif === 0) {
    showToast('Anticipo ignorado: esta garantía no tiene costo', 'warning');
    document.getElementById('venta-anticipo').value = '0';
    calcularRestante();
  }
  if (anticipo > totalConDif && totalConDif > 0) {
    showToast('El anticipo no puede ser mayor al total', 'warning');
    return;
  }

  const productoId   = val('venta-producto');
  const anticipoFinal = (tipo === 'garantia' && totalConDif === 0) ? 0 : (parseFloat(val('venta-anticipo')) || 0);
const data = {
    clienteId,
    clienteNombre: cliente?.nombre || '',
    registradoPor: STATE.usuario?.nombre || '',
    tipo,
    tipoLente:  val('venta-lente'),
    productoId,
    cantidad,
    precio,
    descuento:  desc,
    totalFinal: totalConDif,
    anticipo:   anticipoFinal,
    metodo:     val('venta-metodo'),
    fecha:      val('venta-fecha') || fechaLocal(new Date()),
    diferencia,
    cambioDesc: tipo === 'cambio' ? val('venta-cambio-desc') : '',
  };

  // Validar stock suficiente si hay producto seleccionado
  if (productoId && tipo !== 'garantia') {
    const prod = STATE.inventario.find(p => String(p.id) === String(productoId));
    const ventaIdActual = val('venta-id');
    const ventaAnterior = ventaIdActual
      ? STATE.ventas.find(v => String(v.id) === String(ventaIdActual))
      : null;
// Solo sumar la cantidad anterior si ESA venta sí consumió stock (no era garantía)
const anteriorConsumoStock = ventaAnterior &&
  String(ventaAnterior.productoId).trim() === String(productoId).trim() &&
  ventaAnterior.tipo !== 'garantia';
const stockEfectivo = anteriorConsumoStock
  ? parseInt(prod?.stock || 0) + parseInt(ventaAnterior.cantidad || 1)
  : parseInt(prod?.stock || 0);
    if (prod && stockEfectivo < cantidad) {
      showToast(`Stock insuficiente: solo hay ${prod.stock} unidad(es) disponibles de "${prod.nombre}"`, 'warning', 5000);
      return;
    }
  }

const id = val('venta-id');
  if (btnGuardarVenta) { btnGuardarVenta.disabled = true; btnGuardarVenta.textContent = 'Guardando...'; }
  showLoading(id ? 'Actualizando venta...' : 'Guardando venta...');
try {
if (id) {
      data.id = id;
      const idx = STATE.ventas.findIndex(v => String(v.id) === String(id));
const ventaSnap = idx > -1 ? { ...STATE.ventas[idx] } : null;

const yaRegistrado = calcularPagado(id);
const nuevoAnticipo = parseFloat(data.anticipo) || 0;
if (nuevoAnticipo < yaRegistrado) {
  data.anticipo = yaRegistrado;
  showToast(
    `Anticipo ajustado a ${formatMoney(yaRegistrado)} — los pagos previos no se modifican.`,
    'warning', 5000
  );
}

await apiPost(CONFIG.HOJAS.VENTAS, 'update', data);
if (idx > -1) STATE.ventas[idx] = { ...STATE.ventas[idx], ...data };

      // ── Ajustar stock considerando cambio de tipo, producto y cantidad ──
      {
        const prodAnteriorId   = String(ventaSnap?.productoId || '').trim();
        const cantAnterior     = parseInt(ventaSnap?.cantidad) || 1;
        const tipoAnterior     = ventaSnap?.tipo || 'normal';
        const prodNuevoId      = String(productoId || '').trim();
        const cantNueva        = cantidad;
        const anteriorDescontaba = tipoAnterior !== 'garantia';
        const nuevoDescuenta     = tipo !== 'garantia';

        // 1. Restaurar stock del anterior si esa venta sí consumía stock
        if (prodAnteriorId && anteriorDescontaba) {
          if (prodAnteriorId !== prodNuevoId || !nuevoDescuenta) {
            // Cambió producto, o se editó a garantía → devolver lo que consumió
            const idxAnt = STATE.inventario.findIndex(p => String(p.id) === prodAnteriorId);
            if (idxAnt > -1) {
              const stockRestaurado = parseInt(STATE.inventario[idxAnt].stock || 0) + cantAnterior;
              await apiPost(CONFIG.HOJAS.INVENTARIO, 'update', { ...STATE.inventario[idxAnt], stock: stockRestaurado });
              STATE.inventario[idxAnt].stock = stockRestaurado;
            }
          }
        }

        // 2. Descontar del nuevo producto solo si el tipo sí consume stock
        if (prodNuevoId && nuevoDescuenta) {
          const idxNuevo = STATE.inventario.findIndex(p => String(p.id) === prodNuevoId);
          if (idxNuevo > -1) {
            const prod = STATE.inventario[idxNuevo];
            let stockBase = parseInt(prod.stock || 0);
            if (prodAnteriorId === prodNuevoId && anteriorDescontaba) {
              // Mismo producto y ambas versiones consumen stock: solo ajustar la diferencia
              stockBase = stockBase + cantAnterior - cantNueva;
            } else {
              // Producto diferente o anterior era garantía: descontar la nueva cantidad completa
              stockBase = stockBase - cantNueva;
            }
            const nuevoStock = Math.max(0, stockBase);
            await apiPost(CONFIG.HOJAS.INVENTARIO, 'update', { ...prod, stock: nuevoStock });
            STATE.inventario[idxNuevo].stock = nuevoStock;
            filterInventario();
            if (nuevoStock === 0) showToast(`⚠️ ${prod.nombre} se quedó sin stock`, 'warning', 5000);
            else if (nuevoStock <= parseInt(prod.stockMin || 3)) showToast(`⚠️ Stock bajo: ${prod.nombre} (${nuevoStock})`, 'warning', 4000);
          }
        }
      }

      const accion = tipo === 'cambio' ? 'Cambio' : tipo === 'garantia' ? 'Garantía' : 'Editar';
      await registrarAuditoria(accion, `${STATE.usuario.nombre} editó venta de ${cliente?.nombre}`);
      showToast('Venta actualizada', 'success');
    } else {
    const res = await apiPost(CONFIG.HOJAS.VENTAS, 'create', data);
// Usar siempre el ID confirmado por el servidor (coincide con el generado en cliente)
    data.id = res.id || data.id;
    STATE.ventas.push({ ...data }); 
    if (data.anticipo > 0) {
        await guardarPagoInterno({
            clienteId,
            clienteNombre: cliente?.nombre,
            ventaId: data.id,
            monto: data.anticipo,
            metodo: data.metodo,
            fecha: data.fecha,
            notas: 'Anticipo inicial',
        });
    }
// ── Bajar stock automáticamente ──
      if (productoId && tipo !== 'garantia') {
        const prodIdx = STATE.inventario.findIndex(p => String(p.id) === String(productoId));
        if (prodIdx > -1) {
          const prod = STATE.inventario[prodIdx];
          const stockActual = parseInt(prod.stock || 0);
          const nuevoStock  = Math.max(0, stockActual - cantidad);
          const prodActualizado = { ...prod, stock: nuevoStock };
          await apiPost(CONFIG.HOJAS.INVENTARIO, 'update', prodActualizado);
          STATE.inventario[prodIdx].stock = nuevoStock;
          filterInventario();
          const badgeStockEl = document.getElementById('badge-stock');
          if (badgeStockEl) {
            const alertasGlobal = STATE.inventario.filter(p => parseInt(p.stock || 0) <= parseInt(p.stockMin || 3)).length;
            badgeStockEl.textContent = alertasGlobal;
            badgeStockEl.style.display = alertasGlobal > 0 ? '' : 'none';
          }
          if (nuevoStock === 0)
            showToast(`⚠️ ${prod.nombre} se quedó sin stock`, 'warning', 5000);
          else if (nuevoStock <= parseInt(prod.stockMin || 3))
            showToast(`⚠️ Stock bajo: ${prod.nombre} (${nuevoStock} unidades)`, 'warning', 4000);
        }
      }

      const accion = tipo === 'cambio' ? 'Cambio' : tipo === 'garantia' ? 'Garantía' : 'Crear';
      await registrarAuditoria(accion, `${STATE.usuario.nombre} registró venta para ${cliente?.nombre} — ${formatMoney(totalConDif)}`);
      showToast('Venta registrada correctamente', 'success');
      if (tipo === 'cambio') {
        showToast(
          '↩️ Recuerda: el artículo devuelto NO se repuso al inventario automáticamente. Ve a Inventario → Ajustar Stock para corregirlo.',
          'warning', 8000
        );
      }
    }
    document.getElementById('venta-id').value = '';
    STATE.paginacion.ventas.pagina = 1;
    closeAllModals();
    filterVentas();
    filterPagos();
    filterAdeudosBusqueda();
    filterGarantias();
    renderDashboard();
    actualizarBadgeAdeudos();
  } catch (err) {
    console.error(err);
    showToast('Error al guardar venta', 'error');
  } finally {
    hideLoading();
    const btnGV = document.querySelector('#modal-venta .btn-primary');
    if (btnGV) { btnGV.disabled = false; btnGV.innerHTML = '<i data-feather="save"></i> Guardar Venta'; feather.replace(); }
  }
}

function editarVenta(id) {
  const v = STATE.ventas.find(x => x.id == id);
  if (!v) return;
  document.getElementById('venta-id').value = v.id;
  openModal('modal-venta');
  document.getElementById('venta-cliente').value     = v.clienteId;
  document.getElementById('venta-tipo').value        = v.tipo || 'normal';
  document.getElementById('venta-lente').value       = v.tipoLente || '';
  document.getElementById('venta-fecha').value       = v.fecha || '';
  document.getElementById('venta-precio').value      = v.precio || '';
  document.getElementById('venta-descuento').value   = v.descuento || '0';
  document.getElementById('venta-total').value       = formatMoney(v.totalFinal);
  document.getElementById('venta-metodo').value      = v.metodo    || 'efectivo';
  document.getElementById('venta-diferencia').value  = v.diferencia || '';
  document.getElementById('venta-cambio-desc').value = v.cambioDesc || '';

  // Mostrar pagos reales acumulados — solo lectura informativa
  const yaPagado = calcularPagado(v.id);
  const anticipoInput = document.getElementById('venta-anticipo');
  anticipoInput.value = yaPagado.toFixed(2);
  anticipoInput.readOnly = true;
  anticipoInput.style.background = 'var(--gris-claro)';
  anticipoInput.style.color      = 'var(--azul-medio)';
  anticipoInput.style.fontWeight = '700';
  anticipoInput.title = 'En edición este valor refleja los pagos ya registrados y no se puede modificar aquí. Usa la sección Pagos para agregar o eliminar pagos.';

  // Label informativo junto al campo
  const anticipoLabel = anticipoInput.closest('.form-group')?.querySelector('label');
  if (anticipoLabel) anticipoLabel.textContent = 'Ya Pagado (solo lectura)';

  llenarSelectProductos();
  const selectProd = document.getElementById('venta-producto');
  if (selectProd && v.productoId) {
    const existeEnSelect = Array.from(selectProd.options).some(o => o.value === String(v.productoId));
    if (!existeEnSelect) {
      const opt = document.createElement('option');
      opt.value = v.productoId;
      opt.textContent = `⚠️ Producto original (sin stock / eliminado)`;
      opt.dataset.stock  = '0';
      opt.dataset.precio = v.precio || '';
      selectProd.appendChild(opt);
    }
    selectProd.value = v.productoId;
    onProductoChange();
  }
  document.getElementById('venta-precio').value   = v.precio || '';
  const cantInput = document.getElementById('venta-cantidad');
  if (cantInput) cantInput.value = v.cantidad || 1;
  handleTipoVenta();
  document.getElementById('venta-total').value = formatMoney(v.totalFinal);
  calcularRestante();
  setHTML('modal-venta-title', 'Editar Venta');
  calcularTotal();
}

async function eliminarVenta(id) {
  showLoading('Eliminando venta...');
  const v = STATE.ventas.find(x => x.id == id);
  const pagosAsociados = STATE.pagos.filter(p => String(p.ventaId) === String(id));
  try {
    for (const p of pagosAsociados) {
      await apiPost(CONFIG.HOJAS.PAGOS, 'delete', { id: p.id });
    }
    await apiPost(CONFIG.HOJAS.VENTAS, 'delete', { id });
    // Solo mutar estado local si ambas operaciones en Sheets tuvieron éxito
    STATE.pagos  = STATE.pagos.filter(p => String(p.ventaId) !== String(id));
    STATE.ventas = STATE.ventas.filter(x => x.id != id);

    // ── Restaurar stock si la venta tenía producto vinculado ──
    if (v?.productoId && v?.tipo !== 'garantia') {
      const prodIdx = STATE.inventario.findIndex(p => String(p.id) === String(v.productoId));
      if (prodIdx > -1) {
        const prod = STATE.inventario[prodIdx];
        const stockRestaurado = parseInt(prod.stock || 0) + (parseInt(v.cantidad) || 1);
        const prodActualizado = { ...prod, stock: stockRestaurado };
        await apiPost(CONFIG.HOJAS.INVENTARIO, 'update', prodActualizado);
        STATE.inventario[prodIdx].stock = stockRestaurado;
        filterInventario();
        showToast(`Stock restaurado: ${prod.nombre} → ${stockRestaurado} unidades`, 'info', 4000);
      }
    }

    await registrarAuditoria('Eliminar', `${STATE.usuario.nombre} eliminó una venta de ${v?.clienteNombre}`);
    showToast('Venta eliminada', 'success');
    STATE.paginacion.ventas.pagina = 1;
    closeAllModals();
    filterVentas();
    filterPagos();
    filterAdeudosBusqueda();
    filterGarantias();
    renderDashboard();
    actualizarBadgeAdeudos();
  } catch { showToast('Error al eliminar venta', 'error'); }
  finally  { hideLoading(); }
}

/* ══════════════════════════════════════════════════════════════
   💳  PAGOS
══════════════════════════════════════════════════════════════ */

async function cargarPagos() {
  try {
    const res = await apiGet(CONFIG.HOJAS.PAGOS);
    STATE.pagos = res.data || [];
  } catch { STATE.pagos = []; }
}
function sanitizarTelefono(tel) {
  return String(tel || '').replace(/[\s\-().+]/g, '');
}
function calcularPagado(ventaId) {
  if (ventaId === null || ventaId === undefined || ventaId === '') return 0;
  return STATE.pagos
    .filter(p => p.ventaId && String(p.ventaId).trim() === String(ventaId).trim())
    .reduce((s, p) => s + parseFloat(p.monto || 0), 0);
}

async function guardarPagoInterno(data) {
  const res = await apiPost(CONFIG.HOJAS.PAGOS, 'create', data);
  data.id = res.id || Date.now().toString();
  STATE.pagos.push(data);
  return data;
}

async function savePago() {
  const btnPago = document.querySelector('#modal-pago .btn-primary');
  if (btnPago?.disabled) return;
  if (btnPago) btnPago.disabled = true;

  const clienteId = val('pago-cliente');
  const ventaId   = val('pago-venta') || document.getElementById('pago-venta-id').value;
  const monto     = parseFloat(val('pago-monto'));

  const rehabBtn = () => {
    if (btnPago) {
      btnPago.disabled = false;
      btnPago.innerHTML = '<i data-feather="dollar-sign"></i> Registrar Pago';
      feather.replace();
    }
  };

  if (!clienteId) { showToast('Selecciona un cliente', 'warning'); rehabBtn(); return; }
  if (!ventaId)   { showToast('Selecciona una venta',  'warning'); rehabBtn(); return; }
  if (!monto || monto <= 0) { showToast('Ingresa un monto válido', 'warning'); rehabBtn(); return; }

  const ventaParaValidar = STATE.ventas.find(v => v.id == ventaId);
  if (!ventaParaValidar) {
    showToast('La venta seleccionada no se encontró. Recarga la página.', 'error');
    rehabBtn(); return;
  }
  const totalVenta = parseFloat(ventaParaValidar.totalFinal || 0);
  const saldoActual = Math.round(Math.max(0, totalVenta - calcularPagado(ventaId)) * 100) / 100;
  if (totalVenta === 0) {
    showToast('Esta venta es una garantía sin costo, no requiere pago', 'warning');
    rehabBtn(); return;
  }
if (saldoActual === 0) {
    showToast('Esta venta ya está completamente pagada', 'warning');
    rehabBtn(); return;
}
if (Math.round(monto * 100) > Math.round(saldoActual * 100)) {
    showToast(`El pago (${formatMoney(monto)}) supera el saldo pendiente (${formatMoney(saldoActual)})`, 'warning');
    rehabBtn(); return;
}

  const cliente = STATE.clientes.find(c => c.id == clienteId);
  if (!cliente) {
    showToast('Cliente no encontrado', 'warning');
    rehabBtn(); return;
  }
  const venta = STATE.ventas.find(v => v.id == ventaId);

  const data = {
    clienteId,
    clienteNombre: cliente?.nombre || '',
    ventaId,
    monto,
    metodo: val('pago-metodo'),
    fecha: val('pago-fecha') || fechaLocal(new Date()),
    notas: val('pago-notas'),
  };

  showLoading('Registrando pago...');
  try {
    await guardarPagoInterno(data);
    await registrarAuditoria('Pago',
      `${STATE.usuario.nombre} registró pago de ${formatMoney(monto)} para ${cliente?.nombre}`);

    const totalPagado = calcularPagado(ventaId);
    const totalVentaF = parseFloat(venta?.totalFinal || 0);
    const saldoFinal  = Math.max(0, totalVentaF - totalPagado);
    const saldado     = Math.round(saldoFinal * 100) === 0 && totalVentaF > 0;

    showToast(`Pago registrado: ${formatMoney(monto)}`, 'success');
    STATE.paginacion.pagos.pagina = 1;
    STATE.paginacion.ventas.pagina = 1;
    closeAllModals();
    filterPagos();
    filterVentas();
    filterAdeudosBusqueda();
    renderDashboard();
    actualizarBadgeAdeudos();

    if (saldado) {
      if (cliente?.email) {
        sendCorreoAgradecimiento(cliente, totalVentaF)
          .then(() => showToast(`¡Cuenta saldada! Correo enviado a ${cliente.nombre.split(' ')[0]} 🎉`, 'success', 4000))
          .catch(() => showToast(`¡Cuenta de ${cliente.nombre.split(' ')[0]} saldada! (No se pudo enviar correo)`, 'warning', 4000));
      } else {
        showToast(`¡Cuenta de ${cliente.nombre.split(' ')[0]} completamente saldada! 🎉`, 'success', 4000);
      }
    }
  } catch (err) {
    console.error(err);
    showToast('Error al registrar pago', 'error');
  } finally {
    hideLoading();
    rehabBtn();
  }
}

function renderPagos(lista = STATE.pagos) {
  const tbody = document.getElementById('pagos-body');
  if (!tbody) return;
  if (!lista.length) {
    const esFiltrando = val('search-pagos').trim() !== '';
    tbody.innerHTML = `<tr><td colspan="7" class="empty-row">
      ${esFiltrando ? 'Sin resultados para esa búsqueda' : 'No hay pagos registrados'}
    </td></tr>`;
    renderPaginacion([], 'pagos', 'cambiarPaginaPagos');
    return;
  }
  const listaOrdenada = [...lista].sort((a, b) => {
    const fa = String(a.fecha || '0000-00-00');
    const fb = String(b.fecha || '0000-00-00');
    return fb.localeCompare(fa);
  });
  const paginados = paginar(listaOrdenada, 'pagos');
  tbody.innerHTML = paginados.map(p => {
    const cliente = STATE.clientes.find(c => c.id == p.clienteId);
    return `
      <tr>
        <td data-label="Cliente"><strong>${esc(cliente?.nombre || p.clienteNombre || '—')}</strong></td>
        <td data-label="Monto" class="mono text-green"><strong>${formatMoney(p.monto)}</strong></td>
        <td data-label="Método">${capitalize(esc(p.metodo || '—'))}</td>
        <td data-label="Fecha" class="mono">${p.fecha ? new Date(p.fecha + 'T12:00:00').toLocaleDateString('es-MX', {day:'2-digit', month:'short', year:'numeric'}) : '—'}</td>
        <td data-label="Venta Ref." class="mono">${esc(p.ventaId || '—')}</td>
        <td data-label="Notas">${esc(p.notas || '—')}</td>
        <td>
          <div class="action-btns">
            <button class="btn-action delete" onclick="confirmarEliminar('pago','${p.id}','')" title="Eliminar"><i data-feather="trash-2"></i></button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
  renderPaginacion(listaOrdenada, 'pagos', 'cambiarPaginaPagos');
  feather.replace();
}

function filterPagos() {
  STATE.paginacion.pagos.pagina = 1;
  const q      = val('search-pagos').toLowerCase();
  const metodo = val('filter-metodo-pago');
  const lista  = STATE.pagos.filter(p => {
    const c = STATE.clientes.find(x => x.id == p.clienteId);
    return (!q || c?.nombre?.toLowerCase().includes(q) || p.clienteNombre?.toLowerCase().includes(q))
        && (!metodo || p.metodo === metodo);
  });
  renderPagos(lista);
}

async function eliminarPago(id) {
  showLoading('Eliminando pago...');
  try {
    const pago = STATE.pagos.find(p => String(p.id) === String(id));
    await apiPost(CONFIG.HOJAS.PAGOS, 'delete', { id });
    STATE.pagos = STATE.pagos.filter(p => p.id != id);

    // Si el pago eliminado estaba asociado a una venta, recalcular y sincronizar
    // el campo `anticipo` de esa venta en Sheets para mantener consistencia
    if (pago?.ventaId) {
      const venta = STATE.ventas.find(v => String(v.id) === String(pago.ventaId));
      if (venta) {
        const nuevoPagado = calcularPagado(venta.id); // ya excluye el pago eliminado
        const ventaActualizada = { ...venta, anticipo: nuevoPagado };
        await apiPost(CONFIG.HOJAS.VENTAS, 'update', ventaActualizada);
        const idx = STATE.ventas.findIndex(v => String(v.id) === String(venta.id));
        if (idx > -1) STATE.ventas[idx].anticipo = nuevoPagado;
      }
    }

    await registrarAuditoria('Eliminar', `${STATE.usuario.nombre} eliminó un registro de pago`);
    showToast('Pago eliminado', 'success');
    STATE.paginacion.pagos.pagina  = 1;
    STATE.paginacion.ventas.pagina = 1;
    closeAllModals();
    filterPagos();
    filterVentas();
    filterAdeudosBusqueda();
    renderDashboard();
    actualizarBadgeAdeudos();
  } catch { showToast('Error al eliminar pago', 'error'); }
  finally  { hideLoading(); }
}

/* ── Abrir modal de pago desde botones de acceso rápido ── */
function abrirPagoCliente(clienteId) {
  const ventasPendientes = STATE.ventas.filter(v => {
    if (String(v.clienteId) !== String(clienteId)) return false;
    const saldo = parseFloat(v.totalFinal || 0) - calcularPagado(v.id);
    return saldo > 0;
  });
  if (!ventasPendientes.length) {
    showToast('Este cliente no tiene ventas con saldo pendiente', 'info');
    return;
  }
openModal('modal-pago');
const sel = document.getElementById('pago-cliente');
if (sel) {
  sel.value = clienteId;
  loadVentasDeCliente();
}
}

function abrirPagoVenta(ventaId) {
  const venta = STATE.ventas.find(v => v.id == ventaId);
  if (!venta) return;
  const totalVenta = parseFloat(venta.totalFinal || 0);
  const saldo = Math.max(0, totalVenta - calcularPagado(ventaId));
  if (totalVenta === 0) {
    showToast('Esta venta es una garantía sin costo, no requiere pago', 'info');
    return;
  }
  if (saldo === 0) {
    showToast('Esta venta ya está completamente pagada ✓', 'info');
    return;
  }
openModal('modal-pago');
// openModal ya terminó de limpiar, ahora podemos setear directamente
document.getElementById('pago-cliente').value  = venta.clienteId;
document.getElementById('pago-venta-id').value = ventaId;
loadVentasDeCliente(ventaId);
}

function loadVentasDeCliente(preseleccionarVentaId = null) {
  const clienteId = val('pago-cliente');
  const select    = document.getElementById('pago-venta');

  // Limpiar venta pre-seleccionada al cambiar cliente manualmente
  if (!preseleccionarVentaId) {
    document.getElementById('pago-venta-id').value = '';
    document.getElementById('pago-resumen').classList.add('hidden');
    document.getElementById('pago-monto').value = '';
    document.getElementById('pago-notas').value = '';
  }

  // Solo ventas con saldo pendiente
  const ventasPendientes = STATE.ventas
    .filter(v => v.clienteId == clienteId)
    .map(v => ({ ...v, _pagado: calcularPagado(v.id), _saldo: parseFloat(v.totalFinal || 0) - calcularPagado(v.id) }))
    .filter(v => v._saldo > 0);

  const ventasCompletas = STATE.ventas
    .filter(v => v.clienteId == clienteId)
    .map(v => ({ ...v, _pagado: calcularPagado(v.id), _saldo: parseFloat(v.totalFinal || 0) - calcularPagado(v.id) }))
    .filter(v => v._saldo <= 0);

  let optsHTML = '<option value="">— Seleccionar venta —</option>';

  if (ventasPendientes.length) {
    optsHTML += '<optgroup label="⚠️ Con saldo pendiente">';
    optsHTML += ventasPendientes.map(v =>
      `<option value="${v.id}">
        ${esc(v.tipoLente || 'Venta')} · ${formatMoney(v.totalFinal)}
        — Debe: ${formatMoney(v._saldo)}
        · Pagado: ${formatMoney(v._pagado)}
      </option>`
    ).join('');
    optsHTML += '</optgroup>';
  }

  if (ventasCompletas.length) {
    optsHTML += '<optgroup label="✅ Ya pagadas (no seleccionables)">';
    optsHTML += ventasCompletas.map(v =>
      `<option value="${v.id}" disabled style="color:#aaa;">
        ${esc(v.tipoLente || 'Venta')} · ${formatMoney(v.totalFinal)} — Pagada ✓
      </option>`
    ).join('');
    optsHTML += '</optgroup>';
  }

if (!ventasPendientes.length && !ventasCompletas.length) {
  optsHTML += '<option disabled>— Este cliente no tiene ventas registradas —</option>';
} else if (!ventasPendientes.length) {
  optsHTML += '<option disabled>— Todas las ventas de este cliente están pagadas ✓ —</option>';
}

  select.innerHTML = optsHTML;

  // Preseleccionar si viene de "abrirPagoVenta"
  if (preseleccionarVentaId) {
    select.value = preseleccionarVentaId;
    loadSaldoVenta();
  } else if (ventasPendientes.length === 1) {
    select.value = ventasPendientes[0].id;
    loadSaldoVenta();
  } else {
    document.getElementById('pago-resumen').classList.add('hidden');
  }
}

function loadSaldoVenta() {
  const ventaId = val('pago-venta') || document.getElementById('pago-venta-id').value;
  if (!ventaId) return;
  const venta = STATE.ventas.find(v => v.id == ventaId);
  if (!venta) return;

  const totalPagado = calcularPagado(ventaId);
  const saldo = Math.max(0, parseFloat(venta.totalFinal || 0) - totalPagado);

  setHTML('r-total',  formatMoney(venta.totalFinal));
  setHTML('r-pagado', formatMoney(totalPagado));
  setHTML('r-saldo',  formatMoney(saldo));
  document.getElementById('pago-resumen').classList.remove('hidden');
  document.getElementById('pago-monto').value = saldo > 0 ? saldo.toFixed(2) : '';
}

/* ══════════════════════════════════════════════════════════════
   📊  ADEUDOS
══════════════════════════════════════════════════════════════ */

function calcularEstadoVenta(v) {
  const total  = parseFloat(v.totalFinal || 0);
  const pagado = calcularPagado(v.id);
  return getEstadoPago(total, pagado);
}

function getEstadoPago(total, pagado) {
  if (total === 0 || total == null) return 'pagado';
  if (pagado <= 0)                  return 'deuda';
  if (Math.round(pagado * 100) >= Math.round(total * 100)) return 'pagado';
  return 'parcial';
}
function estadoBadge(estado) {
  const cfg = {
    pagado:  { class: 'badge-green',  dot: 'dot-green',  label: 'Pagado'  },
    parcial: { class: 'badge-yellow', dot: 'dot-yellow', label: 'Parcial' },
    deuda:   { class: 'badge-red',    dot: 'dot-red',    label: 'Deuda'   },
  };
  const c = cfg[estado] || cfg.deuda;
  return `<span class="badge ${c.class}"><span class="dot ${c.dot}"></span>${c.label}</span>`;
}

function filterAdeudos(filtro, btn) {
  STATE._filtroAdeudos = filtro;
  document.querySelectorAll('#filter-adeudos .filter-tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  // Limpiar búsqueda al cambiar filtro de tab para evitar resultados vacíos confusos
  const searchEl = document.getElementById('search-adeudos');
  if (searchEl) searchEl.value = '';
  filterAdeudosBusqueda();
}

function actualizarBadgeAdeudos() {
  const conDeuda = STATE.ventas.filter(v => {
    const total = parseFloat(v.totalFinal || 0);
    if (total === 0) return false; // excluir garantías sin costo
    const pagado = calcularPagado(v.id);
    return pagado < total;
  }).length;
  const badge = document.getElementById('badge-adeudos');
  if (badge) badge.textContent = conDeuda;
}

/* ══════════════════════════════════════════════════════════════
   🔄  GARANTÍAS Y CAMBIOS
══════════════════════════════════════════════════════════════ */

function renderGarantias(lista = null) {
  const ventas = lista
    ? lista
    : STATE.ventas.filter(v => v.tipo === 'garantia' || v.tipo === 'cambio');
  const tbody = document.getElementById('garantias-body');
  if (!tbody) return;
  if (!ventas.length) {
    const q = val('search-garantias').trim();
    const tipo = val('filter-tipo-garantia');
    const hayFiltro = q || tipo;
    tbody.innerHTML = `<tr><td colspan="6" class="empty-row">${
      hayFiltro ? 'Sin resultados para esa búsqueda' : 'Sin garantías ni cambios registrados'
    }</td></tr>`;
    return;
  }
  tbody.innerHTML = ventas.map(v => {
    const cliente = STATE.clientes.find(c => String(c.id) === String(v.clienteId));
    return `
      <tr>
        <td data-label="Cliente"><strong>${esc(cliente?.nombre || v.clienteNombre || '—')}</strong></td>
        <td data-label="Tipo"><span class="badge tipo-${v.tipo}">${capitalize(v.tipo)}</span></td>
        <td data-label="Descripción">${esc(v.cambioDesc || v.tipoLente || '—')}</td>
        <td data-label="Diferencia" class="mono">${v.diferencia ? formatMoney(v.diferencia) : '—'}</td>
        <td data-label="Fecha" class="mono">${esc(v.fecha || '—')}</td>
        <td data-label="Registrado por">${esc(v.registradoPor || '—')}</td>
      </tr>
    `;
  }).join('');
  feather.replace();
}

function filterGarantias() {
  const q    = val('search-garantias').toLowerCase();
  const tipo = val('filter-tipo-garantia');
  const lista = STATE.ventas.filter(v => {
    const c = STATE.clientes.find(x => x.id == v.clienteId);
    return (v.tipo === 'garantia' || v.tipo === 'cambio')
      && (!q || c?.nombre?.toLowerCase().includes(q))
      && (!tipo || v.tipo === tipo);
  });
  renderGarantias(lista);
}

/* ══════════════════════════════════════════════════════════════
   📊  DASHBOARD
══════════════════════════════════════════════════════════════ */

function renderDashboard() {
  calcularKpisPeriodo(STATE._periodoKpi || 'mes', STATE._periodoKpiMes || null);
  actualizarLabelReporte();

  // Tabla de adeudos en dashboard
const empDash = STATE._filtroEmpleadoDash;
  const conSaldo = STATE.ventas
    .filter(v => !empDash || v.registradoPor === empDash)
    .map(v => ({ ...v, _saldo: parseFloat(v.totalFinal || 0) - calcularPagado(v.id), _c: STATE.clientes.find(c => String(c.id) === String(v.clienteId)) }))
    .filter(v => v._saldo > 0)
    .sort((a, b) => b._saldo - a._saldo)
    .slice(0, 8);

  const dashBody = document.getElementById('dash-adeudos-body');
  if (dashBody) {
if (!conSaldo.length) {
      dashBody.innerHTML = '<tr><td colspan="4" class="empty-row">¡Sin adeudos pendientes! 🎉</td></tr>';
    } else {
      dashBody.innerHTML = conSaldo.map(v => `
        <tr>
          <td data-label="Cliente"><strong>${esc(v._c?.nombre || v.clienteNombre || '—')}</strong></td>
          <td data-label="Teléfono" class="mono">${esc(v._c?.telefono || '—')}</td>
          <td data-label="Adeudo" class="mono text-red fw-bold">${formatMoney(v._saldo)}</td>
          <td data-label="Estado">${estadoBadge(calcularEstadoVenta(v))}</td>
        </tr>
      `).join('');
    }
  }

  // Actividad reciente
  const actList = document.getElementById('dash-activity-list');
  if (actList) {
    const recent = STATE.auditoria.slice(0, 10);
    if (!recent.length) {
      actList.innerHTML = '<div class="empty-row">Sin actividad reciente</div>';
    } else {
      actList.innerHTML = recent.map(a => `
        <div class="activity-item">
          <div class="activity-dot"></div>
          <div>
            <div class="activity-text">${esc(a.descripcion)}</div>
            <div class="activity-time">${esc(a.fecha)} ${formatHora(a.hora, a.timestamp)}</div>
          </div>
        </div>
      `).join('');
    }
  }

  renderGraficas();
  if (STATE.clientes.length > 0) {
    verificarRevisionesAnuales();
  }
  feather.replace();
}

function calcularKpisPeriodo(periodo, mesCustom) {
  const hoy = new Date();
  let desde, hasta;

  if (mesCustom) {
    const [y, m] = mesCustom.split('-').map(Number);
    desde = new Date(y, m - 1, 1);
    hasta = new Date(y, m, 0, 23, 59, 59, 999);
  } else if (periodo === 'semana') {
    desde = new Date(hoy);
    desde.setDate(hoy.getDate() - 6);
    desde.setHours(0, 0, 0, 0);
    hasta = new Date(hoy);
    hasta.setHours(23, 59, 59, 999);
  } else if (periodo === 'mes') {
    desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    hasta = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0, 23, 59, 59, 999);
  } else if (periodo === 'año') {
    desde = new Date(hoy.getFullYear(), 0, 1);
    hasta = new Date(hoy.getFullYear(), 11, 31, 23, 59, 59, 999);
  } else {
    // 'total' — sin filtro de fecha
    desde = null;
    hasta = null;
  }

  const empDash = STATE._filtroEmpleadoDash;
  const ventasFiltradas = STATE.ventas.filter(v => {
    if (empDash && v.registradoPor !== empDash) return false;
    if (!desde) return true;
    if (!v.fecha) return false;
    const fv = new Date(v.fecha + 'T12:00:00');
    return fv >= desde && fv <= hasta;
  });

  const idsConVenta = new Set(ventasFiltradas.map(v => String(v.clienteId)));
  const totalVendido = ventasFiltradas.reduce((s, v) => s + parseFloat(v.totalFinal || 0), 0);
  const pagadas = ventasFiltradas.filter(v => calcularEstadoVenta(v) === 'pagado').length;
  const totalPendiente = ventasFiltradas.reduce((s, v) => {
    const pagado = calcularPagado(v.id);
    return s + Math.max(0, parseFloat(v.totalFinal || 0) - pagado);
  }, 0);

  let labelPeriodo = '';
  if (mesCustom) {
    const [y, m] = mesCustom.split('-').map(Number);
    const d = new Date(y, m - 1, 1);
    labelPeriodo = d.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
  } else if (periodo === 'semana') labelPeriodo = 'Esta semana';
  else if (periodo === 'mes')     labelPeriodo = 'Este mes';
  else if (periodo === 'año')     labelPeriodo = String(hoy.getFullYear());
  else                            labelPeriodo = 'Histórico';

  if (empDash) labelPeriodo += ' · ' + empDash;

  setHTML('kpi-clientes', idsConVenta.size);
  setHTML('kpi-ventas', formatMoney(totalVendido));
  setHTML('kpi-pagados', pagadas);
  setHTML('kpi-pendiente', formatMoney(totalPendiente));

  ['kpi-clientes','kpi-ventas','kpi-pagados','kpi-pendiente'].forEach(id => {
    const card = document.getElementById(id)?.closest('.kpi-card');
    if (!card) return;
    const labelEl = card.querySelector('.kpi-label');
    if (!labelEl) return;
    const base = {
      'kpi-clientes': 'Clientes con venta',
      'kpi-ventas':   'Total Vendido',
      'kpi-pagados':  'Cuentas Pagadas',
      'kpi-pendiente':'Total Pendiente'
    };
    labelEl.textContent = base[id] + (labelPeriodo ? ' · ' + labelPeriodo : '');
  });
}

function cambiarPeriodoKpi(periodo, btn) {
  STATE._periodoKpi = periodo;
  STATE._periodoKpiMes = null;
  const mesInput = document.getElementById('kpi-mes-custom');
  if (mesInput) mesInput.value = '';
  document.querySelectorAll('.kpi-periodo-tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  calcularKpisPeriodo(periodo, null);
  actualizarLabelReporte();
}

function cambiarPeriodoKpiMes(val) {
  if (!val) return;
  STATE._periodoKpiMes = val;
  STATE._periodoKpi = null;
  document.querySelectorAll('.kpi-periodo-tab').forEach(t => t.classList.remove('active'));
  calcularKpisPeriodo(null, val);
  actualizarLabelReporte();
}
function actualizarLabelReporte() {
  const span = document.getElementById('reporte-periodo-label');
  if (!span) return;
  let label = '';
  if (STATE._periodoKpiMes) {
    const [y, m] = STATE._periodoKpiMes.split('-').map(Number);
    label = new Date(y, m - 1, 1).toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
  } else {
    const mapa = {
      mes:    'Este mes',
      semana: 'Esta semana',
      año:    String(new Date().getFullYear()),
      total:  'Histórico',
    };
    label = mapa[STATE._periodoKpi || 'mes'] || 'Este mes';
  }
  if (STATE._filtroEmpleadoDash) label += ' · ' + STATE._filtroEmpleadoDash;
  span.textContent = '· ' + label;
}
async function refreshDashboard() {
  showLoading('Actualizando dashboard...');
  try {
    const resultados = await Promise.allSettled([
      cargarClientes(),
      cargarVentas(),
      cargarPagos(),
      cargarHistorial(),
      cargarAuditoria(),
      cargarInventario(),
    ]);
    const modulos = ['Clientes','Ventas','Pagos','Historial','Auditoría','Inventario'];
    const fallidos = resultados
      .map((r, i) => r.status === 'rejected' ? modulos[i] : null)
      .filter(Boolean);
    if (fallidos.length) {
      showToast(`No se pudieron cargar: ${fallidos.join(', ')}. Refresca la página.`, 'warning', 7000);
    }
    renderDashboard();
    window.dispatchEvent(new Event('resize'));
    filterClientes();
    filterVentas();
    filterPagos();
    filterHistorial();
    filterGarantias();
    filterAdeudosBusqueda();
    actualizarBadgeAdeudos();
    llenarSelectsClientes();
    llenarSelectEmpleados();
    filterInventario();
    showToast('Dashboard actualizado', 'success');
  } catch { showToast('Error al actualizar', 'error'); }
  finally  { hideLoading(); feather.replace(); }
}

/* ══════════════════════════════════════════════════════════════
   📧  EMAILJS — CORREOS AUTOMÁTICOS
══════════════════════════════════════════════════════════════ */

async function sendRecordatorio() {
  const c = STATE.clienteActivo;
  if (!c) return;
  if (!c.email) { showToast('Este cliente no tiene correo registrado', 'warning'); return; }

  const ventasCli = STATE.ventas.filter(v => v.clienteId == c.id);
  const pagado    = ventasCli.reduce((s, v) => s + calcularPagado(v.id), 0);
  const total     = ventasCli.reduce((s, v) => s + parseFloat(v.totalFinal || 0), 0);
  const saldo     = Math.max(0, total - pagado);
  const ultimoPago= STATE.pagos.filter(p => p.clienteId == c.id).slice(-1)[0];

  if (typeof emailjs === 'undefined') {
    setEmailStatus('Servicio de correo no disponible. Recarga la página.', 'error');
    return;
  }
  setEmailStatus('Enviando correo...', '');
  try {
    await emailjs.send(CONFIG.EMAILJS.SERVICE_ID, CONFIG.EMAILJS.TEMPLATE_RECORDATORIO, {
      to_name:      c.nombre,
      to_email:     c.email,
      tipo:         'pago',
      etiqueta:     'Saldo pendiente',
      saldo:        formatMoney(saldo),
      ultimo_pago:  ultimoPago ? `${formatMoney(ultimoPago.monto)} el ${ultimoPago.fecha}` : 'Sin pagos previos',
      mensaje:      `Hola ${c.nombre.split(' ')[0]}, te recordamos que tienes un saldo pendiente de ${formatMoney(saldo)} en Óptica Aurora. ¡Estamos aquí para ayudarte!`,
      contacto:     'WhatsApp: (282) 129-2915',
    });
    await registrarAuditoria('Pago', `${STATE.usuario.nombre} envió recordatorio de pago a ${c.nombre}`);
    setEmailStatus('✓ Recordatorio enviado correctamente', 'success');
    showToast('Correo de recordatorio enviado', 'success');
  } catch (err) {
    console.error(err);
    setEmailStatus('Error al enviar correo. Verifica la configuración de EmailJS.', 'error');
    showToast('Error al enviar correo', 'error');
  }
}

async function sendAgradecimiento() {
  const c = STATE.clienteActivo;
  if (!c) return;
  if (!c.email) { showToast('Este cliente no tiene correo registrado', 'warning'); return; }

  const total = STATE.ventas
    .filter(v => v.clienteId == c.id)
    .reduce((s, v) => s + parseFloat(v.totalFinal || 0), 0);

  setEmailStatus('Enviando correo...', '');
  try {
    await sendCorreoAgradecimiento(c, total);
    setEmailStatus('✓ Correo de agradecimiento enviado', 'success');
  } catch {
    setEmailStatus('Error al enviar correo.', 'error');
  }
}

async function sendCorreoAgradecimiento(cliente, totalVenta) {
  if (typeof emailjs === 'undefined') {
    throw new Error('EmailJS no disponible');
  }
  await emailjs.send(CONFIG.EMAILJS.SERVICE_ID, CONFIG.EMAILJS.TEMPLATE_GRACIAS, {
    to_name:  cliente.nombre,
    to_email: cliente.email,
    total:    formatMoney(totalVenta),
    mensaje:  `¡Gracias ${cliente.nombre.split(' ')[0]}! Tu pago ha sido recibido y tu cuenta está al corriente. Si tienes dudas o necesitas facturación, contáctanos.`,
    contacto: 'Óptica Aurora — Tel: (282) 129-2915',
  });
  await registrarAuditoria('Pago', `Correo de agradecimiento enviado a ${cliente.nombre}`);
  showToast(`Correo de agradecimiento enviado a ${cliente.nombre}`, 'success');
}

function abrirCorreoAdeudo(clienteId) {
  const c = STATE.clientes.find(x => x.id == clienteId);
  if (!c) return;
  STATE.clienteActivo = c;
  verDetalleCliente(clienteId);
  // switchDetailTab después de que verDetalleCliente activa la primera tab
  const tabBtn = document.querySelector('#modal-detalle-cliente .detail-tab[onclick*="correos"]');
  if (tabBtn) switchDetailTab('correos', tabBtn);
}

function setEmailStatus(msg, tipo) {
  const el = document.getElementById('email-status');
  if (!el) return;
  el.textContent = msg;
  el.className = `email-status ${tipo}`;
  el.classList.remove('hidden');
}

/* ══════════════════════════════════════════════════════════════
   🗑️  ELIMINACIÓN GENERAL
══════════════════════════════════════════════════════════════ */

function confirmarEliminar(tipo, id) {
  // Obtener nombre desde STATE para evitar bugs con apóstrofes en onclick
  let nombre = '';
  if (tipo === 'cliente')  nombre = STATE.clientes.find(c => String(c.id) === String(id))?.nombre || '';
  if (tipo === 'producto') nombre = STATE.inventario.find(p => String(p.id) === String(id))?.nombre || '';

  const rol = (STATE.usuario?.rol || '').toLowerCase();
  const soloAdmin = ['cliente', 'venta', 'pago', 'historial', 'producto'];
  if (soloAdmin.includes(tipo) && rol !== 'admin' && rol !== 'administrador') {
    showToast('Solo un administrador puede eliminar este registro', 'warning');
    return;
  }
  const textos = {
    cliente:   `¿Eliminar al cliente ${esc(nombre)}? Se eliminarán también TODAS sus ventas, pagos e historial clínico. Esta acción no se puede deshacer.`,
    venta:     '¿Eliminar esta venta? Se perderá el registro de pagos asociados.',
    pago:      '¿Eliminar este pago? El saldo del cliente se recalculará.',
    historial: '¿Eliminar este registro clínico? Esta acción no se puede deshacer.',
    producto:  `¿Eliminar el producto "${esc(nombre)}"? Esta acción no se puede deshacer.`,
  };
  const confirmBtn = document.getElementById('confirm-btn');
  setHTML('confirm-text', textos[tipo] || '¿Confirmar eliminación?');
  confirmBtn.onclick = () => {
    if (tipo === 'cliente')   eliminarCliente(id);
    if (tipo === 'venta')     eliminarVenta(id);
    if (tipo === 'pago')      eliminarPago(id);
    if (tipo === 'historial') eliminarHistorial(id);
    if (tipo === 'producto')  eliminarProducto(id);
  };
  openModal('modal-confirmar');
}

/* ══════════════════════════════════════════════════════════════
   🔽  SELECTS — Llenar opciones de clientes
══════════════════════════════════════════════════════════════ */
/* ══════════════════════════════════════════════════════════════
   📦  SELECTOR DE PRODUCTOS EN VENTA
══════════════════════════════════════════════════════════════ */

function llenarSelectProductos() {
  const select = document.getElementById('venta-producto');
  if (!select) return;

  const agotados = STATE.inventario.filter(p => parseInt(p.stock || 0) === 0);
  const disponibles = STATE.inventario
    .filter(p => parseInt(p.stock || 0) > 0)
    .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));

  let opts = '<option value="">— Seleccionar producto (opcional) —</option>';

  if (disponibles.length) {
    opts += '<optgroup label="✅ Disponibles">';
    opts += disponibles.map(p => {
      const stock = parseInt(p.stock || 0);
      const stockMin = parseInt(p.stockMin || 3);
      const alerta = stock <= stockMin ? '⚠️ ' : '';
      return `<option value="${p.id}"
        data-nombre="${esc(p.nombre)}"
        data-stock="${stock}"
        data-precio="${p.precioVenta || ''}"
        data-categoria="${esc(p.categoria || '')}">
        ${alerta}${esc(p.nombre)}${p.marca ? ' · ' + esc(p.marca) : ''} — Stock: ${stock}
      </option>`;
    }).join('');
    opts += '</optgroup>';
  }

  if (agotados.length) {
    opts += '<optgroup label="❌ Sin stock (solo para editar ventas existentes)">';
    opts += agotados.map(p =>
      `<option value="${p.id}" data-nombre="${esc(p.nombre)}" data-stock="0" data-precio="${p.precioVenta || ''}" style="color:#aaa;">
        ${esc(p.nombre)}${p.marca ? ' · ' + esc(p.marca) : ''} — Agotado
      </option>`
    ).join('');
    opts += '</optgroup>';
  }

  select.innerHTML = opts;
}

function onProductoChange() {
  const select = document.getElementById('venta-producto');
  const opt = select.options[select.selectedIndex];
  const display = document.getElementById('venta-stock-display');

  if (!opt || !opt.value) {
    if (display) display.innerHTML = '';
    return;
  }

  const stock    = parseInt(opt.dataset.stock || 0);
  const nombre   = opt.dataset.nombre || '';
  const precio   = opt.dataset.precio || '';

  // Auto-rellenar tipo de lente solo si está vacío
  const lenteInput = document.getElementById('venta-lente');
  if (lenteInput && !lenteInput.value) lenteInput.value = nombre;

  // Auto-rellenar precio SOLO si el campo está vacío o es 0 (no sobreescribir precio existente)
  const precioInput = document.getElementById('venta-precio');
  const esModoEdicion = val('venta-id').trim() !== '';
  if (precioInput && precio && !esModoEdicion && (!precioInput.value || parseFloat(precioInput.value) === 0)) {
    precioInput.value = precio;
    calcularTotal();
  }

  // Mostrar badge de stock
  if (display) {
    const color  = stock === 0 ? '#E53935' : stock <= 3 ? '#FBC02D' : '#4CAF50';
    const texto  = stock === 0
      ? '❌ Sin stock disponible'
      : stock <= 3
        ? `⚠️ Stock bajo: ${stock} unidad${stock !== 1 ? 'es' : ''}`
        : `✅ Stock disponible: ${stock} unidad${stock !== 1 ? 'es' : ''}`;

    display.innerHTML = `<span style="
      display:inline-block;background:${color};color:#fff;
      padding:.25rem .85rem;border-radius:99px;font-size:.78rem;font-weight:700;margin-top:.3rem;">
      ${texto}
    </span>`;
  }

  // Advertir si stock es 0
  if (stock === 0) {
    showToast('⚠️ Este producto no tiene stock disponible', 'warning');
  }
}
function llenarSelectsClientes() {
  const opts = '<option value="">— Seleccionar cliente —</option>'
    + STATE.clientes
        .slice()
        .sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''))
        .map(c => `<option value="${c.id}">${esc(c.nombre)}</option>`)
        .join('');

  ['venta-cliente', 'historial-cliente', 'pago-cliente'].forEach(selectId => {
    const el = document.getElementById(selectId);
    if (!el) return;

    const valorAnterior  = el.value;
    const inputBuscador  = document.getElementById('buscar-' + selectId);
    const queryAnterior  = inputBuscador?.value || '';
    const tieneFoco      = document.activeElement === inputBuscador;

    // Eliminar buscador existente sin disparar eventos
    if (inputBuscador) inputBuscador.remove();

    el.innerHTML = opts;
    agregarBuscadorCliente(selectId);

    // Restaurar valor seleccionado
    if (valorAnterior && Array.from(el.options).some(o => o.value === valorAnterior)) {
      el.value = valorAnterior;
    }

    // Restaurar query y reaplicar filtro visual — sin disparar change
    if (queryAnterior) {
      const nuevoInput = document.getElementById('buscar-' + selectId);
      if (nuevoInput) {
        nuevoInput.value = queryAnterior;
        // Filtrar opciones sin disparar el autoselect de 1 resultado
        const q = queryAnterior.toLowerCase();
        Array.from(el.options).forEach(opt => {
          if (!opt.value) { opt.style.display = ''; return; }
          opt.style.display = opt.text.toLowerCase().includes(q) ? '' : 'none';
        });
        // Restaurar foco solo si el input lo tenía antes de reconstruir
        if (tieneFoco) {
          requestAnimationFrame(() => {
            nuevoInput.focus();
            const len = nuevoInput.value.length;
            nuevoInput.setSelectionRange(len, len);
          });
        }
      }
    }
  });
}
function llenarSelectEmpleados() {
  const esAdmin = ['admin', 'administrador'].includes((STATE.usuario?.rol || '').toLowerCase());
  if (!esAdmin) return;
  const empleados = [...new Set(STATE.ventas.map(v => v.registradoPor).filter(Boolean))].sort();
  const opts = '<option value="">👤 Todos los empleados</option>' +
    empleados.map(e => `<option value="${esc(e)}">${esc(e)}</option>`).join('');
  ['filter-empleado-ventas', 'filter-empleado-dash'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const current = el.value;
    el.innerHTML = opts;
    if (current && [...el.options].some(o => o.value === current)) el.value = current;
  });
}

function cambiarFiltroEmpleadoDash(empleado) {
  STATE._filtroEmpleadoDash = empleado || null;
  renderDashboard();
  actualizarLabelReporte();
}

function agregarBuscadorCliente(selectId) {
  const select = document.getElementById(selectId);
  if (!select) return;

  // Eliminar TODOS los buscadores existentes (no solo uno)
  document.querySelectorAll('[id="buscar-' + selectId + '"]').forEach(el => el.remove());
  const input = document.createElement('input');
  input.type        = 'text';
  input.id          = 'buscar-' + selectId;
  input.placeholder = '🔍 Buscar cliente...';
  input.style.cssText = 'margin-bottom:.4rem;';

  input.addEventListener('input', () => {
    const q = input.value.toLowerCase();
    Array.from(select.options).forEach(opt => {
      if (!opt.value) { opt.style.display = ''; return; } // mantener placeholder
      opt.style.display = opt.text.toLowerCase().includes(q) ? '' : 'none';
    });
    // Si hay un solo resultado visible, seleccionarlo automáticamente
    const visibles = Array.from(select.options).filter(o => o.value && o.style.display !== 'none');
    if (visibles.length === 1) {
      select.value = visibles[0].value;
      select.dispatchEvent(new Event('change'));
    }
  });

  select.parentNode.insertBefore(input, select);
}

/* ══════════════════════════════════════════════════════════════
   🧭  NAVEGACIÓN
══════════════════════════════════════════════════════════════ */

const SECTION_LABELS = {
  dashboard: 'Dashboard',
  clientes:  'Clientes',
  historial: 'Historial Clínico',
  ventas:    'Ventas',
  pagos:     'Pagos',
  adeudos:   'Control de Adeudos',
  garantias: 'Garantías y Cambios',
  inventario: 'Inventario',
  auditoria:  'Auditoría',
};

function navigateTo(seccion) {
  if (seccion === 'auditoria') {
    const rol = (STATE.usuario?.rol || '').toLowerCase();
    if (rol !== 'admin' && rol !== 'administrador') {
      showToast('Solo administradores pueden ver la auditoría', 'warning');
      return;
    }
  }

  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  const el = document.getElementById(`section-${seccion}`);
  if (el) el.classList.add('active');

  const navItem = document.querySelector(`.nav-item[data-section="${seccion}"]`);
  if (navItem) navItem.classList.add('active');

  setHTML('breadcrumb-section', SECTION_LABELS[seccion] || seccion);

  if (seccion === 'adeudos')    filterAdeudosBusqueda();
  if (seccion === 'garantias')  filterGarantias();
  if (seccion === 'inventario') filterInventario();
  if (seccion === 'auditoria')  filterAuditoria();

  if (window.innerWidth <= 768) {
    document.getElementById('sidebar').classList.remove('mobile-open');
    const overlay = document.getElementById('sidebar-mobile-overlay');
    if (overlay) overlay.remove();
  }

  feather.replace();
}

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const main    = document.getElementById('main-content');

  if (window.innerWidth <= 768) {
    sidebar.classList.toggle('mobile-open');
    // Overlay para cerrar el sidebar tocando fuera en móvil
    let overlay = document.getElementById('sidebar-mobile-overlay');
    if (sidebar.classList.contains('mobile-open')) {
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'sidebar-mobile-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:99;';
        overlay.onclick = toggleSidebar;
        document.body.appendChild(overlay);
      }
    } else {
      if (overlay) overlay.remove();
    }
} else {
  sidebar.classList.toggle('collapsed');
  main.classList.toggle('expanded');
  document.body.classList.toggle('sidebar-collapsed');
}
}

/* ══════════════════════════════════════════════════════════════
   🪟  MODALES
══════════════════════════════════════════════════════════════ */
function cerrarModalConConfirmacion() {
  const MODALES_SOLO_LECTURA = ['modal-confirmar', 'modal-ver-historial', 'modal-detalle-cliente', 'modal-ajuste-stock', 'modal-export-ventas'];
  const modalActivo = document.querySelector('.modal.active');
  if (!modalActivo) return closeAllModals();
  if (MODALES_SOLO_LECTURA.includes(modalActivo.id)) return closeAllModals();

  const CAMPOS_IGNORAR = new Set([
    'venta-fecha','pago-fecha','historial-fecha',
    'venta-cantidad','venta-descuento','producto-stock-min'
  ]);
  const VALORES_DEFAULT = new Set(['1','0','0.00','3']);

  const inputs = modalActivo.querySelectorAll('input:not([type=hidden]):not([readonly]), textarea');
  // producto-categoria tiene 'armazon' como default no vacío → excluir para evitar falso positivo
  const selects = modalActivo.querySelectorAll(
    'select:not([id$="-tipo"]):not([id$="-metodo"]):not([id$="-categoria"])'
  );

  const hayDatosInputs = [...inputs].some(el => {
    const v = el.value.trim();
    if (CAMPOS_IGNORAR.has(el.id)) return false;
    if (VALORES_DEFAULT.has(v)) return false;
    return v !== '';
  });

  const hayDatosSelects = [...selects].some(el => {
    return el.value !== '' && el.value !== undefined;
  });

  if (hayDatosInputs || hayDatosSelects) {
    if (!confirm('¿Cerrar sin guardar? Los datos ingresados se perderán.')) return;
  }
  closeAllModals();
}
function openModal(id) {
  closeAllModals(false);
  const modal   = document.getElementById(id);
  const overlay = document.getElementById('modal-overlay');
  if (modal)   { modal.classList.add('active'); }
  if (overlay) { overlay.classList.add('active'); }

  const emailStatus = document.getElementById('email-status');
  if (emailStatus) emailStatus.classList.add('hidden');

 if (id === 'modal-venta' && !val('venta-id')) {
    ['venta-lente','venta-precio','venta-anticipo','venta-cantidad',
     'venta-diferencia','venta-cambio-desc'].forEach(f => {
      const e = document.getElementById(f);
      if (e) e.value = f === 'venta-cantidad' ? '1' : '';
    });
    // Restaurar campo anticipo a estado editable (por si venía de editarVenta)
    const anticipoInput = document.getElementById('venta-anticipo');
    if (anticipoInput) {
      anticipoInput.readOnly = false;
      anticipoInput.style.background = '';
      anticipoInput.style.color      = '';
      anticipoInput.style.fontWeight = '';
      anticipoInput.title = '';
    }
    const anticipoLabel = anticipoInput?.closest('.form-group')?.querySelector('label');
    if (anticipoLabel) anticipoLabel.textContent = 'Anticipo ($)';

    const stockDisplay = document.getElementById('venta-stock-display');
    if (stockDisplay) stockDisplay.innerHTML = '';
    llenarSelectProductos();
    document.getElementById('venta-cliente').value   = '';
    document.getElementById('venta-metodo').value    = 'efectivo';
    document.getElementById('venta-descuento').value = '0';
    document.getElementById('venta-total').value     = '';
    document.getElementById('venta-restante').value  = '';
    document.getElementById('venta-tipo').value      = 'normal';
    document.getElementById('cambio-extra')?.classList.add('hidden');
    document.getElementById('venta-anticipo').style.borderColor = '';
    const buscarV = document.getElementById('buscar-venta-cliente');
    if (buscarV) {
      buscarV.value = '';
      Array.from(document.getElementById('venta-cliente')?.options || []).forEach(o => o.style.display = '');
    }
    setFechasHoy();
  }

  if (id === 'modal-pago') {
    ['pago-monto','pago-notas'].forEach(f => { const e = document.getElementById(f); if(e) e.value = ''; });
    const buscarPago = document.getElementById('buscar-pago-cliente');
    if (buscarPago) { buscarPago.value = ''; Array.from(document.getElementById('pago-cliente')?.options||[]).forEach(o=>o.style.display=''); }
    document.getElementById('pago-cliente').value = '';
    document.getElementById('pago-venta-id').value = '';
    document.getElementById('pago-venta').innerHTML = '<option value="">— Seleccionar venta —</option>';
    document.getElementById('pago-resumen').classList.add('hidden');
    document.getElementById('pago-metodo').value = 'efectivo';
    setFechasHoy();
    // Preseleccionar cliente si solo hay uno con deuda
    const clientesConDeuda = [...new Set(
      STATE.ventas
        .filter(v => parseFloat(v.totalFinal || 0) > calcularPagado(v.id))
        .map(v => String(v.clienteId))
    )];
    if (clientesConDeuda.length === 1) {
      const pagoClienteSel = document.getElementById('pago-cliente');
      if (pagoClienteSel) {
        pagoClienteSel.value = clientesConDeuda[0];
        loadVentasDeCliente();
      }
    }
  }

  if (id === 'modal-historial' && !val('historial-id')) {
    document.getElementById('historial-diagnostico').value = '';
    document.getElementById('historial-observaciones').value = '';
    document.querySelectorAll('input[name="sintoma"]').forEach(cb => cb.checked = false);
    document.querySelectorAll('input[name="antecedente"]').forEach(cb => cb.checked = false);
    ['avlsc-od','avlsc-oi','avlsc-ao','avlcc-od','avlcc-oi','avlcc-ao',
     'vcsc-od','vcsc-oi','vcsc-ao','vccc-od','vccc-oi','vccc-ao',
     'historial-motivo','historial-desde-cuando','historial-atribuye',
     'historial-medicamento','historial-ultimo-examen','historial-tiempo-lentes',
     'historial-cambios-graduacion','historial-tiempo-contacto','historial-cirugia',
     'ph-od','ph-oi','reloj-od','reloj-oi','bicro-od','bicro-oi','mpp-od','mpp-oi',
     'historial-altura','historial-dip','historial-dnp-od','historial-dnp-oi','historial-add',
     'historial-parpados','historial-pestanas','historial-cejas','historial-conjuntiva',
     'historial-oftalmoscopia','historial-grad-ant-od','historial-grad-ant-oi',
     'historial-eje-od','historial-eje-oi','historial-material',
     'historial-rx-od','historial-rx-oi','historial-rx-add',
     'historial-prueba-amb'
    ].forEach(f => { const e = document.getElementById(f); if(e) e.value = ''; });
    ['historial-aumento','historial-usa-lentes','historial-usa-contacto',
    'historial-reloj-neutralizado','historial-bicro-neutralizado'
    ].forEach(f => { const e = document.getElementById(f); if(e) e.value = ''; });
    document.getElementById('historial-cliente').value = '';
    const buscarHC = document.getElementById('buscar-historial-cliente');
    if (buscarHC) {
      buscarHC.value = '';
      Array.from(document.getElementById('historial-cliente')?.options || [])
        .forEach(o => o.style.display = '');
    }
    setHTML('modal-historial-title', 'Nuevo Registro Clínico');
    setFechasHoy();
  }

  if (id === 'modal-cliente' && !val('cliente-id')) limpiarFormCliente();

  if (id === 'modal-producto' && !val('producto-id')) {
    quitarImagenProducto();
    ['producto-nombre','producto-marca','producto-sku','producto-color',
     'producto-proveedor','producto-notas'].forEach(f => {
      const el = document.getElementById(f); if (el) el.value = '';
    });
    const catEl = document.getElementById('producto-categoria');
    if (catEl) catEl.value = 'armazon';
    const stockEl = document.getElementById('producto-stock');
    if (stockEl) stockEl.value = '';
    const stockMinEl = document.getElementById('producto-stock-min');
    if (stockMinEl) stockMinEl.value = '3';
    const costoEl = document.getElementById('producto-precio-costo');
    if (costoEl) costoEl.value = '';
    const ventaEl = document.getElementById('producto-precio-venta');
    if (ventaEl) ventaEl.value = '';
    setHTML('modal-producto-title', 'Nuevo Producto');
  }

  feather.replace();
}

function closeAllModals(closeOverlay = true) {
  const modalConfirmarActivo = document.getElementById('modal-confirmar')?.classList.contains('active');
  document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
  if (closeOverlay) {
    const overlay = document.getElementById('modal-overlay');
    if (overlay) overlay.classList.remove('active');
  }
  // Solo limpiar IDs al cerrar de verdad (no al cambiar entre modales)
  if (closeOverlay && !modalConfirmarActivo) {
    const histId = document.getElementById('historial-id');
    if (histId) histId.value = '';
    const ventaId = document.getElementById('venta-id');
    if (ventaId) ventaId.value = '';
    const clienteId = document.getElementById('cliente-id');
    if (clienteId) clienteId.value = '';
    const productoId = document.getElementById('producto-id');
    if (productoId) productoId.value = '';
  }
}

/* ══════════════════════════════════════════════════════════════
   🔔  TOASTS
══════════════════════════════════════════════════════════════ */

const TOAST_ICONS = {
  success: 'check-circle',
  error:   'x-circle',
  warning: 'alert-triangle',
  info:    'info',
};

function showToast(msg, tipo = 'info', duracion = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast toast-${tipo}`;
  toast.innerHTML = `<i data-feather="${TOAST_ICONS[tipo] || 'info'}"></i><span>${msg}</span>`;
  container.appendChild(toast);
  feather.replace();
  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 350);
  }, duracion);
}

/* ══════════════════════════════════════════════════════════════
   ⏳  LOADING
══════════════════════════════════════════════════════════════ */

function showLoading(msg = 'Procesando...') {
  setHTML('loading-text', msg);
  document.getElementById('loading-overlay').classList.remove('hidden');
}

function hideLoading() {
  document.getElementById('loading-overlay').classList.add('hidden');
}

/* ══════════════════════════════════════════════════════════════
   🛠️  UTILIDADES
══════════════════════════════════════════════════════════════ */

function val(id) {
  const el = document.getElementById(id);
  return el ? el.value : '';
}

function setHTML(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatMoney(val) {
  const num = parseFloat(val) || 0;
  return '$' + num.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function parseMoney(str) {
  return parseFloat((str || '').replace(/[$,]/g, '')) || 0;
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}
function filterAdeudosBusqueda() {
  const q = document.getElementById('search-adeudos')?.value.toLowerCase() || '';
  const filtroActivo = STATE._filtroAdeudos || 'todos';

  // Precomputar mapa de pagos para O(n+m) en lugar de O(n×m)
  const mapaP = {};
  STATE.pagos.forEach(p => {
    const key = String(p.ventaId || '').trim();
    mapaP[key] = (mapaP[key] || 0) + parseFloat(p.monto || 0);
  });

let lista = STATE.ventas
  .filter(v => parseFloat(v.totalFinal || 0) > 0) // excluir garantías sin costo
  .map(v => {
    const pagado = mapaP[String(v.id).trim()] || 0;
    const total  = parseFloat(v.totalFinal || 0);
    const estado = pagado <= 0 ? 'deuda'
      : Math.round(pagado * 100) >= Math.round(total * 100) ? 'pagado'
      : 'parcial';
    return { ...v, _pagado: pagado, _estado: estado, _cliente: STATE.clientes.find(c => String(c.id).trim() === String(v.clienteId).trim()) };
  });

  if (filtroActivo !== 'todos') lista = lista.filter(v => v._estado === filtroActivo);
  if (q) lista = lista.filter(v =>
    v._cliente?.nombre?.toLowerCase().includes(q) ||
    v.clienteNombre?.toLowerCase().includes(q)
  );

  const tbody = document.getElementById('adeudos-body');
  if (!tbody) return;
    if (!lista.length) {
    const qTrim = document.getElementById('search-adeudos')?.value.trim();
    const msg = qTrim
        ? `Sin resultados para "<strong>${esc(qTrim)}</strong>"`
        : 'Sin registros para este filtro';
    tbody.innerHTML = `<tr><td colspan="8" class="empty-row">${msg}</td></tr>`;
    return;
  }
tbody.innerHTML = lista.map(v => {
    const saldo = parseFloat(v.totalFinal || 0) - v._pagado;
    const saldoDisplay = Math.abs(saldo);
    const esExceso = saldo < 0;
    const ultimoPago = STATE.pagos.filter(p => String(p.ventaId) === String(v.id)).slice(-1)[0];
    return `
      <tr>
        <td data-label="Estado">${estadoBadge(v._estado)}</td>
        <td data-label="Cliente"><strong>${esc(v._cliente?.nombre || v.clienteNombre || '—')}</strong></td>
        <td data-label="Teléfono" class="mono">
        ${v._cliente?.telefono
            ? `<a href="https://wa.me/52${sanitizarTelefono(v._cliente.telefono)}" target="_blank" style="color:var(--verde);text-decoration:none;">📱 ${esc(v._cliente.telefono)}</a>`
            : '—'
        }
        </td>        
        <td data-label="Total" class="mono">${formatMoney(v.totalFinal)}</td>
        <td data-label="Pagado" class="mono text-green">${formatMoney(v._pagado)}</td>
        <td data-label="Saldo" class="mono ${esExceso ? 'text-green' : saldo > 0 ? 'text-red fw-bold' : 'text-green'}">${esExceso ? '⬆️ Exceso: ' + formatMoney(saldoDisplay) : formatMoney(saldoDisplay)}</td>        <td data-label="Último Pago" class="mono">${ultimoPago ? esc(ultimoPago.fecha) : '—'}</td>
        <td>
          <div class="action-btns">
            <button class="btn-action pay"   onclick="abrirPagoVenta('${v.id}')" title="Registrar pago"><i data-feather="dollar-sign"></i></button>
            <button class="btn-action email" onclick="abrirCorreoAdeudo('${v.clienteId}')" title="Enviar recordatorio"><i data-feather="mail"></i></button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
  feather.replace();
}
function imprimirExpediente(historialId) {
  const h = STATE.historial.find(x => String(x.id) === String(historialId));
  if (!h) return;
  const cliente = STATE.clientes.find(c => String(c.id) === String(h.clienteId)) || null;
  const nombre = (cliente?.nombre || h.clienteNombre || 'Paciente').trim() || 'Paciente';
  const sintomas = (h.sintomas || '').split(',').filter(Boolean);
  const antecedentes = (h.antecedentes || '').split(',').filter(Boolean);
const logoURL  = window.location.origin + window.location.pathname.replace(/[^/]*$/, '') + 'Logo-optica.ico';
  const fila = (label, valor) => valor
    ? `<tr><td class="lbl">${label}</td><td class="val">${esc(String(valor))}</td></tr>`
    : '';

  const seccion = (icono, titulo, contenido) => `
    <div class="seccion">
      <div class="seccion-titulo"><span class="sec-icon">${icono}</span>${titulo}</div>
      <div class="seccion-body">${contenido}</div>
    </div>`;

  const isPWA = window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;

  const htmlExpediente = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Expediente — ${nombre}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:'Inter',Arial,sans-serif;font-size:12px;color:#1a2b45;background:#e8edf3;padding:24px;}

    /* ── BOTÓN IMPRIMIR ── */
    .btn-print{
      display:flex;align-items:center;gap:.5rem;
      max-width:820px;margin:0 auto 16px;padding:10px 24px;
      background:linear-gradient(135deg,#1F3A5F,#2E5C8A);
      color:#fff;border:none;border-radius:10px;font-size:13px;
      font-weight:600;cursor:pointer;font-family:'Inter',Arial,sans-serif;
    }
    .btn-print:hover{opacity:.9;}

    /* ── PÁGINA ── */
    .pagina{background:#fff;max-width:820px;margin:0 auto;border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.18);display:flex;flex-direction:column;min-height:100vh;}

    /* ── HEADER PRINCIPAL ── */
    .header{
      background:linear-gradient(135deg,#1F3A5F 0%,#2E5C8A 60%,#3a7aaa 100%);
      padding:0;
      position:relative;
      overflow:hidden;
    }
    .header::before{
      content:'';position:absolute;top:-60px;right:-60px;
      width:240px;height:240px;border-radius:50%;
      background:rgba(79,195,199,.12);pointer-events:none;
    }
    .header::after{
      content:'';position:absolute;bottom:-40px;left:30%;
      width:160px;height:160px;border-radius:50%;
      background:rgba(255,255,255,.05);pointer-events:none;
    }
    .header-inner{
      display:flex;align-items:center;justify-content:space-between;
      padding:22px 32px;position:relative;z-index:2;
    }
    .header-left{display:flex;align-items:center;gap:14px;}
    .logo-img{width:54px;height:54px;border-radius:12px;background:rgba(255,255,255,.12);padding:4px;object-fit:contain;border:1.5px solid rgba(255,255,255,.2);}
    .logo-text .optica{font-size:10px;font-weight:600;letter-spacing:.22em;color:#7EC8CB;display:block;}
    .logo-text .aurora{font-size:24px;font-weight:800;color:#fff;letter-spacing:.04em;line-height:1.1;}
    .header-right{text-align:right;}
    .doc-tipo{font-size:10px;font-weight:700;letter-spacing:.18em;color:#7EC8CB;text-transform:uppercase;}
    .doc-num{font-size:11px;color:rgba(255,255,255,.5);margin-top:3px;font-weight:400;}

    /* ── FRANJA TURQUESA ── */
    .header-accent{height:4px;background:linear-gradient(90deg,#4FC3C7,#38a8ac,#4FC3C7);}

    /* ── BANNER PACIENTE ── */
    .banner{
      background:linear-gradient(to right,#f0f6fb,#e8f4f8);
      border-bottom:2px solid #dde9f0;
      padding:20px 32px;
      display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;
    }
    .banner-left{}
    .banner-label{font-size:9px;font-weight:700;letter-spacing:.18em;color:#6FA9C9;text-transform:uppercase;margin-bottom:4px;}
    .banner-nombre{font-size:22px;font-weight:800;color:#1F3A5F;letter-spacing:-.01em;}
    .banner-chips{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;}
    .chip{
      background:#fff;border:1.5px solid #c8d8e8;border-radius:99px;
      padding:4px 12px;font-size:11px;font-weight:500;color:#2E5C8A;
      display:flex;align-items:center;gap:4px;box-shadow:0 1px 3px rgba(0,0,0,.06);
    }
    .chip-lbl{color:#8A9BB0;font-weight:400;}
    .banner-fecha{text-align:right;}
    .fecha-label{font-size:9px;font-weight:700;letter-spacing:.18em;color:#6FA9C9;text-transform:uppercase;}
    .fecha-val{font-size:15px;font-weight:700;color:#1F3A5F;margin-top:2px;}

    /* ── CUERPO ── */
    .cuerpo{padding:24px 32px;flex:1;}

    /* ── SECCIONES ── */
    .seccion{margin-bottom:18px;}
    .seccion-titulo{
      display:flex;align-items:center;gap:8px;
      font-size:9.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;
      color:#1F3A5F;background:linear-gradient(to right,#EBF4F8,#f4f8fb);
      border-left:3.5px solid #4FC3C7;padding:7px 14px;
      border-radius:0 8px 8px 0;margin-bottom:10px;
    }
    .sec-icon{font-size:13px;}
    .seccion-body{padding:0 2px;}

    /* ── TABLA DATOS ── */
    table.datos{width:100%;border-collapse:collapse;font-size:11.5px;}
    table.datos td{padding:5px 8px;vertical-align:top;}
    table.datos tr:nth-child(odd) td{background:#f8fafc;border-radius:4px;}
    td.lbl{color:#8A9BB0;font-weight:600;width:38%;white-space:nowrap;font-size:11px;}
    td.val{color:#1a2b45;font-weight:500;}

    /* ── TABLA AVD ── */
    .av-wrap{overflow-x:auto;border-radius:10px;overflow:hidden;border:1.5px solid #dde6ef;}
    table.av{width:100%;border-collapse:collapse;font-size:11.5px;}
    table.av th{
      background:linear-gradient(135deg,#1F3A5F,#2E5C8A);
      color:#fff;font-weight:700;padding:8px 12px;
      text-align:center;font-size:10px;letter-spacing:.08em;
    }
    table.av th:first-child{text-align:left;width:70px;}
    table.av td{
      border:1px solid #dde6ef;padding:7px 12px;text-align:center;
      font-family:'Courier New',monospace;color:#1F3A5F;font-size:12px;
    }
    table.av tr:nth-child(even) td{background:#f4f7fb;}
    table.av td:first-child{
      background:#EBF4F8;font-weight:700;
      font-family:'Inter',Arial,sans-serif;font-size:11px;color:#2E5C8A;text-align:left;
    }

    /* ── GRID 2 COLUMNAS ── */
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
    .grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;}

    /* ── RX BOX ── */
    .rx-box{
      background:linear-gradient(135deg,#1F3A5F,#2a4e7a);
      border-radius:12px;padding:16px 18px;color:#fff;
      box-shadow:0 4px 16px rgba(31,58,95,.25);
    }
    .rx-titulo{font-size:9px;font-weight:800;letter-spacing:.18em;color:#7EC8CB;margin-bottom:10px;text-transform:uppercase;}
    .rx-box table{width:100%;font-size:12px;}
    .rx-box td{padding:4px 6px;color:rgba(255,255,255,.65);}
    .rx-box td:last-child{color:#fff;font-weight:700;text-align:right;font-family:'Courier New',monospace;font-size:13px;}

    /* ── CHIPS SÍNTOMAS ── */
    .tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px;}
    .tag{
      background:linear-gradient(135deg,#EBF4F8,#ddeef6);
      border:1.5px solid #b8d4e8;color:#1F3A5F;
      border-radius:99px;padding:4px 12px;
      font-size:11px;font-weight:600;
    }
    .tag.antec{background:linear-gradient(135deg,#FFF8E1,#fdf0c0);border-color:#f0d070;color:#7a5c00;}
    .tag.sint{background:linear-gradient(135deg,#e8f5e9,#d4edda);border-color:#a8d5b0;color:#1a5c25;}

    /* ── DIAGNÓSTICO ── */
    .diag-box{
      background:linear-gradient(to right,#f0f9f0,#e8f5e8);
      border:1.5px solid #a8d5b0;border-radius:10px;
      padding:14px 18px;font-size:12.5px;line-height:1.7;color:#1a3a1a;
      box-shadow:inset 0 1px 4px rgba(0,0,0,.04);
    }
    .obs-box{
      background:#f8fafc;border:1.5px solid #dde6ef;border-radius:10px;
      padding:14px 18px;font-size:12px;line-height:1.7;color:#3a4a5a;
    }

    /* ── MEDIDAS CARD ── */
    .medidas-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px;}
    .medida-item{
      display:flex;justify-content:space-between;align-items:center;
      background:#f4f7fb;border-radius:6px;padding:5px 10px;font-size:11.5px;
    }
    .medida-lbl{color:#8A9BB0;font-weight:600;font-size:10.5px;}
    .medida-val{color:#1F3A5F;font-weight:700;font-family:'Courier New',monospace;}

    /* ── DIVIDER ── */
    .divider{height:1px;background:linear-gradient(to right,transparent,#dde6ef,transparent);margin:4px 0 18px;}

    /* ── FOOTER ── */
.footer{
      background:linear-gradient(to right,#f0f6fb,#e8f4f8);
      border-top:2px solid #dde9f0;
      padding:20px 32px;
      display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px;
      margin-top:auto;
    }
    .footer-brand{display:flex;align-items:center;gap:10px;}
    .footer-logo{width:32px;height:32px;border-radius:7px;object-fit:contain;background:rgba(31,58,95,.08);padding:3px;}
    .footer-info{}
    .footer-nombre{font-size:12px;font-weight:700;color:#1F3A5F;}
    .footer-sub{font-size:10px;color:#8A9BB0;margin-top:1px;}
    .firma-bloque{text-align:center;}
    .firma-linea{
      width:200px;height:1.5px;
      background:linear-gradient(to right,transparent,#2E5C8A,transparent);
      margin:0 auto 6px;
    }
    .firma-nombre{font-size:12px;font-weight:700;color:#1F3A5F;}
    .firma-titulo{font-size:10px;color:#6FA9C9;font-weight:600;letter-spacing:.06em;margin-top:2px;}
    .firma-ced{font-size:9.5px;color:#8A9BB0;margin-top:1px;}

    /* ── WATERMARK STRIP ── */
    .footer-anchor{}
    .wm-strip{
      height:3px;
      background:repeating-linear-gradient(90deg,#4FC3C7 0,#4FC3C7 30px,#2E5C8A 30px,#2E5C8A 60px);
      opacity:.3;
    }

    @media print{
      *{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
      body{background:#fff;padding:0;margin:0;}
      .btn-print{display:none;}
      .pagina{
        box-shadow:none;
        border-radius:0;
        display:block;
        min-height:unset;
        width:100%;
      }
      .cuerpo{
        flex:unset;
        padding-bottom:0;
      }
      .footer{
        margin-top:0;
        page-break-inside:avoid;
        break-inside:avoid;
      }
      /* Anclar footer al fondo de la última página */
      .footer-anchor{
        position:fixed;
        bottom:0;
        left:0;
        right:0;
      }
    }
  </style>
</head>
<body>

<button class="btn-print" onclick="window.print()">🖨️&nbsp; Imprimir Expediente</button>

<div class="pagina">
  <div class="wm-strip"></div>

  <!-- HEADER -->
  <div class="header">
    <div class="header-inner">
      <div class="header-left">
        <img src="${logoURL}" alt="Óptica Aurora" class="logo-img" onerror="this.style.display='none'" />
        <div class="logo-text">
          <span class="optica">ÓPTICA</span>
          <span class="aurora">AURORA</span>
        </div>
      </div>
      <div class="header-right">
        <div class="doc-tipo">Expediente Clínico</div>
        <div class="doc-num">Generado: ${new Date().toLocaleDateString('es-MX',{day:'2-digit',month:'long',year:'numeric'})}</div>
      </div>
    </div>
  </div>
  <div class="header-accent"></div>

  <!-- BANNER PACIENTE -->
  <div class="banner">
    <div class="banner-left">
      <div class="banner-label">Datos del Paciente</div>
      <div class="banner-nombre">${nombre}</div>
      <div class="banner-chips">
        ${cliente?.edad    ? `<span class="chip"><span class="chip-lbl">Edad</span>${cliente.edad} años</span>` : ''}
        ${cliente?.telefono? `<span class="chip"><span class="chip-lbl">Tel.</span>${cliente.telefono}</span>` : ''}
        ${cliente?.ocupacion?`<span class="chip"><span class="chip-lbl">Ocup.</span>${cliente.ocupacion}</span>` : ''}
        ${cliente?.escolaridad?`<span class="chip"><span class="chip-lbl">Esc.</span>${cliente.escolaridad}</span>` : ''}
      </div>
    </div>
    <div class="banner-fecha">
      <div class="fecha-label">Fecha de Consulta</div>
      <div class="fecha-val">${h.fecha || '—'}</div>
    </div>
  </div>

  <div class="cuerpo">

    <!-- AGUDEZA VISUAL -->
    ${seccion('👁️', 'Agudeza Visual', `
      <div class="av-wrap">
        <table class="av">
          <thead><tr>
            <th></th>
            <th>AVL&nbsp;S/C</th><th>AVL&nbsp;C/C</th><th>VC&nbsp;S/C</th><th>VC&nbsp;C/C</th>
          </tr></thead>
          <tbody>
            <tr><td>OD</td>
              <td>${h.avlscOd?'20/'+h.avlscOd:'—'}</td><td>${h.avlccOd?'20/'+h.avlccOd:'—'}</td>
              <td>${h.vcscOd?'20/'+h.vcscOd:'—'}</td><td>${h.vcccOd?'20/'+h.vcccOd:'—'}</td>
            </tr>
            <tr><td>OI</td>
              <td>${h.avlscOi?'20/'+h.avlscOi:'—'}</td><td>${h.avlccOi?'20/'+h.avlccOi:'—'}</td>
              <td>${h.vcscOi?'20/'+h.vcscOi:'—'}</td><td>${h.vcccOi?'20/'+h.vcccOi:'—'}</td>
            </tr>
            <tr><td>AO</td>
              <td>${h.avlscAo?'20/'+h.avlscAo:'—'}</td><td>${h.avlccAo?'20/'+h.avlccAo:'—'}</td>
              <td>${h.vcscAo?'20/'+h.vcscAo:'—'}</td><td>${h.vcccAo?'20/'+h.vcccAo:'—'}</td>
            </tr>
          </tbody>
        </table>
      </div>
    `)}

    <!-- RX FINAL + MEDIDAS -->
    <div class="grid2" style="margin-bottom:18px;">
      <div class="rx-box">
        <div class="rx-titulo">📋 RX Final</div>
        <table>
          ${h.rxOd      ? `<tr><td>OD</td><td>${h.rxOd}</td></tr>`         : ''}
          ${h.rxOi      ? `<tr><td>OI</td><td>${h.rxOi}</td></tr>`         : ''}
          ${h.rxAdd     ? `<tr><td>ADD</td><td>${h.rxAdd}</td></tr>`       : ''}
          ${h.material  ? `<tr><td>Material</td><td>${h.material}</td></tr>` : ''}
          ${h.gradAntOd ? `<tr><td>Grad. ant. OD</td><td>${h.gradAntOd}</td></tr>` : ''}
          ${h.gradAntOi ? `<tr><td>Grad. ant. OI</td><td>${h.gradAntOi}</td></tr>` : ''}
          ${h.ejeOd     ? `<tr><td>Eje OD</td><td>${h.ejeOd}</td></tr>`   : ''}
          ${h.ejeOi     ? `<tr><td>Eje OI</td><td>${h.ejeOi}</td></tr>`   : ''}
        </table>
      </div>
      <div>
        <div class="seccion-titulo" style="margin-bottom:8px;"><span class="sec-icon">📐</span>Medidas Optométricas</div>
        <div class="medidas-grid">
          ${h.dip    ? `<div class="medida-item"><span class="medida-lbl">DIP</span><span class="medida-val">${h.dip} mm</span></div>` : ''}
          ${h.altura ? `<div class="medida-item"><span class="medida-lbl">Altura</span><span class="medida-val">${h.altura} mm</span></div>` : ''}
          ${h.dnpOd  ? `<div class="medida-item"><span class="medida-lbl">DNP OD</span><span class="medida-val">${h.dnpOd}</span></div>` : ''}
          ${h.dnpOi  ? `<div class="medida-item"><span class="medida-lbl">DNP OI</span><span class="medida-val">${h.dnpOi}</span></div>` : ''}
          ${h.add    ? `<div class="medida-item"><span class="medida-lbl">ADD</span><span class="medida-val">${h.add}</span></div>` : ''}
          ${h.phOd   ? `<div class="medida-item"><span class="medida-lbl">PH OD</span><span class="medida-val">${h.phOd}</span></div>` : ''}
          ${h.phOi   ? `<div class="medida-item"><span class="medida-lbl">PH OI</span><span class="medida-val">${h.phOi}</span></div>` : ''}
          ${h.relojOd? `<div class="medida-item"><span class="medida-lbl">Reloj OD</span><span class="medida-val">${h.relojOd}</span></div>` : ''}
          ${h.relojOi? `<div class="medida-item"><span class="medida-lbl">Reloj OI</span><span class="medida-val">${h.relojOi}</span></div>` : ''}
          ${h.bicroOd? `<div class="medida-item"><span class="medida-lbl">Bicro OD</span><span class="medida-val">${h.bicroOd}</span></div>` : ''}
          ${h.bicroOi? `<div class="medida-item"><span class="medida-lbl">Bicro OI</span><span class="medida-val">${h.bicroOi}</span></div>` : ''}
          ${h.mppOd  ? `<div class="medida-item"><span class="medida-lbl">MPP OD</span><span class="medida-val">${h.mppOd}</span></div>` : ''}
          ${h.mppOi  ? `<div class="medida-item"><span class="medida-lbl">MPP OI</span><span class="medida-val">${h.mppOi}</span></div>` : ''}
        </div>
      </div>
    </div>

    <div class="divider"></div>

    <!-- MOTIVO DE CONSULTA -->
    ${(h.motivo || h.desdeCuando) ? seccion('💬', 'Motivo de Consulta', `
      <table class="datos">
        ${fila('Motivo de visita', h.motivo)}
        ${fila('Desde cuándo', h.desdeCuando)}
        ${fila('Lo atribuye a', h.atribuye)}
        ${fila('¿Ha aumentado?', h.haAumentado)}
        ${fila('Medicamento', h.medicamento)}
      </table>
    `) : ''}

    <!-- ANTECEDENTES -->
    <div class="grid2">
      ${(h.ultimoExamen || h.usaLentes) ? seccion('🔬', 'Antec. Refractométricos', `
        <table class="datos">
          ${fila('Último examen', h.ultimoExamen)}
          ${fila('Usa lentes', h.usaLentes)}
          ${fila('Tiempo con lentes', h.tiempoLentes)}
          ${fila('Cambios de graduación', h.cambiosGraduacion)}
          ${fila('Usa lentes de contacto', h.usaContacto)}
          ${fila('Tiempo con contacto', h.tiempoContacto)}
          ${fila('Cirugía ocular', h.cirugia)}
        </table>
      `) : ''}
      ${antecedentes.length ? seccion('🧬', 'Antec. Heredofamiliares', `
        <div class="tags">${antecedentes.map(a=>`<span class="tag antec">${a}</span>`).join('')}</div>
      `) : ''}
    </div>

    <!-- REVISIÓN DE ANEXOS -->
    ${(h.parpados || h.conjuntiva) ? seccion('🔎', 'Revisión de Anexos', `
      <table class="datos">
        ${fila('Párpados', h.parpados)}
        ${fila('Pestañas', h.pestanas)}
        ${fila('Cejas', h.cejas)}
        ${fila('Conjuntiva', h.conjuntiva)}
        ${h.oftalmoscopia ? `<tr><td class="lbl" colspan="2" style="padding-top:8px;font-weight:700;color:#2E5C8A;">Oftalmoscopía / Retinoscopia</td></tr><tr><td colspan="2" class="val" style="background:#f0f6fb;padding:6px 8px;border-radius:6px;">${esc(h.oftalmoscopia)}</td></tr>` : ''}
      </table>
    `) : ''}

    <div class="divider"></div>

    <!-- SÍNTOMAS -->
    ${sintomas.length ? seccion('⚠️', 'Síntomas Reportados', `
      <div class="tags">${sintomas.map(s=>`<span class="tag sint">${s}</span>`).join('')}</div>
    `) : ''}

    <!-- DIAGNÓSTICO Y OBSERVACIONES -->
    ${h.diagnostico ? seccion('📝', 'Diagnóstico', `<div class="diag-box">${esc(h.diagnostico)}</div>`) : ''}
    ${h.observaciones ? seccion('📌', 'Observaciones', `<div class="obs-box">${esc(h.observaciones)}</div>`) : ''}

  </div>

  <!-- FOOTER -->
  <div class="footer footer-anchor">
    <div class="footer-brand">
      <img src="${logoURL}" alt="" class="footer-logo" onerror="this.style.display='none'" />
      <div class="footer-info">
        <div class="footer-nombre">Óptica Aurora</div>
        <div class="footer-sub">Sistema de Gestión Interno · ${new Date().toLocaleDateString('es-MX',{day:'2-digit',month:'long',year:'numeric'})}</div>
      </div>
    </div>
    <div class="firma-bloque">
      <div style="height:48px;"></div>
      <div class="firma-linea"></div>
      <div class="firma-nombre">Lic. Opt. Jorge Espinosa</div>
      <div class="firma-titulo">Optometrista Certificado</div>
      <div class="firma-ced">Óptica Aurora</div>
    </div>
  </div>
  <div class="wm-strip"></div>

</div>
</body>
</html>`;

  if (isPWA) {
    const frame = document.getElementById('print-frame');
    if (!frame) { showToast('Error al preparar impresión', 'error'); return; }
    frame.srcdoc = htmlExpediente;
    frame.onload = () => {
      try { frame.contentWindow.focus(); frame.contentWindow.print(); }
      catch(e) { showToast('No se pudo abrir el diálogo de impresión', 'warning'); }
    };
  } else {
    const win = window.open('', '_blank');
    if (!win) { showToast('Permite ventanas emergentes para imprimir expedientes', 'warning'); return; }
    win.document.write(htmlExpediente);
    win.document.close();
  }
}
function formatHora(hora, timestamp) {
  if (timestamp) {
    const d = new Date(timestamp);
    if (!isNaN(d)) {
      const h = d.getHours();
      const m = String(d.getMinutes()).padStart(2,'0');
      const periodo = h >= 12 ? 'pm' : 'am';
      const h12 = h % 12 || 12;
      return `${String(h12).padStart(2,'0')}:${m} ${periodo}`;
    }
  }

  if (!hora) return '—';
  const s = String(hora).trim();

  // Formato con am/pm (p.m. / a.m. / am / pm)
  const matchAmPm = s.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(a\.m\.|p\.m\.|am|pm)/i);
  if (matchAmPm) {
    const periodo = matchAmPm[3].toLowerCase().replace(/\./g,'');
    return `${matchAmPm[1].padStart(2,'0')}:${matchAmPm[2]} ${periodo}`;
  }

  // Formato 24h sin am/pm (HH:MM o HH:MM:SS)
  const match24 = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (match24) {
    const h = parseInt(match24[1]);
    const m = match24[2];
    const periodo = h >= 12 ? 'pm' : 'am';
    const h12 = h % 12 || 12;
    return `${String(h12).padStart(2,'0')}:${m} ${periodo}`;
  }

  return s; // Devolver como está si no coincide ningún patrón
}
function paginar(lista, seccion) {
  const cfg = STATE.paginacion[seccion];
  if (!cfg) return lista;
  const inicio = (cfg.pagina - 1) * cfg.porPagina;
  return lista.slice(inicio, inicio + cfg.porPagina);
}

function renderPaginacion(lista, seccion, onCambio) {
  const cfg = STATE.paginacion[seccion];
  if (!cfg || lista.length <= cfg.porPagina) {
    const el = document.getElementById(`paginacion-${seccion}`);
    if (el) el.innerHTML = '';
    return;
  }
  const totalPaginas = Math.ceil(lista.length / cfg.porPagina);
  const el = document.getElementById(`paginacion-${seccion}`);
  if (!el) return;

  let html = `<div class="paginacion">`;
  html += `<button class="pag-btn" ${cfg.pagina === 1 ? 'disabled' : ''} 
           onclick="${onCambio}(${cfg.pagina - 1})">‹</button>`;
  
  for (let i = 1; i <= totalPaginas; i++) {
    if (
      i === 1 || i === totalPaginas ||
      (i >= cfg.pagina - 2 && i <= cfg.pagina + 2)
    ) {
      html += `<button class="pag-btn ${i === cfg.pagina ? 'pag-activa' : ''}"
               onclick="${onCambio}(${i})">${i}</button>`;
    } else if (i === cfg.pagina - 3 || i === cfg.pagina + 3) {
      html += `<span class="pag-dots">…</span>`;
    }
  }

  html += `<button class="pag-btn" ${cfg.pagina === totalPaginas ? 'disabled' : ''} 
           onclick="${onCambio}(${cfg.pagina + 1})">›</button>`;
  html += `<span class="pag-info">${lista.length} registros · Página ${cfg.pagina} de ${totalPaginas}</span>`;
  html += `</div>`;
  el.innerHTML = html;
}

function cambiarPaginaClientes(p) {
  STATE.paginacion.clientes.pagina = p;
  const q = val('search-clientes').toLowerCase();
  const orden = val('sort-clientes');
  let lista = STATE.clientes.filter(c =>
    c.nombre?.toLowerCase().includes(q) ||
    c.telefono?.toLowerCase().includes(q) ||
    c.email?.toLowerCase().includes(q)
  );
  if (orden === 'nombre')      lista.sort((a,b) => (a.nombre||'').localeCompare(b.nombre||''));
  if (orden === 'nombre-desc') lista.sort((a,b) => (b.nombre||'').localeCompare(a.nombre||''));
  if (orden === 'reciente')    lista = lista.slice().reverse();
  renderClientes(lista);
}

function cambiarPaginaVentas(p) {
  STATE.paginacion.ventas.pagina = p;
  renderVentas(_filtrarVentasLista());
}

function cambiarPaginaPagos(pagina) {
  STATE.paginacion.pagos.pagina = pagina;
  const q      = val('search-pagos').toLowerCase();
  const metodo = val('filter-metodo-pago');
  const lista  = STATE.pagos
    .filter(pago => {
      const c = STATE.clientes.find(x => x.id == pago.clienteId);
      return (!q || c?.nombre?.toLowerCase().includes(q) || pago.clienteNombre?.toLowerCase().includes(q))
          && (!metodo || pago.metodo === metodo);
    })
    .sort((a, b) => {
      const fa = String(a.fecha || '0000-00-00');
      const fb = String(b.fecha || '0000-00-00');
      return fb.localeCompare(fa);
    });
  renderPagos(lista);
}

function cambiarPaginaHistorial(p) {
  STATE.paginacion.historial.pagina = p;
  const q = val('search-historial').toLowerCase();
  const lista = STATE.historial.filter(h => {
    const c = STATE.clientes.find(x => x.id == h.clienteId);
    return !q || c?.nombre?.toLowerCase().includes(q) || h.clienteNombre?.toLowerCase().includes(q);
  });
  renderHistorial(lista);
}
/* ══════════════════════════════════════════════════════════════
   📊  GRÁFICAS DE VENTAS — versión mejorada
══════════════════════════════════════════════════════════════ */

let _chartVentas    = null;
let _chartEstados   = null;
let _chartNumVentas = null;
let _periodoActual  = 'semana';

function cambiarPeriodo(periodo, btn) {
  _periodoActual = periodo;
  // Limpiar rango personalizado al usar los tabs
  const desde = document.getElementById('dash-fecha-desde');
  const hasta  = document.getElementById('dash-fecha-hasta');
  if (desde) desde.value = '';
  if (hasta)  hasta.value = '';
  document.querySelectorAll('.grafica-tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderGraficas();
}

function aplicarRangoPersonalizado() {
  const desde = document.getElementById('dash-fecha-desde')?.value;
  const hasta  = document.getElementById('dash-fecha-hasta')?.value;
  if (!desde || !hasta) return; // esperar a que ambas tengan valor
  if (desde > hasta) {
    showToast('La fecha inicial no puede ser mayor a la final', 'warning');
    return;
  }
  // Desactivar tabs visuales
  document.querySelectorAll('.grafica-tab').forEach(t => t.classList.remove('active'));
  renderGraficasRango(desde, hasta);
}

function limpiarRangoPersonalizado() {
  const desde = document.getElementById('dash-fecha-desde');
  const hasta  = document.getElementById('dash-fecha-hasta');
  if (desde) desde.value = '';
  if (hasta)  hasta.value = '';
  // Reactivar tab de semana
  const primerTab = document.querySelector('.grafica-tab');
  if (primerTab) { primerTab.classList.add('active'); _periodoActual = 'semana'; }
  renderGraficas();
}

function renderGraficasRango(desdeStr, hastaStr) {
  const rangoInicio = new Date(desdeStr + 'T00:00:00');
  const rangoFin    = new Date(hastaStr  + 'T23:59:59');
  const diffDias    = Math.round((rangoFin - rangoInicio) / (1000*60*60*24));

  const ventasFiltradas = STATE.ventas.filter(v => {
    if (!v.fecha) return false;
    const fv = new Date(v.fecha + 'T12:00:00');
    return fv >= rangoInicio && fv <= rangoFin;
  });

  // Generar labels dinámicos según el rango
  let labels = [];
  let datosIngresos = [];
  let datosNumVentas = [];

  if (diffDias <= 14) {
    // Día a día
    for (let i = 0; i <= diffDias; i++) {
      const d = new Date(rangoInicio);
      d.setDate(rangoInicio.getDate() + i);
      const dStr = fechaLocal(d);
      labels.push(d.toLocaleDateString('es-MX', { weekday:'short', day:'2-digit', month:'short' }));
      const grupo = ventasFiltradas.filter(v => v.fecha === dStr);
      datosIngresos.push(grupo.reduce((s,v) => s + parseFloat(v.totalFinal||0), 0));
      datosNumVentas.push(grupo.length);
    }
  } else if (diffDias <= 60) {
    // Semanas
    const semanas = Math.ceil(diffDias / 7);
    for (let i = 0; i < semanas; i++) {
      const ini = new Date(rangoInicio); ini.setDate(rangoInicio.getDate() + i*7);
      const fin = new Date(ini); fin.setDate(ini.getDate() + 6); fin.setHours(23,59,59);
      const finReal = fin > rangoFin ? rangoFin : fin;
      labels.push(ini.toLocaleDateString('es-MX',{day:'2-digit',month:'short'}) + '–' + finReal.toLocaleDateString('es-MX',{day:'2-digit'}));
      const grupo = ventasFiltradas.filter(v => {
        if (!v.fecha) return false;
        const fv = new Date(v.fecha+'T12:00:00');
        return fv >= ini && fv <= finReal;
      });
      datosIngresos.push(grupo.reduce((s,v) => s+parseFloat(v.totalFinal||0),0));
      datosNumVentas.push(grupo.length);
    }
  } else {
    // Por mes
    const meses = new Map();
    ventasFiltradas.forEach(v => {
      if (!v.fecha) return;
      const key = v.fecha.substring(0,7);
      if (!meses.has(key)) meses.set(key, { total:0, count:0 });
      meses.get(key).total += parseFloat(v.totalFinal||0);
      meses.get(key).count++;
    });
    [...meses.keys()].sort().forEach(k => {
      const [y,m] = k.split('-');
      labels.push(new Date(parseInt(y),parseInt(m)-1,1).toLocaleDateString('es-MX',{month:'short',year:'2-digit'}));
      datosIngresos.push(meses.get(k).total);
      datosNumVentas.push(meses.get(k).count);
    });
  }

  // KPIs del rango
  const totalPeriodo   = ventasFiltradas.reduce((s,v) => s+parseFloat(v.totalFinal||0),0);
  const numVentas      = ventasFiltradas.length;
  const cobradoPeriodo = ventasFiltradas.reduce((s,v) => s+calcularPagado(v.id),0);
  const pendiente      = Math.max(0, totalPeriodo - cobradoPeriodo);
  const garantias      = ventasFiltradas.filter(v => v.tipo==='garantia'||v.tipo==='cambio').length;
  const tasaCobro      = totalPeriodo > 0 ? Math.round((cobradoPeriodo/totalPeriodo)*100) : 0;
  const idsEnPeriodo   = new Set(ventasFiltradas.map(v => String(v.clienteId)));
  const ventasFuera    = STATE.ventas.filter(v => v.fecha && new Date(v.fecha+'T12:00:00') < rangoInicio);
  const idsAnteriores  = new Set(ventasFuera.map(v => String(v.clienteId)));
  const nuevos         = [...idsEnPeriodo].filter(id => !idsAnteriores.has(id)).length;
  const pagadasP  = ventasFiltradas.filter(v => calcularEstadoVenta(v)==='pagado').length;
  const parcialesP= ventasFiltradas.filter(v => calcularEstadoVenta(v)==='parcial').length;
  const deudasP   = ventasFiltradas.filter(v => calcularEstadoVenta(v)==='deuda').length;

  setHTML('grafica-kpi-total',  formatMoney(totalPeriodo));
  setHTML('grafica-kpi-ventas', numVentas + ' ventas');
  setHTML('m-promedio',         numVentas > 0 ? formatMoney(totalPeriodo/numVentas) : '$0.00');
  setHTML('m-cobrado',          formatMoney(cobradoPeriodo));
  setHTML('m-pendiente-periodo',formatMoney(pendiente));
  setHTML('m-garantias',        garantias);
  setHTML('m-nuevos-clientes',  nuevos);
  setHTML('m-tasa-cobro',       tasaCobro + '%');

  // Redibujar gráficas con los datos del rango
  _redibujarCharts(labels, datosIngresos, datosNumVentas, [], [], pagadasP, parcialesP, deudasP);
}

function _redibujarCharts(labels, datosIngresos, datosNumVentas, datosIngresosAnt, datosNumVentasAnt, pagadasPer, parcialesPer, deudasPer) {
  const azul = '#2E5C8A', turquesa = '#4FC3C7', verde = '#4CAF50', rojo = '#E53935', amarillo = '#FBC02D';

  const ctx1 = document.getElementById('chart-ventas')?.getContext('2d');
  if (ctx1) {
    if (_chartVentas) _chartVentas.destroy();
    _chartVentas = new Chart(ctx1, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Ingresos',
          data: datosIngresos,
          backgroundColor: 'rgba(46,92,138,0.18)',
          borderColor: azul,
          borderWidth: 1.5,
          borderRadius: 7,
          borderSkipped: false,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => ` ${formatMoney(ctx.raw)}` }, backgroundColor:'#1F3A5F', titleColor:'#7EC8CB', bodyColor:'#fff', cornerRadius:8, padding:12 }
        },
        scales: {
          x: { grid:{display:false}, ticks:{color:'#8A9BB0',font:{size:10}} },
          y: { grid:{color:'rgba(0,0,0,0.04)'}, ticks:{color:'#8A9BB0',font:{size:10},callback:v=>v>=1000?'$'+(v/1000).toFixed(0)+'k':'$'+v}, beginAtZero:true }
        }
      }
    });
  }

  const ctx2 = document.getElementById('chart-estados')?.getContext('2d');
  if (ctx2) {
    if (_chartEstados) _chartEstados.destroy();
    const totalD = pagadasPer + parcialesPer + deudasPer;
    _chartEstados = new Chart(ctx2, {
      type: 'doughnut',
      data: {
        labels: ['Pagadas','Parciales','Con deuda'],
        datasets: [{ data: totalD>0?[pagadasPer,parcialesPer,deudasPer]:[1,0,0], backgroundColor: totalD>0?[verde,amarillo,rojo]:['#e0e0e0'], borderColor:'#fff', borderWidth:3, hoverOffset:8 }]
      },
      options: { responsive:true, maintainAspectRatio:false, cutout:'70%', plugins:{legend:{display:false}} }
    });
    const leyenda = document.getElementById('donut-leyenda');
    if (leyenda) {
      leyenda.innerHTML = totalD===0 ? '<div style="text-align:center;color:var(--gris-label);font-size:.8rem;padding:.5rem">Sin ventas en este rango</div>'
        : [
            {color:verde,   label:'Pagadas',   val:pagadasPer},
            {color:amarillo,label:'Parciales',  val:parcialesPer},
            {color:rojo,    label:'Con deuda',  val:deudasPer},
          ].map(item=>`<div class="donut-item"><span class="donut-dot" style="background:${item.color}"></span><span class="donut-label">${item.label}</span><span class="donut-num">${item.val}</span><span class="donut-pct">${totalD>0?Math.round(item.val/totalD*100):0}%</span></div>`).join('');
    }
  }

  const ctx3 = document.getElementById('chart-num-ventas')?.getContext('2d');
  if (ctx3) {
    if (_chartNumVentas) _chartNumVentas.destroy();
    const gradLinea = ctx3.createLinearGradient(0,0,0,220);
    gradLinea.addColorStop(0,'rgba(79,195,199,0.25)');
    gradLinea.addColorStop(1,'rgba(79,195,199,0.02)');
    _chartNumVentas = new Chart(ctx3, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Ventas',
          data: datosNumVentas,
          borderColor: turquesa,
          backgroundColor: gradLinea,
          borderWidth: 2.5,
          pointBackgroundColor: turquesa,
          pointBorderColor: '#fff',
          pointBorderWidth: 2,
          pointRadius: 4,
          fill: true,
          tension: 0.4,
        }]
      },
      options: {
        responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{display:false}, tooltip:{callbacks:{label:ctx=>` ${ctx.raw} venta${ctx.raw!==1?'s':''}`}, backgroundColor:'#1F3A5F',titleColor:'#7EC8CB',bodyColor:'#fff',cornerRadius:8,padding:12} },
        scales:{ x:{grid:{display:false},ticks:{color:'#8A9BB0',font:{size:10}}}, y:{grid:{color:'rgba(0,0,0,0.04)'},ticks:{color:'#8A9BB0',font:{size:10},stepSize:1,precision:0},beginAtZero:true} }
      }
    });
  }
}

// Convierte Date a string local yyyy-MM-dd sin conversión UTC
function fechaLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// Genera rango de fechas del período anterior (para comparar)
function getRangoComparacion(periodo, hoy) {
  const fin = new Date(hoy);
  const ini = new Date(hoy);
  if (periodo === 'semana') {
    // Semana anterior: hace 14 → hace 8 días
    fin.setDate(hoy.getDate() - 7);
    ini.setDate(hoy.getDate() - 13);
  } else if (periodo === 'mes') {
    // 30 días anteriores al rango actual (días 30–59 hacia atrás)
    fin.setDate(hoy.getDate() - 30);
    ini.setDate(hoy.getDate() - 59);
  } else {
    // Año anterior
    fin.setFullYear(hoy.getFullYear() - 1, 11, 31);
    ini.setFullYear(hoy.getFullYear() - 1, 0, 1);
  }
  ini.setHours(0,0,0,0);
  fin.setHours(23,59,59,999);
  return { ini, fin };
}

function renderGraficas() {
  if (typeof Chart === 'undefined') {
    console.warn('Chart.js no está disponible aún');
    return;
  }
  const periodo = _periodoActual;
  const hoy = new Date();
  hoy.setHours(23, 59, 59, 999);

  // ── Generar labels y rango ──
  let labels = [];
  let rangoInicio;

  if (periodo === 'semana') {
    rangoInicio = new Date(hoy);
    rangoInicio.setDate(hoy.getDate() - 6);
    rangoInicio.setHours(0,0,0,0);
    for (let i = 6; i >= 0; i--) {
      const d = new Date(hoy);
      d.setDate(hoy.getDate() - i);
      labels.push(d.toLocaleDateString('es-MX', { weekday: 'short', day: '2-digit' }));
    }
  } else if (periodo === 'mes') {
    // Últimos 30 días agrupados en 6 bloques de 5 días
    rangoInicio = new Date(hoy);
    rangoInicio.setDate(hoy.getDate() - 29);
    rangoInicio.setHours(0,0,0,0);
    for (let i = 5; i >= 0; i--) {
      const fin = new Date(hoy);
      fin.setDate(hoy.getDate() - i * 5);
      const ini = new Date(fin);
      ini.setDate(fin.getDate() - 4);
      labels.push(
        ini.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }) +
        '–' +
        fin.toLocaleDateString('es-MX', { day: '2-digit' })
      );
    }
  } else {
    // Últimos 12 meses
    rangoInicio = new Date(hoy);
    rangoInicio.setMonth(hoy.getMonth() - 11);
    rangoInicio.setDate(1);
    rangoInicio.setHours(0,0,0,0);
    for (let i = 11; i >= 0; i--) {
      const d = new Date(hoy);
      d.setMonth(hoy.getMonth() - i);
      labels.push(d.toLocaleDateString('es-MX', { month: 'short', year: '2-digit' }));
    }
  }

  // ── Filtrar ventas del período actual ──
  const ventasFiltradas = STATE.ventas.filter(v => {
    if (!v.fecha) return false;
    const fv = new Date(v.fecha + 'T12:00:00');
    return fv >= rangoInicio && fv <= hoy;
  });

  // ── Filtrar ventas del período anterior (para comparativa) ──
  const { ini: iniAnt, fin: finAnt } = getRangoComparacion(periodo, hoy);
  const ventasAnteriores = STATE.ventas.filter(v => {
    if (!v.fecha) return false;
    const fv = new Date(v.fecha + 'T12:00:00');
    return fv >= iniAnt && fv <= finAnt;
  });

  // ── Calcular datos de gráficas ──
  const datosIngresos       = agruparVentas(ventasFiltradas, periodo, hoy, 'totalFinal');
  const datosNumVentas      = agruparVentas(ventasFiltradas, periodo, hoy, 'count');
  const datosIngresosAnt    = agruparVentas(ventasAnteriores, periodo, finAnt, 'totalFinal');
  const datosNumVentasAnt   = agruparVentas(ventasAnteriores, periodo, finAnt, 'count');

  // ── KPIs del período ──
  const totalPeriodo      = ventasFiltradas.reduce((s,v) => s + parseFloat(v.totalFinal||0), 0);
  const totalAnterior     = ventasAnteriores.reduce((s,v) => s + parseFloat(v.totalFinal||0), 0);
  const numVentas         = ventasFiltradas.length;
  const numVentasAnt      = ventasAnteriores.length;
  const cobradoPeriodo    = ventasFiltradas.reduce((s,v) => s + calcularPagado(v.id), 0);
  const pendientePeriodo  = Math.max(0, totalPeriodo - cobradoPeriodo);
  const garantiasCambios  = ventasFiltradas.filter(v => v.tipo==='garantia'||v.tipo==='cambio').length;
  const tasaCobro         = totalPeriodo > 0 ? Math.round((cobradoPeriodo / totalPeriodo) * 100) : 0;

  // Tendencia vs período anterior
  const tendenciaIngresos = totalAnterior > 0
    ? Math.round(((totalPeriodo - totalAnterior) / totalAnterior) * 100)
    : null;
  const tendenciaVentas = numVentasAnt > 0
    ? Math.round(((numVentas - numVentasAnt) / numVentasAnt) * 100)
    : null;

  // Nuevos clientes reales en el período
  const idsEnPeriodo  = new Set(ventasFiltradas.map(v => String(v.clienteId)));
  const ventasFuera   = STATE.ventas.filter(v => {
    if (!v.fecha) return false;
    const fv = new Date(v.fecha + 'T12:00:00');
    return fv < rangoInicio;
  });
  const idsAnteriores = new Set(ventasFuera.map(v => String(v.clienteId)));
  const clientesNuevos = [...idsEnPeriodo].filter(id => !idsAnteriores.has(id));

  // ── Estado de cuentas SOLO del período ──
  const pagadasPer   = ventasFiltradas.filter(v => calcularEstadoVenta(v)==='pagado').length;
  const parcialesPer = ventasFiltradas.filter(v => calcularEstadoVenta(v)==='parcial').length;
  const deudasPer    = ventasFiltradas.filter(v => calcularEstadoVenta(v)==='deuda').length;

  // ── Actualizar KPIs ──
  setHTML('grafica-kpi-total',  formatMoney(totalPeriodo) + tendenciaBadge(tendenciaIngresos));
  setHTML('grafica-kpi-ventas', numVentas + ' ventas' + tendenciaBadge(tendenciaVentas));
  setHTML('m-promedio',         numVentas > 0 ? formatMoney(totalPeriodo / numVentas) : '$0.00');
  setHTML('m-cobrado',          formatMoney(cobradoPeriodo));
  setHTML('m-pendiente-periodo',formatMoney(pendientePeriodo));
  setHTML('m-garantias',        garantiasCambios);
  setHTML('m-nuevos-clientes',  clientesNuevos.length);
  setHTML('m-tasa-cobro',       tasaCobro + '%');

  // ── Colores ──
  const azul     = '#2E5C8A';
  const turquesa = '#4FC3C7';
  const verde    = '#4CAF50';
  const rojo     = '#E53935';
  const amarillo = '#FBC02D';
  const azulClaro = 'rgba(46,92,138,0.15)';
  const turqFade  = 'rgba(79,195,199,0.15)';

  // ── CHART 1: Ingresos con línea de período anterior ──
  const ctx1 = document.getElementById('chart-ventas')?.getContext('2d');
  if (ctx1) {
    if (_chartVentas) _chartVentas.destroy();

    // Gradiente de relleno
    const gradiente = ctx1.createLinearGradient(0, 0, 0, 220);
    gradiente.addColorStop(0, 'rgba(46,92,138,0.35)');
    gradiente.addColorStop(1, 'rgba(46,92,138,0.02)');

    const gradAnt = ctx1.createLinearGradient(0, 0, 0, 220);
    gradAnt.addColorStop(0, 'rgba(79,195,199,0.2)');
    gradAnt.addColorStop(1, 'rgba(79,195,199,0.02)');

    _chartVentas = new Chart(ctx1, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Período actual',
            data: datosIngresos,
            backgroundColor: datosIngresos.map((v,i) =>
              i === datosIngresos.length - 1 ? turquesa : azulClaro
            ),
            borderColor: datosIngresos.map((v,i) =>
              i === datosIngresos.length - 1 ? turquesa : azul
            ),
            borderWidth: 1.5,
            borderRadius: 7,
            borderSkipped: false,
            order: 2,
          },
          {
            label: 'Período anterior',
            data: datosIngresosAnt,
            type: 'line',
            borderColor: 'rgba(79,195,199,0.6)',
            backgroundColor: 'transparent',
            borderWidth: 2,
            borderDash: [5, 4],
            pointRadius: 3,
            pointBackgroundColor: turquesa,
            pointBorderColor: '#fff',
            pointBorderWidth: 1.5,
            tension: 0.4,
            fill: false,
            order: 1,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            align: 'end',
            labels: {
              boxWidth: 10,
              boxHeight: 10,
              borderRadius: 3,
              font: { size: 11, family: "'Sora', sans-serif" },
              color: '#8A9BB0',
              padding: 12,
            }
          },
          tooltip: {
            callbacks: {
              label: ctx => ` ${ctx.dataset.label}: ${formatMoney(ctx.raw)}`,
            },
            backgroundColor: '#1F3A5F',
            titleColor: '#7EC8CB',
            bodyColor: '#fff',
            cornerRadius: 8,
            padding: 12,
            boxPadding: 4,
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: '#8A9BB0', font: { size: 11 } },
          },
          y: {
            grid: { color: 'rgba(0,0,0,0.04)', drawBorder: false },
            ticks: {
              color: '#8A9BB0',
              font: { size: 11 },
              callback: v => v >= 1000 ? '$' + (v/1000).toFixed(0) + 'k' : '$' + v,
            },
            beginAtZero: true,
          }
        }
      }
    });
  }

  // ── CHART 2: Estado de cuentas del PERÍODO (donut) ──
  const ctx2 = document.getElementById('chart-estados')?.getContext('2d');
  if (ctx2) {
    if (_chartEstados) _chartEstados.destroy();
    const totalDonut = pagadasPer + parcialesPer + deudasPer;
    _chartEstados = new Chart(ctx2, {
      type: 'doughnut',
      data: {
        labels: ['Pagadas', 'Parciales', 'Con deuda'],
        datasets: [{
          data: totalDonut > 0 ? [pagadasPer, parcialesPer, deudasPer] : [1, 0, 0],
          backgroundColor: totalDonut > 0 ? [verde, amarillo, rojo] : ['#e0e0e0'],
          borderColor: '#fff',
          borderWidth: 3,
          hoverOffset: 8,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '70%',
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: ctx => {
                if (totalDonut === 0) return ' Sin ventas en este período';
                const pct = Math.round((ctx.raw / totalDonut) * 100);
                return ` ${ctx.label}: ${ctx.raw} (${pct}%)`;
              }
            },
            backgroundColor: '#1F3A5F',
            titleColor: '#7EC8CB',
            bodyColor: '#fff',
            cornerRadius: 8,
            padding: 12,
          }
        }
      }
    });

    // Leyenda personalizada — muestra datos del período seleccionado
    const leyenda = document.getElementById('donut-leyenda');
    if (leyenda) {
      if (totalDonut === 0) {
        leyenda.innerHTML = '<div style="text-align:center;color:var(--gris-label);font-size:.8rem;padding:.5rem">Sin ventas en este período</div>';
      } else {
        leyenda.innerHTML = [
          { color: verde,    label: 'Pagadas',   val: pagadasPer },
          { color: amarillo, label: 'Parciales',  val: parcialesPer },
          { color: rojo,     label: 'Con deuda',  val: deudasPer },
        ].map(item => `
          <div class="donut-item">
            <span class="donut-dot" style="background:${item.color}"></span>
            <span class="donut-label">${item.label}</span>
            <span class="donut-num">${item.val}</span>
            <span class="donut-pct">${totalDonut > 0 ? Math.round(item.val/totalDonut*100) : 0}%</span>
          </div>
        `).join('');
      }
    }
  }

  // ── CHART 3: Número de ventas (línea + área rellena) ──
  const ctx3 = document.getElementById('chart-num-ventas')?.getContext('2d');
  if (ctx3) {
    if (_chartNumVentas) _chartNumVentas.destroy();

    const gradLinea = ctx3.createLinearGradient(0, 0, 0, 220);
    gradLinea.addColorStop(0, 'rgba(79,195,199,0.25)');
    gradLinea.addColorStop(1, 'rgba(79,195,199,0.02)');

    _chartNumVentas = new Chart(ctx3, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Ventas actuales',
            data: datosNumVentas,
            borderColor: turquesa,
            backgroundColor: gradLinea,
            borderWidth: 2.5,
            pointBackgroundColor: turquesa,
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 7,
            fill: true,
            tension: 0.4,
            order: 1,
          },
          {
            label: 'Período anterior',
            data: datosNumVentasAnt,
            borderColor: 'rgba(46,92,138,0.4)',
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            borderDash: [5, 4],
            pointRadius: 2,
            pointBackgroundColor: azul,
            fill: false,
            tension: 0.4,
            order: 2,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            align: 'end',
            labels: {
              boxWidth: 10, boxHeight: 10, borderRadius: 3,
              font: { size: 11, family: "'Sora', sans-serif" },
              color: '#8A9BB0', padding: 12,
            }
          },
          tooltip: {
            callbacks: {
              label: ctx => ` ${ctx.dataset.label}: ${ctx.raw} venta${ctx.raw !== 1 ? 's' : ''}`,
            },
            backgroundColor: '#1F3A5F',
            titleColor: '#7EC8CB',
            bodyColor: '#fff',
            cornerRadius: 8,
            padding: 12,
            boxPadding: 4,
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: '#8A9BB0', font: { size: 11 } },
          },
          y: {
            grid: { color: 'rgba(0,0,0,0.04)' },
            ticks: {
              color: '#8A9BB0', font: { size: 11 },
              stepSize: 1, precision: 0,
            },
            beginAtZero: true,
          }
        }
      }
    });
  }
}

// Genera badge HTML de tendencia (+12% / -5%)
function tendenciaBadge(pct) {
  if (pct === null || isNaN(pct)) return '';
  const sube  = pct >= 0;
  const color = sube ? '#4CAF50' : '#E53935';
  const icono = sube ? '▲' : '▼';
  return ` <span style="font-size:.68rem;font-weight:700;color:${color};margin-left:.3rem;">${icono} ${Math.abs(pct)}%</span>`;
}

function agruparVentas(ventas, periodo, hoyRef, campo) {
  const hoy = new Date(hoyRef);
  hoy.setHours(23,59,59,999);

  if (periodo === 'semana') {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(hoy);
      d.setDate(hoy.getDate() - (6 - i));
      const dStr = fechaLocal(d);
      const grupo = ventas.filter(v => v.fecha === dStr);
      return campo === 'count'
        ? grupo.length
        : grupo.reduce((s, v) => s + parseFloat(v.totalFinal || 0), 0);
    });
  }

  if (periodo === 'mes') {
    // 6 bloques de 5 días, del más antiguo al más reciente
    return Array.from({ length: 6 }, (_, i) => {
      const fin = new Date(hoy);
      fin.setDate(hoy.getDate() - (5 - i) * 5);
      fin.setHours(23,59,59,999);
      const ini = new Date(fin);
      ini.setDate(fin.getDate() - 4);
      ini.setHours(0,0,0,0);
      const grupo = ventas.filter(v => {
        if (!v.fecha) return false;
        const fv = new Date(v.fecha + 'T12:00:00');
        return fv >= ini && fv <= fin;
      });
      return campo === 'count'
        ? grupo.length
        : grupo.reduce((s, v) => s + parseFloat(v.totalFinal || 0), 0);
    });
  }

// año: últimos 12 meses
  if (periodo === 'año') {
    return Array.from({ length: 12 }, (_, i) => {
      const d = new Date(hoy.getFullYear(), hoy.getMonth() - (11 - i), 1);
      const mes = d.getMonth();
      const año = d.getFullYear();
      const grupo = ventas.filter(v => {
        if (!v.fecha) return false;
        const fv = new Date(v.fecha + 'T12:00:00');
        return fv.getMonth() === mes && fv.getFullYear() === año;
      });
      return campo === 'count'
        ? grupo.length
        : grupo.reduce((s, v) => s + parseFloat(v.totalFinal || 0), 0);
    });
  }
console.warn('agruparVentas: período desconocido →', periodo);
const n = periodo === 'año' ? 12 : periodo === 'mes' ? 6 : 7;
return Array(n).fill(0);
} 

/* ══════════════════════════════════════════════════════════════
   🧾  TICKETS DE VENTA
══════════════════════════════════════════════════════════════ */

function imprimirTicket(ventaId) {
  const v = STATE.ventas.find(x => String(x.id) === String(ventaId));
  if (!v) return;
  const cliente  = STATE.clientes.find(c => String(c.id) === String(v.clienteId));
  const pagado   = calcularPagado(ventaId);
  const saldo    = Math.max(0, parseFloat(v.totalFinal || 0) - pagado);
  const pagos    = STATE.pagos.filter(p => String(p.ventaId) === String(ventaId));
  const logoURL  = window.location.origin + window.location.pathname.replace(/[^/]*$/, '') + 'Logo-optica.ico';
  const fechaHoy = new Date().toLocaleDateString('es-MX', { day:'2-digit', month:'long', year:'numeric' });

  const isPWA = window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;

  // Abrir ventana SINCRÓNICAMENTE antes de cualquier await para evitar bloqueo en Safari
  let winRef = null;
  if (!isPWA) {
    winRef = window.open('', '_blank', 'width=420,height=700');
    if (!winRef) {
      showToast('Permite ventanas emergentes para imprimir tickets', 'warning');
      return;
    }
    // Mostrar placeholder mientras se construye el HTML
    winRef.document.write('<html><body style="font-family:sans-serif;padding:2rem;color:#555">Preparando ticket...</body></html>');
  }

  const htmlContent = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Ticket — ${cliente?.nombre || ''}</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:'Inter',monospace;background:#f0f2f5;display:flex;flex-direction:column;align-items:center;padding:20px;min-height:100vh;}
    .btn-print{background:linear-gradient(135deg,#1F3A5F,#2E5C8A);color:#fff;border:none;padding:10px 28px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;margin-bottom:16px;font-family:'Inter',sans-serif;}
    .btn-print:hover{opacity:.9;}
    .ticket{background:#fff;width:320px;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.15);overflow:hidden;}
    .t-header{background:linear-gradient(135deg,#1F3A5F,#2E5C8A);padding:20px 16px 16px;text-align:center;}
    .t-logo{width:48px;height:48px;border-radius:10px;object-fit:contain;background:rgba(255,255,255,.12);padding:3px;margin-bottom:8px;}
    .t-marca{font-size:10px;letter-spacing:.22em;color:#7EC8CB;font-weight:600;}
    .t-nombre{font-size:20px;font-weight:800;color:#fff;letter-spacing:.04em;}
    .t-sub{font-size:10px;color:rgba(255,255,255,.5);margin-top:3px;}
    .t-accent{height:3px;background:linear-gradient(90deg,#4FC3C7,#38a8ac,#4FC3C7);}
    .t-cliente{padding:14px 16px;border-bottom:1px dashed #e0e6ed;background:#f8fafc;}
    .t-cliente-nombre{font-size:13px;font-weight:700;color:#1F3A5F;}
    .t-cliente-tel{font-size:11px;color:#8A9BB0;margin-top:2px;}
    .t-folio{display:flex;justify-content:space-between;align-items:center;margin-top:6px;}
    .t-folio-label{font-size:9px;font-weight:700;letter-spacing:.12em;color:#aab;text-transform:uppercase;}
    .t-folio-val{font-size:11px;font-family:monospace;color:#2E5C8A;font-weight:700;}
    .t-body{padding:14px 16px;}
    .t-section-title{font-size:9px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#8A9BB0;margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid #eef;}
    .t-row{display:flex;justify-content:space-between;align-items:center;padding:4px 0;font-size:12px;}
    .t-row .label{color:#5A6A7E;flex:1;}
    .t-row .value{font-weight:600;color:#1F3A5F;font-family:monospace;}
    .t-row.total{border-top:2px solid #1F3A5F;margin-top:8px;padding-top:8px;}
    .t-row.total .label{font-weight:700;color:#1F3A5F;font-size:13px;}
    .t-row.total .value{font-size:15px;font-weight:800;color:#1F3A5F;}
    .t-row.pagado .value{color:#4CAF50;}
    .t-row.saldo .value{color:${saldo > 0 ? '#E53935' : '#4CAF50'};}
    .t-tipo{display:inline-block;padding:2px 10px;border-radius:99px;font-size:10px;font-weight:700;background:${v.tipo==='garantia'?'#E8F5E9':v.tipo==='cambio'?'#FFF8E1':'rgba(46,92,138,.1)'};color:${v.tipo==='garantia'?'#2e7d32':v.tipo==='cambio'?'#b8860b':'#2E5C8A'};margin-bottom:10px;}
    .t-pagos{background:#f4f8fb;border-radius:8px;padding:10px 12px;margin:10px 0;}
    .t-pago-row{display:flex;justify-content:space-between;font-size:11px;padding:3px 0;color:#5A6A7E;}
    .t-pago-row .monto{font-weight:600;color:#4CAF50;font-family:monospace;}
    .t-estado{text-align:center;padding:10px;border-radius:8px;margin:12px 0;background:${saldo===0?'#E8F5E9':'#FFF8E1'};border:1.5px solid ${saldo===0?'#a8d5b0':'#f0d070'};}
    .t-estado-text{font-size:12px;font-weight:700;color:${saldo===0?'#2e7d32':'#b8860b'};}
    .t-footer{background:#f4f8fb;padding:12px 16px;text-align:center;border-top:1px dashed #e0e6ed;}
    .t-gracias{font-size:12px;font-weight:700;color:#1F3A5F;margin-bottom:4px;}
    .t-footer-sub{font-size:10px;color:#8A9BB0;line-height:1.5;}
    .t-corte{text-align:center;color:#ccc;font-size:11px;margin:10px 0;letter-spacing:.1em;}
    @media print{body{background:#fff;padding:0;}.ticket{box-shadow:none;border-radius:0;width:100%;}.btn-print{display:none;}}
  </style>
</head>
<body>
<button class="btn-print" onclick="window.print()">🖨️ Imprimir Ticket</button>
<div class="ticket">
  <div class="t-header">
    <img src="${logoURL}" class="t-logo" onerror="this.style.display='none'" />
    <div class="t-marca">ÓPTICA</div>
    <div class="t-nombre">AURORA</div>
    <div class="t-sub">Sistema de Gestión Interno</div>
  </div>
  <div class="t-accent"></div>
  <div class="t-cliente">
    <div class="t-cliente-nombre">${esc(cliente?.nombre || v.clienteNombre || 'Cliente')}</div>
    <div class="t-cliente-tel">${cliente?.telefono ? '📱 ' + cliente.telefono : ''}</div>
    <div class="t-folio">
      <span class="t-folio-label">Folio</span>
      <span class="t-folio-val">#${String(ventaId).slice(-8).toUpperCase()}</span>
    </div>
  </div>
  <div class="t-body">
    <span class="t-tipo">${capitalize(v.tipo || 'normal')}</span>
    <div class="t-section-title">Detalle del producto</div>
    <div class="t-row"><span class="label">Tipo de lente</span><span class="value">${esc(v.tipoLente || '—')}</span></div>
    ${(v.cantidad && parseInt(v.cantidad) > 1) ? `<div class="t-row"><span class="label">Cantidad</span><span class="value">${v.cantidad}</span></div>` : ''}
    <div class="t-row"><span class="label">Precio unitario</span><span class="value">${formatMoney(v.precio || v.totalFinal)}</span></div>
    <div class="t-row"><span class="label">Fecha</span><span class="value">${esc(v.fecha || '—')}</span></div>
    ${v.descuento > 0 ? `<div class="t-row"><span class="label">Precio base</span><span class="value">${formatMoney(v.precio)}</span></div><div class="t-row"><span class="label">Descuento</span><span class="value">-${formatMoney(v.descuento)}</span></div>` : ''}
    ${v.diferencia > 0 ? `<div class="t-row"><span class="label">Diferencia cambio</span><span class="value">+${formatMoney(v.diferencia)}</span></div>` : ''}
    <div class="t-row total"><span class="label">TOTAL</span><span class="value">${formatMoney(v.totalFinal)}</span></div>
    ${pagos.length ? `<div class="t-pagos"><div class="t-section-title" style="margin-bottom:6px;">Pagos registrados</div>${pagos.map(p => `<div class="t-pago-row"><span>${esc(p.fecha)} · ${capitalize(p.metodo || '')}</span><span class="monto">${formatMoney(p.monto)}</span></div>`).join('')}</div>` : ''}
    <div class="t-row pagado"><span class="label">Total pagado</span><span class="value">${formatMoney(pagado)}</span></div>
    <div class="t-row saldo"><span class="label">Saldo pendiente</span><span class="value">${formatMoney(saldo)}</span></div>
    <div class="t-estado"><div class="t-estado-text">${saldo === 0 ? '✓ CUENTA SALDADA' : `⚠️ PENDIENTE: ${formatMoney(saldo)}`}</div></div>
  </div>
  <div class="t-corte">- - - - - - - - - - - - - - - - - -</div>
  <div class="t-footer">
    <div class="t-gracias">¡Gracias por su preferencia!</div>
    <div class="t-footer-sub">Óptica Aurora<br>Teziutlán, Pue. · Tel: (282) 129-2915<br>Impreso: ${fechaHoy}</div>
  </div>
</div>
</body></html>`;

  if (isPWA) {
    const frame = document.getElementById('print-frame');
    if (!frame) { showToast('Error al preparar impresión', 'error'); return; }
    frame.srcdoc = htmlContent;
    frame.onload = () => {
      try { frame.contentWindow.focus(); frame.contentWindow.print(); }
      catch(e) { showToast('No se pudo abrir el diálogo de impresión', 'warning'); }
    };
  } else {
    // winRef ya está abierto sincrónicamente arriba
    winRef.document.open();
    winRef.document.write(htmlContent);
    winRef.document.close();
  }
}

async function enviarTicketEmail(ventaId) {
  const v = STATE.ventas.find(x => String(x.id) === String(ventaId));
  if (!v) return;
  const cliente = STATE.clientes.find(c => String(c.id) === String(v.clienteId));

  if (!cliente?.email) {
    showToast('Este cliente no tiene correo registrado', 'warning');
    return;
  }
  if (typeof emailjs === 'undefined') {
    showToast('Servicio de correo no disponible. Recarga la página.', 'error');
    return;
  }

  const pagado = calcularPagado(ventaId);
  const saldo  = Math.max(0, parseFloat(v.totalFinal || 0) - pagado);
  const pagos  = STATE.pagos.filter(p => String(p.ventaId) === String(ventaId));
  const folio  = String(ventaId).slice(-8).toUpperCase();

  const resumenPagos = pagos.map(p =>
    `• ${p.fecha} — ${capitalize(p.metodo || '')} — ${formatMoney(p.monto)}`
  ).join('\n');

  showLoading('Enviando ticket por correo...');
  try {
    await emailjs.send(CONFIG.EMAILJS.SERVICE_ID, CONFIG.EMAILJS.TEMPLATE_GRACIAS, {
      to_name:     cliente.nombre,
      to_email:    cliente.email,
      saldo:       formatMoney(saldo),
      ultimo_pago: resumenPagos || 'Sin pagos registrados',
      mensaje: `
Folio: #${folio}
Producto: ${String(v.tipoLente || '—').replace(/[<>&"]/g, '')}
Tipo: ${capitalize(v.tipo || 'normal')}
Fecha: ${v.fecha || '—'}

Total: ${formatMoney(v.totalFinal)}
Pagado: ${formatMoney(pagado)}
Saldo pendiente: ${formatMoney(saldo)}

${saldo === 0 ? '✓ Su cuenta está completamente saldada.' : `⚠️ Recuerde que tiene un saldo pendiente de ${formatMoney(saldo)}.`}

Gracias por su preferencia — Óptica Aurora
      `.trim(),
    });
    await registrarAuditoria('Pago', `Ticket enviado por correo a ${cliente.nombre} (folio #${folio})`);
    showToast(`Ticket enviado a ${cliente.email}`, 'success');
  } catch (err) {
    console.error(err);
    showToast('Error al enviar el correo. Verifica EmailJS.', 'error');
  } finally {
    hideLoading();
  }
}
/* ══════════════════════════════════════════════════════════════
   📅  RECORDATORIOS DE REVISIÓN ANUAL
══════════════════════════════════════════════════════════════ */

function restarMeses(fecha, meses) {
  const d = new Date(fecha);
  const dia = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() - meses);
  const ultimoDia = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(dia, ultimoDia));
  return d;
}

function verificarRevisionesAnuales() {
  const hoy    = new Date();
  const hace11 = restarMeses(hoy, 11);
  hace11.setHours(0, 0, 0, 0);

  // Por cada cliente, buscar su venta de lentes más reciente
  const clientesPendientes = STATE.clientes.map(c => {
    const ventas = STATE.ventas
  .filter(v =>
    String(v.clienteId) === String(c.id) &&
    v.fecha &&
    (v.tipo === 'normal' || v.tipo === 'cambio')
  )
      .map(v => ({ ...v, _fecha: new Date(v.fecha + 'T12:00:00') }))
      .filter(v => !isNaN(v._fecha))
      .sort((a, b) => b._fecha - a._fecha);   // más reciente primero

    if (!ventas.length) return null;           // sin ventas → ignorar

    const ultimaVenta = ventas[0];
    if (ultimaVenta._fecha > hace11) return null; // compró hace menos de 11 meses → OK

    const diffMs = hoy - ultimaVenta._fecha;
    const meses  = Math.floor(diffMs / (1000 * 60 * 60 * 24 * 30.44));
    return { cliente: c, ultimaVenta, meses };
  }).filter(Boolean);

  STATE._revisionesPendientes = clientesPendientes;

  const alerta = document.getElementById('revision-anual-alerta');
  if (!alerta) return;

  if (!clientesPendientes.length) {
    alerta.classList.add('hidden');
    return;
  }

  alerta.classList.remove('hidden');
  const btnVer = alerta.querySelector('.btn-sm');
  if (btnVer) btnVer.textContent = `Ver lista (${clientesPendientes.length})`;
}

function toggleRevisionDetalle() {
  const detalle = document.getElementById('revision-detalle');
  const btn = document.querySelector('#revision-anual-alerta .btn-sm');
  if (!detalle) return;

  if (!detalle.classList.contains('hidden')) {
    detalle.classList.add('hidden');
    if (btn) btn.textContent = `Ver lista (${(STATE._revisionesPendientes || []).length})`;
    return;
  }

  const lista = STATE._revisionesPendientes || [];
  detalle.innerHTML = lista
    .sort((a, b) => b.meses - a.meses)   // los más atrasados primero
    .map(item => {
      const c          = item.cliente;
      const v          = item.ultimaVenta;
      const meses      = item.meses;
      const mesesTexto = meses === 1 ? '1 mes' : `${meses} meses`;
      const lente      = v?.tipoLente || 'Lentes';
      const fecha      = v?.fecha || '—';
      const colorMeses = meses >= 12 ? '#E53935' : '#b8860b';

      return `
        <div class="revision-card">
          <div class="revision-card-nombre">${esc(c.nombre)}</div>
          <div class="revision-card-info">
            🕶️ <strong>${esc(lente)}</strong> &nbsp;·&nbsp; Compra: ${esc(fecha)}
          </div>
          ${c.telefono ? `<div class="revision-card-info">📱 ${esc(c.telefono)}</div>` : ''}
          <span class="revision-card-meses" style="background:#fff3;color:${colorMeses};border:1px solid ${colorMeses}33;">
            ⏱️ Hace ${mesesTexto} sin revisión
          </span>
          <div class="revision-card-btns">
            ${c.email
              ? `<button class="btn-sm" onclick="enviarRecordatorioRevision('${c.id}')">📧 Recordatorio</button>`
              : '<span style="font-size:.75rem;color:#aaa">Sin correo</span>'
            }
            ${c.telefono
              ? `<a class="btn-sm" href="https://wa.me/52${sanitizarTelefono(c.telefono)}?text=${encodeURIComponent(`Hola ${c.nombre.split(' ')[0]}, ya lleva ${mesesTexto} con sus ${lente} de Óptica Aurora. ¿Le gustaría pasar a una revisión? 👓`)}" target="_blank">📱 WhatsApp</a>`
              : ''
            }
            <button class="btn-sm" onclick="verDetalleCliente('${c.id}')">Ver ficha</button>
          </div>
        </div>
      `;
    }).join('');

  detalle.classList.remove('hidden');
  if (btn) btn.textContent = `Ocultar lista`;
  detalle.classList.remove('hidden');
  feather.replace();
}

async function enviarRecordatorioRevision(clienteId) {
  const c = STATE.clientes.find(x => String(x.id) === String(clienteId));
  if (!c?.email) { showToast('Sin correo registrado', 'warning'); return; }

  const item  = (STATE._revisionesPendientes || []).find(x => String(x.cliente.id) === String(clienteId));
  const meses = item?.meses ?? 12;
  const mesesTexto = meses === 1 ? '1 mes' : `${meses} meses`;
  const lente = item?.ultimaVenta?.tipoLente || 'sus lentes';
  const fecha = item?.ultimaVenta?.fecha || '';

  if (typeof emailjs === 'undefined') {
    showToast('Servicio de correo no disponible. Recarga la página.', 'error');
    return;
  }
  showLoading('Enviando recordatorio de revisión...');
  try {
    await emailjs.send(CONFIG.EMAILJS.SERVICE_ID, CONFIG.EMAILJS.TEMPLATE_RECORDATORIO, {
      to_name:      c.nombre,
      to_email:     c.email,
      tipo:         'visita',                       // ← distingue el tipo en la plantilla
      etiqueta:     '¿Cómo van tus lentes? 👓',
      saldo:        `${mesesTexto} desde tu compra`,
      ultimo_pago:  `${lente}${fecha ? ' · adquiridos el ' + fecha : ''}`,
      mensaje:      `Hola ${c.nombre.split(' ')[0]}, han pasado ${mesesTexto} desde que adquiriste ${lente} en Óptica Aurora. ¡Queremos saber cómo te han ido! Te invitamos a pasar para una revisión sin costo. Recuerda que una buena graduación mejora tu calidad de vida. 👓`,
      contacto:     'WhatsApp: (282) 129-2915',
    });
    await registrarAuditoria('Pago', `Recordatorio de revisión enviado a ${c.nombre} (${mesesTexto} con ${lente})`);
    showToast(`Recordatorio enviado a ${c.nombre}`, 'success');
  } catch (err) {
    console.error(err);
    showToast('Error al enviar correo', 'error');
  } finally {
    hideLoading();
  }
}
/* ══════════════════════════════════════════════════════════════
   📄  REPORTE PDF
══════════════════════════════════════════════════════════════ */

function generarReportePDF() {
  const logoURL  = window.location.origin + window.location.pathname.replace(/[^/]*$/, '') + 'Logo-optica.ico';
  const fechaHoy = new Date().toLocaleDateString('es-MX', { weekday:'long', day:'2-digit', month:'long', year:'numeric' });

  // ── Determinar período activo (igual que los KPIs del dashboard) ──
  const hoy        = new Date();
  const periodoKpi = STATE._periodoKpi || 'mes';
  const mesCustom  = STATE._periodoKpiMes || null;

  let desde = null, hasta = null, labelPeriodo = '', iconoPeriodo = '📅';

  if (mesCustom) {
    const [y, m] = mesCustom.split('-').map(Number);
    desde = new Date(y, m - 1, 1);
    hasta = new Date(y, m, 0, 23, 59, 59, 999);
    labelPeriodo = desde.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
    iconoPeriodo = '🗓️';
  } else if (periodoKpi === 'semana') {
    desde = new Date(hoy); desde.setDate(hoy.getDate() - 6); desde.setHours(0, 0, 0, 0);
    hasta = new Date(hoy); hasta.setHours(23, 59, 59, 999);
    labelPeriodo = 'Esta semana · ' +
      desde.toLocaleDateString('es-MX', { day:'2-digit', month:'short' }) + ' – ' +
      hasta.toLocaleDateString('es-MX', { day:'2-digit', month:'short', year:'numeric' });
    iconoPeriodo = '📆';
  } else if (periodoKpi === 'mes') {
    desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    hasta = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0, 23, 59, 59, 999);
    labelPeriodo = 'Este mes · ' + hoy.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
    iconoPeriodo = '📆';
  } else if (periodoKpi === 'año') {
    desde = new Date(hoy.getFullYear(), 0, 1);
    hasta = new Date(hoy.getFullYear(), 11, 31, 23, 59, 59, 999);
    labelPeriodo = 'Año ' + hoy.getFullYear();
    iconoPeriodo = '📆';
  } else {
    labelPeriodo = 'Histórico total';
    iconoPeriodo = '🗃️';
  }

  // ── Filtrar ventas del período ──
const empDash = STATE._filtroEmpleadoDash;
  const empLabel = empDash ? empDash : '';
  const ventasPeriodo = STATE.ventas.filter(v => {
    if (empDash && v.registradoPor !== empDash) return false;
    if (!desde) return true;
    if (!v.fecha) return false;
    const fv = new Date(v.fecha + 'T12:00:00');
    return fv >= desde && fv <= hasta;
  });

  // ── KPIs del período ──
  const idsConVenta    = new Set(ventasPeriodo.map(v => String(v.clienteId)));
  const totalVendido   = ventasPeriodo.reduce((s, v) => s + parseFloat(v.totalFinal || 0), 0);
  const totalCobrado   = ventasPeriodo.reduce((s, v) => s + calcularPagado(v.id), 0);
  const totalPendiente = Math.max(0, totalVendido - totalCobrado);
  const ventasPagadas  = ventasPeriodo.filter(v => calcularEstadoVenta(v) === 'pagado').length;
  const ventasParcial  = ventasPeriodo.filter(v => calcularEstadoVenta(v) === 'parcial').length;
  const ventasDeuda    = ventasPeriodo.filter(v => calcularEstadoVenta(v) === 'deuda').length;
  const tasaCobro      = totalVendido > 0 ? Math.round((totalCobrado / totalVendido) * 100) : 0;
  const ticketPromedio = ventasPeriodo.length > 0 ? totalVendido / ventasPeriodo.length : 0;
  const garantias      = ventasPeriodo.filter(v => v.tipo === 'garantia' || v.tipo === 'cambio').length;

  // Clientes nuevos en el período
  const ventasFuera   = STATE.ventas.filter(v => {
    if (!desde || !v.fecha) return !desde;
    return new Date(v.fecha + 'T12:00:00') < desde;
  });
  const idsAnteriores  = new Set(ventasFuera.map(v => String(v.clienteId)));
  const clientesNuevos = [...idsConVenta].filter(id => !idsAnteriores.has(id)).length;

  // ── Adeudos del período (top 15) ──
  const adeudos = ventasPeriodo
    .map(v => ({
      ...v,
      _saldo: Math.max(0, parseFloat(v.totalFinal || 0) - calcularPagado(v.id)),
      _c: STATE.clientes.find(c => String(c.id) === String(v.clienteId)),
    }))
    .filter(v => v._saldo > 0)
    .sort((a, b) => b._saldo - a._saldo)
    .slice(0, 15);

  // ── Ventas del período ordenadas de más reciente a más antigua ──
  const ventasOrdenadas = [...ventasPeriodo].sort((a, b) => {
    const fa = String(a.fecha || '0000-00-00');
    const fb = String(b.fecha || '0000-00-00');
    return fb.localeCompare(fa);
  });

const isPWA = window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;

  // Abrir ventana sincrónicamente ANTES de construir el HTML
  let winRef = null;
  if (!isPWA) {
    winRef = window.open('', '_blank');
    if (!winRef) {
      showToast('Permite ventanas emergentes para el reporte', 'warning');
      return;
    }
    winRef.document.write('<html><body style="font-family:sans-serif;padding:2rem;color:#555">Preparando reporte...</body></html>');
  }

  const htmlReporte = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Reporte — Óptica Aurora</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:'Inter',Arial,sans-serif;font-size:12px;color:#1a2b45;background:#e8edf3;padding:24px;}
    .btn-print{
      display:flex;align-items:center;gap:.5rem;max-width:920px;
      margin:0 auto 16px;padding:10px 28px;
      background:linear-gradient(135deg,#1F3A5F,#2E5C8A);color:#fff;
      border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;
      font-family:'Inter',sans-serif;
    }
    .btn-print:hover{opacity:.9;}
    .pagina{background:#fff;max-width:920px;margin:0 auto;border-radius:16px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.18);}
    /* Header */
    .rpt-header{
      background:linear-gradient(135deg,#1F3A5F 0%,#2E5C8A 60%,#3a7aaa 100%);
      padding:24px 32px;display:flex;align-items:center;justify-content:space-between;
      position:relative;overflow:hidden;
    }
    .rpt-header::before{content:'';position:absolute;top:-50px;right:-50px;width:200px;height:200px;border-radius:50%;background:rgba(79,195,199,.1);pointer-events:none;}
    .rpt-logo-area{display:flex;align-items:center;gap:14px;position:relative;z-index:2;}
    .rpt-logo{width:50px;height:50px;border-radius:10px;background:rgba(255,255,255,.12);padding:4px;object-fit:contain;border:1.5px solid rgba(255,255,255,.2);}
    .rpt-marca .optica{font-size:9px;letter-spacing:.22em;color:#7EC8CB;font-weight:600;display:block;}
    .rpt-marca .aurora{font-size:22px;font-weight:800;color:#fff;letter-spacing:.04em;}
    .rpt-titulo-area{text-align:right;position:relative;z-index:2;}
    .rpt-titulo{font-size:11px;font-weight:800;letter-spacing:.16em;color:#7EC8CB;text-transform:uppercase;}
    .rpt-fecha{font-size:10.5px;color:rgba(255,255,255,.5);margin-top:4px;}
    .rpt-accent{height:4px;background:linear-gradient(90deg,#4FC3C7,#2E5C8A,#4FC3C7);}
    /* Banner período */
    .rpt-periodo-banner{
      background:linear-gradient(to right,#EBF4F8,#e4f0f7);
      border-bottom:2px solid #c8dce8;
      padding:14px 32px;
      display:flex;align-items:center;gap:14px;
    }
    .rpt-periodo-icon{font-size:20px;}
    .rpt-periodo-texto{}
    .rpt-periodo-label{font-size:9px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#6FA9C9;}
    .rpt-periodo-valor{font-size:15px;font-weight:800;color:#1F3A5F;margin-top:2px;text-transform:capitalize;}
    /* KPIs */
    .rpt-kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:#e0e6ed;border-bottom:1px solid #e0e6ed;}
    .rpt-kpi{background:#fff;padding:18px 16px;text-align:center;}
    .rpt-kpi-val{font-size:1.35rem;font-weight:800;color:#1F3A5F;font-family:monospace;margin-bottom:5px;letter-spacing:-.01em;}
    .rpt-kpi-label{font-size:9px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#8A9BB0;}
    .rpt-kpi.green .rpt-kpi-val{color:#4CAF50;}
    .rpt-kpi.red   .rpt-kpi-val{color:#E53935;}
    .rpt-kpi.teal  .rpt-kpi-val{color:#4FC3C7;}
    /* Cuerpo */
    .rpt-body{padding:24px 32px;}
    .rpt-seccion{margin-bottom:26px;}
    .rpt-seccion-titulo{
      display:flex;align-items:center;gap:8px;
      font-size:9px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;
      color:#1F3A5F;background:linear-gradient(to right,#EBF4F8,#f4f8fb);
      border-left:3.5px solid #4FC3C7;padding:7px 14px;
      border-radius:0 8px 8px 0;margin-bottom:14px;
    }
    /* Stats */
    .stats-bar{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:14px;}
    .stat-card{background:#f4f8fb;border-radius:10px;padding:13px 14px;border:1px solid #dde6ef;}
    .stat-val{font-size:1.15rem;font-weight:800;color:#1F3A5F;font-family:monospace;}
    .stat-label{font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#8A9BB0;margin-top:3px;}
    /* Métricas adicionales */
    .metricas-extra{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;}
    .metrica-ex{background:#f4f8fb;border-radius:8px;padding:10px 12px;border:1px solid #dde6ef;text-align:center;}
    .metrica-ex-val{font-size:.95rem;font-weight:800;color:#1F3A5F;font-family:monospace;}
    .metrica-ex-label{font-size:8.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#8A9BB0;margin-top:3px;}
    /* Tabla */
    table.rpt{width:100%;border-collapse:collapse;font-size:11px;}
    table.rpt th{
      background:linear-gradient(135deg,#1F3A5F,#2E5C8A);color:#fff;
      padding:8px 10px;text-align:left;font-weight:700;font-size:9.5px;letter-spacing:.06em;
    }
    table.rpt td{padding:7px 10px;border-bottom:1px solid #eef2f7;color:#1a2b45;vertical-align:middle;}
    table.rpt tr:nth-child(even) td{background:#f8fafc;}
    .verde{color:#4CAF50;font-weight:700;}
    .rojo{color:#E53935;font-weight:700;}
    .mono{font-family:monospace;}
    .badge{display:inline-block;padding:2px 8px;border-radius:99px;font-size:9.5px;font-weight:700;}
    .b-verde   {background:#E8F5E9;color:#2e7d32;}
    .b-amarillo{background:#FFF8E1;color:#b8860b;}
    .b-rojo    {background:#FFEBEE;color:#E53935;}
    .b-azul    {background:rgba(46,92,138,.1);color:#2E5C8A;}
    .empty-note{text-align:center;padding:22px;color:#8A9BB0;font-style:italic;font-size:11px;}
    .cap-nota{font-size:10px;color:#8A9BB0;font-style:italic;padding:6px 10px;text-align:right;}
    /* Footer */
    .rpt-footer{
      background:linear-gradient(to right,#f4f8fb,#eef4f8);
      border-top:2px solid #dde9f0;
      padding:16px 32px;
      display:flex;justify-content:space-between;align-items:center;
    }
    .rpt-footer-text{font-size:10px;color:#8A9BB0;}
    .wm-strip{height:3px;background:repeating-linear-gradient(90deg,#4FC3C7 0,#4FC3C7 30px,#2E5C8A 30px,#2E5C8A 60px);opacity:.3;}
    @media print{
      body{background:#fff;padding:0;}
      .btn-print{display:none;}
      .pagina{box-shadow:none;border-radius:0;}
      *{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
      .rpt-header{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
      table.rpt th{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
      .rpt-periodo-banner{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
    }
  </style>
</head>
<body>
<button class="btn-print" onclick="window.print()">🖨️ Imprimir / Guardar PDF</button>
<div class="pagina">
  <div class="wm-strip"></div>

  <div class="rpt-header">
    <div class="rpt-logo-area">
      <img src="${logoURL}" class="rpt-logo" onerror="this.style.display='none'" />
      <div class="rpt-marca">
        <span class="optica">ÓPTICA</span>
        <span class="aurora">AURORA</span>
      </div>
    </div>
    <div class="rpt-titulo-area">
      <div class="rpt-titulo">Reporte de Ventas</div>
      <div class="rpt-fecha">Generado: ${fechaHoy}</div>
    </div>
  </div>
  <div class="rpt-accent"></div>

  <!-- PERÍODO ACTIVO -->
<div class="rpt-periodo-banner">
    <div class="rpt-periodo-icon">${iconoPeriodo}</div>
    <div class="rpt-periodo-texto">
      <div class="rpt-periodo-label">Período del reporte</div>
      <div class="rpt-periodo-valor">${esc(labelPeriodo)}${empLabel ? ` <span style="font-size:.85em;opacity:.75;">· ${esc(empLabel)}</span>` : ''}</div>
    </div>
  </div>

  <!-- KPIs DEL PERÍODO -->
  <div class="rpt-kpis">
    <div class="rpt-kpi">
      <div class="rpt-kpi-val">${idsConVenta.size}</div>
      <div class="rpt-kpi-label">Clientes con venta</div>
    </div>
    <div class="rpt-kpi teal">
      <div class="rpt-kpi-val">${formatMoney(totalVendido)}</div>
      <div class="rpt-kpi-label">Total Vendido</div>
    </div>
    <div class="rpt-kpi green">
      <div class="rpt-kpi-val">${formatMoney(totalCobrado)}</div>
      <div class="rpt-kpi-label">Total Cobrado</div>
    </div>
    <div class="rpt-kpi red">
      <div class="rpt-kpi-val">${formatMoney(totalPendiente)}</div>
      <div class="rpt-kpi-label">Pendiente</div>
    </div>
  </div>

  <div class="rpt-body">

    <!-- RESUMEN DEL PERÍODO -->
    <div class="rpt-seccion">
      <div class="rpt-seccion-titulo">📊 Resumen del Período</div>
      <div class="stats-bar">
        <div class="stat-card">
          <div class="stat-val verde">${ventasPagadas}</div>
          <div class="stat-label">Ventas pagadas</div>
        </div>
        <div class="stat-card">
          <div class="stat-val" style="color:#FBC02D">${ventasParcial}</div>
          <div class="stat-label">Pago parcial</div>
        </div>
        <div class="stat-card">
          <div class="stat-val rojo">${ventasDeuda}</div>
          <div class="stat-label">Con deuda</div>
        </div>
      </div>
      <div class="metricas-extra">
        <div class="metrica-ex">
          <div class="metrica-ex-val">${tasaCobro}%</div>
          <div class="metrica-ex-label">Tasa de cobro</div>
        </div>
        <div class="metrica-ex">
          <div class="metrica-ex-val">${formatMoney(ticketPromedio)}</div>
          <div class="metrica-ex-label">Ticket promedio</div>
        </div>
        <div class="metrica-ex">
          <div class="metrica-ex-val">${clientesNuevos}</div>
          <div class="metrica-ex-label">Clientes nuevos</div>
        </div>
        <div class="metrica-ex">
          <div class="metrica-ex-val">${garantias}</div>
          <div class="metrica-ex-label">Garantías / Cambios</div>
        </div>
      </div>
    </div>

    <!-- CUENTAS CON ADEUDO -->
    <div class="rpt-seccion">
      <div class="rpt-seccion-titulo">⚠️ Cuentas con Saldo Pendiente — ${esc(labelPeriodo)}</div>
      ${adeudos.length ? `
      <table class="rpt">
        <thead>
          <tr>
            <th>Cliente</th>
            <th>Teléfono</th>
            <th>Total Venta</th>
            <th>Pagado</th>
            <th>Saldo</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          ${adeudos.map(v => `
          <tr>
            <td><strong>${esc(v._c?.nombre || v.clienteNombre || '—')}</strong></td>
            <td class="mono">${esc(v._c?.telefono || '—')}</td>
            <td class="mono">${formatMoney(v.totalFinal)}</td>
            <td class="mono verde">${formatMoney(calcularPagado(v.id))}</td>
            <td class="mono rojo"><strong>${formatMoney(v._saldo)}</strong></td>
            <td><span class="badge b-${calcularEstadoVenta(v) === 'parcial' ? 'amarillo' : 'rojo'}">
              ${calcularEstadoVenta(v) === 'parcial' ? 'Parcial' : 'Deuda'}
            </span></td>
          </tr>`).join('')}
        </tbody>
      </table>
      ${adeudos.length === 15 ? '<div class="cap-nota">Mostrando top 15 por monto</div>' : ''}
      ` : '<div class="empty-note">¡Sin adeudos pendientes en este período! 🎉</div>'}
    </div>

    <!-- VENTAS DEL PERÍODO -->
    <div class="rpt-seccion">
      <div class="rpt-seccion-titulo">💰 Ventas del Período — ${esc(labelPeriodo)} (${ventasOrdenadas.length})</div>
      ${ventasOrdenadas.length ? `
      <table class="rpt">
        <thead>
          <tr>
            <th>Cliente</th>
            <th>Producto</th>
            <th>Tipo</th>
            <th>Total</th>
            <th>Pagado</th>
            <th>Saldo</th>
            <th>Fecha</th>
            <th>Registrado por</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          ${ventasOrdenadas.map(v => {
            const c   = STATE.clientes.find(x => String(x.id) === String(v.clienteId));
            const pag = calcularPagado(v.id);
            const sal = Math.max(0, parseFloat(v.totalFinal || 0) - pag);
            const est = calcularEstadoVenta(v);
            return `<tr>
              <td><strong>${esc(c?.nombre || v.clienteNombre || '—')}</strong></td>
              <td>${esc(v.tipoLente || '—')}</td>
              <td><span class="badge b-${v.tipo === 'garantia' ? 'verde' : v.tipo === 'cambio' ? 'amarillo' : 'azul'}">${capitalize(v.tipo || 'normal')}</span></td>
              <td class="mono">${formatMoney(v.totalFinal)}</td>
              <td class="mono verde">${formatMoney(pag)}</td>
              <td class="mono ${sal > 0 ? 'rojo' : ''}">${formatMoney(sal)}</td>
              <td class="mono">${esc(v.fecha || '—')}</td>
              <td>${esc(v.registradoPor || '—')}</td>
              <td><span class="badge b-${est === 'pagado' ? 'verde' : est === 'parcial' ? 'amarillo' : 'rojo'}">
                ${est === 'pagado' ? 'Pagado' : est === 'parcial' ? 'Parcial' : 'Deuda'}
              </span></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
      ` : '<div class="empty-note">Sin ventas registradas en este período.</div>'}
    </div>

  </div>

  <div class="rpt-footer">
    <div class="rpt-footer-text">Óptica Aurora · Sistema de Gestión Interno · Período: ${esc(labelPeriodo)}</div>
<div class="rpt-footer-text">Generado el ${fechaHoy} · ${esc(STATE.usuario?.nombre || '')}${empLabel ? ' · Empleado: ' + esc(empLabel) : ''}</div>  </div>
  <div class="wm-strip"></div>
</div>
</body></html>`;

 if (isPWA) {
    const frame = document.getElementById('print-frame');
    if (!frame) { showToast('Error al preparar reporte', 'error'); return; }
    frame.srcdoc = htmlReporte;
    frame.onload = () => {
      try { frame.contentWindow.focus(); frame.contentWindow.print(); }
      catch(e) { showToast('No se pudo abrir el diálogo de impresión', 'warning'); }
    };
  } else {
    winRef.document.open();
    winRef.document.write(htmlReporte);
    winRef.document.close();
  }
}
/* ══════════════════════════════════════════════════════════════
   🖼️  IMAGEN DE PRODUCTO
══════════════════════════════════════════════════════════════ */

async function compressImage(file, maxWidth = 150, quality = 0.62) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer el archivo'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('No se pudo procesar la imagen'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        const canvas = document.createElement('canvas');
        canvas.width  = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function handleImagenProducto(input) {
  if (!input.files?.[0]) return;
  const file = input.files[0];

  // Validación de tipo
  if (!file.type.startsWith('image/')) {
    showToast('El archivo seleccionado no es una imagen', 'warning');
    input.value = '';
    return;
  }
  // Validación de tamaño
  if (file.size > 5 * 1024 * 1024) {
    showToast('La imagen no puede ser mayor a 5MB', 'warning');
    input.value = '';
    return;
  }

  const statusEl  = document.getElementById('img-upload-status');
  const preview   = document.getElementById('producto-imagen-preview');
  const ph        = document.getElementById('img-upload-ph');
  const actions   = document.getElementById('img-upload-actions');

  statusEl.textContent = '⏳ Comprimiendo imagen...';
  statusEl.style.color = 'var(--gris-label)';

  try {
    const compressed = await compressImage(file);

    // Estimar tamaño en KB
    const sizeKB = Math.round((compressed.length * 3) / 4 / 1024);
    if (sizeKB > 45) {
      // Segundo intento con más compresión
      const compressed2 = await compressImage(file, 100, 0.5);
      document.getElementById('producto-imagen-url').value = compressed2;
    } else {
      document.getElementById('producto-imagen-url').value = compressed;
    }

    const finalUrl = document.getElementById('producto-imagen-url').value;
    const finalKB  = Math.round((finalUrl.length * 3) / 4 / 1024);

    preview.src           = finalUrl;
    preview.style.display = 'block';
    ph.style.display      = 'none';
    actions.style.display = 'flex';
    statusEl.textContent  = `✓ Imagen lista · ~${finalKB} KB`;
    statusEl.style.color  = 'var(--verde)';
  } catch (err) {
    statusEl.textContent = 'Error al procesar la imagen. Intenta con otro archivo.';
    statusEl.style.color = 'var(--rojo)';
    console.error('Imagen error:', err);
  }

  // Permite volver a seleccionar el mismo archivo
  input.value = '';
}

function quitarImagenProducto() {
  document.getElementById('producto-imagen-url').value   = '';
  const preview = document.getElementById('producto-imagen-preview');
  preview.src           = '';
  preview.style.display = 'none';
  document.getElementById('img-upload-ph').style.display      = 'flex';
  document.getElementById('img-upload-actions').style.display = 'none';
  document.getElementById('img-upload-status').textContent    = '';
  document.getElementById('img-upload-status').style.color    = '';
}

function setImagenProductoUI(url) {
  const preview = document.getElementById('producto-imagen-preview');
  const ph      = document.getElementById('img-upload-ph');
  const actions = document.getElementById('img-upload-actions');
  const status  = document.getElementById('img-upload-status');
  if (url) {
    preview.src           = url;
    preview.style.display = 'block';
    ph.style.display      = 'none';
    actions.style.display = 'flex';
    status.textContent    = '✓ Imagen guardada';
    status.style.color    = 'var(--turquesa-dark)';
  } else {
    quitarImagenProducto();
  }
}

function initImagenDropZone() {
  const zone = document.getElementById('img-upload-zone');
  if (!zone) return;
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('drag-over');
  });
  zone.addEventListener('dragleave', () => {
    zone.classList.remove('drag-over');
  });
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      const input = document.getElementById('producto-imagen-input');
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      handleImagenProducto(input);
    } else {
      showToast('Solo se aceptan archivos de imagen', 'warning');
    }
  });
}
/* ══════════════════════════════════════════════════════════════
   📦  INVENTARIO
══════════════════════════════════════════════════════════════ */

async function cargarInventario() {
  try {
    const res = await apiGet(CONFIG.HOJAS.INVENTARIO);
    STATE.inventario = res.data || [];
  } catch { STATE.inventario = []; }
}

function renderInventario(lista = STATE.inventario) {
  const tbody = document.getElementById('inventario-body');
  if (!tbody) return;

  // KPIs
  const totalProductos = STATE.inventario.length;
  const totalStock     = STATE.inventario.reduce((s, p) => s + parseInt(p.stock || 0), 0);
  const bajosStock     = STATE.inventario.filter(p => parseInt(p.stock||0) <= parseInt(p.stockMin||3) && parseInt(p.stock||0) > 0).length;
  const agotados       = STATE.inventario.filter(p => parseInt(p.stock||0) === 0).length;
  const valorTotal     = STATE.inventario.reduce((s, p) => s + (parseFloat(p.precioCosto||0) * parseInt(p.stock||0)), 0);

  setHTML('inv-kpi-total', totalProductos);
  setHTML('inv-kpi-stock', totalStock);
  setHTML('inv-kpi-bajo',  bajosStock + agotados);
  setHTML('inv-kpi-valor', formatMoney(valorTotal));

  // Badge en sidebar — siempre basado en el inventario COMPLETO, no la lista filtrada
  const badge = document.getElementById('badge-stock');
  if (badge) {
    const alertasGlobal = STATE.inventario.filter(p => parseInt(p.stock || 0) <= parseInt(p.stockMin || 3)).length;
    badge.textContent = alertasGlobal;
    badge.style.display = alertasGlobal > 0 ? '' : 'none';
  }

  if (!lista.length) {
    const q = val('search-inventario').trim();
    tbody.innerHTML = `<tr><td colspan="9" class="empty-row">${q ? 'Sin resultados' : 'No hay productos en inventario'}</td></tr>`;
    return;
  }

  tbody.innerHTML = lista.map(p => {
    const stock    = parseInt(p.stock || 0);
    const stockMin = parseInt(p.stockMin || 3);
    let estadoStock, estadoClass;
    if (stock === 0)          { estadoStock = 'Agotado';     estadoClass = 'badge-red'; }
    else if (stock <= stockMin){ estadoStock = 'Stock bajo';  estadoClass = 'badge-yellow'; }
    else                      { estadoStock = 'Disponible';  estadoClass = 'badge-green'; }

    return `
    <tr>
      <td data-label="Producto">
        <div class="inv-prod-cell">
          ${p.imagenUrl
            ? `<img src="${p.imagenUrl}" alt="${esc(p.nombre)}" class="inv-thumb" onerror="this.style.display='none'" />`
            : ''
          }
          <div>
            <strong>${esc(p.nombre)}</strong>
            ${p.sku ? `<div style="font-size:.72rem;color:#8A9BB0;font-family:monospace;">${esc(p.sku)}</div>` : ''}
          </div>
        </div>
      </td>
      <td data-label="Categoría"><span class="badge badge-blue">${capitalize(esc(p.categoria||'otro'))}</span></td>
      <td data-label="Marca">${esc(p.marca || '—')}</td>
      <td data-label="Stock" class="mono fw-bold" style="font-size:1rem;${stock===0?'color:var(--rojo)':stock<=stockMin?'color:var(--amarillo)':'color:var(--verde)'}">${stock}</td>
      <td data-label="Mín." class="mono">${stockMin}</td>
      <td data-label="Precio Costo" class="mono">${p.precioCosto ? formatMoney(p.precioCosto) : '—'}</td>
      <td data-label="Precio Venta" class="mono">${p.precioVenta ? formatMoney(p.precioVenta) : '—'}</td>
      <td data-label="Estado"><span class="badge ${estadoClass}">${estadoStock}</span></td>
      <td>
        <div class="action-btns">
          <button class="btn-action pay"    onclick="abrirAjusteStock('${p.id}')" title="Ajustar stock"><i data-feather="layers"></i></button>
          <button class="btn-action edit"   onclick="editarProducto('${p.id}')"   title="Editar"><i data-feather="edit-2"></i></button>
          <button class="btn-action delete" onclick="confirmarEliminar('producto','${p.id}')" title="Eliminar"><i data-feather="trash-2"></i></button>
        </div>
      </td>
    </tr>
    `;
  }).join('');
  feather.replace();
}

function filterInventario() {
  const q    = val('search-inventario').toLowerCase();
  const cat  = val('filter-categoria');
  const stk  = val('filter-stock');

  let lista = STATE.inventario.filter(p => {
    const matchQ   = !q || p.nombre?.toLowerCase().includes(q) || p.marca?.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q);
    const matchCat = !cat || p.categoria === cat;
    const stock    = parseInt(p.stock || 0);
    const stockMin = parseInt(p.stockMin || 3);
    const matchStk = !stk
      || (stk === 'agotado'    && stock === 0)
      || (stk === 'bajo'       && stock > 0 && stock <= stockMin)
      || (stk === 'disponible' && stock > stockMin);
    return matchQ && matchCat && matchStk;
  });

  renderInventario(lista);
}

async function saveProducto() {
  const btnP = document.querySelector('#modal-producto .btn-primary');
  if (btnP?.disabled) return;

  const nombre = document.getElementById('producto-nombre').value.trim();
  if (!nombre) { showToast('El nombre del producto es requerido', 'warning'); return; }

  const skuCheck = document.getElementById('producto-sku').value.trim();
  const idActual = val('producto-id');
  if (skuCheck) {
    const duplicadoSku = STATE.inventario.find(p =>
      p.sku && p.sku.trim().toLowerCase() === skuCheck.toLowerCase() &&
      String(p.id) !== String(idActual)
    );
    if (duplicadoSku) {
      showToast(`El SKU "${skuCheck}" ya está en uso por "${duplicadoSku.nombre}"`, 'warning');
      return;
    }
  }

  const stockRaw = parseInt(document.getElementById('producto-stock').value);
  if (isNaN(stockRaw) || stockRaw < 0) {
    showToast('El stock no puede ser negativo', 'warning');
    return;
  }

  const data = {
    nombre,
    categoria:    val('producto-categoria'),
    marca:        document.getElementById('producto-marca').value.trim(),
    sku:          document.getElementById('producto-sku').value.trim(),
    color:        document.getElementById('producto-color').value.trim(),
    stock:        stockRaw,
    stockMin:     parseInt(document.getElementById('producto-stock-min').value) || 3,
    precioCosto:  parseFloat(document.getElementById('producto-precio-costo').value) || 0,
    precioVenta:  parseFloat(document.getElementById('producto-precio-venta').value) || 0,
    proveedor:    document.getElementById('producto-proveedor').value.trim(),
    notas:        document.getElementById('producto-notas').value.trim(),
    imagenUrl:    document.getElementById('producto-imagen-url').value || '',
    actualizadoPor: STATE.usuario?.nombre || '',
    fechaActualizacion: new Date().toLocaleDateString('es-MX'),
  };

  const id = val('producto-id');
  if (btnP) { btnP.disabled = true; btnP.textContent = 'Guardando...'; }
showLoading(id ? 'Actualizando producto...' : 'Guardando producto...');  try {
    if (id) {
      data.id = id;
      await apiPost(CONFIG.HOJAS.INVENTARIO, 'update', data);
      const idx = STATE.inventario.findIndex(p => String(p.id) === String(id));
      if (idx > -1) STATE.inventario[idx] = { ...STATE.inventario[idx], ...data };
      await registrarAuditoria('Editar', `${STATE.usuario.nombre} editó producto: ${nombre}`);
      showToast('Producto actualizado', 'success');
    } else {
      const res = await apiPost(CONFIG.HOJAS.INVENTARIO, 'create', data);
      data.id = res.id || data.id || ('id_' + Date.now() + '_' + Math.random().toString(36).substr(2,9));
      STATE.inventario.push(data);
      await registrarAuditoria('Crear', `${STATE.usuario.nombre} agregó producto: ${nombre} (stock: ${data.stock})`);
      showToast('Producto creado correctamente', 'success');
    }
    document.getElementById('producto-id').value = '';
    closeAllModals();
    filterInventario();
  } catch (err) {
    showToast('Error al guardar producto', 'error');
  } finally {
    hideLoading();
    if (btnP) {
      btnP.disabled = false;
      btnP.innerHTML = '<i data-feather="save"></i> Guardar Producto';
      feather.replace();
    }
  }
}

function editarProducto(id) {
  const p = STATE.inventario.find(x => x.id == id);
  if (!p) return;
  document.getElementById('producto-id').value = p.id;    // ← primero el ID
  openModal('modal-producto');                             // ← luego abrir
  setHTML('modal-producto-title', 'Editar Producto');
  document.getElementById('producto-nombre').value         = p.nombre      || '';
  document.getElementById('producto-categoria').value      = p.categoria   || 'otro';
  document.getElementById('producto-marca').value          = p.marca       || '';
  document.getElementById('producto-sku').value            = p.sku         || '';
  document.getElementById('producto-color').value          = p.color       || '';
  document.getElementById('producto-stock').value          = p.stock       || 0;
  document.getElementById('producto-stock-min').value      = p.stockMin    || 3;
  document.getElementById('producto-precio-costo').value   = p.precioCosto || '';
  document.getElementById('producto-precio-venta').value   = p.precioVenta || '';
  document.getElementById('producto-proveedor').value      = p.proveedor   || '';
  document.getElementById('producto-notas').value          = p.notas       || '';
  document.getElementById('producto-imagen-url').value     = p.imagenUrl   || '';
  setImagenProductoUI(p.imagenUrl || '');
}

function abrirAjusteStock(productoId) {
  const p = STATE.inventario.find(x => x.id == productoId);
  if (!p) return;
  document.getElementById('ajuste-producto-id').value = productoId;
  document.getElementById('ajuste-cantidad').value    = '';
  document.getElementById('ajuste-motivo').value      = '';
  document.getElementById('ajuste-tipo').value        = 'entrada';

  setHTML('ajuste-producto-info', `
    <div class="resumen-row"><span>Producto:</span><strong>${esc(p.nombre)}</strong></div>
    <div class="resumen-row"><span>Stock actual:</span><strong style="color:${parseInt(p.stock||0)===0?'var(--rojo)':'var(--verde)'}">${p.stock || 0} unidades</strong></div>
    <div class="resumen-row"><span>Stock mínimo:</span><strong>${p.stockMin || 3} unidades</strong></div>
  `);

  // Listener para actualizar label dinámicamente
  const tipoSel = document.getElementById('ajuste-tipo');
  const cantLabel = document.querySelectorAll('#modal-ajuste-stock .form-group label')[1];
  function actualizarLabelAjuste() {
    if (!cantLabel) return;
    const t = tipoSel?.value;
    const prod = STATE.inventario.find(p => String(p.id) === String(document.getElementById('ajuste-producto-id').value));
    const stk = parseInt(prod?.stock || 0);
    if (t === 'ajuste')        cantLabel.textContent = `Nuevo stock total (actual: ${stk} uds)`;
    else if (t === 'entrada')  cantLabel.textContent = 'Unidades a agregar (+)';
    else                       cantLabel.textContent = 'Unidades a restar (−)';
  }
  if (tipoSel) {
    tipoSel.value = 'entrada';
    tipoSel.onchange = actualizarLabelAjuste;
    actualizarLabelAjuste();
  }
  openModal('modal-ajuste-stock');
}

async function guardarAjusteStock() {
  const productoId = val('ajuste-producto-id');
  const tipo       = val('ajuste-tipo');
  const cantRaw    = val('ajuste-cantidad');
  const cantidad   = parseInt(cantRaw) || 0;
  const motivo     = val('ajuste-motivo').trim();
  if (tipo === 'ajuste' && (cantRaw === '' || cantRaw === null || cantRaw === undefined || isNaN(parseInt(cantRaw)) || parseInt(cantRaw) < 0)) {
    showToast('Ingresa una cantidad válida (0 o mayor)', 'warning');
    return;
  }
  if (tipo !== 'ajuste' && (!cantidad || cantidad <= 0)) {
    showToast('Ingresa una cantidad mayor a 0', 'warning');
    return;
  }

  const p = STATE.inventario.find(x => String(x.id) === String(productoId));
  if (!p) return;

  const stockAnterior = parseInt(p.stock || 0); // capturar ANTES de mutar
  let nuevoStock = stockAnterior;
  if (tipo === 'entrada')  nuevoStock += cantidad;
  else if (tipo === 'salida') nuevoStock = Math.max(0, nuevoStock - cantidad);
  else nuevoStock = cantidad; // ajuste directo

  if (tipo === 'ajuste' && nuevoStock === 0) {
    if (!confirm(`⚠️ Estás poniendo el stock de "${p.nombre}" en CERO. ¿Confirmas?`)) return;
  }
  showLoading('Actualizando stock...');
  try {
    const dataUpdate = { ...p, stock: nuevoStock };
    await apiPost(CONFIG.HOJAS.INVENTARIO, 'update', dataUpdate);
    const idx = STATE.inventario.findIndex(x => String(x.id) === String(productoId));
    if (idx > -1) STATE.inventario[idx].stock = nuevoStock;

    const tipoLabel = tipo === 'entrada' ? 'Entrada' : tipo === 'salida' ? 'Salida' : 'Ajuste';
    await registrarAuditoria('Editar',
      `${STATE.usuario.nombre} — ${tipoLabel} de stock: ${p.nombre} (${stockAnterior} → ${nuevoStock})${motivo ? ' · ' + motivo : ''}`
    );

    closeAllModals();
    filterInventario();
    showToast(`Stock actualizado...: ${p.nombre} → ${nuevoStock} unidades`, 'success');

    if (nuevoStock === 0) showToast(`⚠️ ${p.nombre} se ha agotado`, 'warning', 5000);
    else if (nuevoStock <= parseInt(p.stockMin || 3)) showToast(`⚠️ ${p.nombre} tiene stock bajo (${nuevoStock} unidades)`, 'warning', 5000);
  } catch (err) {
    showToast('Error al actualizar stock', 'error');
  } finally { hideLoading(); }
}

async function eliminarProducto(id) {
  const p = STATE.inventario.find(x => x.id == id);
  showLoading('Eliminando producto...');
  try {
    await apiPost(CONFIG.HOJAS.INVENTARIO, 'delete', { id });
    STATE.inventario = STATE.inventario.filter(x => x.id != id);

    // Marcar ventas asociadas para que muestren advertencia al editar
    const ventasAsociadas = STATE.ventas.filter(v => String(v.productoId) === String(id));
    if (ventasAsociadas.length) {
      showToast(
        `Producto eliminado. ${ventasAsociadas.length} venta(s) lo referenciaban — el stock no se restaurará automáticamente al eliminarlas.`,
        'warning',
        6000
      );
    } else {
      showToast('Producto eliminado', 'success');
    }

    await registrarAuditoria('Eliminar',
      `${STATE.usuario.nombre} eliminó producto: ${p?.nombre}` +
      (ventasAsociadas.length ? ` (referenciado en ${ventasAsociadas.length} venta(s))` : '')
    );
    closeAllModals();
    filterInventario();
  } catch { showToast('Error al eliminar', 'error'); }
  finally  { hideLoading(); }
}
/* ══════════════════════════════════════════════════════════════
   🌙  MODO OSCURO
══════════════════════════════════════════════════════════════ */
function toggleDarkMode() {
  const isDark = document.body.classList.toggle('dark');
  localStorage.setItem('aurora_dark', isDark ? '1' : '0');
  const icon = document.getElementById('icon-dark');
  if (icon) {
    icon.setAttribute('data-feather', isDark ? 'sun' : 'moon');
    feather.replace();
  }
  // Re-renderizar gráficas con los colores correctos del nuevo modo
  if (document.getElementById('section-dashboard')?.classList.contains('active')) {
    renderGraficas();
  }
}

// Restaurar preferencia al cargar
(function() {
  if (localStorage.getItem('aurora_dark') === '1') {
    document.body.classList.add('dark');
  }
  document.documentElement.classList.remove('dark-preload');
})();
function toggleAcordeon(btn) {
  const acordeon = btn.closest('.clinica-acordeon');
  if (!acordeon) return;
  const body = acordeon.querySelector('.acordeon-body');
  const icon = btn.querySelector('.acordeon-icon');
  const isOpen = acordeon.classList.contains('abierto');
  if (isOpen) {
    acordeon.classList.remove('abierto');
    body.style.maxHeight = '0';
    if (icon) icon.style.transform = 'rotate(0deg)';
  } else {
    acordeon.classList.add('abierto');
    body.style.maxHeight = body.scrollHeight + 'px';
    if (icon) icon.style.transform = 'rotate(180deg)';
  }
}