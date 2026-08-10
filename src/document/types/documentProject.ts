import type {
  DocumentDropCapSettings,
} from '../typography/documentTypography';

export type DocumentContentJson = {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: DocumentContentJson[];
  marks?: Array<{
    type: string;
    attrs?: Record<string, unknown>;
  }>;
  text?: string;
  [key: string]: unknown;
};

export type DocumentFlowImageWrap =
  | 'inline'
  | 'float-left'
  | 'float-right'
  | 'top-bottom'
  | 'span-columns';

export type DocumentImageVerticalAnchor = 'flow' | 'page-position';

/**
 * Persisted document-image coordinates always use unzoomed 96-CSS-pixel
 * layout units. `body-span` means Y is measured from the body-region top and
 * X is measured from the selected column-span's left edge. Flow-anchored
 * images do not persist an active free-position coordinate.
 */
export type DocumentImageCoordinateSpace = 'flow' | 'body-span';

export type DocumentImageCropMode = 'fit' | 'fill';

export const normalizeDocumentImageCropMode = (
  value: unknown
): DocumentImageCropMode => value === 'fill' ? 'fill' : 'fit';

export const normalizeDocumentImageFocal = (
  value: unknown,
  fallback = 0.5
) => {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.min(1, Math.max(0, numeric))
    : fallback;
};

export const normalizeDocumentImageCropAttributes = (
  sourceAttrs: Record<string, unknown>
): Record<string, unknown> => ({
  ...sourceAttrs,
  cropMode: normalizeDocumentImageCropMode(sourceAttrs.cropMode),
  cropFocalX: normalizeDocumentImageFocal(sourceAttrs.cropFocalX),
  cropFocalY: normalizeDocumentImageFocal(sourceAttrs.cropFocalY),
});

export type DocumentImageWrapPadding = {
  wrapPaddingTopPx: number;
  wrapPaddingRightPx: number;
  wrapPaddingBottomPx: number;
  wrapPaddingLeftPx: number;
};

export const DEFAULT_DOCUMENT_IMAGE_WRAP_PADDING_PX = 12;
export const MAX_DOCUMENT_IMAGE_WRAP_PADDING_PX = 96;

const DOCUMENT_FLOW_IMAGE_WRAPS = new Set<DocumentFlowImageWrap>([
  'inline',
  'float-left',
  'float-right',
  'top-bottom',
  'span-columns',
]);

export const normalizeDocumentFlowImageWrap = (
  value: unknown,
  fallback: DocumentFlowImageWrap = 'float-left'
): DocumentFlowImageWrap => (
  typeof value === 'string'
  && DOCUMENT_FLOW_IMAGE_WRAPS.has(value as DocumentFlowImageWrap)
    ? value as DocumentFlowImageWrap
    : fallback
);

export const normalizeDocumentImageVerticalAnchor = (
  value: unknown
): DocumentImageVerticalAnchor => (
  value === 'page-position' ? 'page-position' : 'flow'
);

const normalizeDocumentImagePaddingValue = (
  value: unknown,
  fallback: number
) => {
  if (
    value === undefined
    || value === null
    || value === ''
    || typeof value === 'boolean'
  ) {
    return fallback;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(
    MAX_DOCUMENT_IMAGE_WRAP_PADDING_PX,
    Math.max(0, Math.round(numeric))
  );
};

const getLegacyDocumentImageWrapPadding = (
  wrap: DocumentFlowImageWrap,
  horizontalPaddingPx: number,
  verticalSpacingPx: number
): DocumentImageWrapPadding => {
  if (wrap === 'span-columns') {
    return {
      wrapPaddingTopPx: verticalSpacingPx,
      wrapPaddingRightPx: horizontalPaddingPx,
      wrapPaddingBottomPx: verticalSpacingPx,
      wrapPaddingLeftPx: horizontalPaddingPx,
    };
  }
  if (wrap === 'float-left') {
    return {
      wrapPaddingTopPx: 0,
      wrapPaddingRightPx: horizontalPaddingPx,
      wrapPaddingBottomPx: horizontalPaddingPx,
      wrapPaddingLeftPx: 0,
    };
  }
  if (wrap === 'float-right') {
    return {
      wrapPaddingTopPx: 0,
      wrapPaddingRightPx: 0,
      wrapPaddingBottomPx: horizontalPaddingPx,
      wrapPaddingLeftPx: horizontalPaddingPx,
    };
  }
  if (wrap === 'top-bottom') {
    return {
      wrapPaddingTopPx: horizontalPaddingPx,
      wrapPaddingRightPx: 0,
      wrapPaddingBottomPx: horizontalPaddingPx,
      wrapPaddingLeftPx: 0,
    };
  }

  // Inline images did not consume the legacy CSS variable. Retaining the
  // scalar on every side is lossless if inline wrapping becomes configurable.
  return {
    wrapPaddingTopPx: horizontalPaddingPx,
    wrapPaddingRightPx: horizontalPaddingPx,
    wrapPaddingBottomPx: horizontalPaddingPx,
    wrapPaddingLeftPx: horizontalPaddingPx,
  };
};

export type NormalizedDocumentImageGeometry =
  DocumentImageWrapPadding & {
    wrap: DocumentFlowImageWrap;
    verticalAnchor: DocumentImageVerticalAnchor;
    coordinateSpace: DocumentImageCoordinateSpace;
  };

/**
 * Converts v2 scalar padding and spacing into the canonical four-sided v3
 * contract. Explicit side values win independently; missing/malformed sides
 * fall back to the legacy mode-compatible geometry.
 */
export const normalizeDocumentImageGeometry = (
  value: Record<string, unknown>,
  fallbackWrap: DocumentFlowImageWrap = 'float-left'
): NormalizedDocumentImageGeometry => {
  const wrap = normalizeDocumentFlowImageWrap(value.wrap, fallbackWrap);
  const verticalAnchor = normalizeDocumentImageVerticalAnchor(
    value.verticalAnchor
  );
  const legacyHorizontalPadding = normalizeDocumentImagePaddingValue(
    value.wrapPaddingPx,
    DEFAULT_DOCUMENT_IMAGE_WRAP_PADDING_PX
  );
  const legacyVerticalSpacing = normalizeDocumentImagePaddingValue(
    value.verticalSpacingPx,
    DEFAULT_DOCUMENT_IMAGE_WRAP_PADDING_PX
  );
  const legacy = getLegacyDocumentImageWrapPadding(
    wrap,
    legacyHorizontalPadding,
    legacyVerticalSpacing
  );

  return {
    wrap,
    verticalAnchor,
    coordinateSpace:
      wrap === 'span-columns' && verticalAnchor === 'page-position'
        ? 'body-span'
        : 'flow',
    wrapPaddingTopPx: normalizeDocumentImagePaddingValue(
      value.wrapPaddingTopPx,
      legacy.wrapPaddingTopPx
    ),
    wrapPaddingRightPx: normalizeDocumentImagePaddingValue(
      value.wrapPaddingRightPx,
      legacy.wrapPaddingRightPx
    ),
    wrapPaddingBottomPx: normalizeDocumentImagePaddingValue(
      value.wrapPaddingBottomPx,
      legacy.wrapPaddingBottomPx
    ),
    wrapPaddingLeftPx: normalizeDocumentImagePaddingValue(
      value.wrapPaddingLeftPx,
      legacy.wrapPaddingLeftPx
    ),
  };
};

const DOCUMENT_IMAGE_GEOMETRY_ATTRIBUTE_KEYS = [
  'wrap',
  'verticalAnchor',
  'coordinateSpace',
  'wrapPaddingTopPx',
  'wrapPaddingRightPx',
  'wrapPaddingBottomPx',
  'wrapPaddingLeftPx',
  'wrapPaddingPx',
  'verticalSpacingPx',
] as const;

const isDocumentContentRecord = (
  value: unknown
): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

export const normalizeDocumentImageNodeGeometryAttributes = (
  sourceAttrs: Record<string, unknown>,
  nodeType: string | undefined
): Record<string, unknown> => {
  const normalized = { ...sourceAttrs };
  DOCUMENT_IMAGE_GEOMETRY_ATTRIBUTE_KEYS.forEach((key) => {
    delete normalized[key];
  });
  return {
    ...normalized,
    ...normalizeDocumentImageGeometry(
      sourceAttrs,
      nodeType === 'documentInlineImage' ? 'inline' : 'float-left'
    ),
  };
};

export type DocumentFlowControlAttributes = {
  documentColumnBreakBefore: boolean;
  documentKeepWithNext: boolean;
  documentKeepLinesTogether: boolean;
};

export const normalizeDocumentFlowControlAttributes = (
  sourceAttrs: Record<string, unknown>
): DocumentFlowControlAttributes => ({
  documentColumnBreakBefore: sourceAttrs.documentColumnBreakBefore === true,
  documentKeepWithNext: sourceAttrs.documentKeepWithNext === true,
  documentKeepLinesTogether: sourceAttrs.documentKeepLinesTogether === true,
});

const normalizeDocumentImageContentGeometryNode = (
  value: unknown
): DocumentContentJson | null => {
  if (!isDocumentContentRecord(value)) return null;
  const nodeType = typeof value.type === 'string' ? value.type : undefined;
  const isImage =
    nodeType === 'documentInlineImage'
    || nodeType === 'documentFlowImage';
  const sourceAttrs = isDocumentContentRecord(value.attrs) ? value.attrs : {};
  const content = Array.isArray(value.content)
    ? value.content
        .map(normalizeDocumentImageContentGeometryNode)
        .filter((child): child is DocumentContentJson => child !== null)
    : undefined;
  return {
    ...value,
    ...(isImage
      ? {
          attrs: normalizeDocumentImageNodeGeometryAttributes(
            normalizeDocumentImageCropAttributes(sourceAttrs),
            nodeType
          ),
        }
      : value.attrs === undefined
        ? {}
        : { attrs: { ...sourceAttrs } }),
    ...(content === undefined ? {} : { content }),
  };
};

/**
 * Canonicalizes legacy image geometry without changing text or marks. Besides
 * serialization, this provides a stable equality boundary between Tiptap's
 * parse-only compatibility attributes and canonical persisted content.
 */
export const normalizeDocumentImageContentGeometry = (
  value: unknown
): DocumentContentJson => (
  normalizeDocumentImageContentGeometryNode(value)
  ?? {
    type: 'doc',
    content: [{ type: 'paragraph' }],
  }
);

export type DocumentCaptionAlignment =
  | 'inherit'
  | 'left'
  | 'center'
  | 'right';
export type DocumentCaptionItalic = boolean | 'inherit';
export type DocumentCaptionSpacing = number | 'inherit';

export type DocumentFlowImage = {
  id: string;
  assetId: string;
  altText: string;
  widthPx: number;
  heightPx: number;
  wrap: DocumentFlowImageWrap;
  spanCount?: 1 | 2 | 3;
  spanStartColumn?: 1 | 2 | 3;
  wrapPaddingTopPx: number;
  wrapPaddingRightPx: number;
  wrapPaddingBottomPx: number;
  wrapPaddingLeftPx: number;
  verticalAnchor?: DocumentImageVerticalAnchor;
  coordinateSpace: DocumentImageCoordinateSpace;
  yPx?: number;
  horizontalPlacement?: 'left' | 'center' | 'right' | 'custom';
  xOffsetPx?: number;
  caption?: string;
  captionAlignment?: DocumentCaptionAlignment;
  captionItalic?: DocumentCaptionItalic;
  captionSpacingPx?: DocumentCaptionSpacing;
  naturalWidth?: number;
  naturalHeight?: number;
  cropMode?: DocumentImageCropMode;
  cropFocalX?: number;
  cropFocalY?: number;
};

export type DocumentOverlayPlacement = 'front' | 'behind';

export type DocumentOverlayImage = {
  id: string;
  assetId: string;
  altText: string;
  xPx: number;
  yPx: number;
  widthPx: number;
  heightPx: number;
  placement: DocumentOverlayPlacement;
  caption?: string;
  captionAlignment?: DocumentCaptionAlignment;
  captionItalic?: DocumentCaptionItalic;
  captionSpacingPx?: DocumentCaptionSpacing;
  naturalWidth?: number;
  naturalHeight?: number;
  cropMode?: DocumentImageCropMode;
  cropFocalX?: number;
  cropFocalY?: number;
  locked?: boolean;
};

export type DocumentImageGroupKind = 'row' | 'stack';

/**
 * Declarative compound-image metadata. Child image nodes remain the only
 * source of truth for persisted geometry and captions; a group records
 * ordering and alignment policy only.
 */
export type DocumentImageGroup = {
  id: string;
  kind: DocumentImageGroupKind;
  childImageIds: string[];
  gapPx: number;
  sharedWidth: boolean;
};

export type ScanReference = {
  assetId: string;
  sourceType: 'image' | 'pdf';
  opacity: number;
  fit: 'contain' | 'cover' | 'stretch';
  scale: number;
  offsetXPx: number;
  offsetYPx: number;
  visible: boolean;
  locked: boolean;
};

export type DocumentPageSize = {
  presetId: 'letter' | 'a4' | 'custom';
  orientation: 'portrait' | 'landscape';
  widthIn: number;
  heightIn: number;
  dpi: number;
};

export type DocumentPageMargins = {
  topIn: number;
  bottomIn: number;
  innerIn: number;
  outerIn: number;
};

export type DocumentFolioSettings = {
  startingNumber: number;
  visible: boolean;
  placement: 'outside-bottom';
};

export type DocumentPage = {
  kind: 'document';
  id: string;
  name: string;
  size: DocumentPageSize;
  margins: DocumentPageMargins;
  titleContent: DocumentContentJson;
  bodyContent: DocumentContentJson;
  columnCount: 1 | 2 | 3;
  columnGapPx: number;
  language?: string;
  dropCap: DocumentDropCapSettings;
  /** Pages such as historical article continuations may intentionally omit a title region. */
  suppressTitle?: boolean;
  suppressFolio: boolean;
  overlayObjects: DocumentOverlayImage[];
  imageGroups: DocumentImageGroup[];
  reference?: ScanReference;
};
