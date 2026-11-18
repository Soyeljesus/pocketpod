import { useEffect, useState } from "react";

export const DEFAULT_ACCENT = "hsl(228 92% 80%)";

function toHsl(r: number, g: number, b: number): [number, number, number] {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  const lightness = (max + min) / 2;
  if (delta === 0) return [0, 0, lightness];

  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  const hue =
    max === red
      ? ((green - blue) / delta + 6) % 6
      : max === green
        ? (blue - red) / delta + 2
        : (red - green) / delta + 4;
  return [hue * 60, saturation, lightness];
}

function accentFromImage(image: HTMLImageElement): string | null {
  const size = 20;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;

  context.drawImage(image, 0, 0, size, size);
  const { data } = context.getImageData(0, 0, size, size);

  let best: [number, number, number] | null = null;
  let bestScore = 0;
  for (let index = 0; index < data.length; index += 4) {
    const hsl = toHsl(data[index], data[index + 1], data[index + 2]);
    const score = hsl[1] * (1 - Math.abs(hsl[2] - 0.5));
    if (score > bestScore) {
      best = hsl;
      bestScore = score;
    }
  }
  if (!best || bestScore < 0.12) return null;

  // Tono de la portada con luz fija para que siga legible sobre fondo oscuro.
  const saturation = Math.round(Math.min(0.9, Math.max(0.55, best[1])) * 100);
  return `hsl(${Math.round(best[0])} ${saturation}% 74%)`;
}

/** Color de acento de la portada. Si no se puede leer, usa el color base. */
export function useArtworkAccent(url: string | null): string {
  const [accent, setAccent] = useState(DEFAULT_ACCENT);

  useEffect(() => {
    if (!url) {
      setAccent(DEFAULT_ACCENT);
      return;
    }

    let alive = true;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      if (!alive) return;
      try {
        setAccent(accentFromImage(image) ?? DEFAULT_ACCENT);
      } catch {
        setAccent(DEFAULT_ACCENT);
      }
    };
    image.onerror = () => {
      if (alive) setAccent(DEFAULT_ACCENT);
    };
    image.src = url;

    return () => {
      alive = false;
    };
  }, [url]);

  return accent;
}
