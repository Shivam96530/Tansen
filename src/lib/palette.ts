export interface Palette {
  primary: string;
  secondary: string;
}

const DEFAULT_PALETTES: Palette[] = [
  { primary: "rgba(240, 168, 50, 0.28)", secondary: "rgba(155, 140, 255, 0.22)" },
  { primary: "rgba(95, 217, 164, 0.28)", secondary: "rgba(240, 168, 50, 0.22)" },
  { primary: "rgba(155, 140, 255, 0.28)", secondary: "rgba(255, 107, 139, 0.22)" },
  { primary: "rgba(255, 107, 139, 0.28)", secondary: "rgba(240, 168, 50, 0.22)" },
];

const paletteCache = new Map<string, Palette>();

/**
 * Extract an ambient 2-color bloom palette from track thumbnail or title hash.
 */
export async function extractPalette(imageUrl: string | null, seed = ""): Promise<Palette> {
  if (!imageUrl) {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) hash = (hash << 5) - hash + seed.charCodeAt(i);
    const index = Math.abs(hash) % DEFAULT_PALETTES.length;
    return DEFAULT_PALETTES[index];
  }

  if (paletteCache.has(imageUrl)) {
    return paletteCache.get(imageUrl)!;
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "Anonymous";
    img.src = imageUrl;

    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 16;
        canvas.height = 16;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(DEFAULT_PALETTES[0]);

        ctx.drawImage(img, 0, 0, 16, 16);
        const data = ctx.getImageData(0, 0, 16, 16).data;

        let r1 = 0, g1 = 0, b1 = 0, c1 = 0;
        let r2 = 0, g2 = 0, b2 = 0, c2 = 0;

        for (let i = 0; i < data.length; i += 16) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          // Skip very dark or very light pixels
          const brightness = (r * 299 + g * 587 + b * 114) / 1000;
          if (brightness < 30 || brightness > 235) continue;

          if (i < data.length / 2) {
            r1 += r; g1 += g; b1 += b; c1++;
          } else {
            r2 += r; g2 += g; b2 += b; c2++;
          }
        }

        if (c1 > 0 && c2 > 0) {
          const primary = `rgba(${Math.round(r1 / c1)}, ${Math.round(g1 / c1)}, ${Math.round(b1 / c1)}, 0.35)`;
          const secondary = `rgba(${Math.round(r2 / c2)}, ${Math.round(g2 / c2)}, ${Math.round(b2 / c2)}, 0.28)`;
          const result = { primary, secondary };
          paletteCache.set(imageUrl, result);
          resolve(result);
        } else {
          paletteCache.set(imageUrl, DEFAULT_PALETTES[0]);
          resolve(DEFAULT_PALETTES[0]);
        }
      } catch {
        resolve(DEFAULT_PALETTES[0]);
      }
    };

    img.onerror = () => {
      paletteCache.set(imageUrl, DEFAULT_PALETTES[0]);
      resolve(DEFAULT_PALETTES[0]);
    };
  });
}
