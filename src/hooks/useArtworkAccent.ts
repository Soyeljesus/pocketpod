import { useEffect, useState } from "react";

export interface ArtworkPalette {
  /** Color claro para botones y elementos activos. */
  accent: string;
  /** Color intenso para el reproductor y el minirreproductor. */
  tint: string;
  /** Color oscuro con el que termina el fondo del reproductor. */
  deep: string;
}

function hslToHex(hue: number, saturation: number, lightness: number): string {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const sector = hue / 60;
  const second = chroma * (1 - Math.abs((sector % 2) - 1));
  const [red, green, blue] =
    sector < 1
      ? [chroma, second, 0]
      : sector < 2
        ? [second, chroma, 0]
        : sector < 3
          ? [0, chroma, second]
          : sector < 4
            ? [0, second, chroma]
            : sector < 5
              ? [second, 0, chroma]
              : [chroma, 0, second];
  const match = lightness - chroma / 2;
  return `#${[red, green, blue]
    .map((value) =>
      Math.round((value + match) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

function paletteFrom(hue: number, saturation: number): ArtworkPalette {
  return {
    accent: hslToHex(hue, clamp(saturation, 0.55, 0.9), 0.82),
    tint: hslToHex(hue, clamp(saturation, 0.38, 0.62), 0.3),
    deep: hslToHex(hue, clamp(saturation, 0.28, 0.5), 0.115),
  };
}

export const DEFAULT_PALETTE = paletteFrom(224, 0.62);

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

function paletteFromImage(image: HTMLImageElement): ArtworkPalette | null {
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
  return paletteFrom(best[0], best[1]);
}

/** Colores de la portada. Si no se pueden leer, usa los colores de FoYu. */
export function useArtworkPalette(url: string | null): ArtworkPalette {
  const [palette, setPalette] = useState(DEFAULT_PALETTE);

  useEffect(() => {
    if (!url) {
      setPalette(DEFAULT_PALETTE);
      return;
    }

    let alive = true;
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => {
      if (!alive) return;
      try {
        setPalette(paletteFromImage(image) ?? DEFAULT_PALETTE);
      } catch {
        setPalette(DEFAULT_PALETTE);
      }
    };
    image.onerror = () => {
      if (alive) setPalette(DEFAULT_PALETTE);
    };
    image.src = url;

    return () => {
      alive = false;
    };
  }, [url]);

  return palette;
}
