# PocketPod

Un reproductor con forma de **iPod clásico** que controla **Spotify** y **Apple Music** en **Windows** y **Android**.

PocketPod se conecta a la sesión del reproductor a través de los controles multimedia del sistema, así que no necesita la API web ni iniciar sesión: si Spotify o Apple Music están reproduciendo, el iPod lo muestra y lo controla.

![Plataformas](https://img.shields.io/badge/plataformas-Windows%2010%2F11%20%C2%B7%20Android%207%2B-0ea5e9)

## Características

- Pantalla **Now Playing** con portada, título, artista y álbum.
- Barra de progreso con tiempo transcurrido y restante, actualizada en tiempo real y sin saltos.
- Rueda click funcional: **MENU**, anterior, siguiente y play/pausa.
- **Historial de canciones** escuchadas (se guarda localmente).
- En Windows: ventana sin bordes con carcasa de iPod, botones de minimizar/cerrar y redimensionado proporcional (280×500 a 380×680).
- En Android: carcasa a pantalla completa, lista para usar con el dedo.

## Requisitos

### Windows

- Windows 10 u 11 de 64 bits.
- La **app de escritorio de Spotify** o **Apple Music** abierta (las versiones web no exponen los controles multimedia).
- WebView2. El instalador lo incluye; en Windows 11 ya viene preinstalado.

### Android

- Android 7.0 (API 24) o superior.
- La app de **Spotify** o **Apple Music** abierta.
- Conceder una vez el **acceso a notificaciones** a PocketPod. Android exige este permiso para que una app pueda leer y controlar la reproducción de otras; sin él, PocketPod no puede ver la sesión multimedia.

## Descargar e instalar

1. Entra en la página de [Releases](../../releases) del repositorio.
2. Descarga el archivo según tu sistema:
   - **Windows**: `PocketPod_<versión>_x64-setup.exe` (recomendado) o `PocketPod_<versión>_x64_en-US.msi`.
   - **Android**: `PocketPod_<versión>_arm64.apk` (teléfonos de 64 bits, la mayoría desde 2017).
3. En Windows, ejecuta el instalador y sigue el asistente.
4. En Android, abre el APK y permite la instalación desde esta fuente si el sistema lo pregunta.

> Windows puede mostrar el aviso de SmartScreen porque la app no está firmada digitalmente. Pulsa **Más información → Ejecutar de todas formas**.
>
> Android también puede avisar de que el APK no proviene de Play Store; es normal en una app distribuida directamente desde GitHub.

### Activar el acceso a notificaciones en Android

La primera vez que abras PocketPod verás **“Activa el acceso”** en la pantalla. Pulsa **Permitir acceso**, busca **PocketPod** en la lista y activa el interruptor. Vuelve a la app: la sesión de Spotify o Apple Music aparecerá automáticamente.

Si el botón no abre los ajustes, ve manualmente a **Ajustes → Notificaciones → Acceso a notificaciones → PocketPod**.

## Actualizaciones

PocketPod comprueba al arrancar si hay una versión nueva publicada en GitHub. Si la hay, muestra un aviso en la pantalla del iPod con dos opciones:

- **Actualizar**: abre la descarga del instalador (Windows) o del APK (Android) en el navegador.
- **Ahora no**: cierra el aviso y no vuelve a aparecer hasta la siguiente versión.

La app nunca se actualiza sola ni descarga nada sin que lo pidas. En Android, después de descargar el APK, ábrelo y acepta la instalación; tus datos (historial y preferencias) se conservan.

## Uso

- **MENU**: alterna entre `Now Playing` y el historial de canciones (`Music`).
- **◀◀ / ▶▶**: canción anterior / siguiente en el reproductor activo.
- **▶ / ❚❚** (abajo): reproducir o pausar.
- **Botón central**: vuelve a `Now Playing` desde el menú.
- **Windows**: arrastra la franja superior para mover la ventana, la esquina inferior derecha para redimensionar, y usa `−` / `×` para minimizar o cerrar.
- **Android**: la app ocupa toda la pantalla. Para salir, usa el gesto de **Inicio** o **Atrás** del sistema (deslizar hacia arriba o hacia el lateral, según tu teléfono).

## Desarrollo

```bash
npm install
npm run tauri dev          # Windows
npm run tauri android dev  # Android (requiere SDK/NDK)
```

Requisitos para compilar en Windows: Node.js 20+, Rust estable y las dependencias de Tauri para Windows.

Para Android necesitas además JDK 17, Android SDK (platform 37 y build-tools 37) y NDK 27, con `JAVA_HOME`, `ANDROID_HOME` y `NDK_HOME` configurados.

## Compilar los instaladores

### Windows

```bash
npm run tauri build
```

Los artefactos se generan en:

```
src-tauri/target/release/bundle/msi/
src-tauri/target/release/bundle/nsis/
```

### Android

```bash
npm run tauri android build -- --apk
```

El APK se genera en:

```
src-tauri/gen/android/app/build/outputs/apk/universal/release/
```

Para una compilación de prueba (firmada con la clave de debug):

```bash
npm run tauri android build -- --apk --debug
```

### Firmar la APK

Todas las versiones deben firmarse con **la misma clave** para que una actualización se pueda instalar encima de la anterior. La clave local vive en:

- `src-tauri/gen/android/pocketpod-release.jks`
- `src-tauri/gen/android/keystore.properties` (contiene la contraseña)

Ambos archivos están ignorados por Git. **Haz una copia de seguridad de los dos**: sin esa clave no podrás publicar actualizaciones que se instalen sobre la app ya existente.

Para que GitHub Actions firme la APK, añade estos secretos en **Settings → Secrets and variables → Actions**:

| Secreto | Valor |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | El `.jks` codificado en base64 |
| `ANDROID_KEYSTORE_PASSWORD` | Contraseña del almacén |
| `ANDROID_KEY_ALIAS` | `pocketpod` |
| `ANDROID_KEY_PASSWORD` | Contraseña de la clave |

Para generar el base64 en PowerShell:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("src-tauri/gen/android/pocketpod-release.jks"))
```

## Publicar una versión en GitHub

El repositorio incluye un workflow de GitHub Actions (`.github/workflows/release.yml`) que compila la app de Windows, genera la APK de Android firmada y crea un borrador de release al empujar un tag:

```bash
git tag -a v0.2.0 -m "PocketPod 0.2.0"
git push origin v0.2.0
```

Cuando termine el workflow, el borrador incluirá el `.exe`, el `.msi` y `PocketPod_<versión>_arm64.apk`. Revísalo en **Releases** y publícalo: hasta que no lo publiques, las versiones anteriores no verán el aviso de actualización.

## Tecnologías

- [Tauri 2](https://tauri.app/) + Rust
- React 19 + TypeScript + Vite
- **Windows**: API GSMTC (`windows` crate)
- **Android**: `MediaSessionManager` + `NotificationListenerService` (plugin Kotlin)

## Licencia

[MIT](LICENSE)
