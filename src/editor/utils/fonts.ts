export const loadGoogleFont = (fontFamily: string) => {
  const fontId = `font-${fontFamily.replace(/\s/g, '-')}`;
  if (document.getElementById(fontId)) return;
  const link = document.createElement('link');
  link.id = fontId;
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${fontFamily.replace(/\s/g, '+')}&display=swap`;
  document.head.appendChild(link);
};

export const isFontAvailable = (fontFamily: string) => {
  if (!document.fonts) return false;
  return document.fonts.check(`12px "${fontFamily}"`);
};

export const loadAndCheckFont = async (fontFamily: string) => {
  if (!fontFamily) return false;
  loadGoogleFont(fontFamily);
  if (document.fonts?.load) {
    try {
      await document.fonts.load(`12px "${fontFamily}"`);
    } catch {
      return false;
    }
  }
  return isFontAvailable(fontFamily);
};
