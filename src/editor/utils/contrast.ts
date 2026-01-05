const hexToRgb = (hex: string) => {
  const normalized = hex.replace('#', '').trim();
  if (normalized.length === 3) {
    const r = parseInt(normalized[0] + normalized[0], 16);
    const g = parseInt(normalized[1] + normalized[1], 16);
    const b = parseInt(normalized[2] + normalized[2], 16);
    return { r, g, b };
  }
  if (normalized.length === 6) {
    const r = parseInt(normalized.slice(0, 2), 16);
    const g = parseInt(normalized.slice(2, 4), 16);
    const b = parseInt(normalized.slice(4, 6), 16);
    return { r, g, b };
  }
  return null;
};

const parseRgb = (color: string) => {
  const match = color.match(/rgba?\(([^)]+)\)/i);
  if (!match) return null;
  const parts = match[1].split(',').map((part) => parseFloat(part.trim()));
  if (parts.length < 3) return null;
  return {
    r: parts[0],
    g: parts[1],
    b: parts[2],
  };
};

const getRelativeLuminance = (r: number, g: number, b: number) => {
  const toLinear = (value: number) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  const red = toLinear(r);
  const green = toLinear(g);
  const blue = toLinear(b);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};

export const getContrastRatio = (colorA: string, colorB: string) => {
  const rgbA = colorA.startsWith('rgb') ? parseRgb(colorA) : hexToRgb(colorA);
  const rgbB = colorB.startsWith('rgb') ? parseRgb(colorB) : hexToRgb(colorB);

  if (!rgbA || !rgbB) return null;

  const luminanceA = getRelativeLuminance(rgbA.r, rgbA.g, rgbA.b);
  const luminanceB = getRelativeLuminance(rgbB.r, rgbB.g, rgbB.b);
  const lighter = Math.max(luminanceA, luminanceB);
  const darker = Math.min(luminanceA, luminanceB);

  return (lighter + 0.05) / (darker + 0.05);
};
