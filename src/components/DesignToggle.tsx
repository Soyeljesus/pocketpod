export type AppDesign = "modern" | "ipod";

interface DesignToggleProps {
  design: AppDesign;
  onToggle: () => void;
}

function IpodGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <rect x="5" y="1.75" width="14" height="20.5" rx="3.2" fill="currentColor" />
      <rect x="7.4" y="4.2" width="9.2" height="6.7" rx="1" className="glyph-cut" />
      <circle cx="12" cy="16.4" r="3.9" className="glyph-cut" />
      <circle cx="12" cy="16.4" r="1.35" fill="currentColor" />
    </svg>
  );
}

function ModernGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <rect x="2.5" y="2.5" width="19" height="19" rx="6.5" fill="currentColor" />
      <g className="glyph-bars">
        <rect x="6.7" y="10.2" width="2.3" height="6.3" rx="1.15" />
        <rect x="10.85" y="6.8" width="2.3" height="9.7" rx="1.15" />
        <rect x="15" y="8.8" width="2.3" height="7.7" rx="1.15" />
      </g>
    </svg>
  );
}

/** Muestra siempre el diseño al que se cambiará al pulsarlo. */
export function DesignToggle({ design, onToggle }: DesignToggleProps) {
  const toIpod = design === "modern";
  const label = toIpod ? "Cambiar al diseño iPod" : "Cambiar al diseño moderno";

  return (
    <button
      type="button"
      className={`design-toggle ${toIpod ? "to-ipod" : "to-modern"}`}
      onClick={onToggle}
      aria-label={label}
      title={label}
    >
      <span key={design} className="design-toggle-glyph">
        {toIpod ? <IpodGlyph /> : <ModernGlyph />}
      </span>
    </button>
  );
}
