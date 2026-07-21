import { describe, expect, it } from 'vitest';
import {
  loadSvgFromFile,
  sanitizeSvgMarkup,
  validateRasterImageFile,
} from '../src/editor/services/assetLoader';

const pngSignature = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x00,
]);

describe('asset import security', () => {
  it('checks raster signatures instead of trusting the browser MIME type', async () => {
    const png = new File([pngSignature], 'art.png', { type: 'image/png' });
    await expect(validateRasterImageFile(png)).resolves.toBe('png');

    const spoofed = new File([pngSignature], 'art.jpg', { type: 'image/jpeg' });
    await expect(validateRasterImageFile(spoofed)).rejects.toThrow(/do not match/i);

    const invalid = new File(['not an image'], 'art.png', { type: 'image/png' });
    await expect(validateRasterImageFile(invalid)).rejects.toThrow(/valid PNG, JPEG, and WebP/i);
  });

  it('removes executable SVG features and external references', () => {
    const sanitized = sanitizeSvgMarkup(`
      <svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" onload="alert(1)">
        <script>alert(1)</script>
        <foreignObject><div xmlns="http://www.w3.org/1999/xhtml">unsafe</div></foreignObject>
        <image href="https://tracking.example/private.png" />
        <a xlink:href="javascript:alert(1)"><rect width="10" height="10" /></a>
        <rect width="10" height="10" style="fill:url(https://tracking.example/fill.svg)" />
      </svg>
    `);

    expect(sanitized).not.toMatch(/<script|foreignObject|onload|tracking\.example|javascript:|style=/i);
    expect(sanitized).toContain('<rect');
  });

  it('sanitizes SVG files before returning their markup', async () => {
    const file = new File([
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><circle r="5" /></svg>',
    ], 'safe-name.SVG', { type: 'image/svg+xml' });

    const result = await loadSvgFromFile(file);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.asset).toContain('<circle');
      expect(result.asset).not.toContain('<script');
    }
  });
});
