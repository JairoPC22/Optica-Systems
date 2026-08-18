# Óptica-Systems — Sistema Interno

Sistema web interno de gestión para una óptica: clientes, historial clínico,
ventas, pagos, control de adeudos, garantías, inventario, auditoría y
administración de usuarios. Es una PWA (funciona offline y se puede instalar)
construida en HTML/CSS/JavaScript sin frameworks ni build, con un backend en
Google Apps Script que lee y escribe sobre una hoja de cálculo de Google
Sheets.

## Arquitectura

```
Navegador (index.html + script.js + styles.css + sw.js)
        │  fetch() por HTTPS
        ▼
Google Apps Script — Web App (apps-script/*.gs)
        │  SpreadsheetApp
        ▼
Google Sheets "Optica-System"  (USUARIOS, CLIENTES, VENTAS, PAGOS,
                                 HISTORIAL, AUDITORÍA, INVENTARIO, SESIONES)
```

- **Frontend**: SPA de una sola página (`index.html`), toda la lógica en
  `script.js`, estilos en `styles.css`. Sin dependencias de build: los
  únicos recursos externos son Google Fonts, Feather Icons, Chart.js y
  EmailJS, cargados por CDN con verificación de integridad (SRI).
- **Backend**: `apps-script/` contiene el código fuente completo de Apps
  Script — autenticación con contraseñas hasheadas (PBKDF2), sesiones por
  token, permisos por rol, y una capa de acceso a datos que es la única
  autorizada a leer/escribir la hoja de cálculo. Ver
  [`apps-script/README.md`](apps-script/README.md) para el detalle de cada
  archivo y el procedimiento de despliegue.
- **Almacenamiento offline**: IndexedDB cachea las últimas lecturas y encola
  operaciones de escritura cuando no hay conexión; se sincronizan solas al
  reconectar.

## Tecnologías

- HTML5 / CSS3 / JavaScript (ES2020+), sin frameworks.
- Google Apps Script (V8 runtime) + Google Sheets como base de datos.
- Chart.js (gráficas), Feather Icons (iconografía SVG), EmailJS (correos de
  recordatorio/agradecimiento), Google Fonts (Sora + JetBrains Mono).
- PWA: Service Worker (`sw.js`) + `manifest.json` para instalación y uso
  offline.

## Requisitos

- Una cuenta de Google con acceso a la hoja de cálculo `Optica-System`.
- Un navegador moderno (Chrome, Edge, Firefox, Safari recientes).
- No se requiere Node.js, npm ni ningún paso de build para ejecutar el
  frontend: son archivos estáticos.

## Instalación y ejecución local

El frontend es estático, así que basta con servirlo con cualquier servidor
HTTP (no puede abrirse con `file://` porque el Service Worker y los módulos
requieren un origen HTTP/HTTPS real):

```bash
# Con Node.js instalado, cualquiera de estas opciones sirve:
npx serve .
# o
python -m http.server 8080
```

Luego abre `http://localhost:8080` en el navegador. El sistema intentará
comunicarse con la URL configurada en `CONFIG.APPS_SCRIPT_URL`
(`script.js`), así que necesitas el backend ya desplegado (ver siguiente
sección) para poder iniciar sesión.

## Configuración de Apps Script

Todo el código del backend vive en [`apps-script/`](apps-script/). Ese
directorio incluye su propio `README.md` con:

- La estructura completa de cada pestaña de la hoja de cálculo.
- El procedimiento paso a paso de despliegue (`inicializarHojas()`, alta
  segura del primer administrador, publicación como aplicación web).
- Cómo actualizar el código sin cambiar la URL de la implementación ya
  publicada.

**Dato de la implementación actual:**

| Campo | Valor |
|---|---|
| Hoja de cálculo | `Optica-System` |
| Descripción de despliegue | Versión 1 del 18 ago 2026, 12:10 a. m. |
| URL de la app web | `https://script.google.com/macros/s/AKfycbyZKDk86o5yK-N_msVk5eNcc-sskrxgE_DAfDwXuk9ijibQerjkTiDyjv6BU9WwUk89ig/exec` |

Esta URL está centralizada en un único lugar del frontend:
`CONFIG.APPS_SCRIPT_URL` en `script.js` (línea ~8). No se repite en ningún
otro archivo. La URL y el ID de implementación **no se tratan como
secretos** — la seguridad depende de la validación de sesión y permisos que
hace el servidor en cada petición, no de ocultar la URL.

> **Importante:** no fue posible, dentro de esta sesión de trabajo,
> autenticarse con Google ni desplegar el código de `apps-script/` en el
> proyecto real (requiere acceso interactivo a la cuenta de Google
> propietaria de la hoja). El código quedó listo, verificado con una batería
> de pruebas automatizadas que reproduce fielmente los servicios de Apps
> Script (ver más abajo), pero **no se puede afirmar que ya esté
> desplegado**. Sigue el procedimiento de `apps-script/README.md` para
> publicarlo.

## Primer uso: alta del administrador

No hay ninguna contraseña de administrador incluida en el código, en la
documentación ni en el historial de Git. El procedimiento seguro es:

1. Desplegar el código de `apps-script/` (ver su README).
2. Ejecutar `inicializarHojas()` una vez desde el editor de Apps Script —
   crea las pestañas necesarias si no existen; es idempotente.
3. Ejecutar `generarTokenDeConfiguracion()` una vez y copiar el token que
   aparece en los registros de ejecución.
4. Hacer una única petición `POST` a la acción `setup_admin` con ese token,
   el nombre de usuario deseado y una contraseña temporal — el hash y el
   salt se generan en el servidor; la contraseña en texto plano nunca se
   guarda ni queda en ningún archivo.
5. Iniciar sesión con esa cuenta: el sistema exigirá cambiar la contraseña
   temporal antes de continuar.

## Roles y permisos

Dos roles: **administrador** y **empleado**. Ambos ven y capturan
información de clientes, historial clínico, ventas, pagos e inventario.
Diferencias:

| Acción | Empleado | Administrador |
|---|---|---|
| Ver/crear/editar registros | ✅ | ✅ |
| Eliminar registros (cliente, venta, pago, historial, producto) | ❌ | ✅ |
| Ver auditoría del sistema | ❌ | ✅ |
| Gestionar usuarios (crear, activar/desactivar, resetear contraseña, revocar sesiones) | ❌ | ✅ |
| Ver desglose de ventas/dashboard por empleado | ❌ | ✅ |

Estas reglas se validan **en el servidor** en cada operación (no solo se
ocultan botones en el cliente): un usuario con herramientas de desarrollador
no puede obtener acceso adicional falsificando su rol o llamando
directamente al backend.

## Sesiones

- El login devuelve un token de sesión aleatorio (256 bits) con expiración
  de 8 horas; el servidor solo guarda su hash SHA-256.
- El token se guarda en `sessionStorage` (nunca en `localStorage`): se borra
  al cerrar la pestaña/navegador, no queda como credencial persistente.
- Cerrar sesión revoca el token en el servidor. Cambiar la contraseña
  revoca automáticamente todas las demás sesiones del usuario.
- Un administrador puede revocar las sesiones de cualquier usuario desde
  **Usuarios → ícono de revocar sesiones**.
- Hay un límite de intentos de login por usuario (bloqueo temporal ante
  fuerza bruta) y un límite de sesiones simultáneas por usuario.

## Cambiar contraseña / recuperar acceso

- Cualquier usuario puede cambiar su propia contraseña desde
  **Cambiar contraseña** en el menú lateral (requiere la contraseña
  actual).
- Un administrador puede restablecer la contraseña de otro usuario desde
  **Usuarios → ícono de llave** — queda marcada como temporal y se le
  exigirá cambiarla en su próximo inicio de sesión.
- Si un administrador pierde el acceso y no hay otro administrador activo,
  la recuperación requiere acceso directo al editor de Apps Script (ver
  `apps-script/README.md`, mismo procedimiento de alta inicial).

## Pruebas

No hay un framework de pruebas instalado (el proyecto no tiene build ni
dependencias de Node para el frontend). Lo que sí se hizo y puede
repetirse:

- **Backend**: una batería de 46 pruebas automatizadas en Node que carga el
  código real de `apps-script/*.gs` sobre un mock fiel de los servicios de
  Apps Script (`SpreadsheetApp`, `Utilities`, `LockService`,
  `CacheService`, `PropertiesService`) y verifica login correcto/incorrecto,
  bloqueo por fuerza bruta, expiración y revocación de sesión, permisos por
  rol (incluyendo intentos de un empleado de leer auditoría o eliminar
  registros), neutralización de inyección de fórmulas, cambio de
  contraseña con revocación de otras sesiones, y administración de
  usuarios. No se incluye en el repositorio (era código de verificación
  temporal), pero el diseño modular de `apps-script/` permite reconstruirla
  fácilmente si se necesita de nuevo.
- **Frontend + backend end-to-end**: se probó manualmente con Chrome
  (DevTools: Console, Network, Application) usando un servidor Node local
  que reproduce el mismo contrato HTTP (`doGet`/`doPost`) que el backend
  real, apuntando temporalmente `CONFIG.APPS_SCRIPT_URL` a esa URL local y
  revirtiéndolo antes de confirmar los cambios. Se verificaron los flujos de
  login/logout, cambio de contraseña obligatorio, alta/baja de usuarios,
  intentos de bypass desde la consola del navegador (rol falsificado, token
  falsificado, llamadas directas a acciones de administrador) y
  neutralización de XSS/inyección de fórmulas.
- **Sintaxis**: `node --check script.js` y `node --check sw.js` para
  detectar errores de sintaxis tras cada cambio.

## Build

No aplica — no hay paso de compilación. Los archivos en la raíz del
proyecto (`index.html`, `script.js`, `styles.css`, `sw.js`,
`manifest.json`, `icons/`, `Logo-optica.ico`) son los que se sirven
directamente en producción.

## Despliegue

**Frontend**: sube el contenido de la raíz del proyecto a cualquier
hosting estático (GitHub Pages, Netlify, Vercel, un bucket, etc.). No hay
variables de entorno que configurar en el frontend.

**Backend**: ver el procedimiento detallado en
[`apps-script/README.md`](apps-script/README.md). En resumen: para
actualizar el código sin perder la URL actual, usa **Gestionar
implementaciones → editar → Nueva versión** sobre la implementación ya
publicada, en vez de crear una implementación nueva.

## Estructura del proyecto

```
├── index.html          # Interfaz completa (SPA)
├── script.js           # Toda la lógica del frontend
├── styles.css          # Estilos y sistema de diseño
├── sw.js                # Service Worker (PWA offline)
├── manifest.json        # Manifiesto de instalación PWA
├── Logo-optica.ico      # Ícono / logo
├── icons/                # Íconos PNG generados para instalación PWA (192, 512, maskable)
└── apps-script/          # Backend completo de Google Apps Script
    ├── Codigo.gs          # doGet/doPost — punto de entrada único
    ├── Config.gs           # Configuración y listas blancas
    ├── Auth.gs               # Login, cambio de contraseña, administración de usuarios
    ├── Sesiones.gs            # Manejo de tokens de sesión
    ├── Permisos.gs             # Matriz de autorización por rol
    ├── AccesoDatos.gs           # CRUD genérico sobre la hoja de cálculo
    ├── Seguridad.gs              # PBKDF2, tokens aleatorios, comparación segura
    ├── LimiteIntentos.gs          # Freno a fuerza bruta
    ├── Auditoria.gs                # Registro de eventos
    ├── Utilidades.gs                # Helpers de acceso a hojas y saneamiento
    ├── Init.gs                      # Inicialización idempotente + alta del primer admin
    ├── appsscript.json                # Manifiesto del proyecto de Apps Script
    └── README.md                      # Estructura de hojas y guía de despliegue
```

## Consideraciones de seguridad

- Las contraseñas nunca se guardan en texto plano: se derivan con
  PBKDF2-HMAC-SHA256 (10 000 iteraciones) con salt único por usuario.
- El frontend nunca decide permisos: solo envía credenciales y muestra lo
  que el servidor autoriza. Toda operación protegida valida sesión, usuario
  activo, rol y permiso específico en el servidor.
- Los errores de login son siempre genéricos («Usuario o contraseña
  incorrectos.») — no revelan si el usuario existe ni si está inactivo.
- Los valores de texto que empiecen con `=`, `+`, `-`, `@` se neutralizan
  antes de guardarse en la hoja (protección contra inyección de fórmulas).
- El contenido dinámico se escapa antes de insertarse en el DOM
  (protección contra XSS almacenado).
- La política de seguridad de contenido (CSP) del `index.html` limita los
  orígenes de scripts, estilos y conexiones a los que la app realmente usa.
- **Limitación conocida de la arquitectura de Apps Script:** el token de
  sesión debe viajar en la URL para las peticiones `GET` (Apps Script no
  permite leer cabeceras personalizadas fácilmente en `doGet`), lo que
  significa que puede quedar registrado en logs de acceso del lado del
  servidor o en el historial del navegador. Se mitiga con expiración corta
  (8 horas), revocación server-side y el hecho de que solo viaja por HTTPS;
  no es un riesgo eliminado por completo, es una limitación documentada.
- Google Apps Script no permite configurar cookies `HttpOnly`: por eso el
  token vive en `sessionStorage` (accesible por JavaScript, pero no
  persistente) en vez de una cookie — es la opción menos mala dentro de las
  limitaciones reales de la plataforma.

## Respaldo y recuperación

La hoja de cálculo de Google Sheets **es** la base de datos: usa el
historial de versiones nativo de Google Sheets (Archivo → Historial de
versiones) como mecanismo de respaldo y recuperación ante errores. Para una
copia adicional, exporta la hoja periódicamente (Archivo → Descargar) a un
almacenamiento externo.
