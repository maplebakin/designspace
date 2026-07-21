import { Mark, mergeAttributes } from '@tiptap/core';

const MIN_FONT_SIZE_PX = 8;
const MAX_FONT_SIZE_PX = 140;
const CSS_PIXELS_PER_POINT = 96 / 72;

export const DOCUMENT_FONT_SIZES_PT = [
  8, 9, 10, 11, 12, 14, 16, 18, 24, 32,
] as const;

export const normalizeDocumentFontSize = (value: unknown): number | null => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const clamped = Math.min(MAX_FONT_SIZE_PX, Math.max(MIN_FONT_SIZE_PX, numeric));
  return Math.round(clamped * 1000) / 1000;
};

export const documentPointsToPixels = (fontSizePt: number): number =>
  normalizeDocumentFontSize(fontSizePt * CSS_PIXELS_PER_POINT) ?? MIN_FONT_SIZE_PX;

export const documentPixelsToPoints = (fontSizePx: number): number =>
  Math.round((fontSizePx / CSS_PIXELS_PER_POINT) * 100) / 100;

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    documentTextStyle: {
      setDocumentFontSize: (fontSizePx: number) => ReturnType;
      unsetDocumentFontSize: () => ReturnType;
    };
  }
}

/**
 * A deliberately narrow text-style mark. It stores only font size; arbitrary
 * clipboard styles never become editor state.
 */
export const DocumentTextStyleExtension = Mark.create({
  name: 'documentTextStyle',
  priority: 101,

  addAttributes() {
    return {
      fontSizePx: {
        default: null,
        parseHTML: (element) => {
          const value = element.style.fontSize;
          return value.endsWith('px')
            ? normalizeDocumentFontSize(value.slice(0, -2))
            : null;
        },
        renderHTML: (attributes) => {
          const fontSizePx = normalizeDocumentFontSize(attributes.fontSizePx);
          if (fontSizePx === null) return {};
          return {
            'data-font-size-px': String(fontSizePx),
            style: `font-size: ${fontSizePx}px`,
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[style*="font-size"]',
      },
      {
        tag: 'span[data-font-size-px]',
        getAttrs: (element) => {
          if (typeof element === 'string') return false;
          return {
            fontSizePx: normalizeDocumentFontSize(
              element.getAttribute('data-font-size-px')
            ),
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setDocumentFontSize:
        (fontSizePx) =>
        ({ commands }) => {
          const normalized = normalizeDocumentFontSize(fontSizePx);
          if (normalized === null) return false;
          return commands.setMark(this.name, { fontSizePx: normalized });
        },
      unsetDocumentFontSize:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});
