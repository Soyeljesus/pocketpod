interface ConnectionStatusProps {
  connected: boolean;
}

/**
 * Pequeño indicador visual de conexión. Verde = sesión activa,
 * rojo = sin Spotify detectado.
 */
export function ConnectionStatus({ connected }: ConnectionStatusProps) {
  return (
    <span
      className={`connection-dot ${connected ? "on" : "off"}`}
      title={connected ? "Conectado a Spotify" : "Sin conexión"}
      aria-label={connected ? "Conectado" : "Sin conexión"}
    />
  );
}