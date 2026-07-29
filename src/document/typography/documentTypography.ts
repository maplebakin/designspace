import { parseDocumentColor } from '../utils/documentColor';

export const DOCUMENT_STYLE_IDS = [
  'article-title',
  'body',
  'subsection-heading',
  'caption',
  'quotation',
  'author-signature',
] as const;

export type DocumentStyleId = typeof DOCUMENT_STYLE_IDS[number];

export const DOCUMENT_FONT_FAMILY_IDS = [
  'historical-serif',
  'book-serif',
  'classic-serif',
  'humanist-sans',
  'system-sans',
] as const;

export type DocumentFontFamilyId = typeof DOCUMENT_FONT_FAMILY_IDS[number];
export type DocumentStyleAlignment = 'left' | 'center' | 'right' | 'justify';
export type DocumentHyphenation = 'auto' | 'manual' | 'none';

export type DocumentNamedStyleDefinition = {
  fontFamilyId: DocumentFontFamilyId;
  fontSizePx: number;
  color: string;
  lineHeight: number;
  paragraphSpacingPx: number;
  firstLineIndentPx: number;
  alignment: DocumentStyleAlignment;
  fontWeight: 400 | 500 | 600 | 700;
  italic: boolean;
  trackingEm: number;
  hyphenation: DocumentHyphenation;
};

export type DocumentNamedStyleRegistry = Record<
  DocumentStyleId,
  DocumentNamedStyleDefinition
>;

export type DocumentDropCapSettings = {
  enabled: boolean;
  fontFamilyId: DocumentFontFamilyId | 'inherit';
  color: string | 'inherit';
  sizeEm: number;
  lineSpan: number;
  spacingPx: number;
};

export const DEFAULT_DOCUMENT_LANGUAGE = 'en';

export const DEFAULT_DOCUMENT_STYLES: DocumentNamedStyleRegistry = {
  'article-title': {
    fontFamilyId: 'historical-serif',
    fontSizePx: 38,
    color: '#285F9E',
    lineHeight: 1.08,
    paragraphSpacingPx: 0,
    firstLineIndentPx: 0,
    alignment: 'left',
    fontWeight: 700,
    italic: false,
    trackingEm: 0,
    hyphenation: 'none',
  },
  body: {
    fontFamilyId: 'historical-serif',
    fontSizePx: 14,
    color: '#1F2937',
    lineHeight: 1.42,
    paragraphSpacingPx: 10,
    firstLineIndentPx: 0,
    alignment: 'justify',
    fontWeight: 400,
    italic: false,
    trackingEm: 0,
    hyphenation: 'auto',
  },
  'subsection-heading': {
    fontFamilyId: 'historical-serif',
    fontSizePx: 14,
    color: '#1F2937',
    lineHeight: 1.2,
    paragraphSpacingPx: 10,
    firstLineIndentPx: 0,
    alignment: 'left',
    fontWeight: 700,
    italic: false,
    trackingEm: 0,
    hyphenation: 'none',
  },
  caption: {
    fontFamilyId: 'historical-serif',
    fontSizePx: 11,
    color: '#374151',
    lineHeight: 1.25,
    paragraphSpacingPx: 5,
    firstLineIndentPx: 0,
    alignment: 'center',
    fontWeight: 400,
    italic: true,
    trackingEm: 0,
    hyphenation: 'none',
  },
  quotation: {
    fontFamilyId: 'historical-serif',
    fontSizePx: 13,
    color: '#1F2937',
    lineHeight: 1.42,
    paragraphSpacingPx: 10,
    firstLineIndentPx: 20,
    alignment: 'justify',
    fontWeight: 400,
    italic: false,
    trackingEm: 0,
    hyphenation: 'auto',
  },
  'author-signature': {
    fontFamilyId: 'historical-serif',
    fontSizePx: 13,
    color: '#1F2937',
    lineHeight: 1.3,
    paragraphSpacingPx: 8,
    firstLineIndentPx: 0,
    alignment: 'right',
    fontWeight: 400,
    italic: true,
    trackingEm: 0,
    hyphenation: 'none',
  },
};

export const DEFAULT_DOCUMENT_DROP_CAP: DocumentDropCapSettings = {
  enabled: false,
  fontFamilyId: 'inherit',
  color: 'inherit',
  sizeEm: 3.35,
  lineSpan: 3,
  spacingPx: 6,
};

const FONT_FAMILY_CSS: Record<DocumentFontFamilyId, string> = {
  'historical-serif': 'Georgia, "Times New Roman", Times, serif',
  'book-serif': 'Palatino, "Palatino Linotype", "Book Antiqua", serif',
  'classic-serif': '"Times New Roman", Times, serif',
  'humanist-sans': '"Trebuchet MS", "Segoe UI", sans-serif',
  'system-sans': 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
};

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const finiteNumber = (value: unknown, fallback: number) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

export const normalizeDocumentBlockFontSizePx = (
  value: unknown
): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.round(clamp(numeric, 8, 240) * 1000) / 1000;
};

export const normalizeDocumentInlineFontSizePx = (
  value: unknown
): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.round(clamp(numeric, 8, 140) * 1000) / 1000;
};

export const normalizeDocumentInlineFontFamilyId = (
  value: unknown
): DocumentFontFamilyId | null => (
  typeof value === 'string'
  && (DOCUMENT_FONT_FAMILY_IDS as readonly string[]).includes(value)
    ? value as DocumentFontFamilyId
    : null
);

export const normalizeDocumentInlineTextColor = (
  value: unknown
): string | null => parseDocumentColor(value);

export const normalizeDocumentInlineTrackingEm = (
  value: unknown
): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.round(clamp(numeric, -0.15, 0.5) * 10_000) / 10_000;
};

export const normalizeDocumentLanguage = (
  value: unknown,
  fallback = DEFAULT_DOCUMENT_LANGUAGE
): string => {
  const candidate = typeof value === 'string' ? value.trim() : '';
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(candidate)) {
    if (fallback !== DEFAULT_DOCUMENT_LANGUAGE) {
      return normalizeDocumentLanguage(fallback, DEFAULT_DOCUMENT_LANGUAGE);
    }
    return DEFAULT_DOCUMENT_LANGUAGE;
  }

  return candidate
    .split('-')
    .map((part, index) => (
      index === 0
        ? part.toLowerCase()
        : part.length === 2
          ? part.toUpperCase()
          : part.toLowerCase()
    ))
    .join('-');
};

export const normalizeDocumentStyleId = (
  value: unknown,
  fallback: DocumentStyleId = 'body'
): DocumentStyleId => (
  typeof value === 'string'
  && (DOCUMENT_STYLE_IDS as readonly string[]).includes(value)
    ? value as DocumentStyleId
    : fallback
);

export const normalizeDocumentFontFamilyId = (
  value: unknown,
  fallback: DocumentFontFamilyId = 'historical-serif'
): DocumentFontFamilyId => (
  typeof value === 'string'
  && (DOCUMENT_FONT_FAMILY_IDS as readonly string[]).includes(value)
    ? value as DocumentFontFamilyId
    : fallback
);

export const normalizeDocumentTextColor = (
  value: unknown,
  fallback = '#1F2937',
  allowInherit = false
): string => {
  if (
    allowInherit
    && typeof value === 'string'
    && value.trim().toLowerCase() === 'inherit'
  ) {
    return 'inherit';
  }
  const parsed = parseDocumentColor(value) ?? parseDocumentColor(fallback);
  if (parsed) return parsed;
  return allowInherit && fallback === 'inherit' ? 'inherit' : '#1F2937';
};

export const normalizeDocumentTrackingEm = (
  value: unknown,
  fallback = 0
): number => clamp(finiteNumber(value, fallback), -0.15, 0.5);

const normalizeAlignment = (
  value: unknown,
  fallback: DocumentStyleAlignment
): DocumentStyleAlignment => (
  value === 'left'
  || value === 'center'
  || value === 'right'
  || value === 'justify'
    ? value
    : fallback
);

const normalizeFontWeight = (
  value: unknown,
  fallback: DocumentNamedStyleDefinition['fontWeight']
): DocumentNamedStyleDefinition['fontWeight'] => (
  value === 400 || value === 500 || value === 600 || value === 700
    ? value
    : fallback
);

const normalizeHyphenation = (
  value: unknown,
  fallback: DocumentHyphenation
): DocumentHyphenation => (
  value === 'auto' || value === 'manual' || value === 'none'
    ? value
    : fallback
);

export const normalizeDocumentStyleDefinition = (
  value: unknown,
  fallback: DocumentNamedStyleDefinition
): DocumentNamedStyleDefinition => {
  const source = isObject(value) ? value : {};
  return {
    fontFamilyId: normalizeDocumentFontFamilyId(
      source.fontFamilyId,
      fallback.fontFamilyId
    ),
    fontSizePx: clamp(finiteNumber(source.fontSizePx, fallback.fontSizePx), 6, 240),
    color: normalizeDocumentTextColor(source.color, fallback.color),
    lineHeight: clamp(finiteNumber(source.lineHeight, fallback.lineHeight), 0.75, 3),
    paragraphSpacingPx: clamp(
      finiteNumber(source.paragraphSpacingPx, fallback.paragraphSpacingPx),
      0,
      192
    ),
    firstLineIndentPx: clamp(
      finiteNumber(source.firstLineIndentPx, fallback.firstLineIndentPx),
      0,
      480
    ),
    alignment: normalizeAlignment(source.alignment, fallback.alignment),
    fontWeight: normalizeFontWeight(source.fontWeight, fallback.fontWeight),
    italic: typeof source.italic === 'boolean' ? source.italic : fallback.italic,
    trackingEm: normalizeDocumentTrackingEm(
      source.trackingEm,
      fallback.trackingEm
    ),
    hyphenation: normalizeHyphenation(
      source.hyphenation,
      fallback.hyphenation
    ),
  };
};

export const normalizeDocumentStyleRegistry = (
  value: unknown,
  defaults: DocumentNamedStyleRegistry = DEFAULT_DOCUMENT_STYLES
): DocumentNamedStyleRegistry => {
  const source = isObject(value) ? value : {};
  return Object.fromEntries(
    DOCUMENT_STYLE_IDS.map((styleId) => [
      styleId,
      normalizeDocumentStyleDefinition(source[styleId], defaults[styleId]),
    ])
  ) as DocumentNamedStyleRegistry;
};

export const normalizeDocumentDropCap = (
  value: unknown,
  fallback: DocumentDropCapSettings = DEFAULT_DOCUMENT_DROP_CAP
): DocumentDropCapSettings => {
  const source = isObject(value) ? value : {};
  const legacyEnabled = value === true;
  const rawFontFamilyId = source.fontFamilyId;
  const fontFamilyId = rawFontFamilyId === 'inherit'
    ? 'inherit'
    : rawFontFamilyId === undefined
      ? fallback.fontFamilyId
    : normalizeDocumentFontFamilyId(
        rawFontFamilyId,
        fallback.fontFamilyId === 'inherit'
          ? 'historical-serif'
          : fallback.fontFamilyId
      );
  return {
    enabled: typeof source.enabled === 'boolean'
      ? source.enabled
      : legacyEnabled || fallback.enabled,
    fontFamilyId,
    color: normalizeDocumentTextColor(source.color, fallback.color, true),
    sizeEm: clamp(finiteNumber(source.sizeEm, fallback.sizeEm), 1, 12),
    lineSpan: Math.round(clamp(finiteNumber(source.lineSpan, fallback.lineSpan), 1, 10)),
    spacingPx: clamp(finiteNumber(source.spacingPx, fallback.spacingPx), 0, 96),
  };
};

export const resolveDocumentFontFamilyCss = (
  value: DocumentFontFamilyId
): string => FONT_FAMILY_CSS[value];

export const getDocumentStyleCss = (
  style: DocumentNamedStyleDefinition
): Record<string, string | number> => ({
  fontFamily: resolveDocumentFontFamilyCss(style.fontFamilyId),
  fontSize: `${style.fontSizePx}px`,
  color: style.color,
  lineHeight: style.lineHeight,
  marginBottom: `${style.paragraphSpacingPx}px`,
  textIndent: `${style.firstLineIndentPx}px`,
  textAlign: style.alignment,
  fontWeight: style.fontWeight,
  fontStyle: style.italic ? 'italic' : 'normal',
  letterSpacing: `${style.trackingEm}em`,
  hyphens: style.hyphenation,
  WebkitHyphens: style.hyphenation,
});

export const getDocumentDropCapCss = (
  dropCap: DocumentDropCapSettings
): Record<string, string | number> => ({
  fontFamily: dropCap.fontFamilyId === 'inherit'
    ? 'inherit'
    : resolveDocumentFontFamilyCss(dropCap.fontFamilyId),
  color: dropCap.color,
  fontSize: `${dropCap.sizeEm}em`,
  marginRight: `${dropCap.spacingPx}px`,
  '--document-drop-cap-line-span': dropCap.lineSpan,
});
