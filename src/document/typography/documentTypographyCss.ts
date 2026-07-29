import type { CSSProperties } from 'react';
import {
  DOCUMENT_STYLE_IDS,
  normalizeDocumentDropCap,
  normalizeDocumentStyleRegistry,
  resolveDocumentFontFamilyCss,
  type DocumentDropCapSettings,
  type DocumentNamedStyleRegistry,
} from './documentTypography';

export type DocumentTypographyCssProperties = CSSProperties & Record<
  `--document-${string}`,
  string | number
>;

/**
 * Converts the validated typography model into the only CSS contract consumed
 * by page, structured-layout, and export renderers. Persisted projects never
 * contain these CSS strings.
 */
export const getDocumentTypographyCssVariables = (
  value: DocumentNamedStyleRegistry,
  dropCapValue: DocumentDropCapSettings
): DocumentTypographyCssProperties => {
  const styles = normalizeDocumentStyleRegistry(value);
  const dropCap = normalizeDocumentDropCap(dropCapValue);
  const variables: Record<string, string | number> = {};

  DOCUMENT_STYLE_IDS.forEach((styleId) => {
    const style = styles[styleId];
    const prefix = `--document-style-${styleId}`;
    variables[`${prefix}-font-family`] = resolveDocumentFontFamilyCss(
      style.fontFamilyId
    );
    variables[`${prefix}-font-size`] = `${style.fontSizePx}px`;
    variables[`${prefix}-color`] = style.color;
    variables[`${prefix}-line-height`] = String(style.lineHeight);
    variables[`${prefix}-paragraph-spacing`] =
      `${style.paragraphSpacingPx}px`;
    variables[`${prefix}-first-line-indent`] =
      `${style.firstLineIndentPx}px`;
    variables[`${prefix}-alignment`] = style.alignment;
    variables[`${prefix}-font-weight`] = String(style.fontWeight);
    variables[`${prefix}-font-style`] = style.italic ? 'italic' : 'normal';
    variables[`${prefix}-tracking`] = `${style.trackingEm}em`;
    variables[`${prefix}-hyphens`] = style.hyphenation;
  });

  variables['--document-drop-cap-font-family'] =
    dropCap.fontFamilyId === 'inherit'
      ? 'inherit'
      : resolveDocumentFontFamilyCss(dropCap.fontFamilyId);
  variables['--document-drop-cap-color'] = dropCap.color;
  variables['--document-drop-cap-size'] = `${dropCap.sizeEm}em`;
  variables['--document-drop-cap-line-span'] = String(dropCap.lineSpan);
  variables['--document-drop-cap-spacing'] = `${dropCap.spacingPx}px`;
  variables['--document-drop-cap-line-height'] = String(
    styles.body.lineHeight * dropCap.lineSpan / dropCap.sizeEm
  );

  return variables as DocumentTypographyCssProperties;
};
