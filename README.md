# FoYu

**FoYu** reúne tu música, tus playlists y tu biblioteca en un reproductor para **Android** y **Windows**.

El nombre viene de **F** de *free* y **Y** de *YouTube*, y suena como *for you*.

![Plataformas](https://img.shields.io/badge/plataformas-Windows%2010%2F11%20%C2%B7%20Android%207%2B-0ea5e9)

## Características

- **Diseño moderno** al abrir la app, con colores tomados de la portada.
- **Diseño iPod clásico** con rueda click. El icono junto a `YT` cambia de un diseño a otro.
- Búsqueda y reproducción de canciones desde YouTube Music.
- **Me gusta** y descargas para escuchar sin conexión.
- **Playlists propias**: créalas, añade canciones y quítalas cuando quieras.
- **Importación por enlace** desde playlists públicas de Spotify, Apple Music, Deezer y YouTube Music.
- **Exportación e importación de archivos**: exporta en CSV e importa CSV, TSV, M3U, M3U8, XSPF, JSON o TXT.
- En Windows, control de Spotify y Apple Music cuando están sonando.

## Privacidad

Las versiones publicadas en [Releases](../../releases) **no incluyen cuenta ni copia en la nube**. Tu biblioteca se guarda en tu dispositivo. Para llevarla a otro, usa **Exportar** e **Importar archivo**.

En Android, FoYu solo pide acceso a Internet. No lee tus notificaciones, contactos ni fotos.

## Cuenta con Google (en desarrollo)

El código incluye una cuenta opcional para Android, pero solo aparece en compilaciones configuradas con Firebase. Aún no está abierta al público.

Con la cuenta activa:

- Firebase Authentication gestiona tu cuenta de Google.
- Cloud Firestore guarda tus playlists, tus Me gusta y datos técnicos de sincronización.
- Las reglas de Firestore permiten que cada cuenta acceda solo a sus datos.
- FoYu no recibe tu contraseña de Google.
- Firestore no guarda tu correo, contraseña ni tokens.

Desde **Cuenta** puedes sincronizar, cerrar sesión, quitar la biblioteca del teléfono, desconectar YouTube Music y borrar tu cuenta con su copia en la nube.

### YouTube Music

La conexión usa YouTube Data API con el permiso `youtube.readonly`:

- Trae las playlists de tu cuenta y tus Me gusta clasificados como música.
- No crea, cambia ni borra nada en YouTube.
- El token es temporal, no se guarda y no entra en la vista web.
- Las canciones y los álbumes guardados solo en la biblioteca de YouTube Music no están disponibles en esta API.
- YouTube entrega hasta los 1000 Me gusta más recientes.

## Requisitos

### Android

- Android 7.0 (API 24) o superior.
- Procesador ARM de 64 bits, presente en casi todos los teléfonos actuales.

### Windows

- Windows 10 u 11 de 64 bits.
- WebView2. El instalador lo incluye y Windows 11 ya lo trae.

## Descargar e instalar

1. Entra en [Releases](../../releases).
2. Descarga el archivo para tu sistema:
   - **Android**: `FoYu_<versión>_arm64.apk`.
   - **Windows**: `FoYu_<versión>_x64-setup.exe` o el `.msi`.
3. Abre el archivo y sigue los pasos del sistema.

> FoYu conserva internamente el identificador `com.pocketpod.app`. Así se actualiza sobre versiones anteriores y mantiene tus datos.

## Uso

- **Inicio** abre el menú principal.
- **Buscar** encuentra canciones.
- **Biblioteca** reúne playlists, Me gusta y descargas.
- En **Biblioteca**, pega un enlace para importar o escribe un nombre para crear una playlist.
- **Exportar** guarda tu biblioteca en un archivo CSV. No incluye el audio.
- **Importar archivo** suma canciones sin borrar las que ya tienes.
- Las descargas, los Me gusta y las playlists se conservan al actualizar FoYu. Si la desinstalas, Android los borra del teléfono.
- En Android, deslizar desde un borde regresa a la pantalla anterior. En la pantalla principal, la app pasa a segundo plano.

Cuando importas desde otro servicio, FoYu busca cada canción por título, artista y duración, y el audio sale de YouTube Music. Una canción puede no encontrarse o aparecer en otra versión.

## Desarrollo

```bash
npm install
npm run tauri dev
npm run tauri android dev
```

Para compilar necesitas Node.js 20+, Rust estable y las dependencias de Tauri. En Android también necesitas JDK 17, Android SDK 37, build-tools 37 y NDK 27, con `JAVA_HOME`, `ANDROID_HOME` y `NDK_HOME` configurados.

### Configurar Firebase

Sigue [docs/firebase.md](docs/firebase.md). Después copia `.env.example` como `.env.local` y rellena los valores. Ese archivo no se sube a GitHub.

Sin esta configuración la app funciona, pero no muestra la opción de cuenta. Así se compilan las versiones públicas.

### Pruebas

```bash
npx tsc --noEmit
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

Para probar reglas y sincronización sin tocar datos reales:

```bash
npx firebase-tools@13.35.1 emulators:start --project demo-foyu --only auth,firestore
```

## Compilar

### Windows

```bash
npm run tauri build
```

### Android

```bash
npm run tauri android build -- --apk
```

Para una compilación de prueba:

```bash
npm run tauri android build -- --apk --debug
```

### Firmar la APK

Todas las versiones deben usar **la misma clave** para instalarse sobre la anterior. Los archivos locales son:

- `src-tauri/gen/android/pocketpod-release.jks`
- `src-tauri/gen/android/keystore.properties`

Están ignorados por Git. Guarda una copia segura de ambos.

## Publicar una versión

En **GitHub → Settings → Secrets and variables → Actions** configura:

| Tipo | Nombre |
| --- | --- |
| Secreto | `ANDROID_KEYSTORE_BASE64` |
| Secreto | `ANDROID_KEYSTORE_PASSWORD` |
| Secreto | `ANDROID_KEY_ALIAS` |
| Secreto | `ANDROID_KEY_PASSWORD` |

Después crea un tag con la versión de `package.json`:

```bash
git tag -a v0.3.0 -m "FoYu 0.3.0"
git push origin v0.3.0
```

El workflow crea un borrador con los instaladores de Windows y la APK de Android. Revísalo y publícalo desde GitHub.

### Activar la cuenta más adelante

Las versiones públicas no llevan cuenta mientras no existan las variables `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID` y `VITE_GOOGLE_WEB_CLIENT_ID`. No las agregues todavía.

Antes de activarla, agrega en Firebase las huellas de la clave de publicación, publica una política de privacidad basada en [docs/privacidad.md](docs/privacidad.md) y ponla en `VITE_PRIVACY_POLICY_URL`. Completa también la verificación de Google y revisa las condiciones de YouTube.

## Aviso

FoYu no está afiliada a YouTube, Google, Spotify, Apple ni Deezer. La reproducción usa un método no oficial de YouTube Music y puede dejar de funcionar si YouTube cambia su servicio. Usa la app de acuerdo con las condiciones de cada plataforma.

## Tecnologías

- [Tauri 2](https://tauri.app/) y Rust
- React 19, TypeScript y Vite
- Firebase Authentication y Cloud Firestore
- Android Credential Manager y Google Identity
- YouTube Data API v3

## Licencia

[MIT](LICENSE)
