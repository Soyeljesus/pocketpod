# Configurar cuentas y sincronización de FoYu

Esta guía la sigue la persona dueña del proyecto. No compartas contraseñas,
códigos de verificación, archivos de "cuenta de servicio" ni claves privadas.
El plan gratuito **Spark** no pide tarjeta.

Los nombres de los botones pueden variar un poco si Google actualiza sus paneles.

## 1. Crear el proyecto

1. Entra a <https://console.firebase.google.com> con la cuenta de Google que
   administrará FoYu.
2. Pulsa **Crear un proyecto** y llámalo `FoYu`.
3. Desactiva Google Analytics. FoYu no lo necesita.

## 2. Activar el inicio de sesión

1. Abre **Compilación → Authentication → Comenzar**.
2. En **Método de acceso**, elige **Google** y actívalo.
3. Selecciona tu correo de asistencia y guarda.
4. Vuelve a abrir Google y, en **Configuración del SDK web**, copia el
   **ID de cliente web**. Termina en `.apps.googleusercontent.com`.

## 3. Crear la base de datos

1. Abre **Compilación → Firestore Database → Crear base de datos**.
2. Elige la edición **Standard** si te lo pregunta.
3. Elige una ubicación cercana a tus usuarios. Después no se puede cambiar.
4. Elige **Modo de producción**. No uses el modo de prueba.
5. En la pestaña **Reglas**, reemplaza todo por el contenido de
   `firestore.rules` y pulsa **Publicar**.

## 4. Registrar la app Android

1. En **Configuración del proyecto → General**, pulsa **Agregar app → Android**.
2. Nombre del paquete: `com.pocketpod.app`.
3. Sobrenombre: `FoYu Android`.
4. Agrega esta huella SHA-1 de la versión de prueba:

   `A7:01:25:B8:B6:ED:9B:C4:63:63:16:B4:BB:78:2F:22:74:25:E8:82`

5. Después, en la misma app, agrega también la SHA-256:

   `7B:1B:2C:22:4F:18:CD:AC:F0:71:3C:6B:A0:FC:91:B6:D6:20:FD:1D:3A:AD:4C:5E:D5:65:A6:E4:1F:56:BD:63`

6. Puedes omitir la descarga de `google-services.json`. FoYu no lo usa.

La versión publicada usa otra firma. Antes de publicarla debes agregar también
sus huellas.

## 5. Registrar la configuración web

1. En **Configuración del proyecto → General**, pulsa **Agregar app → Web**.
2. Sobrenombre: `FoYu`. No actives Hosting.
3. Copia estos valores: `apiKey`, `authDomain`, `projectId` y `appId`.

## 6. Permitir leer YouTube Music

1. Abre <https://console.cloud.google.com> y selecciona el proyecto `FoYu`.
2. En **APIs y servicios → Biblioteca**, busca **YouTube Data API v3** y pulsa
   **Habilitar**.
3. Abre **Google Auth Platform → Público** y deja la app en **Prueba**.
4. Agrega como **usuarios de prueba** los correos que usarán FoYu.
5. En **Acceso a datos**, agrega este permiso:

   `https://www.googleapis.com/auth/youtube.readonly`

6. En **Clientes**, comprueba que exista un cliente Android con
   `com.pocketpod.app` y la SHA-1 anterior.

En modo Prueba solo entran los correos autorizados, hasta 100, y Google puede
volver a pedir el permiso cada 7 días.

## 7. Activar FoYu en tu equipo

Copia `.env.example` como `.env.local` y rellena:

```text
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_APP_ID=
VITE_GOOGLE_WEB_CLIENT_ID=
VITE_PRIVACY_POLICY_URL=
```

`.env.local` no se sube a GitHub. Para las versiones publicadas, crea esos mismos
nombres en **GitHub → Settings → Secrets and variables → Actions → Variables**.

## 8. Antes de abrir la app al público

- Publica una política de privacidad basada en `docs/privacidad.md`.
- Revisa con Google la verificación del permiso de YouTube.
- Agrega las huellas de la firma de publicación.
- Limita la clave web en Google Cloud a Identity Toolkit, Token Service y
  Cloud Firestore.
- Activa Firebase App Check.
- Revisa si la lectura y el uso de YouTube cumplen sus condiciones, sobre todo
  porque FoYu también reproduce audio de YouTube por un método no oficial.

## Qué protege FoYu

- Cada persona solo puede leer y cambiar sus propios documentos.
- La nube guarda playlists, Me gusta y datos técnicos de sincronización. No se
  guardan correo, contraseña ni tokens en Firestore.
- El token de YouTube es temporal, de solo lectura y no entra en la vista web.
- La app no permite copias automáticas de Android de sus datos locales.
- Desde **Cuenta** se puede cerrar sesión, quitar la biblioteca del teléfono o
  borrar la cuenta y su copia en la nube.
