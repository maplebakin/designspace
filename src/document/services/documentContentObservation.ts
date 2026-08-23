import { DOCUMENT_IMAGE_NODE_NAMES } from '../extensions/DocumentImageExtension';
import { measureDocumentLiveTextMetric } from './documentLiveTextDiagnostics';

const IMAGE_NODE_NAMES = new Set<string>(DOCUMENT_IMAGE_NODE_NAMES);
const IMPLICIT_BLOCK_ATTRIBUTE_DEFAULTS = new Set([
  'textAlign',
  'documentColumnBreakBefore',
  'documentKeepWithNext',
  'documentKeepLinesTogether',
]);

const isDefaultEmptyParagraph = (value: Record<string, unknown>) => {
  if (value.type !== 'paragraph' || value.content !== undefined) return false;
  const attrs = value.attrs;
  if (!attrs || typeof attrs !== 'object') return true;
  const keys = Object.keys(attrs as Record<string, unknown>);
  return keys.every((key) => (
    key === 'documentStyleId'
      ? (attrs as Record<string, unknown>)[key] === 'body'
      : key === 'documentStyleFontSizePx'
        ? (attrs as Record<string, unknown>)[key] === null
        : false
  ));
};

/**
 * Produces a stable authored-content projection for a ProseMirror document.
 * Structured image nodes are intentionally omitted because their add/remove
 * and geometry commands already have explicit semantic observations.
 */
const stripStructuredImages = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value
      .map(stripStructuredImages)
      .filter((entry) => entry !== null);
  }
  if (!value || typeof value !== 'object') return value;

  const record = value as Record<string, unknown>;
  if (typeof record.type === 'string' && IMAGE_NODE_NAMES.has(record.type)) {
    return null;
  }

  const entries = Object.entries(record)
    .map(([key, entry]) => [key, stripStructuredImages(entry)] as const)
    .filter(([key, entry]) => {
      if (key === 'content' && Array.isArray(entry) && entry.length === 0) {
        return false;
      }
      if (IMPLICIT_BLOCK_ATTRIBUTE_DEFAULTS.has(key)) {
        return entry !== null && entry !== false;
      }
      return true;
    });
  const normalized = Object.fromEntries(entries);
  return isDefaultEmptyParagraph(normalized) ? null : normalized;
};

const toComparableDocumentValue = (value: unknown) => {
  if (value && typeof value === 'object' && 'toJSON' in value) {
    return stripStructuredImages((value as { toJSON: () => unknown }).toJSON());
  }
  return stripStructuredImages(value);
};

export const documentAuthoredContentProjection = (value: unknown) => (
  measureDocumentLiveTextMetric(
    'documentAuthoredContentProjection',
    () => JSON.stringify(toComparableDocumentValue(value))
  )
);

export const documentAuthoredContentDiffers = (
  before: unknown,
  after: unknown
) => measureDocumentLiveTextMetric(
  'documentAuthoredContentDiffers',
  () => documentAuthoredContentProjection(before)
    !== documentAuthoredContentProjection(after)
);
