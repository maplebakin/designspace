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

export type DocumentFlowImage = {
  id: string;
  assetId: string;
  altText: string;
  widthPx: number;
  heightPx: number;
  wrap: DocumentFlowImageWrap;
  spanCount?: 1 | 2 | 3;
  spanStartColumn?: 1 | 2 | 3;
  wrapPaddingPx: number;
  verticalSpacingPx?: number;
  verticalAnchor?: 'flow' | 'page-position';
  yPx?: number;
  horizontalPlacement?: 'left' | 'center' | 'right' | 'custom';
  xOffsetPx?: number;
  caption?: string;
  naturalWidth?: number;
  naturalHeight?: number;
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
  naturalWidth?: number;
  naturalHeight?: number;
  locked?: boolean;
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
  locked: true;
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
  titleFontSizePx: number;
  columnCount: 1 | 2 | 3;
  columnGapPx: number;
  dropCap: boolean;
  suppressFolio: boolean;
  overlayObjects: DocumentOverlayImage[];
  reference?: ScanReference;
};
