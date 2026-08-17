import {
  Extension,
  Node,
  mergeAttributes,
  type Editor,
} from '@tiptap/core';
import { Fragment, type DOMOutputSpec } from '@tiptap/pm/model';
import {
  NodeSelection,
  type EditorState,
} from '@tiptap/pm/state';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { DocumentImageNodeView } from '../components/DocumentImageNodeView';
import {
  DEFAULT_DOCUMENT_IMAGE_WRAP_PADDING_PX,
  normalizeDocumentFlowImageWrap,
  normalizeDocumentImageCropMode,
  normalizeDocumentImageFocal,
  normalizeDocumentImageGeometry,
  normalizeDocumentImageVerticalAnchor as normalizeProjectDocumentImageVerticalAnchor,
} from '../types/documentProject';
import type {
  DocumentCaptionAlignment,
  DocumentCaptionItalic,
  DocumentCaptionSpacing,
  DocumentImageCoordinateSpace,
  DocumentImageCropMode,
  DocumentImageVerticalAnchor as ProjectDocumentImageVerticalAnchor,
} from '../types/documentProject';

export type {
  DocumentCaptionAlignment,
  DocumentCaptionItalic,
  DocumentCaptionSpacing,
  DocumentImageCoordinateSpace,
} from '../types/documentProject';

export const DOCUMENT_IMAGE_NODE_NAMES = [
  'documentInlineImage',
  'documentFlowImage',
] as const;

export type DocumentImageNodeName =
  typeof DOCUMENT_IMAGE_NODE_NAMES[number];

/**
 * Returns every persistent document image position for an ID in the current
 * editor state. Callers that need selection authority should use
 * `findDocumentImagePositionById`, which rejects duplicate IDs.
 */
export const findDocumentImagePositions = (
  editor: Editor,
  imageId: string,
  nodeType?: DocumentImageNodeName
) => {
  const positions: number[] = [];
  if (editor.isDestroyed || !imageId) return positions;
  editor.state.doc.descendants((node, position) => {
    const isDocumentImage = DOCUMENT_IMAGE_NODE_NAMES.includes(
      node.type.name as DocumentImageNodeName
    );
    if (
      isDocumentImage
      && (!nodeType || node.type.name === nodeType)
      && node.attrs.id === imageId
    ) {
      positions.push(position);
    }
    return true;
  });
  return positions;
};

/**
 * Resolves a document image position from its persistent ID in the current
 * ProseMirror document. A cached visual position is intentionally not part of
 * this API: IDs are authoritative and duplicate/ambiguous IDs fail closed.
 */
export const findDocumentImagePositionById = (
  editor: Editor,
  imageId: string,
  expectedNodeType?: DocumentImageNodeName
): number | null => {
  const positions = findDocumentImagePositions(editor, imageId);
  if (positions.length !== 1) return null;
  const position = positions[0];
  const node = editor.state.doc.nodeAt(position);
  if (
    !node
    || !DOCUMENT_IMAGE_NODE_NAMES.includes(
      node.type.name as DocumentImageNodeName
    )
    || node.attrs.id !== imageId
    || (expectedNodeType && node.type.name !== expectedNodeType)
  ) {
    return null;
  }
  return position;
};

/**
 * Selects exactly one current document image by persistent ID and verifies
 * the resulting NodeSelection before reporting success.
 */
export const selectDocumentImageById = (
  editor: Editor,
  imageId: string,
  expectedNodeType?: DocumentImageNodeName
): number | null => {
  const position = findDocumentImagePositionById(
    editor,
    imageId,
    expectedNodeType
  );
  if (position === null || editor.isDestroyed) return null;
  const node = editor.state.doc.nodeAt(position);
  if (!node) return null;
  try {
    editor.view.dispatch(
      editor.state.tr.setSelection(
        NodeSelection.create(editor.state.doc, position)
      )
    );
  } catch {
    return null;
  }
  const selection = editor.state.selection;
  if (
    !(selection instanceof NodeSelection)
    || selection.from !== position
    || selection.node.attrs.id !== imageId
    || selection.node.type.name !== node.type.name
  ) {
    return null;
  }
  return position;
};

export type DocumentImageMoveDirection = 'earlier' | 'later';

export type DocumentImageWrap =
  | 'inline'
  | 'float-left'
  | 'float-right'
  | 'top-bottom'
  | 'span-columns';

export type DocumentImageVerticalAnchor =
  ProjectDocumentImageVerticalAnchor;
export type DocumentImageHorizontalPlacement =
  | 'left'
  | 'center'
  | 'right'
  | 'custom';

export interface DocumentImageAttributes {
  id: string;
  assetId: string;
  altText: string;
  widthPx: number;
  heightPx: number;
  naturalWidth: number;
  naturalHeight: number;
  wrap: DocumentImageWrap;
  spanCount: 1 | 2 | 3;
  spanStartColumn: 1 | 2 | 3;
  wrapPaddingTopPx: number;
  wrapPaddingRightPx: number;
  wrapPaddingBottomPx: number;
  wrapPaddingLeftPx: number;
  coordinateSpace: DocumentImageCoordinateSpace;
  /**
   * @deprecated Runtime compatibility alias for adapters that have not yet
   * moved to four-sided padding. It is derived from left/right canonical
   * padding and is not emitted by project or HTML serialization.
   */
  wrapPaddingPx: number;
  /**
   * @deprecated Runtime compatibility alias derived from top/bottom canonical
   * padding. It is not emitted by project or HTML serialization.
   */
  verticalSpacingPx: number;
  verticalAnchor: DocumentImageVerticalAnchor;
  yPx: number;
  horizontalPlacement: DocumentImageHorizontalPlacement;
  xOffsetPx: number;
  caption: string;
  captionAlignment: DocumentCaptionAlignment;
  captionItalic: DocumentCaptionItalic;
  captionSpacingPx: DocumentCaptionSpacing;
  cropMode: DocumentImageCropMode;
  cropFocalX: number;
  cropFocalY: number;
}

export interface DocumentImageReplaceRequest {
  editor: Editor;
  position: number | undefined;
  nodeType: DocumentImageNodeName;
  attributes: DocumentImageAttributes;
}

export interface DocumentImageExtensionOptions {
  resolveAssetSource: (assetId: string) => string | undefined;
  onRequestReplace?: (request: DocumentImageReplaceRequest) => void;
  onCommittedImageLayout?: (imageId: string) => void;
  onSelectImage?: (request: {
    editor: Editor;
    position: number | undefined;
    imageId: string;
    additive: boolean;
  }) => string | null | undefined;
  isImageSelected?: (imageId: string) => boolean;
  getViewScale: () => number;
  minWidthPx: number;
  maxWidthPx: number;
  maxSpanWidthPx: number;
  getSpanWidthPx: (spanCount: 1 | 2 | 3) => number;
}

export type InsertDocumentImageAttributes =
  Partial<DocumentImageAttributes>
  & Pick<DocumentImageAttributes, 'id' | 'assetId'>;

export const canMoveSelectedStructuredImage = (
  state: EditorState,
  direction: DocumentImageMoveDirection
): boolean => {
  const { selection, doc } = state;
  if (
    !(selection instanceof NodeSelection)
    || selection.node.type.name !== 'documentFlowImage'
    || selection.node.attrs.wrap !== 'span-columns'
    || selection.$from.depth !== 0
  ) {
    return false;
  }
  if (direction === 'earlier') return selection.from > 0;
  if (selection.to >= doc.content.size) return false;
  const next = doc.childAfter(selection.to);
  const isTrailingCursorParagraph =
    next.node?.type.name === 'paragraph'
    && next.node.content.size === 0
    && next.offset + next.node.nodeSize === doc.content.size;
  return !!next.node && !isTrailingCursorParagraph;
};

const DEFAULT_IMAGE_ATTRIBUTES: DocumentImageAttributes = {
  id: '',
  assetId: '',
  altText: '',
  widthPx: 240,
  heightPx: 160,
  naturalWidth: 240,
  naturalHeight: 160,
  wrap: 'float-left',
  spanCount: 1,
  spanStartColumn: 1,
  wrapPaddingTopPx: 0,
  wrapPaddingRightPx: DEFAULT_DOCUMENT_IMAGE_WRAP_PADDING_PX,
  wrapPaddingBottomPx: DEFAULT_DOCUMENT_IMAGE_WRAP_PADDING_PX,
  wrapPaddingLeftPx: 0,
  coordinateSpace: 'flow',
  wrapPaddingPx: DEFAULT_DOCUMENT_IMAGE_WRAP_PADDING_PX,
  verticalSpacingPx: DEFAULT_DOCUMENT_IMAGE_WRAP_PADDING_PX,
  verticalAnchor: 'flow',
  yPx: 0,
  horizontalPlacement: 'left',
  xOffsetPx: 0,
  caption: '',
  captionAlignment: 'inherit',
  captionItalic: 'inherit',
  captionSpacingPx: 'inherit',
  cropMode: 'fit',
  cropFocalX: 0.5,
  cropFocalY: 0.5,
};

const DOCUMENT_IMAGE_HORIZONTAL_PLACEMENTS =
  new Set<DocumentImageHorizontalPlacement>([
    'left',
    'center',
    'right',
    'custom',
  ]);
const DOCUMENT_CAPTION_ALIGNMENTS = new Set<DocumentCaptionAlignment>([
  'inherit',
  'left',
  'center',
  'right',
]);

const numericAttribute = (
  value: unknown,
  fallback: number,
  minimum = 0,
  maximum = 100_000
) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.round(numeric)));
};

const nonNegativeNumberAttribute = (
  value: unknown,
  fallback = 0
) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : fallback;
};

const spanAttribute = (
  value: unknown,
  fallback: 1 | 2 | 3
): 1 | 2 | 3 => {
  const numeric = Number(value);
  return numeric === 2 || numeric === 3 ? numeric : fallback;
};

export const normalizeDocumentImageWrap = (
  value: unknown,
  fallback: DocumentImageWrap = 'float-left'
): DocumentImageWrap => normalizeDocumentFlowImageWrap(value, fallback);

export const normalizeDocumentImageVerticalAnchor = (
  value: unknown
): DocumentImageVerticalAnchor =>
  normalizeProjectDocumentImageVerticalAnchor(value);

export const normalizeDocumentImageHorizontalPlacement = (
  value: unknown
): DocumentImageHorizontalPlacement =>
  typeof value === 'string'
  && DOCUMENT_IMAGE_HORIZONTAL_PLACEMENTS.has(
    value as DocumentImageHorizontalPlacement
  )
    ? value as DocumentImageHorizontalPlacement
    : 'left';

export const normalizeDocumentCaptionAlignment = (
  value: unknown
): DocumentCaptionAlignment =>
  typeof value === 'string'
  && DOCUMENT_CAPTION_ALIGNMENTS.has(value as DocumentCaptionAlignment)
    ? value as DocumentCaptionAlignment
    : DEFAULT_IMAGE_ATTRIBUTES.captionAlignment;

export const normalizeDocumentCaptionItalic = (
  value: unknown
): DocumentCaptionItalic => (
  value === true || value === 'true'
    ? true
    : value === false || value === 'false'
      ? false
      : value === 'inherit'
        ? 'inherit'
        : DEFAULT_IMAGE_ATTRIBUTES.captionItalic
);

export const normalizeDocumentCaptionSpacing = (
  value: unknown
): DocumentCaptionSpacing => {
  if (value === 'inherit' || value === undefined || value === null) {
    return DEFAULT_IMAGE_ATTRIBUTES.captionSpacingPx;
  }
  return numericAttribute(value, 5, 0, 96);
};

export const clampDocumentImageXOffset = (
  value: unknown,
  spanWidthPx: number,
  imageWidthPx: number
) => {
  const maximum = Math.max(
    0,
    (Number.isFinite(spanWidthPx) ? spanWidthPx : 0)
    - (Number.isFinite(imageWidthPx) ? imageWidthPx : 0)
  );
  const numeric = Number(value);
  return Math.min(maximum, Math.max(0, Number.isFinite(numeric) ? numeric : 0));
};

export const calculateDocumentImageXOffset = ({
  placement,
  xOffsetPx,
  spanWidthPx,
  imageWidthPx,
}: {
  placement: DocumentImageHorizontalPlacement;
  xOffsetPx: number;
  spanWidthPx: number;
  imageWidthPx: number;
}) => {
  const maximum = Math.max(0, spanWidthPx - imageWidthPx);
  if (placement === 'center') return maximum / 2;
  if (placement === 'right') return maximum;
  if (placement === 'custom') {
    return clampDocumentImageXOffset(xOffsetPx, spanWidthPx, imageWidthPx);
  }
  return 0;
};

export const getDocumentImageAspectRatio = (
  attributes: Pick<
    DocumentImageAttributes,
    'naturalWidth' | 'naturalHeight' | 'widthPx' | 'heightPx'
  >
) => (
  attributes.naturalWidth > 0 && attributes.naturalHeight > 0
    ? attributes.naturalWidth / attributes.naturalHeight
    : attributes.widthPx / Math.max(1, attributes.heightPx)
);

export const calculateDocumentImageHeight = (
  widthPx: number,
  aspectRatio: number
) => Math.max(
  1,
  Math.round(
    Math.max(1, Number.isFinite(widthPx) ? widthPx : 1)
    / Math.max(0.0001, Number.isFinite(aspectRatio) ? aspectRatio : 1)
  )
);

export const calculateDocumentImageFrameHeight = (
  attributes: Pick<
    DocumentImageAttributes,
    'cropMode' | 'heightPx' | 'naturalWidth' | 'naturalHeight'
  >,
  widthPx: number
) => attributes.cropMode === 'fill'
  ? Math.max(1, Number.isFinite(attributes.heightPx) ? attributes.heightPx : 1)
  : Math.max(
      1,
      Math.max(1, Number.isFinite(widthPx) ? widthPx : 1)
      / Math.max(
        0.0001,
        attributes.naturalWidth / Math.max(1, attributes.naturalHeight)
      )
    );

export const getDocumentImageSpanDimensions = (
  attributes: Pick<
    DocumentImageAttributes,
    'widthPx' | 'heightPx' | 'cropMode' | 'naturalWidth' | 'naturalHeight'
  >,
  spanWidthPx: number
) => {
  const currentWidthPx = Math.max(
    1,
    Number.isFinite(attributes.widthPx) ? attributes.widthPx : 1
  );
  const maximumWidthPx = Math.max(
    1,
    Number.isFinite(spanWidthPx) ? spanWidthPx : 1
  );
  const widthPx = Math.min(currentWidthPx, maximumWidthPx);
  return {
    widthPx,
    heightPx: widthPx < currentWidthPx
      && attributes.cropMode === 'fit'
      ? calculateDocumentImageFrameHeight(attributes, widthPx)
      : Math.max(
          1,
          Number.isFinite(attributes.heightPx) ? attributes.heightPx : 1
        ),
  };
};

export const clampDocumentImageWidth = (
  value: unknown,
  minimumWidthPx: number,
  maximumWidthPx: number,
  fallbackWidthPx: number
) => {
  const minimum = Math.max(
    1,
    Number.isFinite(minimumWidthPx) ? minimumWidthPx : 48
  );
  const maximum = Math.max(
    minimum,
    Number.isFinite(maximumWidthPx) ? maximumWidthPx : minimum
  );
  const numeric = Number(value);
  const requested = Number.isFinite(numeric) ? numeric : fallbackWidthPx;
  return Math.min(maximum, Math.max(minimum, requested));
};

export const calculateDocumentImageResizeWidth = ({
  startWidthPx,
  pointerDeltaX,
  viewScale,
  minimumWidthPx,
  maximumWidthPx,
}: {
  startWidthPx: number;
  pointerDeltaX: number;
  viewScale: number;
  minimumWidthPx: number;
  maximumWidthPx: number;
}) => {
  const scale = Math.max(
    0.05,
    Number.isFinite(viewScale) ? viewScale : 1
  );
  return clampDocumentImageWidth(
    startWidthPx + pointerDeltaX / scale,
    minimumWidthPx,
    maximumWidthPx,
    startWidthPx
  );
};

export const clampDocumentImageY = (
  value: unknown,
  availableHeightPx: number,
  imageRegionHeightPx: number,
  verticalSpacingPx = 0
) => {
  const available = Math.max(0, Number.isFinite(availableHeightPx)
    ? availableHeightPx
    : 0);
  const region = Math.max(0, Number.isFinite(imageRegionHeightPx)
    ? imageRegionHeightPx
    : 0);
  const spacing = Math.max(0, Number.isFinite(verticalSpacingPx)
    ? verticalSpacingPx
    : 0);
  const maximum = Math.max(spacing, available - region - spacing);
  const numeric = Number(value);
  const requested = Number.isFinite(numeric) ? numeric : spacing;
  return Math.min(maximum, Math.max(spacing, requested));
};

export const calculateDocumentImageDragY = ({
  startY,
  pointerDeltaY,
  viewScale,
  availableHeightPx,
  imageRegionHeightPx,
  verticalSpacingPx,
}: {
  startY: number;
  pointerDeltaY: number;
  viewScale: number;
  availableHeightPx: number;
  imageRegionHeightPx: number;
  verticalSpacingPx: number;
}) => {
  const scale = Math.max(
    0.05,
    Number.isFinite(viewScale) ? viewScale : 1
  );
  return clampDocumentImageY(
    startY + pointerDeltaY / scale,
    availableHeightPx,
    imageRegionHeightPx,
    verticalSpacingPx
  );
};

const getDocumentImageCompatibilityWrapPadding = (
  geometry: ReturnType<typeof normalizeDocumentImageGeometry>
) => geometry.wrap === 'span-columns'
  ? Math.max(
      geometry.wrapPaddingLeftPx,
      geometry.wrapPaddingRightPx
    )
  : geometry.wrap === 'float-left'
    ? Math.max(
        geometry.wrapPaddingRightPx,
        geometry.wrapPaddingBottomPx
      )
    : geometry.wrap === 'float-right'
      ? Math.max(
          geometry.wrapPaddingLeftPx,
          geometry.wrapPaddingBottomPx
        )
      : geometry.wrap === 'top-bottom'
        ? Math.max(
            geometry.wrapPaddingTopPx,
            geometry.wrapPaddingBottomPx
          )
        : Math.max(
            geometry.wrapPaddingTopPx,
            geometry.wrapPaddingRightPx,
            geometry.wrapPaddingBottomPx,
            geometry.wrapPaddingLeftPx
          );

export const normalizeDocumentImageAttributes = (
  value: Partial<DocumentImageAttributes>,
  fallbackWrap: DocumentImageWrap = 'float-left'
): DocumentImageAttributes => {
  const geometry = normalizeDocumentImageGeometry(
    value as Record<string, unknown>,
    fallbackWrap
  );
  const naturalWidth = numericAttribute(
    value.naturalWidth,
    DEFAULT_IMAGE_ATTRIBUTES.naturalWidth,
    1
  );
  const naturalHeight = numericAttribute(
    value.naturalHeight,
    DEFAULT_IMAGE_ATTRIBUTES.naturalHeight,
    1
  );
  const widthPx = numericAttribute(
    value.widthPx,
    Math.min(320, naturalWidth),
    32
  );
  const ratio = naturalWidth / naturalHeight;
  const heightPx = numericAttribute(
    value.heightPx,
    Math.max(1, Math.round(widthPx / ratio)),
    1
  );

  return {
    id: typeof value.id === 'string' ? value.id : '',
    assetId: typeof value.assetId === 'string' ? value.assetId : '',
    altText: typeof value.altText === 'string' ? value.altText : '',
    widthPx,
    heightPx,
    naturalWidth,
    naturalHeight,
    wrap: geometry.wrap,
    spanCount: spanAttribute(value.spanCount, 1),
    spanStartColumn: spanAttribute(value.spanStartColumn, 1),
    wrapPaddingTopPx: geometry.wrapPaddingTopPx,
    wrapPaddingRightPx: geometry.wrapPaddingRightPx,
    wrapPaddingBottomPx: geometry.wrapPaddingBottomPx,
    wrapPaddingLeftPx: geometry.wrapPaddingLeftPx,
    coordinateSpace: geometry.coordinateSpace,
    wrapPaddingPx: getDocumentImageCompatibilityWrapPadding(geometry),
    verticalSpacingPx: Math.max(
      geometry.wrapPaddingTopPx,
      geometry.wrapPaddingBottomPx
    ),
    verticalAnchor: geometry.verticalAnchor,
    yPx: numericAttribute(value.yPx, DEFAULT_IMAGE_ATTRIBUTES.yPx, 0),
    horizontalPlacement: normalizeDocumentImageHorizontalPlacement(
      value.horizontalPlacement
    ),
    xOffsetPx: nonNegativeNumberAttribute(
      value.xOffsetPx,
      DEFAULT_IMAGE_ATTRIBUTES.xOffsetPx
    ),
    caption: typeof value.caption === 'string' ? value.caption : '',
    captionAlignment: normalizeDocumentCaptionAlignment(
      value.captionAlignment
    ),
    captionItalic: normalizeDocumentCaptionItalic(value.captionItalic),
    captionSpacingPx: normalizeDocumentCaptionSpacing(
      value.captionSpacingPx
    ),
    cropMode: normalizeDocumentImageCropMode(value.cropMode),
    cropFocalX: normalizeDocumentImageFocal(value.cropFocalX),
    cropFocalY: normalizeDocumentImageFocal(value.cropFocalY),
  };
};

export const normalizeDocumentImageSpanForColumnCount = (
  value: Partial<DocumentImageAttributes>,
  columnCount: 1 | 2 | 3
): DocumentImageAttributes => {
  const attributes = normalizeDocumentImageAttributes(value);
  if (attributes.wrap !== 'span-columns') return attributes;
  if (columnCount === 1) {
    return {
      ...attributes,
      wrap: 'top-bottom',
      spanCount: 1,
      spanStartColumn: 1,
    };
  }
  if (columnCount === 2) {
    return {
      ...attributes,
      spanCount: 2,
      spanStartColumn: 1,
    };
  }
  const spanCount = attributes.spanCount === 3 ? 3 : 2;
  return {
    ...attributes,
    spanCount,
    spanStartColumn:
      spanCount === 3
        ? 1
        : attributes.spanStartColumn === 2 ? 2 : 1,
  };
};

const getDataNumber = (
  element: HTMLElement,
  attributeName: string,
  fallback: number
) => numericAttribute(element.getAttribute(attributeName), fallback);

const getImageElement = (element: HTMLElement) =>
  element.matches('img') ? element : element.querySelector('img');

const getDocumentImageGeometryFromElement = (
  element: HTMLElement,
  defaultWrap: DocumentImageWrap
) => normalizeDocumentImageGeometry({
  wrap: element.getAttribute('data-wrap'),
  verticalAnchor: element.getAttribute('data-vertical-anchor'),
  coordinateSpace: element.getAttribute('data-coordinate-space'),
  wrapPaddingTopPx: element.getAttribute('data-wrap-padding-top-px'),
  wrapPaddingRightPx: element.getAttribute('data-wrap-padding-right-px'),
  wrapPaddingBottomPx: element.getAttribute('data-wrap-padding-bottom-px'),
  wrapPaddingLeftPx: element.getAttribute('data-wrap-padding-left-px'),
  wrapPaddingPx: element.getAttribute('data-wrap-padding-px'),
  verticalSpacingPx: element.getAttribute('data-vertical-spacing-px'),
}, defaultWrap);

type DocumentImageWrapPaddingAttribute =
  | 'wrapPaddingTopPx'
  | 'wrapPaddingRightPx'
  | 'wrapPaddingBottomPx'
  | 'wrapPaddingLeftPx';

const createDocumentImageWrapPaddingAttribute = (
  defaultWrap: DocumentImageWrap,
  key: DocumentImageWrapPaddingAttribute,
  htmlAttribute: string,
  cssProperty: string,
  includeCompatibilityCssAlias = false
) => ({
  default: null,
  parseHTML: (element: HTMLElement) =>
    getDocumentImageGeometryFromElement(element, defaultWrap)[key],
  renderHTML: (attributes: Record<string, unknown>) => {
    const geometry = normalizeDocumentImageGeometry(
      attributes,
      defaultWrap
    );
    const padding = geometry[key];
    return {
      [htmlAttribute]: String(padding),
      style: [
        `${cssProperty}: ${padding}px`,
        includeCompatibilityCssAlias
          ? `--document-image-wrap-padding: ${
              getDocumentImageCompatibilityWrapPadding(geometry)
            }px`
          : null,
      ].filter((value): value is string => value !== null).join('; '),
    };
  },
});

const createDocumentImageAttributes = (
  defaultWrap: DocumentImageWrap
) => ({
  id: {
    default: '',
    parseHTML: (element: HTMLElement) =>
      element.getAttribute('data-image-id') || '',
    renderHTML: (attributes: Record<string, unknown>) => ({
      'data-image-id': String(attributes.id || ''),
    }),
  },
  assetId: {
    default: '',
    parseHTML: (element: HTMLElement) =>
      element.getAttribute('data-asset-id') || '',
    renderHTML: (attributes: Record<string, unknown>) => ({
      'data-asset-id': String(attributes.assetId || ''),
    }),
  },
  altText: {
    default: '',
    parseHTML: (element: HTMLElement) =>
      getImageElement(element)?.getAttribute('alt') || '',
    renderHTML: () => ({}),
  },
  widthPx: {
    default: DEFAULT_IMAGE_ATTRIBUTES.widthPx,
    parseHTML: (element: HTMLElement) =>
      getDataNumber(
        element,
        'data-width-px',
        DEFAULT_IMAGE_ATTRIBUTES.widthPx
      ),
    renderHTML: (attributes: Record<string, unknown>) => {
      const widthPx = numericAttribute(
        attributes.widthPx,
        DEFAULT_IMAGE_ATTRIBUTES.widthPx,
        32
      );
      return {
        'data-width-px': String(widthPx),
        style: `--document-image-width: ${widthPx}px`,
      };
    },
  },
  heightPx: {
    default: DEFAULT_IMAGE_ATTRIBUTES.heightPx,
    parseHTML: (element: HTMLElement) =>
      getDataNumber(
        element,
        'data-height-px',
        DEFAULT_IMAGE_ATTRIBUTES.heightPx
      ),
    renderHTML: (attributes: Record<string, unknown>) => {
      const heightPx = numericAttribute(
        attributes.heightPx,
        DEFAULT_IMAGE_ATTRIBUTES.heightPx,
        1
      );
      return {
        'data-height-px': String(heightPx),
        style: `--document-image-height: ${heightPx}px`,
      };
    },
  },
  naturalWidth: {
    default: DEFAULT_IMAGE_ATTRIBUTES.naturalWidth,
    parseHTML: (element: HTMLElement) =>
      getDataNumber(
        element,
        'data-natural-width',
        DEFAULT_IMAGE_ATTRIBUTES.naturalWidth
      ),
    renderHTML: (attributes: Record<string, unknown>) => ({
      'data-natural-width': String(
        numericAttribute(
          attributes.naturalWidth,
          DEFAULT_IMAGE_ATTRIBUTES.naturalWidth,
          1
        )
      ),
    }),
  },
  naturalHeight: {
    default: DEFAULT_IMAGE_ATTRIBUTES.naturalHeight,
    parseHTML: (element: HTMLElement) =>
      getDataNumber(
        element,
        'data-natural-height',
        DEFAULT_IMAGE_ATTRIBUTES.naturalHeight
      ),
    renderHTML: (attributes: Record<string, unknown>) => ({
      'data-natural-height': String(
        numericAttribute(
          attributes.naturalHeight,
          DEFAULT_IMAGE_ATTRIBUTES.naturalHeight,
          1
        )
      ),
    }),
  },
  wrap: {
    default: defaultWrap,
    parseHTML: (element: HTMLElement) =>
      normalizeDocumentImageWrap(
        element.getAttribute('data-wrap'),
        defaultWrap
      ),
    renderHTML: (attributes: Record<string, unknown>) => ({
      'data-wrap': normalizeDocumentImageWrap(attributes.wrap, defaultWrap),
    }),
  },
  wrapPaddingTopPx: createDocumentImageWrapPaddingAttribute(
    defaultWrap,
    'wrapPaddingTopPx',
    'data-wrap-padding-top-px',
    '--document-image-wrap-padding-top'
  ),
  wrapPaddingRightPx: createDocumentImageWrapPaddingAttribute(
    defaultWrap,
    'wrapPaddingRightPx',
    'data-wrap-padding-right-px',
    '--document-image-wrap-padding-right'
  ),
  wrapPaddingBottomPx: createDocumentImageWrapPaddingAttribute(
    defaultWrap,
    'wrapPaddingBottomPx',
    'data-wrap-padding-bottom-px',
    '--document-image-wrap-padding-bottom'
  ),
  wrapPaddingLeftPx: createDocumentImageWrapPaddingAttribute(
    defaultWrap,
    'wrapPaddingLeftPx',
    'data-wrap-padding-left-px',
    '--document-image-wrap-padding-left',
    true
  ),
  coordinateSpace: {
    default: null,
    parseHTML: (element: HTMLElement) =>
      getDocumentImageGeometryFromElement(
        element,
        defaultWrap
      ).coordinateSpace,
    renderHTML: (attributes: Record<string, unknown>) => ({
      'data-coordinate-space': normalizeDocumentImageGeometry(
        attributes,
        defaultWrap
      ).coordinateSpace,
    }),
  },
  // Parse-only runtime aliases retain direct v2 Tiptap JSON compatibility.
  // Project and HTML serializers intentionally emit only canonical v3 attrs.
  wrapPaddingPx: {
    default: DEFAULT_IMAGE_ATTRIBUTES.wrapPaddingPx,
    parseHTML: (element: HTMLElement) => {
      const value = element.getAttribute('data-wrap-padding-px');
      return value === null
        ? null
        : numericAttribute(
            value,
            DEFAULT_IMAGE_ATTRIBUTES.wrapPaddingPx,
            0,
            96
          );
    },
    renderHTML: () => ({}),
  },
  spanCount: {
    default: DEFAULT_IMAGE_ATTRIBUTES.spanCount,
    parseHTML: (element: HTMLElement) =>
      spanAttribute(
        element.getAttribute('data-span-count'),
        DEFAULT_IMAGE_ATTRIBUTES.spanCount
      ),
    renderHTML: (attributes: Record<string, unknown>) => ({
      'data-span-count': String(
        spanAttribute(
          attributes.spanCount,
          DEFAULT_IMAGE_ATTRIBUTES.spanCount
        )
      ),
    }),
  },
  spanStartColumn: {
    default: DEFAULT_IMAGE_ATTRIBUTES.spanStartColumn,
    parseHTML: (element: HTMLElement) =>
      spanAttribute(
        element.getAttribute('data-span-start-column'),
        DEFAULT_IMAGE_ATTRIBUTES.spanStartColumn
      ),
    renderHTML: (attributes: Record<string, unknown>) => ({
      'data-span-start-column': String(
        spanAttribute(
          attributes.spanStartColumn,
          DEFAULT_IMAGE_ATTRIBUTES.spanStartColumn
        )
      ),
    }),
  },
  verticalSpacingPx: {
    default: DEFAULT_IMAGE_ATTRIBUTES.verticalSpacingPx,
    parseHTML: (element: HTMLElement) => {
      const value = element.getAttribute('data-vertical-spacing-px');
      return value === null
        ? null
        : numericAttribute(
            value,
            DEFAULT_IMAGE_ATTRIBUTES.verticalSpacingPx,
            0,
            96
          );
    },
    renderHTML: () => ({}),
  },
  verticalAnchor: {
    default: DEFAULT_IMAGE_ATTRIBUTES.verticalAnchor,
    parseHTML: (element: HTMLElement) =>
      normalizeDocumentImageVerticalAnchor(
        element.getAttribute('data-vertical-anchor')
      ),
    renderHTML: (attributes: Record<string, unknown>) => ({
      'data-vertical-anchor': normalizeDocumentImageVerticalAnchor(
        attributes.verticalAnchor
      ),
    }),
  },
  yPx: {
    default: DEFAULT_IMAGE_ATTRIBUTES.yPx,
    parseHTML: (element: HTMLElement) =>
      getDataNumber(element, 'data-y-px', DEFAULT_IMAGE_ATTRIBUTES.yPx),
    renderHTML: (attributes: Record<string, unknown>) => ({
      'data-y-px': String(
        numericAttribute(attributes.yPx, DEFAULT_IMAGE_ATTRIBUTES.yPx, 0)
      ),
    }),
  },
  horizontalPlacement: {
    default: DEFAULT_IMAGE_ATTRIBUTES.horizontalPlacement,
    parseHTML: (element: HTMLElement) =>
      normalizeDocumentImageHorizontalPlacement(
        element.getAttribute('data-horizontal-placement')
      ),
    renderHTML: (attributes: Record<string, unknown>) => ({
      'data-horizontal-placement':
        normalizeDocumentImageHorizontalPlacement(
          attributes.horizontalPlacement
        ),
    }),
  },
  xOffsetPx: {
    default: DEFAULT_IMAGE_ATTRIBUTES.xOffsetPx,
    parseHTML: (element: HTMLElement) =>
      getDataNumber(
        element,
        'data-x-offset-px',
        DEFAULT_IMAGE_ATTRIBUTES.xOffsetPx
      ),
    renderHTML: (attributes: Record<string, unknown>) => ({
      'data-x-offset-px': String(
        nonNegativeNumberAttribute(
          attributes.xOffsetPx,
          DEFAULT_IMAGE_ATTRIBUTES.xOffsetPx
        )
      ),
    }),
  },
  cropMode: {
    default: DEFAULT_IMAGE_ATTRIBUTES.cropMode,
    parseHTML: (element: HTMLElement) => normalizeDocumentImageCropMode(
      element.getAttribute('data-crop-mode')
    ),
    renderHTML: (attributes: Record<string, unknown>) => ({
      'data-crop-mode': normalizeDocumentImageCropMode(attributes.cropMode),
    }),
  },
  cropFocalX: {
    default: DEFAULT_IMAGE_ATTRIBUTES.cropFocalX,
    parseHTML: (element: HTMLElement) => normalizeDocumentImageFocal(
      element.getAttribute('data-crop-focal-x')
    ),
    renderHTML: (attributes: Record<string, unknown>) => ({
      'data-crop-focal-x': String(normalizeDocumentImageFocal(
        attributes.cropFocalX
      )),
    }),
  },
  cropFocalY: {
    default: DEFAULT_IMAGE_ATTRIBUTES.cropFocalY,
    parseHTML: (element: HTMLElement) => normalizeDocumentImageFocal(
      element.getAttribute('data-crop-focal-y')
    ),
    renderHTML: (attributes: Record<string, unknown>) => ({
      'data-crop-focal-y': String(normalizeDocumentImageFocal(
        attributes.cropFocalY
      )),
    }),
  },
  caption: {
    default: '',
    parseHTML: (element: HTMLElement) =>
      element.querySelector('.document-image__caption')?.textContent || '',
    renderHTML: () => ({}),
  },
  captionAlignment: {
    default: DEFAULT_IMAGE_ATTRIBUTES.captionAlignment,
    parseHTML: (element: HTMLElement) =>
      normalizeDocumentCaptionAlignment(
        element.getAttribute('data-caption-alignment')
      ),
    renderHTML: (attributes: Record<string, unknown>) => ({
      'data-caption-alignment': normalizeDocumentCaptionAlignment(
        attributes.captionAlignment
      ),
    }),
  },
  captionItalic: {
    default: DEFAULT_IMAGE_ATTRIBUTES.captionItalic,
    parseHTML: (element: HTMLElement) =>
      normalizeDocumentCaptionItalic(
        element.getAttribute('data-caption-italic')
      ),
    renderHTML: (attributes: Record<string, unknown>) => ({
      'data-caption-italic': String(
        normalizeDocumentCaptionItalic(attributes.captionItalic)
      ),
    }),
  },
  captionSpacingPx: {
    default: DEFAULT_IMAGE_ATTRIBUTES.captionSpacingPx,
    parseHTML: (element: HTMLElement) =>
      normalizeDocumentCaptionSpacing(
        element.getAttribute('data-caption-spacing-px')
      ),
    renderHTML: (attributes: Record<string, unknown>) => {
      const spacing = normalizeDocumentCaptionSpacing(
        attributes.captionSpacingPx
      );
      return {
        'data-caption-spacing-px': String(spacing),
      };
    },
  },
});

const getDefaultOptions = (): DocumentImageExtensionOptions => ({
  resolveAssetSource: () => undefined,
  getViewScale: () => 1,
  minWidthPx: 48,
  maxWidthPx: 720,
  maxSpanWidthPx: 720,
  getSpanWidthPx: () => 720,
});

const getCropStyle = (
  attributes: DocumentImageAttributes
) => [
  `object-fit: ${attributes.cropMode === 'fill' ? 'cover' : 'contain'}`,
  `object-position: ${attributes.cropFocalX * 100}% ${attributes.cropFocalY * 100}%`,
].join('; ');

const renderImageHtml = (
  nodeAttributes: Partial<DocumentImageAttributes>,
  htmlAttributes: Record<string, unknown>,
  options: DocumentImageExtensionOptions,
  isInline: boolean
): DOMOutputSpec => {
  const attributes = normalizeDocumentImageAttributes(
    nodeAttributes,
    isInline ? 'inline' : 'float-left'
  );
  const source = options.resolveAssetSource(attributes.assetId) || '';
  const image: DOMOutputSpec = [
    'img',
    {
      class: 'document-image__media',
      src: source,
      alt: attributes.altText,
      width: attributes.widthPx,
      height: attributes.heightPx,
      draggable: 'false',
      'data-natural-width': String(attributes.naturalWidth),
      'data-natural-height': String(attributes.naturalHeight),
      style: getCropStyle(attributes),
    },
  ];
  const frame: DOMOutputSpec = [
    'div',
    {
      class: 'document-image__frame',
      'data-document-image-frame': 'true',
      'data-crop-mode': attributes.cropMode,
      'data-crop-focal-x': String(attributes.cropFocalX),
      'data-crop-focal-y': String(attributes.cropFocalY),
      style: `width: ${attributes.widthPx}px; height: ${calculateDocumentImageFrameHeight(
        attributes,
        attributes.widthPx
      )}px`,
    },
    image,
  ];
  const caption: DOMOutputSpec | null = attributes.caption
    ? (() => {
        const captionStyles = [
          attributes.captionAlignment === 'inherit'
            ? null
            : `--document-caption-alignment: ${attributes.captionAlignment}`,
          attributes.captionItalic === 'inherit'
            ? null
            : `--document-caption-font-style: ${
                attributes.captionItalic ? 'italic' : 'normal'
              }`,
          attributes.captionSpacingPx === 'inherit'
            ? null
            : `--document-caption-spacing: ${
                attributes.captionSpacingPx
              }px`,
        ].filter((value): value is string => value !== null);
        return [
          isInline ? 'span' : 'figcaption',
          {
            class: 'document-image__caption',
            'data-caption-alignment': attributes.captionAlignment,
            'data-caption-italic': String(attributes.captionItalic),
            'data-caption-spacing-px': String(attributes.captionSpacingPx),
            ...(captionStyles.length > 0
              ? { style: captionStyles.join('; ') }
              : {}),
          },
          attributes.caption,
        ];
      })()
    : null;

  if (isInline) {
    return [
      'span',
      mergeAttributes(htmlAttributes, {
        class: 'document-image document-image--inline',
        'data-document-image': 'true',
      }),
      frame,
      ...(caption ? [caption] : []),
    ];
  }

  return [
    'figure',
    mergeAttributes(htmlAttributes, {
      class: 'document-image document-image--flow',
      'data-document-image': 'true',
    }),
    frame,
    ...(caption ? [caption] : []),
  ];
};

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    documentImage: {
      insertDocumentImage: (
        attributes: InsertDocumentImageAttributes,
        position?: number
      ) => ReturnType;
      setDocumentImageWrap: (wrap: DocumentImageWrap) => ReturnType;
      updateSelectedDocumentImage: (
        attributes: Partial<DocumentImageAttributes>
      ) => ReturnType;
      moveSelectedDocumentImage: (
        direction: DocumentImageMoveDirection
      ) => ReturnType;
    };
  }
}

export const DocumentInlineImageExtension =
  Node.create<DocumentImageExtensionOptions>({
    name: 'documentInlineImage',
    inline: true,
    group: 'inline',
    atom: true,
    selectable: true,
    draggable: true,

    addOptions: getDefaultOptions,

    addAttributes() {
      return createDocumentImageAttributes('inline');
    },

    parseHTML() {
      return [
        {
          tag: 'span[data-document-image][data-wrap="inline"]',
        },
      ];
    },

    renderHTML({ node, HTMLAttributes }) {
      return renderImageHtml(
        node.attrs,
        HTMLAttributes,
        this.options,
        true
      );
    },

    addNodeView() {
      return ReactNodeViewRenderer(DocumentImageNodeView, {
        as: 'span',
        className: 'document-image-node document-image-node--inline',
        attrs: ({ HTMLAttributes }) => HTMLAttributes,
      });
    },
  });

export const DocumentFlowImageExtension =
  Node.create<DocumentImageExtensionOptions>({
    name: 'documentFlowImage',
    group: 'block',
    atom: true,
    selectable: true,
    draggable: true,
    defining: true,

    addOptions: getDefaultOptions,

    addAttributes() {
      return createDocumentImageAttributes('float-left');
    },

    parseHTML() {
      return [
        {
          tag: 'figure[data-document-image]:not([data-wrap="inline"])',
        },
      ];
    },

    renderHTML({ node, HTMLAttributes }) {
      return renderImageHtml(
        node.attrs,
        HTMLAttributes,
        this.options,
        false
      );
    },

    addNodeView() {
      return ReactNodeViewRenderer(DocumentImageNodeView, {
        as: 'div',
        className: 'document-image-node document-image-node--flow',
        attrs: ({ HTMLAttributes }) => HTMLAttributes,
      });
    },
  });

export const DocumentImageCommandsExtension = Extension.create({
  name: 'documentImageCommands',

  addCommands() {
    return {
      insertDocumentImage:
        (attributes, position) =>
        ({ commands, state }) => {
          const normalized = normalizeDocumentImageAttributes(
            attributes,
            attributes.wrap === 'inline' ? 'inline' : 'float-left'
          );
          const type = normalized.wrap === 'inline'
            ? 'documentInlineImage'
            : 'documentFlowImage';
          const content = { type, attrs: normalized };
          if (typeof position === 'number') {
            return commands.insertContentAt(position, content);
          }
          // "Add photo" is an insertion workflow even while another image is
          // selected. Tiptap's insertContent replaces a NodeSelection, which
          // made a second import silently overwrite the first image.
          if (state.selection instanceof NodeSelection) {
            return commands.insertContentAt(state.selection.to, content);
          }
          return commands.insertContent(content);
        },
      setDocumentImageWrap:
        (wrap) =>
        ({ commands, state }) => {
          const normalizedWrap = normalizeDocumentImageWrap(wrap);
          const selection = state.selection;
          if (!(selection instanceof NodeSelection)) return false;
          if (
            !DOCUMENT_IMAGE_NODE_NAMES.includes(
              selection.node.type.name as DocumentImageNodeName
            )
          ) {
            return false;
          }

          const currentType =
            selection.node.type.name as DocumentImageNodeName;
          const nextType: DocumentImageNodeName =
            normalizedWrap === 'inline'
              ? 'documentInlineImage'
              : 'documentFlowImage';
          const attributes = normalizeDocumentImageAttributes(
            { ...selection.node.attrs, wrap: normalizedWrap },
            normalizedWrap
          );

          if (currentType === nextType) {
            return commands.updateAttributes(currentType, attributes);
          }

          if (nextType === 'documentInlineImage') {
            return commands.insertContentAt(
              { from: selection.from, to: selection.to },
              {
                type: 'paragraph',
                content: [{ type: nextType, attrs: attributes }],
              }
            );
          }

          return commands.insertContentAt(
            { from: selection.from, to: selection.to },
            { type: nextType, attrs: attributes }
          );
        },
      updateSelectedDocumentImage:
        (attributes) =>
        ({ commands, state }) => {
          const selection = state.selection;
          if (!(selection instanceof NodeSelection)) return false;
          const type = selection.node.type.name as DocumentImageNodeName;
          if (!DOCUMENT_IMAGE_NODE_NAMES.includes(type)) return false;
          return commands.updateAttributes(type, attributes);
        },
      moveSelectedDocumentImage:
        (direction) =>
        ({ dispatch, state }) => {
          if (!canMoveSelectedStructuredImage(state, direction)) return false;
          const { selection } = state;
          if (!(selection instanceof NodeSelection)) return false;

          const imageNode = selection.node;
          const transaction = state.tr;
          if (direction === 'earlier') {
            const previous = state.doc.childBefore(selection.from);
            if (
              !previous.node
              || previous.offset + previous.node.nodeSize !== selection.from
            ) {
              return false;
            }
            transaction.replaceWith(
              previous.offset,
              selection.to,
              Fragment.fromArray([imageNode, previous.node])
            );
            transaction.setSelection(
              NodeSelection.create(transaction.doc, previous.offset)
            );
          } else {
            const next = state.doc.childAfter(selection.to);
            if (!next.node || next.offset !== selection.to) return false;
            transaction.replaceWith(
              selection.from,
              next.offset + next.node.nodeSize,
              Fragment.fromArray([next.node, imageNode])
            );
            transaction.setSelection(
              NodeSelection.create(
                transaction.doc,
                selection.from + next.node.nodeSize
              )
            );
          }
          dispatch?.(transaction.scrollIntoView());
          return true;
        },
    };
  },
});
