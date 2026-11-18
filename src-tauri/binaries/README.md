# Binarios del extractor (opcional)

Esta carpeta está ignorada por Git salvo este README.

El puente de música implementado usa InnerTube directamente desde Rust y **no
necesita nada aquí**. Solo si algún día quieres añadir un motor alternativo
(por ejemplo `yt-dlp`) coloca el ejecutable en esta carpeta y amplía
`music::MusicEngine`.

Nombre esperado para el sidecar de Tauri (Windows x64):

```
src-tauri/binaries/yt-dlp-x86_64-pc-windows-msvc.exe
```

Nunca subas ejecutables, keystores ni tokens al repositorio.
