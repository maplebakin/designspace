import { PDFDocument, rgb, type PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {
  documentExportService,
  prepareDocumentExportClone,
  type DocumentExportPageSource,
} from './documentExportService';
import {
  loadPublishingFontBytes,
  publishingFontFile,
  publishingFontFromCss,
} from '../typography/publishingFonts';

const POINTS_PER_CSS_PIXEL = 72 / 96;

export const publishingPdfColor = (red: number, green: number, blue: number, grayscale: boolean) => {
  const gray = (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255;
  return grayscale ? rgb(gray, gray, gray) : rgb(red / 255, green / 255, blue / 255);
};

export const assertPublishingText = (text: string) => {
  if (text.normalize('NFC') !== text) {
    throw new Error('This text contains combining characters. Use composed characters or Print / Save PDF to preserve them.');
  }
};

/**
 * The committed DOM supplies glyph positions; PDF text uses the same bundled
 * static font faces. Only artwork/page furniture is rasterized. Unsupported
 * typography fails explicitly rather than silently replacing a font or page.
 */
export const exportPublishingPdf = async (
  sources: readonly DocumentExportPageSource[],
  grayscale = false,
) => {
  if (sources.length === 0) throw new Error('There are no document pages to export.');
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  pdf.setCreator('Design Space');
  pdf.setSubject('Embedded-font printable document');
  const fonts = new Map<string, PDFFont>();
  const characters = new Map<string, Set<number>>();
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Text measurement is unavailable.');

  for (const source of sources) {
    const clone = await prepareDocumentExportClone(source.element, source.options);
    const host = document.createElement('div');
    Object.assign(host.style, { position: 'absolute', left: '-100000px', top: '0', pointerEvents: 'none' });
    host.append(clone);
    document.body.append(host);
    try {
      await document.fonts.ready;
      if (clone.querySelector('[data-document-drop-cap-target="true"], [data-drop-cap="true"]')) {
        throw new Error('Embedded-font PDF does not yet support drop caps. Turn them off or use Print / Save PDF.');
      }
      const bounds = clone.getBoundingClientRect();
      const frontArtwork = [...clone.querySelectorAll('.document-overlay-front .document-image__frame')].map((element) => element.getBoundingClientRect());
      const width = source.options.widthIn * 72;
      const height = source.options.heightIn * 72;
      const page = pdf.addPage([width, height]);
      const glyphs: Array<{ text: string; x: number; y: number; size: number; font: PDFFont; color: ReturnType<typeof rgb>; underline: boolean; width: number }> = [];
      const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
      const parents = new Set<HTMLElement>();
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const parent = node.parentElement;
        if (!parent || parent.closest('style, script, [data-document-export-exclude]')) continue;
        const style = getComputedStyle(parent);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        const text = node.textContent || '';
        if (!text.trim()) continue;
        assertPublishingText(text);
        const family = publishingFontFromCss(style.fontFamily);
        if (!family) {
          throw new Error('Embedded-font PDF requires Cinzel or Cormorant Garamond throughout the document. Choose publishing typography or use Print / Save PDF for other fonts.');
        }
        if (style.textTransform !== 'none' || style.hyphens === 'auto' || style.writingMode !== 'horizontal-tb') {
          throw new Error('Embedded-font PDF requires horizontal text without automatic hyphenation or text transforms. Use Print / Save PDF for this layout.');
        }
        const url = publishingFontFile(family, Number(style.fontWeight), style.fontStyle === 'italic');
        let font = fonts.get(url);
        if (!font) {
          // Full static faces avoid subset shaping differences and include ToUnicode.
          font = await pdf.embedFont(await loadPublishingFontBytes(url));
          fonts.set(url, font);
          characters.set(url, new Set(font.getCharacterSet()));
        }
        const size = Number.parseFloat(style.fontSize);
        context.font = `${style.fontStyle} ${style.fontWeight} ${size}px ${style.fontFamily}`;
        const metrics = context.measureText('Hg');
        const ascent = metrics.fontBoundingBoxAscent;
        if (!Number.isFinite(ascent)) throw new Error('This browser cannot measure PDF text baselines. Use Print / Save PDF.');
        const channels = style.color.match(/[\d.]+/g)?.map(Number) || [];
        if (channels.length < 3) throw new Error('A text colour could not be exported. Use an RGB or hex colour.');
        if (channels.length > 3 && channels[3] !== 1) throw new Error('Transparent text is not supported by embedded-font PDF.');
        const color = publishingPdfColor(channels[0], channels[1], channels[2], grayscale);
        let offset = 0;
        for (const character of text) {
          const range = document.createRange();
          range.setStart(node, offset);
          offset += character.length;
          range.setEnd(node, offset);
          const rect = range.getBoundingClientRect();
          if (!character.trim() || rect.width === 0 || rect.height === 0) continue;
          // A font's em box can extend beyond a short line-height even when
          // all visible ink fits. Validate ink, not the browser's em rectangle.
          const ink = context.measureText(character);
          const inkBounds = {
            left: rect.left - ink.actualBoundingBoxLeft,
            right: rect.left + ink.actualBoundingBoxRight,
            top: rect.top + ascent - ink.actualBoundingBoxAscent,
            bottom: rect.top + ascent + ink.actualBoundingBoxDescent,
          };
          if (inkBounds.left < bounds.left - 1 || inkBounds.right > bounds.right + 1 || inkBounds.top < bounds.top - 1 || inkBounds.bottom > bounds.bottom + 1) {
            throw new Error('Text extends beyond a page. Adjust the layout before exporting.');
          }
          if (frontArtwork.some((art) => inkBounds.left < art.right && inkBounds.right > art.left && inkBounds.top < art.bottom && inkBounds.bottom > art.top)) {
            throw new Error('An image in front of text overlaps the text. Move it, place it behind text, or use Print / Save PDF to preserve this layering.');
          }
          for (let ancestor: HTMLElement | null = parent; ancestor && ancestor !== host; ancestor = ancestor.parentElement) {
            const ancestorStyle = getComputedStyle(ancestor);
            const clip = ancestor.getBoundingClientRect();
            if ((['hidden', 'clip'].includes(ancestorStyle.overflowY) && (inkBounds.top < clip.top - 1 || inkBounds.bottom > clip.bottom + 1))
              || (['hidden', 'clip'].includes(ancestorStyle.overflowX) && (inkBounds.left < clip.left - 1 || inkBounds.right > clip.right + 1))) {
              throw new Error('A text block is clipped. Adjust its spacing or shorten the text before exporting.');
            }
          }
          if (!characters.get(url)?.has(character.codePointAt(0)!)) {
            throw new Error(`The selected font does not contain “${character}”. Choose a supported character before exporting.`);
          }
          glyphs.push({
            text: character,
            x: (rect.left - bounds.left) * POINTS_PER_CSS_PIXEL,
            y: height - (rect.top - bounds.top + ascent) * POINTS_PER_CSS_PIXEL,
            size: size * POINTS_PER_CSS_PIXEL,
            font,
            color,
            underline: style.textDecorationLine.includes('underline'),
            width: rect.width * POINTS_PER_CSS_PIXEL,
          });
        }
        parents.add(parent);
      }
      // Preserve layout and artwork while removing text from the raster layer.
      for (const parent of parents) {
        parent.style.setProperty('color', 'transparent', 'important');
        parent.style.setProperty('text-decoration-color', 'transparent', 'important');
        parent.style.setProperty('text-shadow', 'none', 'important');
      }
      const artwork = await documentExportService.exportPngBlob(clone, { ...source.options, grayscale });
      const image = await pdf.embedPng(await artwork.arrayBuffer());
      page.drawImage(image, { x: 0, y: 0, width, height });
      for (const glyph of glyphs) {
        page.drawText(glyph.text, { x: glyph.x, y: glyph.y, size: glyph.size, font: glyph.font, color: glyph.color });
        if (glyph.underline) page.drawLine({
          start: { x: glyph.x, y: glyph.y - glyph.size * 0.1 },
          end: { x: glyph.x + glyph.width, y: glyph.y - glyph.size * 0.1 },
          thickness: glyph.size / 20,
          color: glyph.color,
        });
      }
    } finally {
      host.remove();
    }
  }
  return new Blob([new Uint8Array(await pdf.save())], { type: 'application/pdf' });
};
