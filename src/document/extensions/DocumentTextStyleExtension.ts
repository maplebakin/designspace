import { Mark, mergeAttributes } from '@tiptap/core';
import {
  type DocumentFontFamilyId,
  normalizeDocumentInlineFontFamilyId,
  normalizeDocumentInlineFontSizePx,
  normalizeDocumentInlineTextColor,
  normalizeDocumentInlineTrackingEm,
  resolveDocumentFontFamilyCss,
} from '../typography/documentTypography';

const MIN_FONT_SIZE_PX = 8;
const CSS_PIXELS_PER_POINT = 96 / 72;

const normalizeFontFamilyOverride = (
  value: unknown
): DocumentFontFamilyId | null =>
  normalizeDocumentInlineFontFamilyId(value);

const normalizeTextColorOverride = (value: unknown): string | null =>
  normalizeDocumentInlineTextColor(value);

const normalizeTrackingOverride = (value: unknown): number | null =>
  normalizeDocumentInlineTrackingEm(value);

export const DOCUMENT_FONT_SIZES_PT = [
  8, 9, 10, 11, 12, 14, 16, 18, 24, 32,
] as const;

export const normalizeDocumentFontSize = (value: unknown): number | null => {
  return normalizeDocumentInlineFontSizePx(value);
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
      setDocumentFontFamily: (fontFamilyId: DocumentFontFamilyId) => ReturnType;
      unsetDocumentFontFamily: () => ReturnType;
      setDocumentTextColor: (textColor: string) => ReturnType;
      unsetDocumentTextColor: () => ReturnType;
      setDocumentTrackingEm: (trackingEm: number) => ReturnType;
      unsetDocumentTrackingEm: () => ReturnType;
    };
  }
}

/**
 * A deliberately narrow text-style mark. Every override is normalized to a
 * bounded model value; arbitrary clipboard or persisted CSS never becomes
 * editor state.
 */
export const DocumentTextStyleExtension = Mark.create({
  name: 'documentTextStyle',
  priority: 101,

  addAttributes() {
    return {
      fontSizePx: {
        default: null,
        parseHTML: (element) => {
          const dataValue = normalizeDocumentFontSize(
            element.getAttribute('data-font-size-px')
          );
          if (dataValue !== null) return dataValue;
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
      fontFamilyId: {
        default: null,
        parseHTML: (element) => normalizeFontFamilyOverride(
          element.getAttribute('data-font-family-id')
        ),
        renderHTML: (attributes) => {
          const fontFamilyId = normalizeFontFamilyOverride(
            attributes.fontFamilyId
          );
          if (fontFamilyId === null) return {};
          return {
            'data-font-family-id': fontFamilyId,
            style: `font-family: ${resolveDocumentFontFamilyCss(fontFamilyId)}`,
          };
        },
      },
      textColor: {
        default: null,
        parseHTML: (element) => normalizeTextColorOverride(
          element.getAttribute('data-text-color')
        ),
        renderHTML: (attributes) => {
          const textColor = normalizeTextColorOverride(attributes.textColor);
          if (textColor === null) return {};
          return {
            'data-text-color': textColor,
            style: `color: ${textColor}`,
          };
        },
      },
      trackingEm: {
        default: null,
        parseHTML: (element) => normalizeTrackingOverride(
          element.getAttribute('data-tracking-em')
        ),
        renderHTML: (attributes) => {
          const trackingEm = normalizeTrackingOverride(attributes.trackingEm);
          if (trackingEm === null) return {};
          return {
            'data-tracking-em': String(trackingEm),
            style: `letter-spacing: ${trackingEm}em`,
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
      },
      {
        tag: 'span[data-font-family-id]',
      },
      {
        tag: 'span[data-text-color]',
      },
      {
        tag: 'span[data-tracking-em]',
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
          commands.setMark(this.name, { fontSizePx: null }),
      setDocumentFontFamily:
        (fontFamilyId) =>
        ({ commands }) => {
          const normalized = normalizeFontFamilyOverride(fontFamilyId);
          if (normalized === null) return false;
          return commands.setMark(this.name, {
            fontFamilyId: normalized,
          });
        },
      unsetDocumentFontFamily:
        () =>
        ({ commands }) =>
          commands.setMark(this.name, { fontFamilyId: null }),
      setDocumentTextColor:
        (textColor) =>
        ({ commands }) => {
          const normalized = normalizeTextColorOverride(textColor);
          if (normalized === null) return false;
          return commands.setMark(this.name, { textColor: normalized });
        },
      unsetDocumentTextColor:
        () =>
        ({ commands }) =>
          commands.setMark(this.name, { textColor: null }),
      setDocumentTrackingEm:
        (trackingEm) =>
        ({ commands }) => {
          const normalized = normalizeTrackingOverride(trackingEm);
          if (normalized === null) return false;
          return commands.setMark(this.name, { trackingEm: normalized });
        },
      unsetDocumentTrackingEm:
        () =>
        ({ commands }) =>
          commands.setMark(this.name, { trackingEm: null }),
    };
  },
});
