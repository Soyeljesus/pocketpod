import { IS_ANDROID } from "./mediaBridge";

/** Estos valores identifican el proyecto; no sustituyen a las reglas de acceso. */
export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

export const googleWebClientId = import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID as
  | string
  | undefined;
export const privacyPolicyUrl = import.meta.env.VITE_PRIVACY_POLICY_URL as
  | string
  | undefined;

/** Solo existe en desarrollo y nunca conecta con datos reales. */
export const usesFirebaseEmulator =
  import.meta.env.DEV && import.meta.env.VITE_FIREBASE_EMULATOR === "1";

/**
 * Cliente de Google para apps de escritorio. Google indica que en apps
 * instaladas este "secreto" no es confidencial: viaja dentro de la app y la
 * protección real la da PKCE.
 */
export const googleDesktopClientId = import.meta.env
  .VITE_GOOGLE_DESKTOP_CLIENT_ID as string | undefined;
export const googleDesktopClientSecret = import.meta.env
  .VITE_GOOGLE_DESKTOP_CLIENT_SECRET as string | undefined;

const isConfigured =
  Object.values(firebaseConfig).every(Boolean) && Boolean(googleWebClientId);

const desktopConfigured =
  Boolean(googleDesktopClientId) && Boolean(googleDesktopClientSecret);

export const cloudAvailable =
  isConfigured && (IS_ANDROID || desktopConfigured || usesFirebaseEmulator);

/** Datos del cliente de Google que usa esta plataforma. */
export function googleClient() {
  return IS_ANDROID
    ? { clientId: googleWebClientId ?? "", clientSecret: null }
    : {
        clientId: googleDesktopClientId ?? "",
        clientSecret: googleDesktopClientSecret ?? "",
      };
}
