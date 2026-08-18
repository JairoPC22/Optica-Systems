# Backend de Apps Script — Óptica Aurora

Código fuente del backend que sirve a `index.html`/`script.js`. Está pensado
para desplegarse como **aplicación web** vinculada a la hoja de cálculo
`Optica-System`.

## Archivos

| Archivo | Responsabilidad |
|---|---|
| `appsscript.json` | Manifiesto del proyecto: runtime V8, scopes mínimos (`spreadsheets`), acceso de la app web. |
| `Config.gs` | Nombres de pestañas, encabezados esperados, parámetros de seguridad (iteraciones PBKDF2, duración de sesión, límites de intentos). |
| `Utilidades.gs` | Acceso a la hoja de cálculo, lectura por lotes, generación de IDs, saneamiento de texto y neutralización de inyección de fórmulas. |
| `Seguridad.gs` | PBKDF2-HMAC-SHA256 manual, generación de salt/token aleatorios, comparación en tiempo constante, SHA-256 para hash de tokens. |
| `Sesiones.gs` | Creación, validación, expiración y revocación de sesiones (tabla `SESIONES`). |
| `Permisos.gs` | Matriz de autorización server-side (qué rol puede hacer qué acción sobre qué pestaña). |
| `AccesoDatos.gs` | CRUD genérico sobre las pestañas de negocio, con `LockService` y lectura/escritura por lotes (nunca celda por celda). |
| `Auditoria.gs` | Registro de eventos (nunca contraseñas, hashes, salts ni tokens). |
| `LimiteIntentos.gs` | Bloqueo temporal por usuario tras varios intentos de login fallidos (`CacheService`). |
| `Auth.gs` | Login, logout, cambio de contraseña y administración de usuarios (crear, activar/desactivar, resetear contraseña, revocar sesiones). |
| `Init.gs` | Inicialización idempotente de pestañas y alta segura del primer administrador. |
| `Codigo.gs` | `doGet`/`doPost`: única puerta de entrada, con lista blanca explícita de acciones. |

## Estructura de cada pestaña (se crea sola al inicializar)

- **USUARIOS**: `id, usuario, nombre, rol, hash, salt, iteraciones, activo, debeCambiarPassword, creado, actualizado`. `hash`/`salt` son PBKDF2 en hexadecimal; la contraseña en texto plano nunca se guarda.
- **CLIENTES**: `id, nombre, telefono, email, edad, ocupacion, direccion, escolaridad, actividades, creado, actualizado`.
- **VENTAS**: `id, clienteId, clienteNombre, tipo, tipoLente, totalFinal, fecha, registradoPor, creado, actualizado`.
- **PAGOS**: `id, clienteId, ventaId, monto, fecha, registradoPor, creado`.
- **HISTORIAL**: `id, clienteId, fecha, registradoPor, creado, actualizado`.
- **AUDITORÍA**: `id, usuario, tipo, descripcion, fecha, hora, creado`.
- **INVENTARIO**: `id, nombre, categoria, stock, creado, actualizado`.
- **SESIONES**: `tokenHash, usuarioId, usuario, rol, creado, expira, ultimoUso`. Solo el hash del token vive aquí; el token en texto plano solo existe una vez, en la respuesta de login.

> Nota: las pestañas de negocio (CLIENTES, VENTAS, PAGOS, HISTORIAL, INVENTARIO) tienen más columnas en uso real por el frontend (`script.js` envía objetos con muchos más campos: teléfono formateado, notas clínicas, etc.). Las tablas anteriores listan solo las columnas que el backend trata de forma especial; el resto de columnas que el cliente envíe se guardan tal cual llegan (saneadas) gracias a que `AccesoDatos.gs` escribe dinámicamente según el encabezado real de cada pestaña. Si necesitas columnas adicionales, agrégalas al arreglo correspondiente en `CONFIG.ENCABEZADOS` (Config.gs) **y** vuelve a ejecutar `inicializarHojas()` — es idempotente, no dupdicará nada.

## Despliegue paso a paso

1. Abre la hoja de cálculo `Optica-System` en Google Sheets → **Extensiones → Apps Script**.
2. Copia el contenido de cada archivo de esta carpeta a un archivo del mismo nombre en el editor de Apps Script (o usa `clasp push` si tienes `clasp` configurado con el `scriptId` del proyecto — ese ID no está incluido aquí porque no se debe inventar; consíguelo desde **Configuración del proyecto** en el editor).
3. Ejecuta la función `inicializarHojas` una vez (menú desplegable de funciones → `inicializarHojas` → ▶ Ejecutar). Autoriza los permisos solicitados. Puedes volver a ejecutarla cuando quieras: es idempotente.
4. Ejecuta `generarTokenDeConfiguracion` una vez. Copia el token que aparece en **Ver → Registros de ejecución** (no quedará visible después).
5. Con ese token, haz una sola petición `POST` al endpoint (puedes usar `curl`, Postman o la consola del navegador) con:
   ```json
   {
     "action": "setup_admin",
     "payload": {
       "setupToken": "TOKEN_DEL_PASO_4",
       "usuario": "admin",
       "nombre": "Nombre del administrador",
       "passwordInicial": "una-contraseña-fuerte-temporal"
     }
   }
   ```
   Esto crea al primer administrador con contraseña hasheada en el servidor y marca `debeCambiarPassword = true`. El token de configuración se invalida automáticamente tras usarse.
6. Implementa la app web: **Implementar → Nueva implementación → Aplicación web**, ejecutar como *"Yo (usuario que implementa)"*, acceso *"Cualquier usuario"*. Para conservar la misma URL en futuras actualizaciones de código, usa **Gestionar implementaciones → editar (lápiz) → Nueva versión** sobre la implementación existente en lugar de crear una implementación nueva.
7. Confirma que `CONFIG.APPS_SCRIPT_URL` en `script.js` (raíz del proyecto) apunta exactamente a la URL `/exec` de esa implementación.

No fue posible ejecutar estos pasos de forma remota en esta sesión de trabajo (requieren autenticación de Google y acceso al proyecto de Apps Script). El código queda listo para que un administrador con acceso lo despliegue siguiendo estos pasos.
