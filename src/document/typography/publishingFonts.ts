export const PUBLISHING_FONT_FAMILIES = {
  cinzel: 'Cinzel',
  'cormorant-garamond': 'Cormorant Garamond',
} as const;

export type PublishingFontId = keyof typeof PUBLISHING_FONT_FAMILIES;

export const publishingFontFile = (id: PublishingFontId, weight: number, italic: boolean) => {
  const family = id === 'cinzel' ? 'Cinzel' : 'CormorantGaramond';
  const boundedWeight = [400, 500, 600, 700].includes(weight) ? weight : 400;
  if (id === 'cinzel' && italic) throw new Error('Cinzel has no italic face. Use Cormorant Garamond for italic text.');
  return `${import.meta.env.BASE_URL}fonts/publishing/${family}${italic ? '-Italic' : ''}-${boundedWeight}.ttf`;
};

const fontBytes = new Map<string, Promise<Uint8Array>>();
export const loadPublishingFontBytes = (url: string) => {
  let pending = fontBytes.get(url);
  if (!pending) {
    pending = fetch(url).then(async (response) => {
      if (!response.ok) throw new Error('A publishing font could not be loaded. Please retry the export.');
      return new Uint8Array(await response.arrayBuffer());
    }).catch((error) => {
      fontBytes.delete(url);
      throw error;
    });
    fontBytes.set(url, pending);
  }
  return pending;
};

export const publishingFontFromCss = (family: string): PublishingFontId | null => {
  const first = family.split(',')[0].trim().replace(/["']/g, '');
  return first === 'Cinzel' ? 'cinzel' : first === 'Cormorant Garamond' ? 'cormorant-garamond' : null;
};

/** SVG image documents cannot fetch external fonts. Embed only the used faces. */
export const inlinePublishingFonts = async (source: HTMLElement, clone: HTMLElement) => {
  const faces = new Map<string, { id: PublishingFontId; weight: number; italic: boolean }>();
  for (const element of [source, ...source.querySelectorAll<HTMLElement>('*')]) {
    const style = getComputedStyle(element);
    const id = publishingFontFromCss(style.fontFamily);
    if (!id) continue;
    const weight = Number(style.fontWeight) || 400;
    const italic = style.fontStyle === 'italic';
    const url = publishingFontFile(id, weight, italic);
    faces.set(url, { id, weight, italic });
  }
  if (faces.size === 0) return;
  const rules = await Promise.all([...faces].map(async ([url, face]) => {
    if (document.fonts?.load) {
      const loaded = await document.fonts.load(`${face.italic ? 'italic' : 'normal'} ${face.weight} 16px "${PUBLISHING_FONT_FAMILIES[face.id]}"`);
      if (loaded.length === 0) throw new Error('A publishing font is unavailable. Reload Design Space before exporting.');
    }
    const bytes = await loadPublishingFontBytes(url);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return `@font-face{font-family:"${PUBLISHING_FONT_FAMILIES[face.id]}";font-style:${face.italic ? 'italic' : 'normal'};font-weight:${face.weight};src:url(data:font/ttf;base64,${btoa(binary)}) format('truetype');}`;
  }));
  const style = document.createElement('style');
  style.textContent = rules.join('\n');
  clone.prepend(style);
};
