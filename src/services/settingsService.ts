/**
 * Persistencia de preferencias de UI.
 * En Etapa 5 migrará a almacenamiento nativo gestionado por Rust.
 * Por ahora usa localStorage del WebView.
 */

export type ThemeName = "classic-white" | "classic-black";

export interface UiSettings {
  theme: ThemeName;
  alwaysOnTop: boolean;
}

const DEFAULT_SETTINGS: UiSettings = {
  theme: "classic-white",
  alwaysOnTop: true,
};

const STORAGE_KEY = "pocketpod.settings.v1";

export function loadSettings(): UiSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: UiSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Silencioso: si localStorage falla, seguimos con defaults.
  }
}