import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { IS_ANDROID } from "./mediaBridge";

/**
 * Comprobación de actualizaciones contra las releases públicas de GitHub.
 *
 * No descarga ni instala nada por su cuenta: si hay una versión nueva, la app
 * avisa y, solo si el usuario acepta, abre la descarga en el navegador.
 */
const REPO = "Soyeljesus/pocketpod";
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;
const DISMISSED_KEY = "pocketpod.dismissedUpdate";

export interface AvailableUpdate {
  /** Versión publicada, sin la "v" inicial (ej. "0.2.0"). */
  version: string;
  /** Enlace directo al instalador/APK si existe; si no, a la release. */
  downloadUrl: string;
  /** Página de la release en GitHub. */
  releaseUrl: string;
}

function parseVersion(value: string): number[] {
  return value
    .trim()
    .replace(/^v/i, "")
    .split("-")[0]
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
}

/** Compara versiones tipo 0.10.2 > 0.9.9 devolviendo true si `latest` es mayor. */
export function isNewerVersion(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  const length = Math.max(a.length, b.length);

  for (let i = 0; i < length; i += 1) {
    const next = a[i] ?? 0;
    const actual = b[i] ?? 0;
    if (next !== actual) return next > actual;
  }

  return false;
}

export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  const current = await getVersion();

  const response = await fetch(
    `https://api.github.com/repos/${REPO}/releases/latest`,
    {
      headers: { Accept: "application/vnd.github+json" },
      cache: "no-store",
    },
  );

  if (!response.ok) return null;

  const data = await response.json();
  if (!data || data.draft || data.prerelease) return null;

  const tag = String(data.tag_name ?? "");
  if (!tag || !isNewerVersion(tag, current)) return null;

  const version = tag.replace(/^v/i, "");

  // Si el usuario ya dijo "ahora no" para esta versión, no volver a insistir.
  try {
    if (localStorage.getItem(DISMISSED_KEY) === version) return null;
  } catch {
    // localStorage no disponible: se muestra el aviso igualmente.
  }

  const assets: Array<{ name?: string; browser_download_url?: string }> =
    Array.isArray(data.assets) ? data.assets : [];

  const androidAsset = assets.find((asset) => /\.apk$/i.test(asset.name ?? ""));
  const windowsAsset =
    assets.find((asset) => /setup\.exe$/i.test(asset.name ?? "")) ??
    assets.find((asset) => /\.msi$/i.test(asset.name ?? ""));

  const asset = IS_ANDROID ? androidAsset : windowsAsset;
  const releaseUrl = String(data.html_url ?? RELEASES_PAGE);

  return {
    version,
    downloadUrl: asset?.browser_download_url ?? releaseUrl,
    releaseUrl,
  };
}

/** Recuerda que el usuario rechazó esta versión. */
export function rememberDismissed(version: string) {
  try {
    localStorage.setItem(DISMISSED_KEY, version);
  } catch {
    // Sin localStorage el aviso reaparecerá en el próximo arranque.
  }
}

export async function openUpdatePage(url: string) {
  await openUrl(url);
}
