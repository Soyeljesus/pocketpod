# YouTube Music dentro de PocketPod (puente PocketAll)

Implementación real en este repositorio: PocketPod puede alternar entre controlar
Spotify/Apple Music y **reproducir música de YouTube Music** sin cambiar el diseño
del iPod.

---

## 1. Qué se ha implementado

| Pieza | Archivo | Qué hace |
| --- | --- | --- |
| Motor InnerTube | `src-tauri/src/music/innertube.rs` | Busca en YouTube Music y resuelve el audio con el cliente `VISIONOS` + `visitorData` de la página, con `ANDROID_VR` como respaldo. |
| Puente HTTP | `src-tauri/src/music/server.rs` | Servidor en `127.0.0.1` con `/search` y `/stream/{videoId}`, token, caché y `Range`. |
| Contrato y trait | `src-tauri/src/music/mod.rs` | DTOs `Track`/`BridgeInfo` y `MusicEngine` para poder cambiar de motor. |
| Arranque | `src-tauri/src/lib.rs` | Inicia el puente al arrancar la app y lo publica como estado de Tauri. |
| Comando | `src-tauri/src/commands.rs` | `music_bridge_info` devuelve `baseUrl` + `token`. |
| Modo standalone | `src-tauri/src/bin/pocketall.rs` | Mismo servidor como proceso aparte (sidecar opcional). |
| Cliente | `src/services/youtubeMusic.ts` | Llama al puente y construye la URL del `<audio>`. |
| Reproductor | `src/hooks/useYoutubeMusic.ts` | Cola, play/pausa, siguiente/anterior, seek y estado con forma de `MediaState`. |
| UI | `src/App.tsx`, `src/components/ipod/IpodDisplay.tsx`, `src/styles/ipod.css` | Selector de fuente, buscador y lista de resultados con el estilo del iPod. |
| Android | `src-tauri/gen/android/.../network_security_config.xml` | Permite HTTP claro solo a loopback en release. |

La app **no** necesita yt-dlp, JVM, Python ni un segundo ejecutable.

---

## 2. Decisión de arquitectura: ¿Kotlin o Rust?

Tu propuesta era un servicio Kotlin (`PocketAll`) reutilizando InnerTubeX de
Vivi-Music. Es correcta sobre el papel, pero en este proyecto tiene tres
problemas serios:

1. **Android no puede lanzar sidecars.** El APK no ejecuta procesos externos
   arbitrarios (desde Android 10, `exec` de binarios propios está bloqueado en
   el directorio de datos). El "servicio local" tendría que ser un proceso
   Kotlin del mismo APK, no un sidecar.
2. **Un sidecar JVM pesa y arranca lento.** Un runtime jlink mínimo son ~45–70 MB
   y 300–800 ms de arranque en frío, además de duplicar el ciclo de vida
   (actualizaciones, antivirus, firma y CI de Windows).
3. **InnerTubeX de Vivi no es un extractor de escritorio tal cual.** Su ruta de
   PO Token usa `WebView` de Android y su inicialización depende de un
   `Activity`. En un servicio headless no tienes eso; en el plugin nativo de
   Tauri sí, pero ya no sería "un servicio externo".

Además hay un detalle técnico que cambia el diseño: desde 2025 YouTube dejó de
publicar una URL por formato en casi todo el catálogo. La respuesta del
`player` trae solo `serverAbrStreamingUrl` (**SABR**), sin `url` ni
`signatureCipher`, y con el cliente equivocado responde
*"Inicia sesión para confirmar que no eres un bot"*. Reproducir eso obliga a
hablar el protocolo SABR (protobuf + PO Token) o a ejecutar el reproductor en
un navegador.

La solución que sí funciona hoy y sigue siendo Rust puro:

1. Pedir la página `www.youtube.com/watch?v=<id>` con el User-Agent de visionOS.
2. Sacar de su HTML el `VISITOR_DATA` que YouTube incrusta en `ytcfg`.
3. Llamar al `player` con el cliente **`VISIONOS`**, ese `visitorData` en el
   contexto **y** en la cabecera `X-Goog-Visitor-Id`.

Con esa combinación el `player` vuelve a devolver 4–5 formatos de audio con
`url` directa de googlevideo (verificado con vídeos que con `ANDROID_VR`
daban `LOGIN_REQUIRED`). El `visitorData` se cachea 20 minutos y se renueva si
un stream falla. `ANDROID_VR` queda como respaldo para vídeos antiguos.

> Ojo: el `visitorData` del buscador de `music.youtube.com` **no** sirve para
> esto; tiene que venir de una página de `www.youtube.com`. Esa fue la
> diferencia exacta entre fallar y funcionar en las pruebas.

### Comparativa

| Criterio | Kotlin sidecar | Rust dentro de `src-tauri` |
| --- | --- | --- |
| Windows | Funciona (JVM empaquetada) | Funciona |
| Android | No como sidecar; habría que portarlo a plugin | Funciona igual |
| Tamaño añadido | 45–70 MB | ~0 (axum + reqwest ya compilan dentro) |
| Arranque | Proceso + JVM | Hilo del propio proceso |
| Reutilización de Vivi | Alta (copiar extractor) | Media (mismo protocolo, código nuevo) |
| Licencia | GPL-3.0 contagia a PocketPod (MIT) | Sin código copiado |
| Riesgo de YouTube | Igual | Igual |

**Decisión:** el contrato HTTP que pediste existe (`/search`, `/stream/{id}`),
pero el servicio vive **dentro** del proceso Tauri. El motor es intercambiable:
si `ANDROID_VR` deja de funcionar, se implementa otro `MusicEngine` (Kotlin con
InnerTubeX, yt-dlp, etc.) sin tocar React ni el servidor.

```
┌──────────────────────────── PocketPod (Tauri) ────────────────────────────┐
│  React (iPod UI)                                                          │
│    │ invoke("music_bridge_info") → { baseUrl, token }                     │
│    │ GET /search?q=...&t=...        GET /stream/{id}?t=...                │
│    ▼                                      ▼                               │
│  axum 127.0.0.1:puerto-efímero  ──►  MusicEngine (trait)                  │
│    · token + CORS                        └─ InnerTubeEngine (Rust)        │
│    · caché búsqueda/stream                    ├─ WEB_REMIX  → metadata    │
│    · proxy Range                              ├─ VISIONOS   → audio URL   │
│    · reintento si la URL caducó               │   (+ visitorData página) │
│                                               └─ ANDROID_VR → respaldo    │
└────────────────────────────────────────────────────────┼──────────────────┘
                                                         ▼
                                              googlevideo.com (audio)
```

### Si aun así quieres reutilizar Vivi-Music

El punto de integración está preparado:

1. En Android, añade un `@TauriPlugin` nuevo (igual que `MediaSessionPlugin`)
   con `search` y `resolveStream`. Los plugins de Tauri reciben la `Activity`,
   que es justo lo que necesita el PO Token/WebView de InnerTubeX.
2. Copia de Vivi `InnerTubeXPlayer`, `utils/cipher/*`, `utils/potoken/*` y su
   módulo `innertube` (o usa el artefacto `innertubex`).
3. Implementa en Rust un `AndroidEngine: MusicEngine` que llame a
   `handle.run_mobile_plugin("search" | "resolveStream", ...)`.
4. En `start_music_bridge`, elige `AndroidEngine` en Android y
   `InnerTubeEngine` en escritorio.

> **Licencia:** Vivi-Music e InnerTubeX son GPL-3.0 y PocketPod es MIT. Si copias
> su código, el binario derivado debe distribuirse bajo GPL-3.0 y con el código
> fuente. La implementación Rust de este repo no copia código de Vivi.

---

## 3. Contrato HTTP

Todos los endpoints escuchan solo en `127.0.0.1`. El token se pasa en `t=` o en
la cabecera `x-pocketall-token`.

```http
GET /health
→ {"ok":true,"engine":"innertube-rust","available":true}

GET /search?q=daft%20punk&limit=20&t=<token>
→ [
    {
      "videoId":"80ZRFkG37pU",
      "title":"Daft Punk - Instant Crush",
      "artist":"Daft Punk",
      "album":"Random Access Memories",
      "durationSec":337,
      "thumbnailUrl":"https://i.ytimg.com/vi/80ZRFkG37pU/hqdefault.jpg"
    }
  ]

GET /stream/80ZRFkG37pU?t=<token>
Range: bytes=0-1023
→ 206 Partial Content
   Content-Type: audio/webm
   Content-Range: bytes 0-1023/3433755

POST /download/80ZRFkG37pU?t=<token>
Content-Type: application/json
{ "videoId":"80ZRFkG37pU", "title":"...", "artist":"...", "album":"...",
  "durationSec":337, "thumbnailUrl":"https://..." }
→ {
    "videoId":"80ZRFkG37pU",
    "fileName":"80ZRFkG37pU.webm",
    "mimeType":"audio/webm",
    "sizeBytes":3433755,
    "downloadedAt":1794888887,
    ... (title/artist/album/durationSec/thumbnailUrl)
  }

GET /offline?t=<token>            → lista de descargas, más recientes primero
GET /offline/80ZRFkG37pU?t=<token>   (acepta Range, no toca la red)
DELETE /offline/80ZRFkG37pU?t=<token> → {"ok":true}, borra archivo e índice
```

Notas:

- `limit` se recorta a `1..=30`.
- Búsquedas cacheadas 10 minutos; streams hasta que caduque la URL (máx. 10 min).
- Si el CDN devuelve 403/410, el servidor invalida la caché y reintenta una vez.
- El `Range` se reenvía tal cual al CDN: el seek del `<audio>` funciona.
- `/download` es idempotente (si ya existe, devuelve la entrada) y responde
  `409` si esa canción ya se está descargando.
- `/offline` y `/download` responden `503` en modo standalone (sin carpeta de
  datos): la app sigue funcionando sin descargas.
- El archivo se escribe como `<videoId>.part` y se renombra al terminar, así una
  descarga cortada nunca se indexa como válida (`Content-Range` se compara con
  los bytes escritos).

### Por qué la descarga pide `Range: bytes=0-`

googlevideo limita a ~35–45 KB/s las peticiones **sin** rango (su modo
"adaptive"). Con `Range: bytes=0-` responde `206` y entrega a velocidad normal.
Medido en el móvil con el mismo archivo:

| Petición | Velocidad |
| --- | --- |
| Sin `Range` | ~44 KB/s (4,1 MB en 94 s) |
| Con `Range: bytes=0-` | ~2,4 MB/s (3,5 MB en 1,4 s) |

Por eso `perform_download` siempre añade ese `Range` y `/offline/{id}` sirve los
rangos con `seek` + `read_exact` en vez de cargar la canción entera en memoria.

---

## 4. Cómo reproduce el frontend

No se usa ningún plugin de audio de Tauri: un `<audio>` de HTML es suficiente y
funciona igual en WebView2 (Windows) y en Android WebView.

```ts
// src/services/youtubeMusic.ts
const info = await getBridgeInfo();
const src = `${info.baseUrl}/stream/${videoId}?t=${encodeURIComponent(info.token)}`;

// src/hooks/useYoutubeMusic.ts
const audio = new Audio();
audio.preload = "auto";
audio.src = src;
await audio.play();
```

Por qué el proxy y no la URL de googlevideo directamente:

- Evita CORS y el problema de cabeceras que un `<audio>` no puede enviar.
- Añade el token sin exponer la lógica de extracción.
- Renueva URLs caducadas de forma transparente.
- Mantiene el `Range` y el 206 para que la barra de progreso y el seek funcionen.

La UI reutiliza `MediaState`, así que `IpodDisplay` no necesita saber si el audio
viene de Spotify o de YouTube: solo cambia el badge `SP`/`YT` y los textos.

### Cambiar de fuente

- Menú del iPod → **Fuente: Spotify / Apple Music** → pulsa para cambiar.
- O **YouTube Music → Buscar**.
- Al pasar a YouTube se pausa Spotify/Apple Music si estaba sonando.
- Al volver al sistema se pausa el `<audio>` de YouTube.
- La preferencia se guarda en `localStorage` (`pocketpod.audio.source`).

### Me gusta y descargas

- **Me gusta** es local: no se envía nada a YouTube ni hace falta cuenta. Se
  guarda en `localStorage` (`pocketpod.youtube.likes`) y el corazón aparece en
  cada fila (búsqueda, Me gusta y Descargadas) y en Now Playing.
- **Descargar** llama a `POST /download/{id}`: Rust baja el audio completo a
  `app_data_dir/offline/<videoId>.<ext>` y lo anota en `index.json`. El
  `localStorage` no se usa para esto porque el WebView no puede escribir
  archivos y perdería la lista al limpiar datos.
- Al reproducir, si la canción está en Descargadas se usa `/offline/{id}`; si no,
  `/stream/{id}`. El `<audio>` no cambia: mismo `Range`, mismo seek.
- Borrar (`✕`) llama a `DELETE /offline/{id}` y elimina archivo + entrada.

En el móvil la carpeta real es `/data/user/0/com.pocketpod.app/offline`
(`app_data_dir`). Para inspeccionarla con la app en depuración:

```powershell
adb shell run-as com.pocketpod.app ls -l /data/user/0/com.pocketpod.app/offline
adb shell run-as com.pocketpod.app cat /data/user/0/com.pocketpod.app/offline/index.json
```

---

## 5. Android: lo que hay que saber

- El motor Rust funciona en Android; el código es el mismo.
- En release el manifiesto pone `usesCleartextTraffic=false`. Se añadió
  `network_security_config.xml` para permitir HTTP claro **solo** a
  `127.0.0.1`/`localhost`.
- Limitación actual: el audio vive en el WebView. Si la app pasa a segundo plano,
  Android puede pausar el WebView. Para reproducción en background con
  notificación y controles del sistema hay que mover la reproducción a
  **Media3/ExoPlayer + foreground service** en Kotlin y exponer
  `play/pause/seek` como comandos del plugin. El contrato HTTP ya está listo para
  ese cambio: Media3 puede usar la misma URL `/stream/{id}`.
- Los controles de la rueda ya funcionan con `MediaState`; solo habría que
  conectar el estado real de Media3 al `MediaState` que pinta la UI.

### 5.1 Probar en un móvil por USB

`npm run tauri android dev` necesita un dispositivo **detectado por `adb`**. Si
no lo encuentra, abre Android Studio en vez de instalar. Comprobaciones:

```powershell
adb devices                 # debe aparecer el serial (p. ej. ZY22KGJ75K) como "device"
adb reverse tcp:1420 tcp:1420   # Vite (dev server)
adb reverse tcp:1421 tcp:1421   # HMR de Vite
```

El proyecto Gradle **no compila Rust por su cuenta**: la tarea
`rustBuild*Debug` ejecuta `tauri android android-studio-script`, que se conecta
por TCP al proceso de `tauri android dev` (la dirección está en
`src-tauri/gen/android/.tauri/cli-options-server.json`). Por eso, si lanzas
Gradle a mano mientras la CLI está cerrada, falla con
`failed to connect to the Tauri CLI`. Deja la CLI corriendo.

Si el APK no instala con `INSTALL_FAILED_UPDATE_INCOMPATIBLE`, es que en el
móvil hay una versión firmada con otra clave (release vs debug). Desinstala la
anterior y repite:

```powershell
adb uninstall com.pocketpod.app
```

Para inspeccionar la WebView desde el PC en un build debug:

```powershell
adb forward tcp:9333 localabstract:webview_devtools_remote_$(adb shell pidof com.pocketpod.app)
# http://127.0.0.1:9333/json/list → webSocketDebuggerUrl
```

Fíjate en el **PID actual**: cada recompilación reinstala y reinicia la app, así
que el `adb forward` anterior deja de funcionar. Repítelo tras cada rebuild.

### 5.2 Probar las descargas sin conexión

1. Con red, busca una canción, pulsa `↓` (o **Descargar** en Now Playing) y
   espera a que el icono pase a `✕`.
2. Activa el modo avión desde el móvil, o desde el PC:

   ```powershell
   adb shell cmd connectivity airplane-mode enable
   ```

3. Menú → **Descargadas** → pulsa una canción. Debe sonar igual (la barra
   avanza) y Now Playing muestra `✓ Offline`. El `adb` por USB sigue funcionando
   en modo avión, así que puedes seguir inspeccionando la WebView.
4. Vuelve a activar la red:

   ```powershell
   adb shell cmd connectivity airplane-mode disable
   ```

`navigator.onLine` no es fiable en Android WebView (puede decir `true` sin
red); para comprobar de verdad que no hay conexión usa
`adb shell ping -c 1 8.8.8.8` → `Network is unreachable`.

---

## 6. Sidecar opcional (si insistes en proceso aparte)

El servidor ya existe como binario independiente:

```powershell
cd src-tauri
cargo run --bin pocketall -- 8787
# imprime: {"baseUrl":"http://127.0.0.1:8787","token":"...","engine":"innertube-rust","available":true}
```

Para empaquetarlo como sidecar de Tauri:

1. Compila el binario para el target de cada plataforma:

   ```powershell
   cargo build --release --bin pocketall --target x86_64-pc-windows-msvc
   Copy-Item target\x86_64-pc-windows-msvc\release\pocketall.exe `
     binaries\pocketall-x86_64-pc-windows-msvc.exe
   ```

2. Añade `externalBin` en `src-tauri/tauri.conf.json`:

   ```json
   "bundle": {
     "externalBin": ["binaries/pocketall"]
   }
   ```

   El nombre del archivo debe incluir el target triple. En macOS/Linux usa el
   sufijo correspondiente (`aarch64-apple-darwin`, `x86_64-unknown-linux-gnu`…).

3. Lánzalo con `tauri-plugin-shell` y lee el JSON de la primera línea:

   ```rust
   use tauri_plugin_shell::ShellExt;

   let sidecar = app.shell().sidecar("pocketall")?.args(["0"]);
   let (mut rx, _child) = sidecar.spawn()?;
   // leer rx hasta la primera línea JSON y guardar baseUrl/token en el estado
   ```

   Permisos necesarios en `capabilities/default.json`:

   ```json
   {
     "identifier": "shell:allow-execute",
     "allow": [{ "name": "binaries/pocketall", "sidecar": true }]
   }
   ```

**Por qué no es el modo por defecto:** un proceso más que empaquetar y firmar en
Windows, imposible de replicar en Android, y sin ventajas frente a un hilo
interno que ya está aislado por token y escucha solo en loopback.

---

## 7. Puesta en marcha

Escritorio:

```powershell
cd D:\PocketAll\pocketpod
npm install
npm run tauri dev
```

Android (móvil con depuración USB):

```powershell
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:NDK_HOME = "$env:ANDROID_HOME\ndk\27.0.12077973"
npm run tauri android dev
```

> `src-tauri/Cargo.toml` fija `default-run = "pocketpod"`. Sin esa clave,
> `cargo run` falla porque hay dos binarios (`pocketpod` y `pocketall`) y no
> sabe cuál arrancar.

Pruebas:

```powershell
# TypeScript + bundle
npm run build

# Backend
cd src-tauri
cargo check --lib --bins
cargo test --lib

# Contrato HTTP sin abrir la app
cargo run --bin pocketall -- 8787
# en otra terminal, usa el token que imprime el proceso:
curl "http://127.0.0.1:8787/health"
curl "http://127.0.0.1:8787/search?q=daft+punk&limit=5&t=<token>"
curl -H "Range: bytes=0-1023" "http://127.0.0.1:8787/stream/<videoId>?t=<token>"
```

### Verificación ejecutada (2026-11-16)

| Prueba | Resultado |
| --- | --- |
| `cargo test --lib` | 11 tests OK |
| `cargo check --lib --bins` | OK |
| `npm run build` | 37 módulos, bundle 267 kB |
| `/health` | `{"ok":true,"engine":"innertube-rust","available":true}` |
| `/search` sin token | `401` |
| `/search?q=daft punk instant crush` | `200`, 3 pistas con `videoId`, artista y duración |
| `/stream/<id>` con `Range: bytes=0-1023` | `206` `audio/mp4`/`audio/webm` + `Content-Range` |
| `/stream/<id>` con `Range: bytes=3000000-3000511` | `206`, seek a mitad de pista |
| Descarga completa de una pista | 5.818.745 bytes, cabecera MP4/DASH válida |
| `POST /download/<id>` en el móvil | 3.492.523 bytes en 1,4 s (~2,4 MB/s) |
| `GET /offline` tras reiniciar la app | lista persistida desde `index.json` |
| `GET /offline/<id>` con `Range: bytes=0-2047` | `206`, `Content-Range`, `Accept-Ranges: bytes` |
| `DELETE /offline/<id>` | archivo e índice borrados (4 → 3) |
| Reproducir descargada en **modo avión** | avanza 00:15 → 00:20, acciones "✓ Offline" |
| `videoId` inválido (`..%2Fetc`) | `400` |

Se probaron vídeos que antes devolvían "confirma que no eres un bot"
(`fJ9rUzIMcZQ`, `80ZRFkG37pU`, `5GRRsZip6-o`, `ktvTqknDobU`): todos sirven audio.

---

## 8. Git: rama, commits y push

El repo ya tiene `origin` (`https://github.com/Soyeljesus/pocketpod.git`) y la
rama `main`. Flujo recomendado:

```powershell
cd D:\PocketAll\pocketpod

# 1. Rama de trabajo
git checkout main
git pull --ff-only
git checkout -b feat/youtube-music-bridge

# 2. Revisa qué entra y qué no
git status
git diff --stat

# 3. Commit 1: backend
git add src-tauri/Cargo.toml src-tauri/Cargo.lock `
        src-tauri/src/music src-tauri/src/bin `
        src-tauri/src/lib.rs src-tauri/src/commands.rs
git commit -m "feat(music): puente local InnerTube con /search y /stream"

# 4. Commit 2: frontend y UI
git add src/App.tsx src/components/ipod/IpodDisplay.tsx `
        src/hooks/useYoutubeMusic.ts src/services/youtubeMusic.ts `
        src/types/youtube.ts src/styles/ipod.css
git commit -m "feat(ui): selector de fuente y búsqueda de YouTube Music"

# 5. Commit 3: Android, ignore y documentación
git add .gitignore src-tauri/binaries/README.md `
        src-tauri/gen/android/app/src/main/AndroidManifest.xml `
        src-tauri/gen/android/app/src/main/res/xml/network_security_config.xml `
        docs/youtube-music.md
git commit -m "chore(android): permitir loopback y documentar la integración"

# 6. Verifica que no se cuela nada sensible
git status --ignored
git ls-files | Select-String -Pattern "\.jks$|keystore|\.exe$|\.env$"

# 7. Sube y abre PR
git push -u origin feat/youtube-music-bridge
gh pr create --title "feat: YouTube Music en PocketPod" `
  --body "Puente local InnerTube, selector de fuente y búsqueda en la UI del iPod."
```

Si no tienes `gh`, usa el enlace que imprime GitHub tras el `push`.

Buenas prácticas:

- Commits pequeños y en imperativo; prefijos `feat`, `fix`, `chore`, `docs`.
- No mezcles `Cargo.lock` con cambios de UI en el mismo commit.
- Nunca subas `*.jks`, `keystore.properties`, `keystore-base64.txt`, binarios ni
  tokens. Ya están en `.gitignore`.
- Si tocas el puerto o el contrato, actualiza `docs/youtube-music.md` en el mismo
  commit.

---

## 9. Rendimiento

Lo ya aplicado:

- **Caché de búsqueda** (10 min, 64 entradas) y **de stream** (hasta la caducidad
  de la URL, 128 entradas) para no repetir InnerTube en cada pulsación.
- **`visitorData` cacheado 20 min**: evita descargar (~1,5 MB) la página del
  vídeo en cada canción.
- **Todo asíncrono**: reqwest + axum + tokio; la UI nunca bloquea el hilo.
- **Range/206**: el `<audio>` pide solo lo que necesita. Medido en local:
  1 MB en 0,5 s, y seek instantáneo.
- **Reintento único** cuando el CDN invalida una URL.
- **Interpolación a 250 ms** en React para que la barra no dependa de
  `timeupdate` (que va a ~4 Hz).
- **Miniaturas con `loading="lazy"`** y tamaño `hqdefault` (~100 KB), no la
  original.
- **`preload="auto"`** en el `<audio>`.
- **`connect_timeout` 6 s + `read_timeout` 30 s** en el proxy. Nunca un
  `timeout` total: cortaba las canciones largas a mitad de descarga.
- **Descargas con `Range: bytes=0-`**: evita el límite de ~40 KB/s que aplica
  googlevideo a las peticiones sin rango (44 KB/s → 2,4 MB/s medidos).
- **`/offline/{id}` lee solo el rango pedido** (`seek` + `read_exact`), sin
  cargar la canción entera en memoria por cada petición del `<audio>`.

Ideas siguientes (cuando haga falta):

1. **Prefetch de la siguiente pista**: al empezar a sonar una canción, resolver
   `/stream/{next}` en segundo plano para que el cambio sea instantáneo.
2. **Debounce de 250–300 ms** en el buscador si pasas de buscar al pulsar “Ir” a
   buscar mientras se escribe.
3. **Caché en disco** de miniaturas (el WebView ya cachea HTTP; añade
   `Cache-Control` si sirves las portadas desde el puente).
4. **Persistir la cola** en `localStorage` para recuperarla al abrir la app.
5. **Media3 en Android** para background real; el proxy no cambia.
6. **Métricas**: `/health` ya existe; añade contadores de aciertos/fallos de caché
   si necesitas depurar.

---

## 10. Límites y avisos

- YouTube cambia clientes y formatos a menudo. El motor tiene dos capas
  (`VISIONOS` + `ANDROID_VR`) detrás de `MusicEngine`; si ambas fallan, se
  sustituye el motor sin tocar React.
- **Descargas**: se guarda solo el audio que sirve el CDN para ese cliente
  (`webm`/opus, ~3–6 MB por canción) en la carpeta privada de la app. No hay
  límite propio ni gestión de espacio: si el móvil se queda sin disco, la
  descarga falla y se informa en la UI. La música descargada desaparece si
  desinstalas la app (`adb uninstall` borra sus datos).
- **Me gusta** vive en `localStorage` del WebView, no en el puente: si borras
  los datos de la app se pierden los "me gusta", pero no las descargas.
- Si un vídeo concreto devuelve "confirma que no eres un bot" incluso con
  `VISIONOS`, la caché de `visitorData` se invalida y se reintenta una vez. Si
  persiste, suele ser límite de IP (VPN/datacenter) o vídeo restringido.
- El uso de streams de YouTube está sujeto a sus Términos de Servicio. No
  distribuyas contenido descargado ni credenciales.
- El token del puente es local y aleatorio, pero cualquiera con acceso al puerto
  de tu equipo podría usarlo mientras la app esté abierta. Es loopback, no una
  API pública.
