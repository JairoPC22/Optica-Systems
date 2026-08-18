# Backend de Apps Script — Óptica-Systems

Código fuente del backend que sirve a `index.html`/`script.js`. Está pensado
para desplegarse como **aplicación web** vinculada a la hoja de cálculo
`Optica-System`.

## Archivos

Todo el backend vive en **un solo archivo**, `Codigo.gs`, para que puedas
copiarlo y pegarlo de una sola vez en el editor de Apps Script (útil si no
puedes crear varios archivos ahí, por ejemplo desde el móvil o con acceso
limitado). Internamente está organizado en secciones claramente separadas
por comentarios, en este orden:

| Sección dentro de `Codigo.gs` | Responsabilidad |
|---|---|
| Config | Nombres de pestañas, encabezados esperados, parámetros de seguridad (iteraciones PBKDF2, duración de sesión, límites de intentos). |
| Utilidades | Acceso a la hoja de cálculo, lectura por lotes, generación de IDs, saneamiento de texto y neutralización de inyección de fórmulas. |
| Seguridad | PBKDF2-HMAC-SHA256 manual, generación de salt/token aleatorios, comparación en tiempo constante, SHA-256 para hash de tokens. |
| Sesiones | Creación, validación, expiración y revocación de sesiones (tabla `SESIONES`). |
| Permisos | Matriz de autorización server-side (qué rol puede hacer qué acción sobre qué pestaña). |
| AccesoDatos | CRUD genérico sobre las pestañas de negocio, con `LockService` y lectura/escritura por lotes (nunca celda por celda). |
| Auditoria | Registro de eventos (nunca contraseñas, hashes, salts ni tokens). |
| LimiteIntentos | Bloqueo temporal por usuario tras varios intentos de login fallidos (`CacheService`). |
| Auth | Login, logout, cambio de contraseña y administración de usuarios (crear, activar/desactivar, resetear contraseña, revocar sesiones). |
| Init | Inicialización idempotente de pestañas y alta segura del primer administrador. |
| Codigo (doGet/doPost) | Única puerta de entrada del backend, con lista blanca explícita de acciones. |

El manifiesto `appsscript.json` es un archivo aparte porque en el editor de
Apps Script se edita en una vista distinta (ícono de engranaje ⚙ →
**Mostrar archivo de manifiesto "appsscript.json"**), no se pega como código.

## Estructura de cada pestaña (se crea sola al inicializar)

- **USUARIOS**: `id, usuario, nombre, rol, hash, salt, iteraciones, activo, debeCambiarPassword, creado, actualizado`. `hash`/`salt` son PBKDF2 en hexadecimal; la contraseña en texto plano nunca se guarda.
- **CLIENTES**: `id, nombre, telefono, email, edad, ocupacion, direccion, escolaridad, actividades, creado, actualizado`.
- **VENTAS**: `id, clienteId, clienteNombre, tipo, tipoLente, totalFinal, fecha, registradoPor, creado, actualizado`.
- **PAGOS**: `id, clienteId, ventaId, monto, fecha, registradoPor, creado`.
- **HISTORIAL**: `id, clienteId, fecha, registradoPor, creado, actualizado`.
- **AUDITORÍA**: `id, usuario, tipo, descripcion, fecha, hora, creado`.
- **INVENTARIO**: `id, nombre, categoria, stock, creado, actualizado`.
- **SESIONES**: `tokenHash, usuarioId, usuario, rol, creado, expira, ultimoUso`. Solo el hash del token vive aquí; el token en texto plano solo existe una vez, en la respuesta de login.

> Nota: las pestañas de negocio (CLIENTES, VENTAS, PAGOS, HISTORIAL, INVENTARIO) tienen más columnas en uso real por el frontend (`script.js` envía objetos con muchos más campos: teléfono formateado, notas clínicas, etc.). Las tablas anteriores listan solo las columnas que el backend trata de forma especial; el resto de columnas que el cliente envíe se guardan tal cual llegan (saneadas) gracias a que la sección AccesoDatos escribe dinámicamente según el encabezado real de cada pestaña. Si necesitas columnas adicionales, agrégalas al arreglo correspondiente en `CONFIG.ENCABEZADOS` (sección Config, dentro de `Codigo.gs`) **y** vuelve a ejecutar `inicializarHojas()` — es idempotente, no duplicará nada.

## Despliegue paso a paso

1. Abre la hoja de cálculo `Optica-System` en Google Sheets → **Extensiones → Apps Script**.
2. En el editor, abre (o crea) un archivo de script y **borra todo su contenido**; copia y pega ahí el contenido completo de `Codigo.gs` de esta carpeta. Es un solo archivo — no necesitas crear ninguno más.
3. Abre el manifiesto (ícono de engranaje ⚙ → **Mostrar archivo de manifiesto "appsscript.json"** → aparece `appsscript.json` en la lista de archivos) y reemplaza su contenido por el de `appsscript.json` de esta carpeta.
4. Guarda (Ctrl+S / ícono de guardar).
5. Ejecuta la función `inicializarHojas` una vez (menú desplegable de funciones, arriba del editor → selecciona `inicializarHojas` → ▶ Ejecutar). Autoriza los permisos solicitados la primera vez. Puedes volver a ejecutarla cuando quieras: es idempotente.
6. Ejecuta `generarTokenDeConfiguracion` una vez. Copia el token que aparece en **Ver → Registros de ejecución** (no quedará visible después).
7. Con ese token, haz una sola petición `POST` al endpoint desplegado (puedes usar `curl`, Postman o la consola del navegador) con:
   ```json
   {
     "action": "setup_admin",
     "payload": {
       "setupToken": "TOKEN_DEL_PASO_6",
       "usuario": "admin",
       "nombre": "Nombre del administrador",
       "passwordInicial": "una-contraseña-fuerte-temporal"
     }
   }
   ```
   Esto crea al primer administrador con contraseña hasheada en el servidor y marca `debeCambiarPassword = true`. El token de configuración se invalida automáticamente tras usarse.
8. Implementa la app web: **Implementar → Nueva implementación → Aplicación web**, ejecutar como *"Yo (usuario que implementa)"*, acceso *"Cualquier usuario"*. Para conservar la misma URL en futuras actualizaciones de código, usa **Gestionar implementaciones → editar (lápiz) → Nueva versión** sobre la implementación existente en lugar de crear una implementación nueva.
9. Confirma que `CONFIG.APPS_SCRIPT_URL` en `script.js` (raíz del proyecto) apunta exactamente a la URL `/exec` de esa implementación.

No fue posible ejecutar estos pasos de forma remota en esta sesión de trabajo (requieren autenticación de Google y acceso al proyecto de Apps Script). El código queda listo — y verificado con pruebas automatizadas — para que un administrador con acceso lo despliegue siguiendo estos pasos.
