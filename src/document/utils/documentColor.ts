export const DEFAULT_DOCUMENT_PAPER_COLOR = '#FAF8F5';

const DOCUMENT_HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Document colours are deliberately stored as opaque, bounded hex values.
 * This keeps project data portable and prevents persisted values from becoming
 * an arbitrary CSS injection surface.
 */
export const parseDocumentColor = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const candidate = value.trim();
  const match = DOCUMENT_HEX_COLOR.exec(candidate);
  if (!match) return null;

  const hex = match[1];
  const expanded = hex.length === 3
    ? Array.from(hex, (character) => `${character}${character}`).join('')
    : hex;
  return `#${expanded.toUpperCase()}`;
};

export const normalizeDocumentPaperColor = (
  value: unknown,
  fallback = DEFAULT_DOCUMENT_PAPER_COLOR
): string => (
  parseDocumentColor(value)
  ?? parseDocumentColor(fallback)
  ?? DEFAULT_DOCUMENT_PAPER_COLOR
);
