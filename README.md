# PocketPod

Un reproductor de escritorio con forma de **iPod clásico** que controla **Spotify** y **Apple Music** en Windows.

PocketPod se conecta a la sesión del reproductor a través de los controles multimedia de Windows (GSMTC), así que no necesita la API web ni iniciar sesión: si Spotify o Apple Music están reproduciendo, el iPod lo muestra y lo controla.

![Plataforma](https://img.shields.io/badge/plataforma-Windows%2010%2F11-0ea5e9)

## Características

- Pantalla **Now Playing** con portada, título, artista y álbum.
- Barra de progreso con tiempo transcurrido y restante, actualizada en tiempo real.
- Rueda click funcional: **MENU**, anterior, siguiente y play/pausa.
- **Historial de canciones** escuchadas (se guarda localmente).
- Ventana sin bordes con carcasa de iPod, botones de minimizar/cerrar y redimensionado proporcional.
- Tamaño ajustable entre 280×500 y 380×680.

## Requisitos

- Windows 10 u 11 de 64 bits.
- La **app de escritorio de Spotify** o **Apple Music** abierta (las versiones web no exponen los controles multimedia).
- WebView2. El instalador lo incluye; en Windows 11 ya viene preinstalado.

## Descargar e instalar

1. Entra en la página de [Releases](../../releases) del repositorio.
2. Descarga el instalador de Windows:
   - `PocketPod_<versión>_x64-setup.exe` (recomendado), o
   - `PocketPod_<versión>_x64_en-US.msi`.
3. Ejecútalo y sigue el asistente.

> Windows puede mostrar el aviso de SmartScreen porque la app no está firmada digitalmente. Pulsa **Más información → Ejecutar de todas formas**. Si publicas tu propia versión, puedes firmar los binarios para evitar ese aviso.

## Uso

- **MENU**: alterna entre `Now Playing` y el historial de canciones (`Music`).
- **◀◀ / ▶▶**: canción anterior / siguiente en el reproductor activo.
- **▶ / ❚❚** (abajo): reproducir o pausar.
- **Botón central**: vuelve a `Now Playing` desde el menú.
- Arrastra la **franja superior** de la carcasa para mover la ventana.
- Arrastra la **esquina inferior derecha** para cambiar el tamaño del iPod.
- `−` minimiza y `×` cierra.

## Desarrollo

```bash
npm install
npm run tauri dev
```

Requisitos para compilar: Node.js 20+, Rust estable y las dependencias de Tauri para Windows.

## Compilar el instalador

```bash
npm run tauri build
```

Los artefactos se generan en:

```
src-tauri/target/release/bundle/msi/
src-tauri/target/release/bundle/nsis/
```

## Publicar una versión en GitHub

El repositorio incluye un workflow de GitHub Actions (`.github/workflows/release.yml`) que compila la app y crea un borrador de release al empujar un tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

Cuando termine el workflow, revisa el borrador en **Releases** y publícalo.

## Tecnologías

- [Tauri 2](https://tauri.app/) + Rust
- React 19 + TypeScript + Vite
- API GSMTC de Windows (`windows` crate)

## Licencia

[MIT](LICENSE)
