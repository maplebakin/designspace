import { parseDocumentColor } from '../utils/documentColor';

const boundedNumber = (value: unknown, fallback: number, min: number, max: number) => {
  const number = Number(value);
  return Math.min(max, Math.max(min, Number.isFinite(number) ? number : fallback));
};

/** Attributes on ordinary paragraphs keep worksheets editable and portable. */
export const normalizeWritingAttributes = (attrs: Record<string, unknown>) => {
  const rows = Math.round(boundedNumber(attrs.documentWritingRows, 0, 0, 30));
  const divider = attrs.documentDivider === true;
  return {
    ...(Number(attrs.documentSpaceBeforePx) > 0 ? { documentSpaceBeforePx: boundedNumber(attrs.documentSpaceBeforePx, 0, 0, 720) } : {}),
    ...(Number(attrs.documentSpaceAfterPx) > 0 ? { documentSpaceAfterPx: boundedNumber(attrs.documentSpaceAfterPx, 0, 0, 720) } : {}),
    ...(rows > 0 ? {
      documentWritingRows: rows,
      documentWritingSpacing: boundedNumber(attrs.documentWritingSpacing ?? 32, 32, 20, 64),
      documentWritingRuleWidthPt: boundedNumber(attrs.documentWritingRuleWidthPt ?? 0.75, 0.75, 0.25, 2.5),
    } : {}),
    ...(divider ? { documentDivider: true } : {}),
    ...(rows > 0 || divider ? {
      documentRuleColor: parseDocumentColor(attrs.documentRuleColor) || '#9A8B94',
    } : {}),
  };
};
