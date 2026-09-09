import {
  useCallback,
  useLayoutEffect,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import {
  NodeSelection,
  Plugin,
  PluginKey,
  TextSelection,
} from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type {
  DocumentImageAttributes,
  DocumentImageNodeName,
} from '../extensions/DocumentImageExtension';
import {
  calculateDocumentImageHeight,
  calculateDocumentImageFrameHeight,
  calculateDocumentImageResizeWidth,
  calculateDocumentImageXOffset,
  clampDocumentImageXOffset,
  clampDocumentImageWidth,
  getDocumentImageAspectRatio,
  clampDocumentImageY,
  normalizeDocumentImageAttributes,
} from '../extensions/DocumentImageExtension';
import {
  bodyPoint,
  bodyRectangle,
  buildExclusionRectangle,
  findRectangleCollisions as findKernelRectangleCollisions,
  getDocumentColumnRectangles,
  layoutDocumentImageGroup,
  moveRectangleWithoutCollisions as moveKernelRectangleWithoutCollisions,
  rectanglesOverlap as kernelRectanglesOverlap,
  resolveInitialRectangleOverlaps,
  translateDocumentImageGroupLayout,
  bodyDelta,
  viewportDelta,
  viewportDeltaToLayoutDelta,
  type BodyRectangle,
  type CollisionObstacle,
  type DocumentImageGroupLayout,
  snapDocumentRectangle,
  type DocumentSnapGuide,
} from '../layout';
import type {
  DocumentImageGroup,
} from '../types/documentProject';

type ActiveStructuredFragmentBlockState = Readonly<{
  blockIndex: number | null;
}>;

export const activeStructuredFragmentBlockKey = new PluginKey<ActiveStructuredFragmentBlockState>(
  'activeStructuredFragmentBlock'
);

export const activeStructuredFragmentBlockPlugin = new Plugin<ActiveStructuredFragmentBlockState>({
  key: activeStructuredFragmentBlockKey,
  state: {
    init: () => ({ blockIndex: null }),
    apply: (transaction, value) => (
      transaction.getMeta(activeStructuredFragmentBlockKey) || value
    ),
  },
  props: {
    decorations: (state) => {
      const blockIndex = activeStructuredFragmentBlockKey.getState(state)?.blockIndex;
      if (blockIndex === null || blockIndex === undefined) return DecorationSet.empty;
      let activePosition: number | null = null;
      state.doc.forEach((_node, offset, index) => {
        if (index === blockIndex) activePosition = offset;
      });
      if (activePosition === null) return DecorationSet.empty;
      const node = state.doc.child(blockIndex);
      return DecorationSet.create(state.doc, [Decoration.node(
        activePosition,
        activePosition + node.nodeSize,
        { class: 'document-active-fragment-block' }
      )]);
    },
  },
});

export const activeStructuredFragmentBlockExtension = Extension.create({
  name: 'activeStructuredFragmentBlock',
  addProseMirrorPlugins: () => [activeStructuredFragmentBlockPlugin],
});
import {
  normalizeDocumentDropCap,
  type DocumentDropCapSettings,
} from '../typography/documentTypography';

export type DocumentSpanLayoutModel = {
  imageId: string;
  imagePosition: number;
  attributes: DocumentImageAttributes;
  beforeColumnHtml: string[];
  sideHtml: string;
  afterColumnHtml: string[];
  imageHtml: string;
  sideColumn: number | null;
  columnWidthPx: number;
  spanWidthPx: number;
  renderedImageWidthPx: number;
  renderedImageHeightPx: number;
  imageRegionHeightPx: number;
  layoutContentHeightPx: number;
  imageTopPx: number;
  exclusionTopPx: number;
  exclusionBottomPx: number;
  maximumImageYPx: number;
  availableHeightPx: number;
  overflowing: boolean;
  columns: Array<{
    column: number;
    occupied: boolean;
    topHtml: string;
    bottomHtml: string;
  }>;
};

export type DocumentColumnSegment = {
  column: number;
  region: 'top' | 'bottom';
  heightPx: number;
};

export type DocumentImageRectangle = {
  imageId: string;
  leftPx: number;
  topPx: number;
  widthPx: number;
  heightPx: number;
};

export const getStructuredImageDragVisualDelta = (
  startRectangle: Pick<DocumentImageRectangle, 'leftPx' | 'topPx'>,
  previewRectangle: Pick<DocumentImageRectangle, 'leftPx' | 'topPx'>,
) => ({
  xPx: previewRectangle.leftPx - startRectangle.leftPx,
  yPx: previewRectangle.topPx - startRectangle.topPx,
});

export type StructuredImageLayout = {
  imageId: string;
  imagePosition: number;
  attributes: DocumentImageAttributes;
  /** Persistent/user-controlled frame projection before collision layout. */
  authoredFrame: StructuredImageFrameGeometry;
  imageHtml: string;
  spanLeftPx: number;
  spanWidthPx: number;
  renderedImageWidthPx: number;
  renderedImageHeightPx: number;
  renderedXOffsetPx: number;
  imageRegionHeightPx: number;
  imageLeftPx: number;
  imageTopPx: number;
  maximumXOffsetPx: number;
  maximumImageYPx: number;
  groupId?: string;
};

/**
 * A persistent image that remains in ordinary flow/inline content while the
 * structured compositor is active because another image spans columns. The
 * image itself stays in its semantic text-band position; this record owns the
 * explicit editor hit target that is projected over its measured frame.
 */
export type StructuredFlowImageLayout = {
  imageId: string;
  imagePosition: number;
  nodeType: DocumentImageNodeName;
  attributes: DocumentImageAttributes;
};

export type StructuredImageFrameGeometry = Readonly<{
  leftPx: number;
  topPx: number;
  widthPx: number;
  heightPx: number;
}>;

const STRUCTURED_IMAGE_DRAG_THRESHOLD_PX = 6;

/**
 * Page-positioned image coordinates are authored from the page content
 * origin, while the structured compositor is mounted at the current body
 * origin. A real title moves that body origin; measure the authored-title
 * offset so fixed frames remain anchored to the sheet instead of moving with
 * flow.
 */
export const measureDocumentPagePositionOriginOffsetPx = (
  bodyRoot: HTMLElement | null,
  viewScale = 1
) => {
  if (!bodyRoot) return 0;
  const contentRoot = bodyRoot.closest<HTMLElement>('.document-page-content');
  if (!contentRoot) return 0;
  const contentRect = contentRoot.getBoundingClientRect();
  const bodyRect = bodyRoot.getBoundingClientRect();
  const scale = Math.max(0.05, viewScale);
  const paddingTop = Number.parseFloat(
    window.getComputedStyle(contentRoot).paddingTop
  ) || 0;
  return Math.max(
    0,
    (bodyRect.top - contentRect.top) / scale - paddingTop
  );
};

/**
 * The transformable photo frame excludes caption flow. The structured layout
 * model is the canonical page-space source for both the rendered frame and
 * its editor-only chrome.
 */
export const getStructuredImageFrameGeometry = ({
  imageLeftPx,
  imageTopPx,
  renderedImageWidthPx,
  renderedImageHeightPx,
}: Pick<
  StructuredImageLayout,
  | 'imageLeftPx'
  | 'imageTopPx'
  | 'renderedImageWidthPx'
  | 'renderedImageHeightPx'
>): StructuredImageFrameGeometry => ({
  leftPx: imageLeftPx,
  topPx: imageTopPx,
  widthPx: renderedImageWidthPx,
  heightPx: renderedImageHeightPx,
});

export type StructuredImageGroupLayout = {
  groupId: string;
  kind: DocumentImageGroup['kind'];
  childImageIds: readonly string[];
  anchorImageId: string;
  gapPx: number;
  sharedWidth: boolean;
  spanLeftPx: number;
  spanWidthPx: number;
  bounds: DocumentImageRectangle;
};

export type StructuredTextBand = {
  id: string;
  column: number;
  topPx: number;
  leftPx: number;
  widthPx: number;
  heightPx: number;
  html: string;
  /**
   * Runtime visual identities produced by the structured allocator. A band
   * can contain several fragments and one PM block can occur in several
   * bands, so this is deliberately richer than `documentFrom/documentTo`.
   */
  fragments: StructuredTextFragmentIdentity[];
  /** The exact ProseMirror text range represented by this visible region. */
  documentFrom: number | null;
  documentTo: number | null;
  /**
   * Line metadata is currently bounded to the fragment range because the
   * layout measurer allocates blocks, not browser line boxes. Keeping the
   * fields explicit makes the mapping contract extensible without guessing
   * character widths or line heights.
   */
  lineFrom: number | null;
  lineTo: number | null;
};

export type StructuredTextFragmentIdentity = Readonly<{
  /** Runtime-only identity; never persisted in document JSON. */
  id: string;
  pageId: string | null;
  blockIndex: number;
  blockFrom: number;
  blockTo: number;
  fragmentFrom: number;
  fragmentTo: number;
  /** Ordinal among fragments derived from the same PM block. */
  fragmentIndex: number;
  columnIndex: number;
  /** A stable-in-this-layout segment identity for diagnostics and hit tests. */
  segmentId: string;
  geometry: Readonly<{
    leftPx: number;
    topPx: number;
    widthPx: number;
    heightPx: number;
  }>;
}>;

/**
 * Transient identity for the block(s) currently owned by the live editor.
 * Block indexes are stable across ordinary text transactions, while the
 * document range is refreshed when selection crosses a block boundary.
 */
export type StructuredTextEditTarget = Readonly<{
  blockFrom: number;
  blockTo: number;
  blockIndexes: readonly number[];
  fragmentIds: readonly string[];
  primaryFragmentId: string | null;
}>;

export type ActiveStructuredFragmentViewport = Readonly<{
  fragmentId: string;
  pageId: string | null;
  blockIndex: number;
  pmRange: { from: number; to: number } | null;
  fragmentRect: Readonly<{
    left: number;
    top: number;
    width: number;
    height: number;
  }>;
  sourceRangeRect: DOMRect | null;
  finalLiveRangeRect: DOMRect | null;
  alignmentOffset: Readonly<{ x: number; y: number }>;
}>;

/**
 * Resolve a frozen fragment against the current PM block without reusing its
 * stale numeric range. The fragment ID is the layout anchor; its original
 * ordinal/span supplies a deterministic position in the live block while the
 * compositor is intentionally frozen during typing.
 */
export const resolveLiveStructuredFragmentRange = (
  editor: Editor,
  fragment: StructuredTextFragmentIdentity,
  fragments: readonly StructuredTextFragmentIdentity[]
): { from: number; to: number } | null => {
  const block = editor.state.doc.child(fragment.blockIndex);
  if (!block) return null;
  let blockFrom = 1;
  for (let index = 0; index < fragment.blockIndex; index += 1) {
    blockFrom += editor.state.doc.child(index).nodeSize;
  }
  const siblings = fragments
    .filter((candidate) => candidate.blockIndex === fragment.blockIndex)
    .sort((left, right) => left.fragmentIndex - right.fragmentIndex);
  const originalFrom = siblings[0]?.fragmentFrom ?? fragment.fragmentFrom;
  const originalTo = siblings[siblings.length - 1]?.fragmentTo ?? fragment.fragmentTo;
  const originalSpan = Math.max(1, originalTo - originalFrom);
  const fromRatio = (fragment.fragmentFrom - originalFrom) / originalSpan;
  const toRatio = (fragment.fragmentTo - originalFrom) / originalSpan;
  const from = blockFrom + Math.round(block.content.size * fromRatio);
  const to = blockFrom + Math.round(block.content.size * toRatio);
  return { from: Math.min(from, to), to: Math.max(from, to) };
};

export const getStructuredTextEditTarget = (
  editor: Editor,
  fragments: readonly StructuredTextFragmentIdentity[] = [],
  preferredFragmentId?: string | null
): StructuredTextEditTarget | null => {
  const selection = editor.state.selection;
  if (selection instanceof NodeSelection) return null;

  const blocks: Array<{
    index: number;
    from: number;
    to: number;
  }> = [];
  editor.state.doc.forEach((node, offset) => {
    blocks.push({
      index: blocks.length,
      from: offset + 1,
      to: offset + node.nodeSize - 1,
    });
  });
  if (blocks.length === 0) return null;

  const selectionFrom = Math.min(selection.from, selection.to);
  const selectionTo = Math.max(selection.from, selection.to);
  const selected = blocks.filter((block) => (
    selection.empty
      ? selectionFrom >= block.from && selectionFrom <= block.to
      : selectionTo > block.from && selectionFrom < block.to
  ));
  const targetBlocks = selected.length > 0
    ? selected
    : [blocks.reduce((nearest, block) => {
        const distance = selectionFrom < block.from
          ? block.from - selectionFrom
          : selectionFrom > block.to
            ? selectionFrom - block.to
            : 0;
        const nearestDistance = selectionFrom < nearest.from
          ? nearest.from - selectionFrom
          : selectionFrom > nearest.to
            ? selectionFrom - nearest.to
            : 0;
        return distance < nearestDistance ? block : nearest;
      }, blocks[0])];

  const targetBlockIndexes = new Set(
    targetBlocks.map((block) => block.index)
  );
  const preferredFragment = preferredFragmentId
    ? fragments.find((fragment) => (
        fragment.id === preferredFragmentId
        && targetBlockIndexes.has(fragment.blockIndex)
      ))
    : undefined;
  const liveRanges = new Map(
    fragments.map((fragment) => [
      fragment.id,
      resolveLiveStructuredFragmentRange(editor, fragment, fragments),
    ])
  );
  const selectedFragments = fragments.filter((fragment) => {
    if (!targetBlockIndexes.has(fragment.blockIndex)) return false;
    const liveRange = liveRanges.get(fragment.id);
    if (!liveRange) return false;
    if (
      selection.empty
      && preferredFragment
      && fragment.id === preferredFragment.id
    ) return true;
    if (selection.empty) {
      return selectionFrom >= liveRange.from && selectionFrom <= liveRange.to;
    }
    return (
      liveRange.to > selectionFrom
      && liveRange.from < selectionTo
    );
  });
  const preferredRange = preferredFragment
    ? liveRanges.get(preferredFragment.id)
    : null;
  const preferredOwnsSelection = preferredFragment && preferredRange && (
    selection.empty
      ? selectionFrom >= preferredRange.from && selectionFrom <= preferredRange.to
      : preferredRange.to > selectionFrom && preferredRange.from < selectionTo
  );
  const resolvedFragments = targetBlocks
    .flatMap((block) => fragments.filter((fragment) => fragment.blockIndex === block.index))
    .sort((left, right) => left.fragmentIndex - right.fragmentIndex);
  const fallbackFragment = resolvedFragments
    .map((fragment) => ({
      fragment,
      range: liveRanges.get(fragment.id),
    }))
    .filter((candidate): candidate is {
      fragment: StructuredTextFragmentIdentity;
      range: { from: number; to: number };
    } => Boolean(candidate.range))
    .sort((left, right) => {
      const leftDistance = selectionFrom < left.range.from
        ? left.range.from - selectionFrom
        : selectionFrom > left.range.to ? selectionFrom - left.range.to : 0;
      const rightDistance = selectionFrom < right.range.from
        ? right.range.from - selectionFrom
        : selectionFrom > right.range.to ? selectionFrom - right.range.to : 0;
      return leftDistance - rightDistance;
    })[0]?.fragment;
  const targetFragments = preferredOwnsSelection
    ? [
        preferredFragment!,
        ...selectedFragments.filter(
          (fragment) => fragment.id !== preferredFragment.id
        ),
      ]
    : selectedFragments.length > 0
      ? selectedFragments
      : fallbackFragment ? [fallbackFragment] : [];

  return {
    blockFrom: Math.min(...targetBlocks.map((block) => block.from)),
    blockTo: Math.max(...targetBlocks.map((block) => block.to)),
    blockIndexes: targetBlocks.map((block) => block.index),
    fragmentIds: targetFragments.map((fragment) => fragment.id),
    primaryFragmentId: targetFragments[0]?.id || null,
  };
};

export type MultiDocumentSpanLayoutModel = {
  images: StructuredImageLayout[];
  flowImages: StructuredFlowImageLayout[];
  imageGroups: StructuredImageGroupLayout[];
  exclusions: DocumentImageRectangle[];
  collisionRectangles: DocumentImageRectangle[];
  collisionUnits: DocumentImageRectangle[];
  textBands: StructuredTextBand[];
  textFragments: StructuredTextFragmentIdentity[];
  columnWidthPx: number;
  columnGapPx: number;
  availableWidthPx: number;
  availableHeightPx: number;
  layoutContentHeightPx: number;
  overflowing: boolean;
  unresolvedCollisionIds: readonly string[];
  structuredMeasurementCount: number;
  structuredMeasurementDurationMs: number;
};

const toBodyRectangle = (
  rectangle: DocumentImageRectangle
): BodyRectangle => bodyRectangle(
  rectangle.leftPx,
  rectangle.topPx,
  rectangle.widthPx,
  rectangle.heightPx
);

const toCollisionObstacle = (
  rectangle: DocumentImageRectangle
): CollisionObstacle<'body'> => ({
  id: rectangle.imageId,
  rectangle: toBodyRectangle(rectangle),
});

const clampStructuredImageTop = ({
  value,
  availableHeightPx,
  imageRegionHeightPx,
  topPaddingPx,
  bottomPaddingPx,
}: {
  value: number;
  availableHeightPx: number;
  imageRegionHeightPx: number;
  topPaddingPx: number;
  bottomPaddingPx: number;
}) => {
  const minimum = Math.max(0, topPaddingPx);
  const maximum = Math.max(
    minimum,
    availableHeightPx
      - imageRegionHeightPx
      - Math.max(0, bottomPaddingPx)
  );
  return Math.min(maximum, Math.max(minimum, value));
};

export const buildPhysicalColumnSegments = (
  columnCount: number,
  occupiedColumns: number[],
  availableHeightPx: number,
  exclusionTopPx: number,
  exclusionBottomPx: number
): DocumentColumnSegment[] =>
  Array.from({ length: columnCount }, (_, index) => index + 1)
    .flatMap((column) => (
      occupiedColumns.includes(column)
        ? [
            {
              column,
              region: 'top' as const,
              heightPx: Math.max(0, exclusionTopPx),
            },
            {
              column,
              region: 'bottom' as const,
              heightPx: Math.max(
                0,
                availableHeightPx - exclusionBottomPx
              ),
            },
          ]
        : [{
            column,
            region: 'top' as const,
            heightPx: Math.max(0, availableHeightPx),
          }]
    ));

type StructuredContentMeasurer = {
  measure: (elements: Element[], widthPx: number) => number;
  dispose: () => void;
};

export type StructuredDocumentTypographyOptions = {
  typographyStyle?: CSSProperties;
  dropCap?: DocumentDropCapSettings | boolean;
  language?: string;
};

const DOCUMENT_DROP_CAP_TARGET_ATTRIBUTE =
  'data-document-drop-cap-target';

export const getStructuredDocumentTypographyVariables = (
  style?: CSSProperties
): CSSProperties => Object.fromEntries(
  Object.entries(style || {}).filter(([property, value]) => (
    property.startsWith('--document-')
    && (typeof value === 'string' || typeof value === 'number')
  ))
) as CSSProperties;

const applyStructuredDocumentTypographyVariables = (
  element: HTMLElement,
  style?: CSSProperties
) => {
  Object.entries(getStructuredDocumentTypographyVariables(style))
    .forEach(([property, value]) => {
      element.style.setProperty(property, String(value));
    });
};

const removeDocumentDropCapTargets = (element: Element) => {
  if (element.hasAttribute(DOCUMENT_DROP_CAP_TARGET_ATTRIBUTE)) {
    element.removeAttribute(DOCUMENT_DROP_CAP_TARGET_ATTRIBUTE);
  }
  element.querySelectorAll(`[${DOCUMENT_DROP_CAP_TARGET_ATTRIBUTE}]`)
    .forEach((target) => {
      target.removeAttribute(DOCUMENT_DROP_CAP_TARGET_ATTRIBUTE);
    });
};

const isEligibleDocumentDropCapParagraph = (element: Element) => (
  element.tagName.toLowerCase() === 'p'
  && (
    !element.hasAttribute('data-document-style-id')
    || element.getAttribute('data-document-style-id') === 'body'
  )
  && (element.textContent || '').trim().length > 0
);

export const markFirstEligibleDocumentDropCapParagraph = (
  elements: Element[],
  enabled: boolean
): Element | null => {
  elements.forEach(removeDocumentDropCapTargets);
  if (!enabled) return null;

  for (const element of elements) {
    const candidates = [
      ...(isEligibleDocumentDropCapParagraph(element) ? [element] : []),
      ...Array.from(element.querySelectorAll('p'))
        .filter(isEligibleDocumentDropCapParagraph),
    ];
    const target = candidates[0];
    if (!target) continue;
    target.setAttribute(DOCUMENT_DROP_CAP_TARGET_ATTRIBUTE, 'true');
    return target;
  }
  return null;
};

const serializeElements = (elements: Element[]) =>
  elements.map((element) => element.outerHTML).join('');

const markStructuredFlowImageElements = (
  elements: Element[],
  flowImageIds: ReadonlySet<string>
) => {
  elements.forEach((element) => {
    const candidates = [
      ...(element.matches('[data-image-id]') ? [element] : []),
      ...Array.from(element.querySelectorAll('[data-image-id]')),
    ];
    candidates.forEach((candidate) => {
      const imageId = candidate.getAttribute('data-image-id');
      if (
        imageId
        && flowImageIds.has(imageId)
        && candidate.getAttribute('data-wrap') !== 'span-columns'
      ) {
        candidate.setAttribute(
          'data-document-structured-flow-image',
          'true'
        );
      }
    });
  });
};

const DOCUMENT_TEXT_FROM_ATTRIBUTE = 'data-document-from';
const DOCUMENT_TEXT_TO_ATTRIBUTE = 'data-document-to';
const DOCUMENT_REGION_ATTRIBUTE = 'data-document-region-id';
const DOCUMENT_BLOCK_FROM_ATTRIBUTE = 'data-document-block-from';
const DOCUMENT_BLOCK_TO_ATTRIBUTE = 'data-document-block-to';
const DOCUMENT_FRAGMENT_ID_ATTRIBUTE = 'data-document-fragment-id';
const DOCUMENT_FRAGMENT_FROM_ATTRIBUTE = 'data-document-fragment-from';
const DOCUMENT_FRAGMENT_TO_ATTRIBUTE = 'data-document-fragment-to';
const DOCUMENT_FRAGMENT_INDEX_ATTRIBUTE = 'data-document-fragment-index';
const DOCUMENT_FRAGMENT_SEGMENT_ATTRIBUTE = 'data-document-segment-id';
const DOCUMENT_UNSPLITTABLE_ATTRIBUTE = 'data-document-unsplittable';

type DocumentTextRange = {
  from: number;
  to: number;
};

const readDocumentTextRange = (element: Element): DocumentTextRange | null => {
  const from = Number(element.getAttribute(DOCUMENT_TEXT_FROM_ATTRIBUTE));
  const to = Number(element.getAttribute(DOCUMENT_TEXT_TO_ATTRIBUTE));
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
    return null;
  }
  return { from, to };
};

const setDocumentTextRange = (
  element: Element,
  range: DocumentTextRange
) => {
  element.setAttribute(DOCUMENT_TEXT_FROM_ATTRIBUTE, String(range.from));
  element.setAttribute(DOCUMENT_TEXT_TO_ATTRIBUTE, String(range.to));
};

const readDocumentAttributeRange = (
  element: Element,
  fromAttribute: string,
  toAttribute: string
): DocumentTextRange | null => {
  const from = Number(element.getAttribute(fromAttribute));
  const to = Number(element.getAttribute(toAttribute));
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
    return null;
  }
  return { from, to };
};

const setDocumentAttributeRange = (
  element: Element,
  fromAttribute: string,
  toAttribute: string,
  range: DocumentTextRange
) => {
  element.setAttribute(fromAttribute, String(range.from));
  element.setAttribute(toAttribute, String(range.to));
};

const getElementDocumentTextRange = (
  element: Element
): DocumentTextRange | null => readDocumentTextRange(element);

const getElementsDocumentTextRange = (
  elements: Element[]
): DocumentTextRange | null => {
  const ranges = elements.flatMap((element) => {
    const range = getElementDocumentTextRange(element);
    return range ? [range] : [];
  });
  if (ranges.length === 0) return null;
  return {
    from: Math.min(...ranges.map((range) => range.from)),
    to: Math.max(...ranges.map((range) => range.to)),
  };
};

const hasNonTextInlineContent = (node: ProseMirrorNode) => {
  let hasNonTextInline = node.isLeaf && !node.isText;
  if (hasNonTextInline) return true;
  node.descendants((child) => {
    if (child.isLeaf && !child.isText) {
      hasNonTextInline = true;
      return false;
    }
    return !hasNonTextInline;
  });
  return hasNonTextInline;
};

/**
 * Annotates parsed top-level HTML blocks with their ProseMirror text range.
 * The structured renderer only consumes these attributes; they are never
 * persisted. Top-level document positions are stable because they are based
 * on the ProseMirror document, not DOM rectangles or CSS columns.
 */
const annotateSourceElementRanges = (
  editor: Editor,
  children: Element[]
) => {
  const entries: Array<{ node: ProseMirrorNode; position: number }> = [];
  editor.state.doc.forEach((node, position) => entries.push({ node, position }));

  children.forEach((element, index) => {
    const entry = entries[index];
    if (!entry) return;
    const { node, position } = entry;
    element.setAttribute('data-document-block-index', String(index));
    const contentFrom = node.isLeaf ? position : position + 1;
    const contentTo = node.isLeaf
      ? position + 1
      : position + node.nodeSize - 1;
    const range = { from: contentFrom, to: Math.max(contentFrom, contentTo) };
    setDocumentTextRange(element, range);
    setDocumentAttributeRange(
      element,
      DOCUMENT_BLOCK_FROM_ATTRIBUTE,
      DOCUMENT_BLOCK_TO_ATTRIBUTE,
      range
    );
    if (hasNonTextInlineContent(node)) {
      element.setAttribute(DOCUMENT_UNSPLITTABLE_ATTRIBUTE, 'true');
    }
  });
};

const estimateElementHeight = (element: Element, widthPx: number) => {
  const textLength = Math.max(1, element.textContent?.length || 0);
  const fontSizes = [
    14,
    ...Array.from(element.querySelectorAll<HTMLElement>('[data-font-size-px]'))
      .map((node) => Number(node.dataset.fontSizePx))
      .filter((size) => Number.isFinite(size) && size > 0),
  ];
  const fontSize = Math.max(...fontSizes);
  const charactersPerLine = Math.max(
    8,
    Math.floor(widthPx / Math.max(4, fontSize * 0.52))
  );
  const lineCount = Math.max(1, Math.ceil(textLength / charactersPerLine));
  return lineCount * fontSize * 1.42 + fontSize * 0.72;
};

type StructuredMeasurementDiagnostics = {
  count: number;
  durationMs: number;
};

const createStructuredContentMeasurer = (
  options: StructuredDocumentTypographyOptions = {},
  diagnostics?: StructuredMeasurementDiagnostics
): StructuredContentMeasurer => {
  if (typeof document === 'undefined' || !document.body) {
    return {
      measure: (elements, widthPx) => {
        const startedAt = typeof performance === 'undefined'
          ? 0
          : performance.now();
        const measured = elements.reduce(
          (height, element) => height + estimateElementHeight(element, widthPx),
          0
        );
        if (diagnostics) {
          diagnostics.count += 1;
          diagnostics.durationMs += typeof performance === 'undefined'
            ? 0
            : performance.now() - startedAt;
        }
        return measured;
      },
      dispose: () => undefined,
    };
  }

  const host = document.createElement('div');
  host.className = 'document-spanning-layout document-span-layout__measure';
  if (options.language) host.lang = options.language;
  const dropCap = normalizeDocumentDropCap(options.dropCap ?? false);
  host.setAttribute(
    'data-document-drop-cap',
    dropCap.enabled ? 'true' : 'false'
  );
  applyStructuredDocumentTypographyVariables(
    host,
    options.typographyStyle
  );
  Object.assign(host.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    height: 'auto',
    minHeight: '0',
    overflow: 'visible',
    visibility: 'hidden',
    pointerEvents: 'none',
  });
  document.body.appendChild(host);

  return {
    measure: (elements, widthPx) => {
      if (elements.length === 0) return 0;
      const startedAt = typeof performance === 'undefined'
        ? 0
        : performance.now();
      host.style.width = `${Math.max(1, widthPx)}px`;
      host.innerHTML = serializeElements(elements);
      const measuredHeight = Math.max(
        host.scrollHeight,
        host.getBoundingClientRect().height
      );
      const result = measuredHeight > 0
        ? measuredHeight
        : elements.reduce(
            (height, element) =>
              height + estimateElementHeight(element, widthPx),
            0
          );
      if (diagnostics) {
        diagnostics.count += 1;
        diagnostics.durationMs += typeof performance === 'undefined'
          ? 0
          : performance.now() - startedAt;
      }
      return result;
    },
    dispose: () => host.remove(),
  };
};

const resolveStructuredCaptionSpacingPx = (
  value: DocumentImageAttributes['captionSpacingPx'],
  options: StructuredDocumentTypographyOptions
) => {
  if (typeof value === 'number') return value;
  const rawValue = (
    options.typographyStyle as Record<string, unknown> | undefined
  )?.['--document-style-caption-paragraph-spacing'];
  const parsed = Number.parseFloat(String(rawValue ?? '5'));
  return Number.isFinite(parsed) ? Math.min(96, Math.max(0, parsed)) : 5;
};

const cloneElementRange = (
  element: Element,
  from: number,
  to: number
): Element | null => {
  if (from >= to) return null;
  const sourceRange = getElementDocumentTextRange(element);
  const offset = { value: 0 };
  const cloneNodeRange = (node: Node): Node | null => {
    if (node.nodeType === 3) {
      const value = node.textContent || '';
      const start = offset.value;
      const end = start + value.length;
      offset.value = end;
      const sliceStart = Math.max(from, start) - start;
      const sliceEnd = Math.min(to, end) - start;
      return sliceStart < sliceEnd
        ? element.ownerDocument.createTextNode(
            value.slice(sliceStart, sliceEnd)
          )
        : null;
    }

    const clone = node.cloneNode(false);
    let hasContent = false;
    node.childNodes.forEach((child) => {
      const childClone = cloneNodeRange(child);
      if (!childClone) return;
      clone.appendChild(childClone);
      hasContent = true;
    });
    if (
      !hasContent
      && node.nodeType === 1
      && node.childNodes.length === 0
      && offset.value >= from
      && offset.value < to
    ) {
      return clone;
    }
    return hasContent ? clone : null;
  };

  const clone = cloneNodeRange(element);
  if (clone?.nodeType !== 1) return null;
  const cloneElement = clone as Element;
  if (sourceRange) {
    setDocumentTextRange(cloneElement, {
      from: sourceRange.from + from,
      to: sourceRange.from + to,
    });
  }
  const sourceBlockRange = readDocumentAttributeRange(
    element,
    DOCUMENT_BLOCK_FROM_ATTRIBUTE,
    DOCUMENT_BLOCK_TO_ATTRIBUTE
  );
  if (sourceBlockRange) {
    setDocumentAttributeRange(
      cloneElement,
      DOCUMENT_BLOCK_FROM_ATTRIBUTE,
      DOCUMENT_BLOCK_TO_ATTRIBUTE,
      sourceBlockRange
    );
  }
  if (from > 0) removeDocumentDropCapTargets(cloneElement);
  return cloneElement;
};

const splitElementToFit = (
  element: Element,
  allocated: Element[],
  widthPx: number,
  maximumHeightPx: number,
  measure: StructuredContentMeasurer['measure']
): { before: Element; after: Element } | null => {
  if (element.hasAttribute(DOCUMENT_UNSPLITTABLE_ATTRIBUTE)) return null;
  const text = element.textContent || '';
  const boundaries: number[] = [];
  for (let index = 1; index < text.length; index += 1) {
    if (/\s/.test(text[index - 1]) || /\s/.test(text[index])) {
      boundaries.push(index);
    }
  }
  if (boundaries.length === 0) return null;

  let low = 0;
  let high = boundaries.length - 1;
  let bestOffset = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const offset = boundaries[middle];
    const before = cloneElementRange(element, 0, offset);
    if (
      before
      && measure([...allocated, before], widthPx) <= maximumHeightPx
    ) {
      bestOffset = offset;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  if (bestOffset <= 0 || bestOffset >= text.length) return null;
  const before = cloneElementRange(element, 0, bestOffset);
  const after = cloneElementRange(element, bestOffset, text.length);
  return before && after ? { before, after } : null;
};

const createStructuredTextFragments = (
  elements: Element[],
  band: Omit<StructuredTextBand, 'html' | 'fragments' | 'documentFrom' | 'documentTo' | 'lineFrom' | 'lineTo'>,
  pageId: string | undefined,
  fragmentIndexes: Map<number, number>,
  measure: StructuredContentMeasurer['measure']
): StructuredTextFragmentIdentity[] => elements.flatMap((element) => {
  // A top-level ordinary-flow image is allocated with the text stream so its
  // passive layout remains correct, but it is not a text fragment. Its
  // explicit editor-only flow-image hit target owns image interaction.
  if (element.getAttribute('data-document-structured-flow-image') === 'true') {
    return [];
  }
  const range = getElementDocumentTextRange(element);
  const blockIndex = Number(element.getAttribute('data-document-block-index'));
  const blockRange = readDocumentAttributeRange(
    element,
    DOCUMENT_BLOCK_FROM_ATTRIBUTE,
    DOCUMENT_BLOCK_TO_ATTRIBUTE
  );
  if (
    !range
    || !Number.isFinite(blockIndex)
    || range.to < range.from
  ) return [];
  const fragmentIndex = fragmentIndexes.get(blockIndex) || 0;
  fragmentIndexes.set(blockIndex, fragmentIndex + 1);
  const pageKey = pageId || 'document';
  const id = `${pageKey}:block-${blockIndex}:fragment-${fragmentIndex}`
    + `:${range.from}-${range.to}:${band.id}`;
  const segmentId = `${pageKey}:${band.id}:segment-${fragmentIndex}`;
  setDocumentAttributeRange(
    element,
    DOCUMENT_FRAGMENT_FROM_ATTRIBUTE,
    DOCUMENT_FRAGMENT_TO_ATTRIBUTE,
    range
  );
  element.setAttribute(DOCUMENT_FRAGMENT_ID_ATTRIBUTE, id);
  element.setAttribute(DOCUMENT_FRAGMENT_INDEX_ATTRIBUTE, String(fragmentIndex));
  element.setAttribute(DOCUMENT_FRAGMENT_SEGMENT_ATTRIBUTE, segmentId);
  element.setAttribute('data-document-fragment-column', String(band.column));
  const elementIndex = elements.indexOf(element);
  const preceding = elementIndex > 0 ? elements.slice(0, elementIndex) : [];
  const topOffsetPx = preceding.length > 0
    ? measure(preceding, band.widthPx)
    : 0;
  const heightPx = Math.max(1, measure([element], band.widthPx));
  return [{
    id,
    pageId: pageId || null,
    blockIndex,
    blockFrom: blockRange?.from ?? range.from,
    blockTo: blockRange?.to ?? range.to,
    fragmentFrom: range.from,
    fragmentTo: range.to,
    fragmentIndex,
    columnIndex: band.column,
    segmentId,
    geometry: {
      leftPx: band.leftPx,
      topPx: band.topPx + topOffsetPx,
      widthPx: band.widthPx,
      heightPx: Math.min(
        heightPx,
        Math.max(1, band.heightPx - topOffsetPx)
      ),
    },
  }];
});

export const allocateElementsToHeight = (
  elements: Element[],
  widthPx: number,
  maximumHeightPx: number,
  measure: StructuredContentMeasurer['measure']
): {
  allocated: Element[];
  remaining: Element[];
  breakBefore: boolean;
} => {
  if (maximumHeightPx <= 0) {
    return { allocated: [], remaining: elements, breakBefore: false };
  }
  const allocated: Element[] = [];
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index];
    const isSubsectionHeading = element.getAttribute('data-document-style-id')
      === 'subsection-heading';
    const startsNewColumn = element.getAttribute(
      'data-document-column-break-before'
    ) === 'true';
    const keepWithNext = isSubsectionHeading
      || element.getAttribute('data-document-keep-with-next') === 'true';
    const keepLinesTogether = element.getAttribute(
      'data-document-keep-lines-together'
    ) === 'true';
    if (startsNewColumn) {
      return {
        allocated,
        remaining: elements.slice(index),
        breakBefore: true,
      };
    }
    const headingWouldBeOrphaned = keepWithNext
      && index < elements.length - 1
      && measure([...allocated, element, elements[index + 1]], widthPx)
        > Math.max(1, maximumHeightPx);
    if (headingWouldBeOrphaned && allocated.length === 0) {
      return {
        allocated,
        remaining: elements.slice(index),
        breakBefore: false,
      };
    }
    if (
      !headingWouldBeOrphaned
      &&
      measure([...allocated, element], widthPx)
      <= Math.max(1, maximumHeightPx)
    ) {
      allocated.push(element);
      continue;
    }

    // Keep semantic subsection headings intact when a physical column or an
    // image exclusion ends mid-heading, and keep them with the following
    // paragraph when a column boundary would orphan the heading. Splitting
    // or orphaning a heading creates a misleading continuation such as
    // “Karatai” at the bottom of one region and “(Nisipari)” at the top of the
    // next, or leaves the following paragraph below the image row.
    const split = isSubsectionHeading || keepLinesTogether || keepWithNext
      ? null
      : splitElementToFit(
          element,
          allocated,
          widthPx,
          maximumHeightPx,
          measure
        );
    if (split) {
      allocated.push(split.before);
      return {
        allocated,
        remaining: [split.after, ...elements.slice(index + 1)],
        breakBefore: false,
      };
    }
    if (allocated.length === 0) {
      return {
        allocated,
        remaining: elements.slice(index),
        breakBefore: false,
      };
    }
    return {
      allocated,
      remaining: elements.slice(index),
      breakBefore: false,
    };
  }
  return { allocated, remaining: [], breakBefore: false };
};

const consumeLeadingDocumentColumnBreak = (
  elements: Element[]
): Element[] => {
  const first = elements[0];
  if (
    !first
    || first.getAttribute('data-document-column-break-before') !== 'true'
  ) {
    return elements;
  }
  const consumed = first.cloneNode(true) as Element;
  consumed.removeAttribute('data-document-column-break-before');
  return [consumed, ...elements.slice(1)];
};

export const buildDocumentSpanLayoutModel = (
  editor: Editor,
  columnCount: 1 | 2 | 3,
  columnGapPx = 24,
  availableWidthPx = 720,
  availableHeightPx = 720,
  attributeOverrides: Partial<DocumentImageAttributes> = {},
  typographyOptions: StructuredDocumentTypographyOptions = {}
): DocumentSpanLayoutModel | null => {
  let imagePosition: number | null = null;
  let attributes: DocumentImageAttributes | null = null;
  editor.state.doc.descendants((node, position) => {
    if (
      imagePosition === null
      && node.type.name === 'documentFlowImage'
      && node.attrs.wrap === 'span-columns'
    ) {
      imagePosition = position;
      attributes = normalizeDocumentImageAttributes(
        node.attrs as Partial<DocumentImageAttributes>,
        'float-left'
      );
      return false;
    }
    return imagePosition === null;
  });
  if (imagePosition === null || attributes === null) return null;
  const spanAttributes = normalizeDocumentImageAttributes({
    ...(attributes as DocumentImageAttributes),
    ...attributeOverrides,
  });
  const spanPosition = imagePosition as number;

  const parsed = new DOMParser().parseFromString(
    `<div data-document-span-source>${editor.getHTML()}</div>`,
    'text/html'
  );
  const source = parsed.querySelector('[data-document-span-source]');
  if (!source) return null;
  const children = Array.from(source.children);
  annotateSourceElementRanges(editor, children);
  const imageIndex = children.findIndex(
    (element) =>
      element.getAttribute('data-image-id') === spanAttributes.id
      && element.getAttribute('data-wrap') === 'span-columns'
  );
  if (imageIndex < 0) return null;

  const before = children.slice(0, imageIndex);
  const after = children.slice(imageIndex + 1);
  const dropCap = normalizeDocumentDropCap(
    typographyOptions.dropCap ?? false
  );
  markFirstEligibleDocumentDropCapParagraph(
    [...before, ...after],
    dropCap.enabled
  );
  const spanCount = Math.min(
    columnCount,
    Math.max(1, spanAttributes.spanCount)
  );
  const startColumn = Math.min(
    Math.max(1, spanAttributes.spanStartColumn),
    Math.max(1, columnCount - spanCount + 1)
  );
  const sideColumn = spanCount < columnCount
    ? (startColumn === 1 ? spanCount + 1 : 1)
    : null;
  const safeAvailableWidth = Math.max(1, availableWidthPx);
  const safeAvailableHeight = Math.max(1, availableHeightPx);
  const safeGap = Math.max(0, columnGapPx);
  const columnWidthPx = Math.max(
    1,
    (safeAvailableWidth - safeGap * (columnCount - 1)) / columnCount
  );
  const spanWidthPx =
    columnWidthPx * spanCount + safeGap * (spanCount - 1);
  const renderedImageWidthPx = Math.min(
    spanWidthPx,
    spanAttributes.widthPx
  );
  const aspectRatio =
    spanAttributes.naturalWidth / Math.max(1, spanAttributes.naturalHeight);
  const renderedImageHeightPx = calculateDocumentImageFrameHeight(
    spanAttributes,
    renderedImageWidthPx
  );

  const imageElement = children[imageIndex] as HTMLElement;
  imageElement.classList.add('document-span-layout__image');
  imageElement.style.width = `${renderedImageWidthPx}px`;
  imageElement.style.maxWidth = `${spanWidthPx}px`;
  imageElement.setAttribute('data-layout-role', 'spanning-image');
  imageElement.setAttribute(
    'data-rendered-width-px',
    String(renderedImageWidthPx)
  );
  imageElement.setAttribute(
    'data-rendered-height-px',
    String(renderedImageHeightPx)
  );
  imageElement.setAttribute('data-width-px', String(spanAttributes.widthPx));
  imageElement.setAttribute('data-height-px', String(
    calculateDocumentImageHeight(
      spanAttributes.widthPx,
      aspectRatio
    )
  ));
  const image = imageElement.querySelector<HTMLElement>(
    '.document-image__media'
  );
  if (image) {
    image.style.width = `${renderedImageWidthPx}px`;
    image.style.height = `${renderedImageHeightPx}px`;
  }
  const frame = imageElement.querySelector<HTMLElement>(
    '.document-image__frame'
  );
  if (frame) {
    frame.style.width = `${renderedImageWidthPx}px`;
    frame.style.height = `${renderedImageHeightPx}px`;
  }

  const measurer = createStructuredContentMeasurer({
    ...typographyOptions,
    dropCap,
  });
  try {
    const caption = imageElement.querySelector('figcaption');
    const captionHeightPx = caption
      ? measurer.measure([caption], renderedImageWidthPx)
      : 0;
    const imageRegionHeightPx = renderedImageHeightPx
      + (
        captionHeightPx > 0
          ? captionHeightPx + resolveStructuredCaptionSpacingPx(
              spanAttributes.captionSpacingPx,
              typographyOptions
            )
          : 0
      );
    const verticalSpacingPx = Math.max(
      0,
      spanAttributes.verticalSpacingPx
    );
    const precedingFullColumns = startColumn - 1;
    const preAnchorHeightPx = measurer.measure(before, columnWidthPx);
    const flowImageTopPx = (
      preAnchorHeightPx
      - precedingFullColumns * safeAvailableHeight
    );
    const requestedImageTopPx =
      spanAttributes.verticalAnchor === 'page-position'
        ? spanAttributes.yPx
        : flowImageTopPx;
    const imageTopPx = clampDocumentImageY(
      requestedImageTopPx,
      safeAvailableHeight,
      imageRegionHeightPx,
      verticalSpacingPx
    );
    const maximumImageYPx = Math.max(
      verticalSpacingPx,
      safeAvailableHeight - imageRegionHeightPx - verticalSpacingPx
    );
    const exclusionTopPx = Math.max(0, imageTopPx - verticalSpacingPx);
    const exclusionBottomPx = Math.min(
      safeAvailableHeight,
      imageTopPx + imageRegionHeightPx + verticalSpacingPx
    );
    const occupiedColumns = Array.from(
      { length: spanCount },
      (_, index) => startColumn + index
    );
    const columns = Array.from({ length: columnCount }, (_, index) => ({
      column: index + 1,
      occupied: occupiedColumns.includes(index + 1),
      topHtml: '',
      bottomHtml: '',
    }));
    const segmentOrder = buildPhysicalColumnSegments(
      columnCount,
      occupiedColumns,
      safeAvailableHeight,
      exclusionTopPx,
      exclusionBottomPx
    );
    let remaining = [...before, ...after];
    let skipColumn: number | null = null;
    let consumeBreakBeforeNextColumn = false;
    segmentOrder.forEach((segment) => {
      if (skipColumn === segment.column) return;
      if (consumeBreakBeforeNextColumn) {
        remaining = consumeLeadingDocumentColumnBreak(remaining);
        consumeBreakBeforeNextColumn = false;
      }
      const allocation = allocateElementsToHeight(
        remaining,
        columnWidthPx,
        segment.heightPx,
        measurer.measure
      );
      const column = columns[segment.column - 1];
      column[segment.region === 'top' ? 'topHtml' : 'bottomHtml'] =
        serializeElements(allocation.allocated);
      remaining = allocation.remaining;
      if (allocation.breakBefore) {
        skipColumn = segment.column;
        consumeBreakBeforeNextColumn = true;
      }
    });
    const overflowElements = remaining;
    const overflowing = overflowElements.length > 0;
    const overflowHeightPx = overflowing
      ? measurer.measure(overflowElements, columnWidthPx) / columnCount
      : 0;
    if (overflowing) {
      const finalSegment = segmentOrder[segmentOrder.length - 1];
      const finalColumn = columns[finalSegment.column - 1];
      const key =
        finalSegment.region === 'top' ? 'topHtml' : 'bottomHtml';
      finalColumn[key] += serializeElements(overflowElements);
    }
    const layoutContentHeightPx = safeAvailableHeight + overflowHeightPx;
    const beforeColumnHtml = columns.map((column) => column.topHtml);
    const afterColumnHtml = columns.map((column) => column.bottomHtml);

    return {
      imageId: spanAttributes.id,
      imagePosition: spanPosition,
      attributes: {
        ...spanAttributes,
        spanCount: spanCount as 1 | 2 | 3,
        spanStartColumn: startColumn as 1 | 2 | 3,
        yPx: imageTopPx,
      },
      beforeColumnHtml,
      sideHtml:
        sideColumn === null ? '' : columns[sideColumn - 1].topHtml,
      afterColumnHtml,
      imageHtml: imageElement.outerHTML,
      sideColumn,
      columnWidthPx,
      spanWidthPx,
      renderedImageWidthPx,
      renderedImageHeightPx,
      imageRegionHeightPx,
      layoutContentHeightPx,
      imageTopPx,
      exclusionTopPx,
      exclusionBottomPx,
      maximumImageYPx,
      availableHeightPx: safeAvailableHeight,
      overflowing,
      columns,
    };
  } finally {
    measurer.dispose();
  }
};

const mergeIntervals = (intervals: Array<[number, number]>) =>
  intervals
    .sort((left, right) => left[0] - right[0])
    .reduce<Array<[number, number]>>((merged, interval) => {
      const previous = merged[merged.length - 1];
      if (!previous || interval[0] > previous[1]) {
        merged.push([...interval]);
      } else {
        previous[1] = Math.max(previous[1], interval[1]);
      }
      return merged;
    }, []);

const intervalsAroundExclusions = (
  columnLeftPx: number,
  columnWidthPx: number,
  exclusions: DocumentImageRectangle[]
) => {
  const columnRightPx = columnLeftPx + columnWidthPx;
  const blocked = mergeIntervals(
    exclusions
      .map((rectangle): [number, number] => [
        Math.max(columnLeftPx, rectangle.leftPx),
        Math.min(columnRightPx, rectangle.leftPx + rectangle.widthPx),
      ])
      .filter(([left, right]) => right > left)
  );
  const available: Array<[number, number]> = [];
  let cursor = columnLeftPx;
  blocked.forEach(([left, right]) => {
    if (left > cursor) available.push([cursor, left]);
    cursor = Math.max(cursor, right);
  });
  if (cursor < columnRightPx) available.push([cursor, columnRightPx]);
  return available;
};

export const rectanglesOverlap = (
  left: DocumentImageRectangle,
  right: DocumentImageRectangle
) => kernelRectanglesOverlap(
  toBodyRectangle(left),
  toBodyRectangle(right)
);

export const moveRectangleWithoutCollisions = ({
  start,
  desiredLeftPx,
  desiredTopPx,
  obstacles,
  bounds,
}: {
  start: DocumentImageRectangle;
  desiredLeftPx: number;
  desiredTopPx: number;
  obstacles: DocumentImageRectangle[];
  bounds?: DocumentImageRectangle;
}) => {
  const moved = moveKernelRectangleWithoutCollisions({
    start: toBodyRectangle(start),
    desiredOrigin: bodyPoint(desiredLeftPx, desiredTopPx),
    obstacles: obstacles.map(toCollisionObstacle),
    bounds: bounds ? toBodyRectangle(bounds) : undefined,
  });
  return {
    leftPx: moved.rectangle.leftPx,
    topPx: moved.rectangle.topPx,
  };
};

export const buildMultiDocumentSpanLayoutModel = (
  editor: Editor,
  columnCount: 1 | 2 | 3,
  columnGapPx = 24,
  availableWidthPx = 720,
  availableHeightPx = 720,
  attributeOverrides: Record<string, Partial<DocumentImageAttributes>> = {},
  typographyOptions: StructuredDocumentTypographyOptions = {},
  imageGroups: readonly DocumentImageGroup[] = [],
  pagePositionOriginOffsetPx = 0,
  pageId?: string
): MultiDocumentSpanLayoutModel | null => {
  const positionedNodes: Array<{
    position: number;
    attributes: DocumentImageAttributes;
  }> = [];
  const flowImages: StructuredFlowImageLayout[] = [];
  editor.state.doc.descendants((node, position) => {
    if (
      node.type.name === 'documentFlowImage'
      && node.attrs.wrap === 'span-columns'
    ) {
      const normalized = normalizeDocumentImageAttributes({
        ...(node.attrs as Partial<DocumentImageAttributes>),
        ...(attributeOverrides[String(node.attrs.id)] || {}),
      });
      positionedNodes.push({ position, attributes: normalized });
      return false;
    }
    if (
      node.type.name === 'documentFlowImage'
      || node.type.name === 'documentInlineImage'
    ) {
      flowImages.push({
        imageId: String(node.attrs.id || ''),
        imagePosition: position,
        nodeType: node.type.name as DocumentImageNodeName,
        attributes: normalizeDocumentImageAttributes(
          node.attrs as Partial<DocumentImageAttributes>,
          node.type.name === 'documentInlineImage' ? 'inline' : 'float-left'
        ),
      });
    }
    return true;
  });
  if (positionedNodes.length === 0) return null;

  const parsed = new DOMParser().parseFromString(
    `<div data-document-span-source>${editor.getHTML()}</div>`,
    'text/html'
  );
  const source = parsed.querySelector('[data-document-span-source]');
  if (!source) return null;
  const children = Array.from(source.children);
  annotateSourceElementRanges(editor, children);
  const structuredIds = new Set(
    positionedNodes.map(({ attributes }) => attributes.id)
  );
  const textElements = children.filter((element) => !(
    element.getAttribute('data-wrap') === 'span-columns'
    && structuredIds.has(element.getAttribute('data-image-id') || '')
  ));
  markStructuredFlowImageElements(
    textElements,
    new Set(flowImages.map((image) => image.imageId))
  );
  const dropCap = normalizeDocumentDropCap(
    typographyOptions.dropCap ?? false
  );
  markFirstEligibleDocumentDropCapParagraph(
    textElements,
    dropCap.enabled
  );
  const safeWidth = Math.max(1, availableWidthPx);
  const safeHeight = Math.max(1, availableHeightPx);
  const pagePositionOffset = Math.max(
    0,
    Number.isFinite(pagePositionOriginOffsetPx)
      ? pagePositionOriginOffsetPx
      : 0
  );
  const bodyBounds = bodyRectangle(0, 0, safeWidth, safeHeight);
  const columnGeometry = getDocumentColumnRectangles({
    bodyWidthPx: safeWidth,
    bodyHeightPx: safeHeight,
    columnCount,
    columnGapPx,
  });
  const safeGap = columnGeometry.columnGapPx;
  const columnWidthPx = columnGeometry.columnWidthPx;
  const columnRectangles = columnGeometry.columns;
  const measurementDiagnostics: StructuredMeasurementDiagnostics = {
    count: 0,
    durationMs: 0,
  };
  const measurer = createStructuredContentMeasurer(
    {
      ...typographyOptions,
      dropCap,
    },
    measurementDiagnostics
  );
  try {
    const unresolvedCollisionIds = new Set<string>();
    const resolvedObstacles: CollisionObstacle<'body'>[] = [];
    const measuredImages = positionedNodes.flatMap((entry) => {
      const attributes = entry.attributes;
      const imageElement = children.find((element) =>
        element.getAttribute('data-image-id') === attributes.id
        && element.getAttribute('data-wrap') === 'span-columns'
      ) as HTMLElement | undefined;
      if (!imageElement) return [];
      const spanCount = Math.min(
        columnCount,
        Math.max(1, attributes.spanCount)
      );
      const startColumn = Math.min(
        Math.max(1, attributes.spanStartColumn),
        Math.max(1, columnCount - spanCount + 1)
      );
      const firstColumn = columnRectangles[startColumn - 1];
      const lastColumn = columnRectangles[
        startColumn + spanCount - 2
      ];
      const spanLeftPx = firstColumn.leftPx;
      const spanWidthPx = lastColumn.rightPx - firstColumn.leftPx;
      const renderedImageWidthPx = Math.min(
        spanWidthPx,
        attributes.widthPx
      );
      const renderedImageHeightPx = calculateDocumentImageFrameHeight(
        attributes,
        renderedImageWidthPx
      );
      const caption = imageElement.querySelector('figcaption');
      const captionHeightPx = caption
        ? measurer.measure([caption], renderedImageWidthPx)
        : 0;
      const imageRegionHeightPx = renderedImageHeightPx
        + (
          captionHeightPx > 0
            ? captionHeightPx + resolveStructuredCaptionSpacingPx(
                attributes.captionSpacingPx,
                typographyOptions
              )
            : 0
        );
      const placement = attributes.horizontalPlacement;
      const xOffsetPx = calculateDocumentImageXOffset({
        placement,
        xOffsetPx: attributes.xOffsetPx,
        spanWidthPx,
        imageWidthPx: renderedImageWidthPx,
      });
      const imageChildIndex = children.indexOf(imageElement);
      const semanticElements = children
        .slice(0, imageChildIndex)
        .filter((element) => !(
          element.getAttribute('data-wrap') === 'span-columns'
          && structuredIds.has(element.getAttribute('data-image-id') || '')
        ));
      const flowTop = (
        measurer.measure(semanticElements, columnWidthPx)
        - (startColumn - 1) * safeHeight
      );
      const isPagePositioned = attributes.verticalAnchor === 'page-position';
      const isPageSpacePositioned = isPagePositioned
        && attributes.coordinateSpace === 'page';
      const requestedImageTopPx = isPagePositioned
        ? attributes.yPx - (isPageSpacePositioned ? pagePositionOffset : 0)
        : flowTop;
      const imageTopPx = isPageSpacePositioned
        ? requestedImageTopPx
        : clampStructuredImageTop({
          value: requestedImageTopPx,
          availableHeightPx: safeHeight,
          imageRegionHeightPx,
          topPaddingPx: attributes.wrapPaddingTopPx,
          bottomPaddingPx: attributes.wrapPaddingBottomPx,
        });
      const requestedRectangle = bodyRectangle(
        spanLeftPx + xOffsetPx,
        imageTopPx,
        renderedImageWidthPx,
        imageRegionHeightPx
      );
      const placementBounds = bodyRectangle(
        spanLeftPx,
        attributes.wrapPaddingTopPx,
        spanWidthPx,
        Math.max(
          0,
          safeHeight
            - attributes.wrapPaddingTopPx
            - attributes.wrapPaddingBottomPx
        )
      );
      return [{
        imageId: attributes.id,
        imagePosition: entry.position,
        attributes: {
          ...attributes,
          spanCount: spanCount as 1 | 2 | 3,
          spanStartColumn: startColumn as 1 | 2 | 3,
        },
        imageElement,
        captionElement: caption,
        captionHeightPx,
        captionSpacingPx: captionHeightPx > 0
          ? resolveStructuredCaptionSpacingPx(
              attributes.captionSpacingPx,
              typographyOptions
            )
          : 0,
        spanLeftPx,
        spanWidthPx,
        renderedImageWidthPx,
        renderedImageHeightPx,
        imageRegionHeightPx,
        requestedRectangle,
        placementBounds,
      }];
    });
    const measuredById = new Map(
      measuredImages.map((image) => [image.imageId, image])
    );
    const claimedImageIds = new Set<string>();
    const activeGroups = imageGroups.flatMap((group) => {
      const members = group.childImageIds
        .map((imageId) => measuredById.get(imageId))
        .filter((image): image is (typeof measuredImages)[number] => (
          image !== undefined
        ));
      const anchor = members[0];
      const compatible = (
        members.length === group.childImageIds.length
        && members.length >= 2
        && members.every((image) => (
          image.attributes.verticalAnchor === 'page-position'
          && image.spanLeftPx === anchor.spanLeftPx
          && image.spanWidthPx === anchor.spanWidthPx
          && !claimedImageIds.has(image.imageId)
        ))
      );
      if (!compatible) return [];
      members.forEach((image) => claimedImageIds.add(image.imageId));
      return [{ group, members, anchor }];
    });

    const groupByChildId = new Map<string, string>();
    activeGroups.forEach(({ group }) => {
      group.childImageIds.forEach((imageId) => {
        groupByChildId.set(imageId, group.id);
      });
    });

    const groupUnits = activeGroups.map(({ group, members, anchor }) => {
      const gapTotal = group.gapPx * Math.max(0, members.length - 1);
      const rawWidthPx = group.kind === 'row'
        ? members.reduce(
            (width, image) => width + image.renderedImageWidthPx,
            0
          ) + gapTotal
        : (
            group.sharedWidth
              ? anchor.renderedImageWidthPx
              : Math.max(
                  ...members.map((image) => image.renderedImageWidthPx)
                )
          );
      const widthScale = rawWidthPx > anchor.spanWidthPx
        ? Math.max(
            0,
            group.kind === 'row'
              ? (
                  anchor.spanWidthPx - gapTotal
                ) / Math.max(1, rawWidthPx - gapTotal)
              : anchor.spanWidthPx / Math.max(1, rawWidthPx)
          )
        : 1;
      const sharedWidthPx = group.sharedWidth
        ? anchor.renderedImageWidthPx * widthScale
        : undefined;
      const childGeometry = members.map((image) => {
        const widthPx = group.sharedWidth
          ? sharedWidthPx!
          : image.renderedImageWidthPx * widthScale;
        const heightPx = calculateDocumentImageFrameHeight(
          image.attributes,
          widthPx
        );
        const captionHeightPx = image.captionElement
          ? measurer.measure([image.captionElement], widthPx)
          : 0;
        return {
          imageId: image.imageId,
          widthPx,
          heightPx,
          captionHeightPx,
          captionSpacingPx: captionHeightPx > 0
            ? image.captionSpacingPx
            : 0,
        };
      });
      if (childGeometry.some((child) => child.widthPx < 48)) {
        unresolvedCollisionIds.add(group.id);
      }
      const laidOutWidthPx = group.kind === 'row'
        ? childGeometry.reduce((total, child) => total + child.widthPx, 0)
          + gapTotal
        : Math.max(...childGeometry.map((child) => child.widthPx));
      const xOffsetPx = calculateDocumentImageXOffset({
        placement: anchor.attributes.horizontalPlacement,
        xOffsetPx: anchor.attributes.xOffsetPx,
        spanWidthPx: anchor.spanWidthPx,
        imageWidthPx: Math.min(anchor.spanWidthPx, laidOutWidthPx),
      });
      const requestedLayout = layoutDocumentImageGroup({
        kind: group.kind,
        origin: bodyPoint(
          anchor.spanLeftPx + xOffsetPx,
          anchor.requestedRectangle.topPx
        ),
        children: childGeometry,
        gapPx: group.gapPx,
        sharedWidth: group.kind === 'stack' && group.sharedWidth,
        sharedWidthPx,
      });
      const topPaddingPx = Math.max(
        ...members.map((image) => image.attributes.wrapPaddingTopPx)
      );
      const bottomPaddingPx = Math.max(
        ...members.map((image) => image.attributes.wrapPaddingBottomPx)
      );
      return {
        id: group.id,
        position: Math.min(...members.map((image) => image.imagePosition)),
        group,
        members,
        layout: requestedLayout,
        bounds: bodyRectangle(
          anchor.spanLeftPx,
          topPaddingPx,
          anchor.spanWidthPx,
          Math.max(0, safeHeight - topPaddingPx - bottomPaddingPx)
        ),
      };
    });
    const imageUnits = measuredImages
      .filter((image) => !claimedImageIds.has(image.imageId))
      .map((image) => ({
        id: image.imageId,
        position: image.imagePosition,
        image,
        rectangle: image.requestedRectangle,
        bounds: image.placementBounds,
      }));
    const units = [
      ...groupUnits.map((unit) => ({ type: 'group' as const, ...unit })),
      ...imageUnits.map((unit) => ({ type: 'image' as const, ...unit })),
    ].sort((left, right) => left.position - right.position);
    const positionedUnits = units.filter((unit) => (
      unit.type === 'group'
      || unit.image.attributes.verticalAnchor === 'page-position'
    ));
    const flowUnits = units.filter((unit) => (
      unit.type === 'image'
        ? unit.image.attributes.verticalAnchor !== 'page-position'
        : false
    ));
    const resolvedRectangles = new Map<string, BodyRectangle>();
    const resolvedGroupLayouts = new Map<string, DocumentImageGroupLayout>();
    const structuredGroups: StructuredImageGroupLayout[] = [];

    // `requestedRectangle` is the authored/layout request. The rectangle
    // stored in `resolvedObstacles` is render-only geometry. Positioned image
    // units are fixed obstacles: passive rendering must never move them.
    [...positionedUnits, ...flowUnits].forEach((unit) => {
      const requestedRectangle = unit.type === 'group'
        ? unit.layout.bounds
        : unit.rectangle;
      const existingCollisions = findKernelRectangleCollisions(
        requestedRectangle,
        resolvedObstacles
      );
      const overlapResolution = positionedUnits.includes(unit)
        ? {
            rectangle: requestedRectangle,
            resolved: existingCollisions.length === 0,
            collisionIds: existingCollisions.map((obstacle) => obstacle.id),
          }
        : resolveInitialRectangleOverlaps({
            rectangle: requestedRectangle,
            obstacles: resolvedObstacles,
            bounds: unit.bounds,
          });
      if (!overlapResolution.resolved) {
        unresolvedCollisionIds.add(unit.id);
        overlapResolution.collisionIds.forEach((id) => {
          unresolvedCollisionIds.add(id);
        });
      }
      resolvedObstacles.push({
        id: unit.id,
        rectangle: overlapResolution.rectangle,
      });
      if (unit.type === 'image') {
        resolvedRectangles.set(
          unit.image.imageId,
          overlapResolution.rectangle
        );
        return;
      }
      const resolvedLayout = translateDocumentImageGroupLayout(
        unit.layout,
        bodyDelta(
          overlapResolution.rectangle.leftPx - unit.layout.bounds.leftPx,
          overlapResolution.rectangle.topPx - unit.layout.bounds.topPx
        )
      );
      resolvedGroupLayouts.set(unit.group.id, resolvedLayout);
      resolvedLayout.children.forEach((child) => {
        resolvedRectangles.set(child.imageId, child.occupiedRectangle);
      });
      structuredGroups.push({
        groupId: unit.group.id,
        kind: unit.group.kind,
        childImageIds: unit.group.childImageIds,
        anchorImageId: unit.group.childImageIds[0],
        gapPx: unit.group.gapPx,
        sharedWidth: unit.group.sharedWidth,
        spanLeftPx: unit.members[0].spanLeftPx,
        spanWidthPx: unit.members[0].spanWidthPx,
        bounds: {
          imageId: unit.group.id,
          leftPx: resolvedLayout.bounds.leftPx,
          topPx: resolvedLayout.bounds.topPx,
          widthPx: resolvedLayout.bounds.widthPx,
          heightPx: resolvedLayout.bounds.heightPx,
        },
      });
    });

    const images: StructuredImageLayout[] = measuredImages.flatMap((image) => {
      const resolvedRectangle = resolvedRectangles.get(image.imageId);
      if (!resolvedRectangle) return [];
      const groupId = groupByChildId.get(image.imageId);
      const groupLayout = groupId
        ? resolvedGroupLayouts.get(groupId)
        : undefined;
      const groupChild = groupLayout?.children.find(
        (child) => child.imageId === image.imageId
      );
      const renderedImageWidthPx = groupChild?.imageRectangle.widthPx
        ?? resolvedRectangle.widthPx;
      const renderedImageHeightPx = groupChild?.imageRectangle.heightPx
        ?? (
          calculateDocumentImageFrameHeight(
            image.attributes,
            renderedImageWidthPx
          )
        );
      const authoredFrame = groupChild
        ? {
            leftPx: groupChild.imageRectangle.leftPx,
            topPx: groupChild.imageRectangle.topPx,
            widthPx: groupChild.imageRectangle.widthPx,
            heightPx: groupChild.imageRectangle.heightPx,
          }
        : {
            leftPx: image.requestedRectangle.leftPx,
            topPx: image.requestedRectangle.topPx,
            widthPx: image.renderedImageWidthPx,
            heightPx: image.renderedImageHeightPx,
          };
      const imageRegionHeightPx = resolvedRectangle.heightPx;
      image.imageElement.classList.add(
        'document-span-layout__image',
        'document-span-layout__image--structured'
      );
      image.imageElement.style.width = `${renderedImageWidthPx}px`;
      image.imageElement.style.maxWidth = `${renderedImageWidthPx}px`;
      image.imageElement.setAttribute('data-layout-role', 'spanning-image');
      image.imageElement.setAttribute(
        'data-rendered-width-px',
        String(renderedImageWidthPx)
      );
      image.imageElement.setAttribute(
        'data-rendered-height-px',
        String(renderedImageHeightPx)
      );
      if (groupId) {
        image.imageElement.setAttribute('data-image-group-id', groupId);
      }
      const media = image.imageElement.querySelector<HTMLElement>(
        '.document-image__media'
      );
      if (media) {
        media.style.width = `${renderedImageWidthPx}px`;
        media.style.height = `${renderedImageHeightPx}px`;
      }
      const frame = image.imageElement.querySelector<HTMLElement>(
        '.document-image__frame'
      );
      if (frame) {
        frame.setAttribute(
          'data-document-visible-image-id',
          image.imageId
        );
        frame.setAttribute('data-document-image-hit-target', 'true');
        frame.style.width = `${renderedImageWidthPx}px`;
        frame.style.height = `${renderedImageHeightPx}px`;
      }
      return [{
        imageId: image.imageId,
        imagePosition: image.imagePosition,
        attributes: image.attributes,
        authoredFrame,
        imageHtml: image.imageElement.outerHTML,
        spanLeftPx: image.spanLeftPx,
        spanWidthPx: image.spanWidthPx,
        renderedImageWidthPx,
        renderedImageHeightPx,
        renderedXOffsetPx: resolvedRectangle.leftPx - image.spanLeftPx,
        imageRegionHeightPx,
        imageLeftPx: resolvedRectangle.leftPx,
        imageTopPx: resolvedRectangle.topPx,
        maximumXOffsetPx: Math.max(
          0,
          image.spanWidthPx - renderedImageWidthPx
        ),
        maximumImageYPx: Math.max(
          image.attributes.wrapPaddingTopPx,
          safeHeight
          - imageRegionHeightPx
          - image.attributes.wrapPaddingBottomPx
        ),
        groupId,
      }];
    });
    const collisionRectangles = images.map((image) => ({
      imageId: image.imageId,
      leftPx: image.imageLeftPx,
      topPx: image.imageTopPx,
      widthPx: image.renderedImageWidthPx,
      heightPx: image.imageRegionHeightPx,
    }));
    const collisionUnits = resolvedObstacles.map((obstacle) => ({
      imageId: obstacle.id,
      leftPx: obstacle.rectangle.leftPx,
      topPx: obstacle.rectangle.topPx,
      widthPx: obstacle.rectangle.widthPx,
      heightPx: obstacle.rectangle.heightPx,
    }));
    const exclusions = images.flatMap((image) => {
      const exclusion = buildExclusionRectangle({
        occupiedRectangles: [bodyRectangle(
          image.imageLeftPx,
          image.imageTopPx,
          image.renderedImageWidthPx,
          image.imageRegionHeightPx
        )],
        padding: {
          topPx: image.attributes.wrapPaddingTopPx,
          rightPx: image.attributes.wrapPaddingRightPx,
          bottomPx: image.attributes.wrapPaddingBottomPx,
          leftPx: image.attributes.wrapPaddingLeftPx,
        },
        bounds: bodyBounds,
      });
      return exclusion
        ? [{
            imageId: image.imageId,
            leftPx: exclusion.leftPx,
            topPx: exclusion.topPx,
            widthPx: exclusion.widthPx,
            heightPx: exclusion.heightPx,
          }]
        : [];
    });
    const candidateBands: Array<Omit<
      StructuredTextBand,
      'html' | 'fragments' | 'documentFrom' | 'documentTo' | 'lineFrom' | 'lineTo'
    >> = [];
    for (let column = 1; column <= columnCount; column += 1) {
      const columnRectangle = columnRectangles[column - 1];
      const columnLeftPx = columnRectangle.leftPx;
      const intersecting = exclusions.filter((rectangle) => (
        rectangle.leftPx < columnRectangle.rightPx
        && rectangle.leftPx + rectangle.widthPx > columnLeftPx
      ));
      const boundaries = Array.from(new Set([
        0,
        safeHeight,
        ...intersecting.flatMap((rectangle) => [
          Math.max(0, rectangle.topPx),
          Math.min(
            safeHeight,
            rectangle.topPx + rectangle.heightPx
          ),
        ]),
      ])).sort((left, right) => left - right);
      for (let index = 0; index < boundaries.length - 1; index += 1) {
        const topPx = boundaries[index];
        const bottomPx = boundaries[index + 1];
        if (bottomPx <= topPx) continue;
        const active = intersecting.filter((rectangle) => (
          rectangle.topPx < bottomPx
          && rectangle.topPx + rectangle.heightPx > topPx
        ));
        intervalsAroundExclusions(
          columnLeftPx,
          columnRectangle.widthPx,
          active
        ).forEach(([left, right], intervalIndex) => {
          const widthPx = right - left;
          if (widthPx < 72) return;
          candidateBands.push({
            id: `column-${column}-band-${index}-${intervalIndex}`,
            column,
            topPx,
            leftPx: left,
            widthPx,
            heightPx: bottomPx - topPx,
          });
        });
      }
    }
    let remaining = [...textElements];
    const fragmentIndexes = new Map<number, number>();
    let skipColumn: number | null = null;
    let consumeBreakBeforeNextColumn = false;
    const textBands = candidateBands.map((band) => {
      if (skipColumn === band.column) {
        return {
          ...band,
          html: '',
          fragments: [],
          documentFrom: null,
          documentTo: null,
          lineFrom: null,
          lineTo: null,
        };
      }
      if (consumeBreakBeforeNextColumn) {
        remaining = consumeLeadingDocumentColumnBreak(remaining);
        consumeBreakBeforeNextColumn = false;
      }
      const allocation = allocateElementsToHeight(
        remaining,
        band.widthPx,
        band.heightPx,
        measurer.measure
      );
      remaining = allocation.remaining;
      if (allocation.breakBefore) {
        skipColumn = band.column;
        consumeBreakBeforeNextColumn = true;
      }
      const documentRange = getElementsDocumentTextRange(
        allocation.allocated
      );
      const fragments = createStructuredTextFragments(
        allocation.allocated,
        band,
        pageId,
        fragmentIndexes,
        measurer.measure
      );
      return {
        ...band,
        html: serializeElements(allocation.allocated),
        fragments,
        documentFrom: documentRange?.from ?? null,
        documentTo: documentRange?.to ?? null,
        lineFrom: documentRange?.from ?? null,
        lineTo: documentRange?.to ?? null,
      };
    });
    const overflowing = (
      remaining.length > 0
      || unresolvedCollisionIds.size > 0
    );
    if (overflowing && textBands.length > 0) {
      textBands[textBands.length - 1].html += serializeElements(remaining);
      const overflowRange = getElementsDocumentTextRange(remaining);
      if (overflowRange) {
        const finalBand = textBands[textBands.length - 1];
        finalBand.fragments.push(...createStructuredTextFragments(
          remaining,
          finalBand,
          pageId,
          fragmentIndexes,
          measurer.measure
        ));
        finalBand.documentFrom = finalBand.documentFrom === null
          ? overflowRange.from
          : Math.min(finalBand.documentFrom, overflowRange.from);
        finalBand.documentTo = finalBand.documentTo === null
          ? overflowRange.to
          : Math.max(finalBand.documentTo, overflowRange.to);
        finalBand.lineFrom = finalBand.documentFrom;
        finalBand.lineTo = finalBand.documentTo;
      }
    }
    const overflowHeightPx = overflowing
      ? measurer.measure(remaining, columnWidthPx) / columnCount
      : 0;
    return {
      images,
      flowImages,
      imageGroups: structuredGroups,
      exclusions,
      collisionRectangles,
      collisionUnits,
      textBands,
      textFragments: textBands.flatMap((band) => band.fragments),
      columnWidthPx,
      columnGapPx: safeGap,
      availableWidthPx: safeWidth,
      availableHeightPx: safeHeight,
      layoutContentHeightPx: safeHeight + overflowHeightPx,
      overflowing,
      unresolvedCollisionIds: [...unresolvedCollisionIds].sort(),
      structuredMeasurementCount: measurementDiagnostics.count,
      structuredMeasurementDurationMs: measurementDiagnostics.durationMs,
    };
  } finally {
    measurer.dispose();
  }
};

type StructuredDocumentSpanLayoutProps = {
  editor: Editor;
  pageId?: string;
  columnCount: 1 | 2 | 3;
  columnGapPx: number;
  availableWidthPx: number;
  availableHeightPx: number;
  revision: number;
  selectionRevision: number;
  textEditing: boolean;
  activeTextFragmentId?: string | null;
  viewScale: number;
  minimumImageWidthPx: number;
  maximumFlowImageWidthPx: number;
  typographyStyle?: CSSProperties;
  dropCap?: DocumentDropCapSettings | boolean;
  language?: string;
  imageGroups?: readonly DocumentImageGroup[];
  pagePositionOriginOffsetPx?: number;
  selectedImageIds?: readonly string[];
  onSelectImage: (
    position: number,
    imageId: string,
    additive: boolean,
    nodeType?: DocumentImageNodeName
  ) => void;
  onCommitImagePosition: (
    position: number,
    imageId: string,
    xOffsetPx: number,
    yPx: number
  ) => boolean;
  onCommitImageSize: (
    position: number,
    imageId: string,
    widthPx: number,
    heightPx: number,
    xOffsetPx: number
  ) => boolean;
  onEditText: (position?: number, fragmentId?: string | null) => void;
};

type StructuredInteractionIntent = {
  pointerId: number;
  owner: 'text' | 'image' | 'resize';
  phase: 'pressed' | 'dragging' | 'released';
  imageId?: string;
  fragmentId?: string | null;
  textPosition?: number | null;
};

const rectangleCollides = (
  rectangle: DocumentImageRectangle,
  obstacles: DocumentImageRectangle[]
) => findKernelRectangleCollisions(
  toBodyRectangle(rectangle),
  obstacles.map(toCollisionObstacle)
).length > 0;

const findDocumentTextRangeElement = (
  node: Node | null
): HTMLElement | null => {
  const element = node instanceof HTMLElement
    ? node
    : node?.parentElement;
  return element?.closest<HTMLElement>(
    `[${DOCUMENT_TEXT_FROM_ATTRIBUTE}][${DOCUMENT_TEXT_TO_ATTRIBUTE}]`
  ) || null;
};

/**
 * Converts a DOM text point into a ProseMirror content offset.  Text nodes
 * have the same UTF-16 length as ProseMirror text, but inline atom nodes have
 * a document size even though they contribute no textContent.  Counting those
 * atoms here keeps hit testing correct for marked text surrounding an inline
 * image without using visual character counts as document ranges.
 */
const getDocumentTextOffsetWithinElement = (
  element: HTMLElement,
  node: Node,
  offset: number
) => {
  let textOffset = 0;
  let found = false;
  const visit = (current: Node) => {
    if (found) return;
    if (current === node) {
      if (current.nodeType === 3) {
        textOffset += Math.min(
          Math.max(0, offset),
          current.textContent?.length || 0
        );
      }
      found = true;
      return;
    }
    if (
      current.nodeType === 1
      && current !== element
      && (current as Element).hasAttribute('data-document-image')
    ) {
      // Document images are ProseMirror atom nodes. Their caption/alt markup
      // is presentation and must not be counted as text content.
      textOffset += 1;
      return;
    }
    if (current.nodeType === 3) {
      textOffset += current.textContent?.length || 0;
      return;
    }
    current.childNodes.forEach(visit);
  };
  visit(element);
  return textOffset;
};

const findDocumentFragmentElement = (
  node: Node | null
): HTMLElement | null => {
  const element = node instanceof HTMLElement
    ? node
    : node?.parentElement;
  return element?.closest<HTMLElement>(
    `[${DOCUMENT_FRAGMENT_ID_ATTRIBUTE}][${DOCUMENT_FRAGMENT_FROM_ATTRIBUTE}][${DOCUMENT_FRAGMENT_TO_ATTRIBUTE}]`
  ) || null;
};

const clampStructuredDocumentPosition = (
  editor: Editor,
  position: number
) => {
  const maximum = Math.max(1, editor.state.doc.content.size);
  return Math.max(1, Math.min(maximum, Math.round(position)));
};

const getCaretRangeAtPoint = (
  ownerDocument: Document,
  clientX: number,
  clientY: number
): Range | null => {
  const documentWithCaret = ownerDocument as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (
      x: number,
      y: number
    ) => { offsetNode: Node; offset: number } | null;
  };
  const range = documentWithCaret.caretRangeFromPoint?.(clientX, clientY);
  if (range) return range;
  const position = documentWithCaret.caretPositionFromPoint?.(clientX, clientY);
  if (!position) return null;
  const converted = ownerDocument.createRange();
  converted.setStart(position.offsetNode, position.offset);
  converted.collapse(true);
  return converted;
};

const getStructuredCaretRangeAtPoint = (
  root: HTMLElement,
  clientX: number,
  clientY: number
) => {
  const editorRoot = root.closest<HTMLElement>('.document-flow-editor');
  const liveSurface = editorRoot?.querySelector<HTMLElement>(
    '.document-flow-editor__content--structured-text-editing .document-flow-prosemirror'
  );
  if (!liveSurface) {
    return getCaretRangeAtPoint(root.ownerDocument, clientX, clientY);
  }

  // The live source is intentionally painted above the frozen layout's
  // transparent text hit regions. Temporarily taking it out of hit testing
  // lets the browser resolve the same coordinate against the canonical band
  // line boxes, without changing the persistent editor selection or leaving
  // a visible frame between pointer events.
  const previousDisplay = liveSurface.style.display;
  root.dataset.resolvingTextHit = 'true';
  liveSurface.style.display = 'none';
  try {
    return getCaretRangeAtPoint(root.ownerDocument, clientX, clientY);
  } finally {
    liveSurface.style.display = previousDisplay;
    delete root.dataset.resolvingTextHit;
  }
};

export type StructuredDocumentTextHit = Readonly<{
  position: number;
  fragmentId: string | null;
}>;

const resolveStructuredBandPositionAtPoint = (
  root: HTMLElement,
  editor: Editor,
  clientX: number,
  clientY: number
) : StructuredDocumentTextHit | null => {
  const fragmentSelector = (
    `[${DOCUMENT_FRAGMENT_ID_ATTRIBUTE}]`
    + `[${DOCUMENT_FRAGMENT_FROM_ATTRIBUTE}]`
    + `[${DOCUMENT_FRAGMENT_TO_ATTRIBUTE}]`
  );
  const rangeSelector = (
    `[${DOCUMENT_REGION_ATTRIBUTE}]`
    + `[${DOCUMENT_TEXT_FROM_ATTRIBUTE}]`
    + `[${DOCUMENT_TEXT_TO_ATTRIBUTE}]`
  );
  const hit = typeof root.ownerDocument.elementFromPoint === 'function'
    ? root.ownerDocument.elementFromPoint(clientX, clientY)
    : null;
  const hitFragment = hit instanceof Element
    ? hit.closest<HTMLElement>(fragmentSelector)
    : null;
  const candidates = hitFragment
    ? [hitFragment]
    : Array.from(root.querySelectorAll<HTMLElement>(fragmentSelector));
  const fallbackCandidates = candidates.length > 0
    ? candidates
    : Array.from(root.querySelectorAll<HTMLElement>(rangeSelector));
  let nearestHit: StructuredDocumentTextHit | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  fallbackCandidates.forEach((band) => {
    const fragmentRange = readDocumentAttributeRange(
      band,
      DOCUMENT_FRAGMENT_FROM_ATTRIBUTE,
      DOCUMENT_FRAGMENT_TO_ATTRIBUTE
    );
    const sourceRange = fragmentRange || readDocumentTextRange(band);
    if (!sourceRange || !band.textContent?.length) return;
    const walker = band.ownerDocument.createTreeWalker(band, 4);
    let current = walker.nextNode();
    while (current) {
      const textNode = current;
      const text = textNode.textContent || '';
      for (let index = 0; index < text.length; index += 1) {
        const characterRange = band.ownerDocument.createRange();
        characterRange.setStart(textNode, index);
        characterRange.setEnd(textNode, index + 1);
        const rectangles = typeof characterRange.getClientRects === 'function'
          ? Array.from(characterRange.getClientRects())
          : [];
        rectangles.forEach((rectangle) => {
          const verticalDistance = clientY < rectangle.top
            ? rectangle.top - clientY
            : clientY > rectangle.bottom ? clientY - rectangle.bottom : 0;
          const horizontalDistance = clientX < rectangle.left
            ? rectangle.left - clientX
            : clientX > rectangle.right ? clientX - rectangle.right : 0;
          const distance = verticalDistance * verticalDistance
            + horizontalDistance * horizontalDistance;
          if (distance >= nearestDistance) return;
          const offset = clientX > rectangle.right
            ? index + 1
            : clientX > rectangle.left + rectangle.width / 2
              ? index + 1
              : index;
          nearestDistance = distance;
          const documentOffset = getDocumentTextOffsetWithinElement(
            band,
            textNode,
            offset
          );
          nearestHit = {
            position: clampStructuredDocumentPosition(
              editor,
              sourceRange.from + documentOffset
            ),
            fragmentId: band.getAttribute(DOCUMENT_FRAGMENT_ID_ATTRIBUTE),
          };
        });
      }
      current = walker.nextNode();
    }
  });

  return nearestHit;
};

/**
 * Resolves browser viewport coordinates against the visible structured text
 * DOM. The browser supplies the caret offset from real line boxes; no fixed
 * character width, line height, zoom, or column index is inferred here.
 */
export const resolveStructuredDocumentPositionAtPoint = ({
  root,
  editor,
  clientX,
  clientY,
}: {
  root: HTMLElement;
  editor: Editor;
  clientX: number;
  clientY: number;
}): number | null => {
  const hit = resolveStructuredDocumentTextAtPoint({
    root,
    editor,
    clientX,
    clientY,
  });
  return hit?.position ?? null;
};

/**
 * Resolves both the document position and the exact structured fragment that
 * owns the clicked line box.  The fragment identity is carried through the
 * text-entry transition; callers do not have to rediscover geometry after the
 * live editor has changed the DOM.
 */
export const resolveStructuredDocumentTextAtPoint = ({
  root,
  editor,
  clientX,
  clientY,
}: {
  root: HTMLElement;
  editor: Editor;
  clientX: number;
  clientY: number;
}): StructuredDocumentTextHit | null => {
  const structuredHit = resolveStructuredBandPositionAtPoint(
    root,
    editor,
    clientX,
    clientY
  );
  if (structuredHit !== null) return structuredHit;
  const range = getStructuredCaretRangeAtPoint(root, clientX, clientY);
  if (range) {
    const fragmentElement = findDocumentFragmentElement(range.startContainer);
    const sourceElement = fragmentElement
      || findDocumentTextRangeElement(range.startContainer);
    const sourceRange = fragmentElement
      ? readDocumentAttributeRange(
          fragmentElement,
          DOCUMENT_FRAGMENT_FROM_ATTRIBUTE,
          DOCUMENT_FRAGMENT_TO_ATTRIBUTE
        )
      : sourceElement
        ? readDocumentTextRange(sourceElement)
        : null;
    if (sourceElement && sourceRange) {
      const offset = getDocumentTextOffsetWithinElement(
        sourceElement,
        range.startContainer,
        range.startOffset
      );
      return {
        position: clampStructuredDocumentPosition(editor, sourceRange.from + offset),
        fragmentId: fragmentElement?.getAttribute(
          DOCUMENT_FRAGMENT_ID_ATTRIBUTE
        ) || null,
      };
    }
  }

  const candidates = Array.from(root.querySelectorAll<HTMLElement>(
    `[${DOCUMENT_REGION_ATTRIBUTE}][${DOCUMENT_FRAGMENT_FROM_ATTRIBUTE}][${DOCUMENT_FRAGMENT_TO_ATTRIBUTE}]`
  )).filter((element) => (element.textContent || '').length > 0);
  const fallbackCandidates = candidates.length > 0
    ? candidates
    : Array.from(root.querySelectorAll<HTMLElement>(
        `[${DOCUMENT_REGION_ATTRIBUTE}][${DOCUMENT_TEXT_FROM_ATTRIBUTE}][${DOCUMENT_TEXT_TO_ATTRIBUTE}]`
      )).filter((element) => (element.textContent || '').length > 0);
  if (fallbackCandidates.length === 0) return null;
  const nearest = fallbackCandidates
    .map((element) => {
      const rect = element.getBoundingClientRect();
      const dx = clientX < rect.left
        ? rect.left - clientX
        : clientX > rect.right ? clientX - rect.right : 0;
      const dy = clientY < rect.top
        ? rect.top - clientY
        : clientY > rect.bottom ? clientY - rect.bottom : 0;
      return { element, rect, distance: dx * dx + dy * dy };
    })
    .sort((left, right) => left.distance - right.distance)[0];
  const fragmentRange = readDocumentAttributeRange(
    nearest.element,
    DOCUMENT_FRAGMENT_FROM_ATTRIBUTE,
    DOCUMENT_FRAGMENT_TO_ATTRIBUTE
  );
  const sourceRange = fragmentRange || readDocumentTextRange(nearest.element);
  if (!sourceRange) return null;
  const position = clientY <= nearest.rect.top
    || (clientY <= nearest.rect.bottom && clientX <= nearest.rect.left)
    ? sourceRange.from
    : sourceRange.to;
  return {
    position: clampStructuredDocumentPosition(editor, position),
    fragmentId: nearest.element.getAttribute(DOCUMENT_FRAGMENT_ID_ATTRIBUTE),
  };
};

export const clampResizeWidthWithoutCollisions = ({
  startWidthPx,
  desiredWidthPx,
  buildRectangle,
  obstacles,
}: {
  startWidthPx: number;
  desiredWidthPx: number;
  buildRectangle: (widthPx: number) => DocumentImageRectangle;
  obstacles: DocumentImageRectangle[];
}) => {
  if (startWidthPx === desiredWidthPx || obstacles.length === 0) {
    return desiredWidthPx;
  }
  const steps = 32;
  let lastSafe = startWidthPx;
  for (let index = 1; index <= steps; index += 1) {
    const candidate = startWidthPx
      + (desiredWidthPx - startWidthPx) * (index / steps);
    if (rectangleCollides(buildRectangle(candidate), obstacles)) {
      let low = lastSafe;
      let high = candidate;
      for (let iteration = 0; iteration < 18; iteration += 1) {
        const middle = (low + high) / 2;
        if (rectangleCollides(buildRectangle(middle), obstacles)) {
          high = middle;
        } else {
          low = middle;
        }
      }
      return low;
    }
    lastSafe = candidate;
  }
  return desiredWidthPx;
};

export const StructuredDocumentSpanLayout = ({
  editor,
  pageId,
  columnCount,
  columnGapPx,
  availableWidthPx,
  availableHeightPx,
  revision,
  selectionRevision,
  textEditing,
  activeTextFragmentId = null,
  viewScale,
  minimumImageWidthPx,
  maximumFlowImageWidthPx,
  typographyStyle,
  dropCap = false,
  language,
  imageGroups = [],
  pagePositionOriginOffsetPx = 0,
  selectedImageIds = [],
  onSelectImage,
  onCommitImagePosition,
  onCommitImageSize,
  onEditText,
}: StructuredDocumentSpanLayoutProps) => {
  const [previewOverrides, setPreviewOverrides] = useState<
    Record<string, Partial<DocumentImageAttributes>>
  >({});
  const [flowImageFrames, setFlowImageFrames] = useState<
    Record<string, StructuredImageFrameGeometry>
  >({});
  const [flowImageResizePreview, setFlowImageResizePreview] = useState<
    Record<string, StructuredImageFrameGeometry>
  >({});
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const interactionIntentRef = useRef<StructuredInteractionIntent | null>(null);
  const imageSlotRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const snapGuideRefs = useRef<
    Record<'x' | 'y', HTMLDivElement | null>
  >({ x: null, y: null });
  const dragVisualPendingRef = useRef<{
    imageIds: readonly string[];
    deltaXPx: number;
    deltaYPx: number;
    guides: readonly DocumentSnapGuide[];
  } | null>(null);
  const dragVisualFrameRef = useRef<number | null>(null);
  const dragVisualFrameUsesAnimationFrameRef = useRef(false);
  const pendingDragCommitCleanupRef = useRef<{
    imageIds: readonly string[];
    imageId: string;
    xOffsetPx: number;
    yPx: number;
  } | null>(null);
  const layoutRenderCountRef = useRef(0);
  const modelBuildCountRef = useRef(0);
  const modelBuildDurationMsRef = useRef(0);
  const modelBuildTotalDurationMsRef = useRef(0);
  const structuredMeasurementCountRef = useRef(0);
  const structuredMeasurementDurationMsRef = useRef(0);
  const structuredMeasurementTotalCountRef = useRef(0);
  const structuredMeasurementTotalDurationMsRef = useRef(0);
  const dragPointerMoveCountRef = useRef(0);
  const dragVisualFrameCountRef = useRef(0);
  const dragCommitCountRef = useRef(0);
  const imageGroupsSignature = useMemo(
    () => JSON.stringify(imageGroups),
    [imageGroups]
  );
  const stableImageGroups = useMemo(
    () => imageGroups,
    [imageGroupsSignature]
  );
  const typographyStyleSignature = useMemo(
    () => JSON.stringify(typographyStyle || {}),
    [typographyStyle]
  );
  const stableTypographyStyle = useMemo(
    () => typographyStyle,
    [typographyStyleSignature]
  );
  const dropCapSignature = useMemo(
    () => JSON.stringify(dropCap),
    [dropCap]
  );
  const stableDropCap = useMemo(
    () => dropCap,
    [dropCapSignature]
  );
  layoutRenderCountRef.current += 1;
  const model = useMemo(
    () => {
      const startedAt = typeof performance === 'undefined'
        ? 0
        : performance.now();
      modelBuildCountRef.current += 1;
      const nextModel = buildMultiDocumentSpanLayoutModel(
        editor,
        columnCount,
        columnGapPx,
        availableWidthPx,
        availableHeightPx,
        previewOverrides,
        {
          typographyStyle: stableTypographyStyle,
          dropCap: stableDropCap,
          language,
        },
        stableImageGroups,
        pagePositionOriginOffsetPx,
        pageId
      );
      const buildDurationMs = typeof performance === 'undefined'
        ? 0
        : performance.now() - startedAt;
      modelBuildDurationMsRef.current = buildDurationMs;
      modelBuildTotalDurationMsRef.current += buildDurationMs;
      structuredMeasurementCountRef.current = nextModel?.structuredMeasurementCount || 0;
      structuredMeasurementDurationMsRef.current =
        nextModel?.structuredMeasurementDurationMs || 0;
      structuredMeasurementTotalCountRef.current += (
        nextModel?.structuredMeasurementCount || 0
      );
      structuredMeasurementTotalDurationMsRef.current += (
        nextModel?.structuredMeasurementDurationMs || 0
      );
      return nextModel;
    },
    [
      availableHeightPx,
      availableWidthPx,
      columnCount,
      columnGapPx,
      editor,
      stableDropCap,
      stableImageGroups,
      pagePositionOriginOffsetPx,
      pageId,
      previewOverrides,
      revision,
      stableTypographyStyle,
      language,
    ]
  );

  useLayoutEffect(() => {
    const root = layoutRef.current;
    if (!root || !model) {
      setFlowImageFrames({});
      return undefined;
    }

    const measureFlowImages = () => {
      const rootRect = root.getBoundingClientRect();
      const scaleX = rootRect.width / Math.max(1, root.offsetWidth);
      const scaleY = rootRect.height / Math.max(1, root.offsetHeight);
      const next: Record<string, StructuredImageFrameGeometry> = {};
      model.flowImages.forEach((image) => {
        const candidates = Array.from(
          root.querySelectorAll<HTMLElement>(
            '[data-document-structured-flow-image="true"]'
          )
        ).filter((candidate) => (
          candidate.dataset.imageId === image.imageId
        ));
        const frame = candidates
          .map((candidate) => (
            candidate.matches('.document-image__frame')
              ? candidate
              : candidate.querySelector<HTMLElement>('.document-image__frame')
          ))
          .find((candidate) => {
            if (!candidate) return false;
            const rect = candidate.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
          });
        if (!frame) return;
        const rect = frame.getBoundingClientRect();
        next[image.imageId] = {
          leftPx: (rect.left - rootRect.left) / Math.max(0.05, scaleX),
          topPx: (rect.top - rootRect.top) / Math.max(0.05, scaleY),
          widthPx: rect.width / Math.max(0.05, scaleX),
          heightPx: rect.height / Math.max(0.05, scaleY),
        };
      });
      setFlowImageFrames((current) => (
        JSON.stringify(current) === JSON.stringify(next) ? current : next
      ));
    };

    measureFlowImages();
    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(measureFlowImages)
      : null;
    resizeObserver?.observe(root);
    root.addEventListener('load', measureFlowImages, true);
    return () => {
      resizeObserver?.disconnect();
      root.removeEventListener('load', measureFlowImages, true);
    };
  }, [model]);
  const dragRef = useRef<{
    pointerId: number;
    imageId: string;
    position: number;
    startClientX: number;
    startClientY: number;
    startImageX: number;
    startImageY: number;
    spanLeftPx: number;
    maximumXOffsetPx: number;
    topPaddingPx: number;
    bottomPaddingPx: number;
    startRectangle: DocumentImageRectangle;
    obstacles: DocumentImageRectangle[];
    captureElement: HTMLElement;
    previewImageIds: readonly string[];
    originalXOffsetPx: number;
    originalYPx: number;
    pinOnDrag: boolean;
    pageSpaceOnDrag: boolean;
    dragStarted: boolean;
    latestPreviewPosition: {
      xOffsetPx: number;
      yPx: number;
    };
    moved: boolean;
  } | null>(null);
  const previewPositionRef = useRef<{
    xOffsetPx: number;
    yPx: number;
  } | null>(null);
  const resizeRef = useRef<{
    pointerId: number;
    imageId: string;
    startClientX: number;
    startWidth: number;
    minimumWidth: number;
    maximumWidth: number;
    position: number;
    aspectRatio: number;
    attributes: DocumentImageAttributes;
    spanLeftPx: number;
    spanWidthPx: number;
    captionExtraHeightPx: number;
    topPx: number;
    obstacles: DocumentImageRectangle[];
    captureElement: HTMLButtonElement;
    moved: boolean;
  } | null>(null);
  const previewResizeRef = useRef<{
    widthPx: number;
    heightPx: number;
    xOffsetPx: number;
  } | null>(null);
  const flowResizeRef = useRef<{
    pointerId: number;
    imageId: string;
    position: number;
    startClientX: number;
    startWidth: number;
    minimumWidth: number;
    maximumWidth: number;
    aspectRatio: number;
    attributes: DocumentImageAttributes;
    startFrame: StructuredImageFrameGeometry;
    captureElement: HTMLButtonElement;
    moved: boolean;
  } | null>(null);
  const flowResizePreviewRef = useRef<StructuredImageFrameGeometry | null>(
    null
  );
  const textSelectionDragRef = useRef<{
    pointerId: number;
    anchorPosition: number;
    captureElement: HTMLElement;
  } | null>(null);
  const finishTextSelectionRef = useRef<(pointerId: number) => void>(
    () => undefined
  );
  const pendingPreviewRef = useRef<{
    imageId: string;
    attributes: Partial<DocumentImageAttributes>;
  } | null>(null);
  const previewFrameRef = useRef<number | null>(null);
  const finishResizeRef = useRef<(
    pointerId: number,
    cancelled: boolean
  ) => void>(() => undefined);
  const finishFlowResizeRef = useRef<(
    pointerId: number,
    cancelled: boolean
  ) => void>(() => undefined);
  const finishDragRef = useRef<(
    pointerId: number,
    cancelled: boolean
  ) => void>(() => undefined);

  const updateDragDiagnostics = useCallback(() => {
    const root = layoutRef.current;
    if (!root) return;
    root.dataset.layoutRenderCount = String(layoutRenderCountRef.current);
    root.dataset.layoutModelBuildCount = String(modelBuildCountRef.current);
    root.dataset.dragPointermoveCount = String(
      dragPointerMoveCountRef.current
    );
    root.dataset.dragPreviewFrameCount = String(
      dragVisualFrameCountRef.current
    );
    root.dataset.dragCommitCount = String(dragCommitCountRef.current);
  }, []);

  const setImageSlotRef = useCallback(
    (imageId: string, element: HTMLDivElement | null) => {
      if (element) {
        imageSlotRefs.current.set(imageId, element);
      } else {
        imageSlotRefs.current.delete(imageId);
      }
    },
    []
  );

  const setSnapGuideRef = useCallback(
    (axis: 'x' | 'y', element: HTMLDivElement | null) => {
      snapGuideRefs.current[axis] = element;
    },
    []
  );

  const setSnapGuideVisuals = useCallback(
    (guides: readonly DocumentSnapGuide[]) => {
      (['x', 'y'] as const).forEach((axis) => {
        const element = snapGuideRefs.current[axis];
        if (!element) return;
        const guide = guides.find((candidate) => candidate.axis === axis);
        if (!guide) {
          element.style.display = 'none';
          element.removeAttribute('data-snap-source');
          return;
        }
        element.style.display = 'block';
        if (axis === 'x') {
          element.style.left = `${guide.positionPx}px`;
        } else {
          element.style.top = `${guide.positionPx}px`;
        }
        element.dataset.snapSource = guide.source;
      });
    },
    []
  );

  const cancelDragVisualFrame = useCallback(() => {
    const frame = dragVisualFrameRef.current;
    if (frame === null) return;
    if (
      dragVisualFrameUsesAnimationFrameRef.current
      && typeof window.cancelAnimationFrame === 'function'
    ) {
      window.cancelAnimationFrame(frame);
    } else {
      window.clearTimeout(frame);
    }
    dragVisualFrameRef.current = null;
    dragVisualFrameUsesAnimationFrameRef.current = false;
  }, []);

  const clearDragVisualPreview = useCallback((
    imageIds?: readonly string[]
  ) => {
    cancelDragVisualFrame();
    dragVisualPendingRef.current = null;
    const ids = imageIds || [...imageSlotRefs.current.keys()];
    ids.forEach((imageId) => {
      const element = imageSlotRefs.current.get(imageId);
      if (!element) return;
      element.style.transform = '';
      element.style.willChange = '';
      element.dataset.imageDragging = 'false';
    });
    setSnapGuideVisuals([]);
  }, [cancelDragVisualFrame, setSnapGuideVisuals]);

  const flushDragVisualPreview = useCallback(() => {
    dragVisualFrameRef.current = null;
    dragVisualFrameUsesAnimationFrameRef.current = false;
    const pending = dragVisualPendingRef.current;
    if (!pending) return;
    dragVisualPendingRef.current = null;
    pending.imageIds.forEach((imageId) => {
      const element = imageSlotRefs.current.get(imageId);
      if (!element) return;
      element.style.transform = (
        `translate3d(${pending.deltaXPx}px, ${pending.deltaYPx}px, 0)`
      );
      element.style.willChange = 'transform';
      element.dataset.imageDragging = 'true';
    });
    setSnapGuideVisuals(pending.guides);
    dragVisualFrameCountRef.current += 1;
    updateDragDiagnostics();
  }, [setSnapGuideVisuals, updateDragDiagnostics]);

  const scheduleDragVisualPreview = useCallback((pending: {
    imageIds: readonly string[];
    deltaXPx: number;
    deltaYPx: number;
    guides: readonly DocumentSnapGuide[];
  }) => {
    dragVisualPendingRef.current = pending;
    if (dragVisualFrameRef.current !== null) return;
    if (typeof window.requestAnimationFrame === 'function') {
      dragVisualFrameUsesAnimationFrameRef.current = true;
      dragVisualFrameRef.current = window.requestAnimationFrame(
        flushDragVisualPreview
      );
    } else {
      dragVisualFrameUsesAnimationFrameRef.current = false;
      dragVisualFrameRef.current = window.setTimeout(
        flushDragVisualPreview,
        0
      );
    }
  }, [flushDragVisualPreview]);

  useEffect(() => {
    if (dragRef.current || resizeRef.current || flowResizeRef.current) return;
    setPreviewOverrides({});
    setFlowImageResizePreview({});
  }, [revision]);

  useLayoutEffect(() => {
    const pending = pendingDragCommitCleanupRef.current;
    if (!pending || !model) return;
    const image = model.images.find(
      (candidate) => candidate.imageId === pending.imageId
    );
    if (!image) return;
    if (
      Math.abs(image.attributes.xOffsetPx - pending.xOffsetPx) > 0.5
      || Math.abs(image.attributes.yPx - pending.yPx) > 0.5
    ) {
      return;
    }
    pendingDragCommitCleanupRef.current = null;
    clearDragVisualPreview(pending.imageIds);
  }, [clearDragVisualPreview, model, revision]);

  const activeTextEditTarget = textEditing && model
    ? getStructuredTextEditTarget(
        editor,
        model.textFragments,
        activeTextFragmentId
      )
    : null;
  const activeEditFragmentIds = activeTextEditTarget?.fragmentIds || [];
  const activeEditFragmentSignature = activeEditFragmentIds.join('|');

  useLayoutEffect(() => {
    const root = layoutRef.current;
    const editorRoot = root?.closest<HTMLElement>('.document-flow-editor');
    if (!root || !editorRoot || !model) return;

    const viewport = editorRoot.querySelector<HTMLElement>(
      '.document-flow-editor__active-fragment-viewport'
    );
    const liveSurface = editorRoot.querySelector<HTMLElement>(
      '.document-flow-editor__content--structured-text-editing .document-flow-prosemirror'
    );
    if (!viewport || !liveSurface) return;

    let canonicalMaskSignature: string | null = null;
    const clearCanonicalFragmentMask = () => {
      root.querySelectorAll<HTMLElement>(
        '[data-document-fragment-id][data-document-active-edit-fragment="true"]'
      ).forEach((fragment) => {
        fragment.removeAttribute('data-document-active-edit-fragment');
      });
      canonicalMaskSignature = null;
    };

    const syncCanonicalFragmentMask = () => {
      const activeIds = new Set(activeEditFragmentIds);
      if (canonicalMaskSignature === activeEditFragmentSignature) {
        const maskedIds = new Set(
          Array.from(root.querySelectorAll<HTMLElement>(
            '[data-document-fragment-id][data-document-active-edit-fragment="true"]'
          )).map((fragment) => fragment.dataset.documentFragmentId || '')
        );
        if (
          maskedIds.size === activeIds.size
          && activeEditFragmentIds.every((id) => maskedIds.has(id))
        ) {
          return;
        }
      }
      root.querySelectorAll<HTMLElement>('[data-document-fragment-id]')
        .forEach((fragment) => {
          const active = activeIds.has(fragment.dataset.documentFragmentId || '');
          if (active) {
            fragment.setAttribute('data-document-active-edit-fragment', 'true');
          } else {
            fragment.removeAttribute('data-document-active-edit-fragment');
          }
        });
      canonicalMaskSignature = activeEditFragmentSignature;
    };

    const rectSnapshot = (rect: DOMRect | null) => rect
      ? {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        }
      : null;

    const measureLiveRange = (
      liveRange: { from: number; to: number } | null
    ): DOMRect | null => {
      if (!liveRange) return null;
      try {
        const from = editor.view.domAtPos(liveRange.from);
        const to = editor.view.domAtPos(liveRange.to);
        const range = editorRoot.ownerDocument.createRange();
        range.setStart(from.node, from.offset);
        range.setEnd(to.node, to.offset);
        return range.getBoundingClientRect();
      } catch {
        return null;
      }
    };

    const clearActiveViewport = () => {
      clearCanonicalFragmentMask();
      viewport.style.left = '';
      viewport.style.top = '';
      viewport.style.width = '';
      viewport.style.height = '';
      viewport.style.overflow = '';
      liveSurface.style.transform = '';
      const currentBlock = activeStructuredFragmentBlockKey.getState(editor.state)?.blockIndex;
      if (currentBlock !== null && currentBlock !== undefined) {
        editor.view.dispatch(editor.state.tr.setMeta(
          activeStructuredFragmentBlockKey,
          { blockIndex: null }
        ).setMeta('addToHistory', false));
      }
      root.dataset.activeEditFragmentId = '';
      root.dataset.activeEditColumn = '';
      root.dataset.activeEditRegionId = '';
      root.dataset.activeEditRect = '';
      root.dataset.activeEditViewportDiagnostics = '';
    };

    const syncActiveFragmentViewport = () => {
      if (!textEditing || activeEditFragmentIds.length === 0) {
        clearActiveViewport();
        return;
      }
      syncCanonicalFragmentMask();
      const fragmentsById = new Map(
        model.textFragments.map((fragment) => [fragment.id, fragment])
      );
      const activeFragment = fragmentsById.get(activeEditFragmentIds[0]);
      if (!activeFragment) {
        clearActiveViewport();
        return;
      }
      const rootRect = root.getBoundingClientRect();
      const rootScaleX = rootRect.width / Math.max(1, root.offsetWidth);
      const rootScaleY = rootRect.height / Math.max(1, root.offsetHeight);
      const editorRootRect = editorRoot.getBoundingClientRect();
      const editorScaleX = editorRootRect.width / Math.max(1, editorRoot.offsetWidth);
      const editorScaleY = editorRootRect.height / Math.max(1, editorRoot.offsetHeight);
      const fragmentRect = {
        left: activeFragment.geometry.leftPx,
        top: activeFragment.geometry.topPx,
        width: Math.max(1, activeFragment.geometry.widthPx),
        height: Math.max(1, activeFragment.geometry.heightPx),
      };

      // Reset the viewport to a measurable source surface before resolving
      // the internal PM range. The structured model, not this DOM range,
      // determines which fragment owns the interaction.
      viewport.style.left = '0px';
      viewport.style.top = '0px';
      viewport.style.width = '100%';
      viewport.style.height = '100%';
      viewport.style.overflow = 'visible';
      liveSurface.style.transform = '';
      const currentBlock = activeStructuredFragmentBlockKey.getState(editor.state)?.blockIndex;
      if (currentBlock !== activeFragment.blockIndex) {
        editor.view.dispatch(editor.state.tr.setMeta(
          activeStructuredFragmentBlockKey,
          { blockIndex: activeFragment.blockIndex }
        ).setMeta('addToHistory', false));
      }

      const liveRange = resolveLiveStructuredFragmentRange(
        editor,
        activeFragment,
        model.textFragments
      );
      const targetClientRect = {
        left: rootRect.left + fragmentRect.left * rootScaleX,
        top: rootRect.top + fragmentRect.top * rootScaleY,
        width: fragmentRect.width * rootScaleX,
        height: fragmentRect.height * rootScaleY,
      };
      // Viewport CSS coordinates are local to the editor root, while the
      // structured geometry is local to the layout root. Convert through
      // client space explicitly so page zoom and any body-root offset cannot
      // leak into the live-source transform.
      viewport.style.left = `${(
        targetClientRect.left - editorRootRect.left
      ) / Math.max(0.05, editorScaleX)}px`;
      viewport.style.top = `${(
        targetClientRect.top - editorRootRect.top
      ) / Math.max(0.05, editorScaleY)}px`;
      viewport.style.width = `${targetClientRect.width / Math.max(0.05, editorScaleX)}px`;
      viewport.style.height = `${targetClientRect.height / Math.max(0.05, editorScaleY)}px`;
      const viewportClientRect = viewport.getBoundingClientRect();
      const sourceRangeRect = measureLiveRange(liveRange);
      const alignmentOffset = sourceRangeRect
        && sourceRangeRect.width > 0
        && sourceRangeRect.height > 0
        ? {
            x: (viewportClientRect.left - sourceRangeRect.left)
              / Math.max(0.05, editorScaleX),
            y: (viewportClientRect.top - sourceRangeRect.top)
              / Math.max(0.05, editorScaleY),
          }
        : { x: 0, y: 0 };
      liveSurface.style.transform = `translate(${alignmentOffset.x}px, ${alignmentOffset.y}px)`;
      const finalLiveRangeRect = measureLiveRange(liveRange);
      const viewportModel: ActiveStructuredFragmentViewport = {
        fragmentId: activeFragment.id,
        pageId: activeFragment.pageId,
        blockIndex: activeFragment.blockIndex,
        pmRange: liveRange,
        fragmentRect,
        sourceRangeRect,
        finalLiveRangeRect,
        alignmentOffset,
      };
      viewport.style.overflow = 'hidden';
      const activeEditRect = {
        left: targetClientRect.left,
        top: targetClientRect.top,
        width: targetClientRect.width,
        height: targetClientRect.height,
      };
      const canonicalFragment = Array.from(root.querySelectorAll<HTMLElement>(
        '[data-document-fragment-id]'
      )).find((fragment) => (
        fragment.dataset.documentFragmentId === activeFragment.id
      ));
      root.dataset.activeEditFragmentId = activeFragment.id;
      root.dataset.activeEditColumn = String(activeFragment.columnIndex);
      root.dataset.activeEditRegionId = activeFragment.segmentId;
      root.dataset.activeEditRect = JSON.stringify(activeEditRect);
      root.dataset.activeEditViewportDiagnostics = JSON.stringify({
        coordinateSpaces: {
          fragment: 'page/body CSS px relative to structured layout root',
          rootClient: 'viewport/client px',
          editorClient: 'viewport/client px',
          sourceRange: 'viewport/client px',
          alignment: 'editor-root CSS px',
        },
        fragmentPageRect: fragmentRect,
        rootClientRect: rectSnapshot(rootRect),
        editorRootClientRect: rectSnapshot(editorRootRect),
        viewportClientRect: rectSnapshot(viewportClientRect),
        sourceRangeClientRect: rectSnapshot(sourceRangeRect),
        finalLiveRangeClientRect: rectSnapshot(viewportModel.finalLiveRangeRect),
        canonicalFragmentClientRect: rectSnapshot(
          canonicalFragment?.getBoundingClientRect() || null
        ),
        rootScale: { x: rootScaleX, y: rootScaleY },
        editorScale: { x: editorScaleX, y: editorScaleY },
        alignmentOffset,
      });
    };

    syncActiveFragmentViewport();
    let syncFrame: number | null = null;
    const scheduleSync = () => {
      if (syncFrame !== null || typeof window === 'undefined') return;
      syncFrame = typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame(() => {
            syncFrame = null;
            syncActiveFragmentViewport();
          })
        : window.setTimeout(() => {
            syncFrame = null;
            syncActiveFragmentViewport();
          }, 0);
    };
    const handleTransaction = () => scheduleSync();
    editor.on('transaction', handleTransaction);
    scheduleSync();
    return () => {
      editor.off('transaction', handleTransaction);
      if (syncFrame !== null && typeof window !== 'undefined') {
        if (typeof window.cancelAnimationFrame === 'function') {
          window.cancelAnimationFrame(syncFrame);
        } else {
          window.clearTimeout(syncFrame);
        }
      }
      clearActiveViewport();
    };
  }, [
    activeEditFragmentSignature,
    activeTextFragmentId,
    editor,
    model,
    textEditing,
    viewScale,
  ]);

  useEffect(() => () => {
    clearDragVisualPreview();
    interactionIntentRef.current = null;
    pendingDragCommitCleanupRef.current = null;
    if (previewFrameRef.current === null) return;
    if (typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(previewFrameRef.current);
    } else {
      window.clearTimeout(previewFrameRef.current);
    }
  }, [clearDragVisualPreview]);

  useEffect(() => {
    const handlePointerUp = (event: globalThis.PointerEvent) => {
      finishDragRef.current(event.pointerId, false);
      finishResizeRef.current(event.pointerId, false);
      finishFlowResizeRef.current(event.pointerId, false);
      finishTextSelectionRef.current(event.pointerId);
      const intent = interactionIntentRef.current;
      if (intent?.pointerId === event.pointerId) intent.phase = 'released';
    };
    const handlePointerCancel = (event: globalThis.PointerEvent) => {
      finishDragRef.current(event.pointerId, true);
      finishResizeRef.current(event.pointerId, true);
      finishFlowResizeRef.current(event.pointerId, true);
      finishTextSelectionRef.current(event.pointerId);
      interactionIntentRef.current = null;
    };
    const handleMouseUp = () => {
      const drag = dragRef.current;
      if (drag) finishDragRef.current(drag.pointerId, false);
      const resize = resizeRef.current;
      if (resize) finishResizeRef.current(resize.pointerId, false);
      const flowResize = flowResizeRef.current;
      if (flowResize) finishFlowResizeRef.current(flowResize.pointerId, false);
      const textSelection = textSelectionDragRef.current;
      if (textSelection) finishTextSelectionRef.current(textSelection.pointerId);
    };
    const handleBlur = () => {
      const drag = dragRef.current;
      if (drag) finishDragRef.current(drag.pointerId, true);
      const resize = resizeRef.current;
      if (resize) finishResizeRef.current(resize.pointerId, true);
      const flowResize = flowResizeRef.current;
      if (flowResize) finishFlowResizeRef.current(flowResize.pointerId, true);
      const textSelection = textSelectionDragRef.current;
      if (textSelection) finishTextSelectionRef.current(textSelection.pointerId);
      interactionIntentRef.current = null;
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const drag = dragRef.current;
      if (!drag) return;
      event.preventDefault();
      finishDragRef.current(drag.pointerId, true);
      interactionIntentRef.current = null;
    };
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('blur', handleBlur);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  if (!model) return null;

  const selectedImageId = editor.state.selection instanceof NodeSelection
    && (
      editor.state.selection.node.type.name === 'documentFlowImage'
      || editor.state.selection.node.type.name === 'documentInlineImage'
    )
    ? String(editor.state.selection.node.attrs.id || '')
    : null;
  const selectedImage = model.images.find(
    (image) => image.imageId === selectedImageId
  );
  const selectedFlowImage = model.flowImages.find(
    (image) => image.imageId === selectedImageId
  );
  const normalizedDropCap = normalizeDocumentDropCap(dropCap);
  const style = {
    ...getStructuredDocumentTypographyVariables(typographyStyle),
    '--document-span-column-count': columnCount,
    '--document-span-column-gap': `${model.columnGapPx}px`,
    '--document-span-column-width': `${model.columnWidthPx}px`,
    '--document-span-available-height': `${model.availableHeightPx}px`,
  } as CSSProperties;
  const applyPendingPreview = () => {
    previewFrameRef.current = null;
    const pending = pendingPreviewRef.current;
    if (!pending) return;
    pendingPreviewRef.current = null;
    setPreviewOverrides((current) => ({
      ...current,
      [pending.imageId]: {
        ...(current[pending.imageId] || {}),
        ...pending.attributes,
      },
    }));
  };

  const schedulePreview = (
    imageId: string,
    attributes: Partial<DocumentImageAttributes>
  ) => {
    pendingPreviewRef.current = { imageId, attributes };
    if (previewFrameRef.current !== null) return;
    previewFrameRef.current =
      typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame(applyPendingPreview)
        : window.setTimeout(applyPendingPreview, 0);
  };

  const clearPreview = (imageId: string) => {
    if (previewFrameRef.current !== null) {
      if (typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(previewFrameRef.current);
      } else {
        window.clearTimeout(previewFrameRef.current);
      }
      previewFrameRef.current = null;
    }
    pendingPreviewRef.current = null;
    setPreviewOverrides((current) => {
      if (!(imageId in current)) return current;
      const next = { ...current };
      delete next[imageId];
      return next;
    });
  };

  const setStructuredTextSelection = (
    fromPosition: number,
    toPosition = fromPosition
  ) => {
    if (editor.isDestroyed) return;
    const from = clampStructuredDocumentPosition(editor, fromPosition);
    const to = clampStructuredDocumentPosition(editor, toPosition);
    const currentSelection = editor.state.selection;
    if (
      currentSelection instanceof TextSelection
      && currentSelection.anchor === from
      && currentSelection.head === to
    ) {
      editor.commands.focus(undefined, { scrollIntoView: false });
      return;
    }
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, from, to)
      )
    );
    editor.commands.focus(undefined, { scrollIntoView: false });
  };

  const finishTextSelection = (pointerId: number) => {
    const selection = textSelectionDragRef.current;
    if (!selection || selection.pointerId !== pointerId) return;
    if (selection.captureElement.hasPointerCapture?.(pointerId)) {
      selection.captureElement.releasePointerCapture?.(pointerId);
    }
    textSelectionDragRef.current = null;
  };
  finishTextSelectionRef.current = finishTextSelection;

  const handleTextPointerDown = (
    event: PointerEvent<HTMLDivElement>
  ) => {
    if (event.button !== 0 || dragRef.current || resizeRef.current) return;
    const root = layoutRef.current;
    if (!root) return;
    const textHit = resolveStructuredDocumentTextAtPoint({
      root,
      editor,
      clientX: event.clientX,
      clientY: event.clientY,
    });
    event.preventDefault();
    event.stopPropagation();
    interactionIntentRef.current = {
      pointerId: event.pointerId,
      owner: 'text',
      phase: 'pressed',
      fragmentId: textHit?.fragmentId,
      textPosition: textHit?.position ?? null,
    };
    onEditText(textHit?.position, textHit?.fragmentId);
    if (!textHit) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    textSelectionDragRef.current = {
      pointerId: event.pointerId,
      anchorPosition: textHit.position,
      captureElement: event.currentTarget,
    };
  };

  const handleTextPointerMove = (
    event: PointerEvent<HTMLDivElement>
  ) => {
    const selection = textSelectionDragRef.current;
    if (!selection || selection.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const intent = interactionIntentRef.current;
    if (intent?.pointerId === event.pointerId) intent.phase = 'dragging';
    const root = layoutRef.current;
    if (!root) return;
    const position = resolveStructuredDocumentPositionAtPoint({
      root,
      editor,
      clientX: event.clientX,
      clientY: event.clientY,
    });
    if (position === null) return;
    setStructuredTextSelection(selection.anchorPosition, position);
  };

  const handleTextPointerUp = (
    event: PointerEvent<HTMLDivElement>
  ) => {
    event.preventDefault();
    event.stopPropagation();
    finishTextSelection(event.pointerId);
    if (interactionIntentRef.current?.pointerId === event.pointerId) {
      interactionIntentRef.current.phase = 'released';
    }
  };

  const handleTextPointerCancel = (
    event: PointerEvent<HTMLDivElement>
  ) => {
    event.preventDefault();
    event.stopPropagation();
    finishTextSelection(event.pointerId);
    if (interactionIntentRef.current?.pointerId === event.pointerId) {
      interactionIntentRef.current = null;
    }
  };

  const handleImagePointerDown = (
    event: PointerEvent<HTMLDivElement>,
    image: StructuredImageLayout
  ) => {
    if (resizeRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    interactionIntentRef.current = {
      pointerId: event.pointerId,
      owner: 'image',
      phase: 'pressed',
      imageId: image.imageId,
    };
    onSelectImage(
      image.imagePosition,
      image.imageId,
      event.shiftKey || event.metaKey || event.ctrlKey
    );
    const group = image.groupId
      ? model.imageGroups.find(
          (candidate) => candidate.groupId === image.groupId
        )
      : undefined;
    const anchorImage = group
      ? model.images.find(
          (candidate) => candidate.imageId === group.anchorImageId
        )
      : image;
    if (!anchorImage) return;
    const frameRectangle = {
      imageId: image.imageId,
      leftPx: image.imageLeftPx,
      topPx: image.imageTopPx,
      widthPx: image.renderedImageWidthPx,
      heightPx: image.renderedImageHeightPx,
    };
    const startRectangle = group?.bounds
      || (image.attributes.verticalAnchor === 'page-position'
        ? model.collisionRectangles.find(
            (rectangle) => rectangle.imageId === image.imageId
          ) || frameRectangle
        : frameRectangle);
    if (!startRectangle) return;
    const previewImageIds = group?.childImageIds || [image.imageId];
    const captureElement = layoutRef.current || event.currentTarget;
    captureElement.setPointerCapture?.(event.pointerId);
    const movingUnitId = group?.groupId ?? image.imageId;
    const pinOnDrag = anchorImage.attributes.verticalAnchor !== 'page-position';
    dragRef.current = {
      pointerId: event.pointerId,
      imageId: anchorImage.imageId,
      position: anchorImage.imagePosition,
      startClientX: event.clientX,
      startClientY: event.clientY,
      // The pointer may start on any child in a group. Drag deltas are
      // measured from the occupied unit's origin, so the group translates as
      // one rectangle regardless of which child was grabbed.
      startImageX: startRectangle.leftPx,
      startImageY: startRectangle.topPx,
      spanLeftPx: anchorImage.spanLeftPx,
      maximumXOffsetPx: Math.max(
        0,
        anchorImage.spanWidthPx - startRectangle.widthPx
      ),
      topPaddingPx: anchorImage.attributes.wrapPaddingTopPx,
      bottomPaddingPx: anchorImage.attributes.wrapPaddingBottomPx,
      startRectangle,
      obstacles: model.collisionUnits.filter(
        (rectangle) => rectangle.imageId !== movingUnitId
      ),
      captureElement,
      previewImageIds,
      originalXOffsetPx: anchorImage.attributes.xOffsetPx,
      originalYPx: startRectangle.topPx,
      pinOnDrag,
      pageSpaceOnDrag: pinOnDrag
        || anchorImage.attributes.coordinateSpace === 'page',
      dragStarted: false,
      latestPreviewPosition: {
        xOffsetPx: anchorImage.attributes.xOffsetPx,
        yPx: startRectangle.topPx,
      },
      moved: false,
    };
    previewPositionRef.current = {
      xOffsetPx: anchorImage.attributes.xOffsetPx,
      yPx: startRectangle.topPx,
    };
    dragPointerMoveCountRef.current = 0;
    dragVisualFrameCountRef.current = 0;
    dragCommitCountRef.current = 0;
    setSnapGuideVisuals([]);
    updateDragDiagnostics();
  };

  const handleResizePointerDown = (
    event: PointerEvent<HTMLButtonElement>,
    image: StructuredImageLayout
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (dragRef.current || resizeRef.current) return;
    interactionIntentRef.current = {
      pointerId: event.pointerId,
      owner: 'resize',
      phase: 'pressed',
      imageId: image.imageId,
    };
    onSelectImage(image.imagePosition, image.imageId, false);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const startWidth = image.renderedImageWidthPx;
    const group = image.groupId
      ? model.imageGroups.find(
          (candidate) => candidate.groupId === image.groupId
        )
      : undefined;
    resizeRef.current = {
      pointerId: event.pointerId,
      imageId: image.imageId,
      startClientX: event.clientX,
      startWidth,
      minimumWidth: Math.min(
        image.spanWidthPx,
        Math.max(48, minimumImageWidthPx)
      ),
      maximumWidth: image.spanWidthPx,
      position: image.imagePosition,
      aspectRatio: getDocumentImageAspectRatio(image.attributes),
      attributes: image.attributes,
      spanLeftPx: image.spanLeftPx,
      spanWidthPx: image.spanWidthPx,
      captionExtraHeightPx:
        image.imageRegionHeightPx - image.renderedImageHeightPx,
      topPx: image.imageTopPx,
      obstacles: model.collisionUnits.filter(
        (rectangle) => rectangle.imageId !== (group?.groupId ?? image.imageId)
      ),
      captureElement: event.currentTarget,
      moved: false,
    };
    const maximumImageHeightPx = Math.max(
      1,
      availableHeightPx
        - image.imageTopPx
        - image.attributes.wrapPaddingBottomPx
        - (
          image.imageRegionHeightPx
          - image.renderedImageHeightPx
        )
    );
    resizeRef.current.maximumWidth = Math.min(
      resizeRef.current.maximumWidth,
      image.attributes.cropMode === 'fill'
        ? Number.POSITIVE_INFINITY
        : maximumImageHeightPx * resizeRef.current.aspectRatio
    );
    resizeRef.current.minimumWidth = Math.min(
      resizeRef.current.minimumWidth,
      resizeRef.current.maximumWidth
    );
    previewResizeRef.current = {
      widthPx: startWidth,
      heightPx: image.renderedImageHeightPx,
      xOffsetPx: image.attributes.xOffsetPx,
    };
  };

  const handleResizePointerMove = (
    event: PointerEvent<HTMLButtonElement>
  ) => {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const intent = interactionIntentRef.current;
    if (intent?.pointerId === event.pointerId) intent.phase = 'dragging';
    const pointerDelta = viewportDeltaToLayoutDelta(
      viewportDelta(event.clientX - resize.startClientX, 0),
      viewScale,
      'body'
    );
    const width = clampDocumentImageWidth(
      resize.startWidth + pointerDelta.xPx,
      resize.minimumWidth,
      resize.maximumWidth,
      resize.startWidth
    );
    const buildRectangle = (candidateWidth: number) => {
      const xOffsetPx = calculateDocumentImageXOffset({
        placement: resize.attributes.horizontalPlacement,
        xOffsetPx: resize.attributes.xOffsetPx,
        spanWidthPx: resize.spanWidthPx,
        imageWidthPx: candidateWidth,
      });
      return {
        imageId: resize.imageId,
        leftPx: resize.spanLeftPx + xOffsetPx,
        topPx: resize.topPx,
        widthPx: candidateWidth,
        heightPx: calculateDocumentImageFrameHeight(
          resize.attributes,
          candidateWidth
        ) + resize.captionExtraHeightPx,
      };
    };
    const collisionSafeWidth = clampResizeWidthWithoutCollisions({
      startWidthPx: resize.startWidth,
      desiredWidthPx: width,
      buildRectangle,
      obstacles: resize.obstacles,
    });
    const heightPx = calculateDocumentImageFrameHeight(
      resize.attributes,
      collisionSafeWidth
    );
    const xOffsetPx = calculateDocumentImageXOffset({
      placement: resize.attributes.horizontalPlacement,
      xOffsetPx: resize.attributes.xOffsetPx,
      spanWidthPx: resize.spanWidthPx,
      imageWidthPx: collisionSafeWidth,
    });
    resize.moved = resize.moved
      || Math.abs(collisionSafeWidth - resize.startWidth) > 0.5;
    previewResizeRef.current = {
      widthPx: collisionSafeWidth,
      heightPx,
      xOffsetPx,
    };
    schedulePreview(resize.imageId, {
      widthPx: collisionSafeWidth,
      heightPx,
      xOffsetPx,
    });
  };

  const finishResize = (pointerId: number, cancelled: boolean) => {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== pointerId) return;
    if (resize.captureElement.hasPointerCapture?.(pointerId)) {
      resize.captureElement.releasePointerCapture?.(pointerId);
    }
    const preview = previewResizeRef.current;
    resizeRef.current = null;
    previewResizeRef.current = null;
    clearPreview(resize.imageId);
    if (resize.moved && !cancelled && preview) {
      onCommitImageSize(
        resize.position,
        resize.imageId,
        preview.widthPx,
        preview.heightPx,
        preview.xOffsetPx
      );
    }
  };
  finishResizeRef.current = finishResize;

  const handleResizePointerUp = (
    event: PointerEvent<HTMLButtonElement>
  ) => {
    event.preventDefault();
    event.stopPropagation();
    finishResize(event.pointerId, false);
    if (interactionIntentRef.current?.pointerId === event.pointerId) {
      interactionIntentRef.current.phase = 'released';
    }
  };

  const handleResizePointerCancel = (
    event: PointerEvent<HTMLButtonElement>
  ) => {
    event.preventDefault();
    event.stopPropagation();
    finishResize(event.pointerId, true);
    if (interactionIntentRef.current?.pointerId === event.pointerId) {
      interactionIntentRef.current = null;
    }
  };

  const handleResizeClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const handleFlowResizePointerDown = (
    event: PointerEvent<HTMLButtonElement>,
    image: StructuredFlowImageLayout
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (dragRef.current || resizeRef.current || flowResizeRef.current) return;
    interactionIntentRef.current = {
      pointerId: event.pointerId,
      owner: 'resize',
      phase: 'pressed',
      imageId: image.imageId,
    };
    onSelectImage(image.imagePosition, image.imageId, false, image.nodeType);
    const minimumWidth = Math.max(32, minimumImageWidthPx);
    const maximumWidth = Math.max(
      minimumWidth,
      maximumFlowImageWidthPx
    );
    const startWidth = image.attributes.widthPx;
    const startFrame = flowImageFrames[image.imageId] || {
      leftPx: 0,
      topPx: 0,
      widthPx: startWidth,
      heightPx: calculateDocumentImageFrameHeight(
        image.attributes,
        startWidth
      ),
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    flowResizeRef.current = {
      pointerId: event.pointerId,
      imageId: image.imageId,
      position: image.imagePosition,
      startClientX: event.clientX,
      startWidth,
      minimumWidth,
      maximumWidth,
      aspectRatio: getDocumentImageAspectRatio(image.attributes),
      attributes: image.attributes,
      startFrame,
      captureElement: event.currentTarget,
      moved: false,
    };
    flowResizePreviewRef.current = {
      ...startFrame,
      widthPx: startFrame.widthPx,
      heightPx: startFrame.heightPx,
    };
    setFlowImageResizePreview({
      [image.imageId]: flowResizePreviewRef.current,
    });
  };

  const handleFlowResizePointerMove = (
    event: PointerEvent<HTMLButtonElement>
  ) => {
    const resize = flowResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const intent = interactionIntentRef.current;
    if (intent?.pointerId === event.pointerId) intent.phase = 'dragging';
    const widthPx = calculateDocumentImageResizeWidth({
      startWidthPx: resize.startWidth,
      pointerDeltaX: event.clientX - resize.startClientX,
      viewScale,
      minimumWidthPx: resize.minimumWidth,
      maximumWidthPx: resize.maximumWidth,
    });
    const heightPx = resize.attributes.cropMode === 'fill'
      ? resize.attributes.heightPx
      : calculateDocumentImageHeight(widthPx, resize.aspectRatio);
    resize.moved = resize.moved
      || Math.abs(widthPx - resize.startWidth) > 0.5;
    const frame = resize.startFrame;
    const startFrameWidth = Math.max(1, resize.startWidth);
    const startFrameHeight = Math.max(
      1,
      calculateDocumentImageFrameHeight(
        resize.attributes,
        resize.startWidth
      )
    );
    const preview = {
      leftPx: frame.leftPx,
      topPx: frame.topPx,
      widthPx: frame.widthPx * widthPx / startFrameWidth,
      heightPx: frame.heightPx * heightPx / startFrameHeight,
    };
    flowResizePreviewRef.current = preview;
    setFlowImageResizePreview({ [resize.imageId]: preview });
  };

  const finishFlowResize = (pointerId: number, cancelled: boolean) => {
    const resize = flowResizeRef.current;
    if (!resize || resize.pointerId !== pointerId) return;
    if (resize.captureElement.hasPointerCapture?.(pointerId)) {
      resize.captureElement.releasePointerCapture?.(pointerId);
    }
    const preview = flowResizePreviewRef.current;
    flowResizeRef.current = null;
    flowResizePreviewRef.current = null;
    setFlowImageResizePreview({});
    if (!cancelled && resize.moved && preview) {
      onCommitImageSize(
        resize.position,
        resize.imageId,
        preview.widthPx,
        preview.heightPx,
        resize.attributes.xOffsetPx
      );
    }
  };
  finishFlowResizeRef.current = finishFlowResize;

  const handleFlowResizePointerUp = (
    event: PointerEvent<HTMLButtonElement>
  ) => {
    event.preventDefault();
    event.stopPropagation();
    finishFlowResize(event.pointerId, false);
    if (interactionIntentRef.current?.pointerId === event.pointerId) {
      interactionIntentRef.current.phase = 'released';
    }
  };

  const handleFlowResizePointerCancel = (
    event: PointerEvent<HTMLButtonElement>
  ) => {
    event.preventDefault();
    event.stopPropagation();
    finishFlowResize(event.pointerId, true);
    if (interactionIntentRef.current?.pointerId === event.pointerId) {
      interactionIntentRef.current = null;
    }
  };

  const handleImagePointerMove = (
    event: PointerEvent<HTMLDivElement>
  ) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragPointerMoveCountRef.current += 1;
    updateDragDiagnostics();
    const viewportDistance = Math.hypot(
      event.clientX - drag.startClientX,
      event.clientY - drag.startClientY
    );
    if (!drag.dragStarted && viewportDistance < STRUCTURED_IMAGE_DRAG_THRESHOLD_PX) {
      return;
    }
    drag.dragStarted = true;
    const intent = interactionIntentRef.current;
    if (intent?.pointerId === event.pointerId) intent.phase = 'dragging';
    event.preventDefault();
    event.stopPropagation();
    const pointerDelta = viewportDeltaToLayoutDelta(
      viewportDelta(
        event.clientX - drag.startClientX,
        event.clientY - drag.startClientY
      ),
      viewScale,
      'body'
    );
    const movementBounds = bodyRectangle(
      drag.spanLeftPx,
      drag.topPaddingPx,
      drag.maximumXOffsetPx + drag.startRectangle.widthPx,
      Math.max(
        0,
        model.availableHeightPx
          + (drag.pageSpaceOnDrag ? pagePositionOriginOffsetPx : 0)
          - drag.topPaddingPx
          - drag.bottomPaddingPx
      )
    );
    const desiredOrigin = bodyPoint(
      drag.startImageX + pointerDelta.xPx,
      drag.startImageY + pointerDelta.yPx
    );
    const columnGeometry = getDocumentColumnRectangles({
      bodyWidthPx: model.availableWidthPx,
      bodyHeightPx: model.availableHeightPx,
      columnCount,
      columnGapPx,
    });
    const snapped = snapDocumentRectangle({
      rectangle: toBodyRectangle(drag.startRectangle),
      desiredOrigin,
      bounds: bodyRectangle(
        0,
        0,
        model.availableWidthPx,
        model.availableHeightPx
          + (drag.pageSpaceOnDrag ? pagePositionOriginOffsetPx : 0)
      ),
      columns: columnGeometry.columns,
      nearby: drag.obstacles.map(toBodyRectangle),
      thresholdPx: 8,
    });
    const nextMovement = moveKernelRectangleWithoutCollisions({
      start: toBodyRectangle(drag.startRectangle),
      desiredOrigin: bodyPoint(
        snapped.rectangle.leftPx,
        snapped.rectangle.topPx
      ),
      obstacles: drag.obstacles.map(toCollisionObstacle),
      bounds: movementBounds,
    });
    const xOffsetPx = clampDocumentImageXOffset(
      nextMovement.rectangle.leftPx - drag.spanLeftPx,
      drag.maximumXOffsetPx + drag.startRectangle.widthPx,
      drag.startRectangle.widthPx
    );
    drag.moved = drag.moved
      || Math.abs(xOffsetPx - (
        drag.startImageX - drag.spanLeftPx
      )) > 0.5
      || Math.abs(
        nextMovement.rectangle.topPx - drag.startImageY
      ) > 0.5;
    previewPositionRef.current = {
      xOffsetPx,
      yPx: nextMovement.rectangle.topPx,
    };
    drag.latestPreviewPosition = {
      xOffsetPx,
      yPx: nextMovement.rectangle.topPx,
    };
    const visualDelta = getStructuredImageDragVisualDelta(
      drag.startRectangle,
      nextMovement.rectangle
    );
    scheduleDragVisualPreview({
      imageIds: drag.previewImageIds,
      deltaXPx: visualDelta.xPx,
      deltaYPx: visualDelta.yPx,
      guides: snapped.guides,
    });
  };

  const finishDrag = (pointerId: number, cancelled: boolean) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== pointerId) return;
    if (drag.captureElement.hasPointerCapture?.(pointerId)) {
      drag.captureElement.releasePointerCapture?.(pointerId);
    }
    const preview = previewPositionRef.current
      ?? drag.latestPreviewPosition;
    cancelDragVisualFrame();
    flushDragVisualPreview();
    dragRef.current = null;
    previewPositionRef.current = null;
    if (cancelled || !drag.dragStarted || !drag.moved) {
      clearDragVisualPreview(drag.previewImageIds);
      return;
    }
    const committedYPx = preview.yPx + pagePositionOriginOffsetPx;
    pendingDragCommitCleanupRef.current = {
      imageIds: drag.previewImageIds,
      imageId: drag.imageId,
      xOffsetPx: preview.xOffsetPx,
      yPx: committedYPx,
    };
    const committed = onCommitImagePosition(
      drag.position,
      drag.imageId,
      preview.xOffsetPx,
      committedYPx
    );
    if (!committed) {
      pendingDragCommitCleanupRef.current = null;
      clearDragVisualPreview(drag.previewImageIds);
    } else {
      dragCommitCountRef.current += 1;
      updateDragDiagnostics();
    }
    setSnapGuideVisuals([]);
  };
  finishDragRef.current = finishDrag;

  const handleImagePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    finishDrag(event.pointerId, false);
    const intent = interactionIntentRef.current;
    if (intent?.pointerId === event.pointerId) intent.phase = 'released';
  };

  const handleImagePointerCancel = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    finishDrag(event.pointerId, true);
    if (interactionIntentRef.current?.pointerId === event.pointerId) {
      interactionIntentRef.current = null;
    }
  };

  const consumeOwnedClick = (event: MouseEvent<HTMLElement>) => {
    const intent = interactionIntentRef.current;
    if (!intent) return false;
    // A pointerdown has already selected the gesture owner. The click phase is
    // only a browser compatibility notification and must not reclassify it
    // after React/CSS has changed the DOM.
    event.preventDefault();
    event.stopPropagation();
    interactionIntentRef.current = null;
    return true;
  };

  const handleClick = (event: MouseEvent<HTMLElement>) => {
    if (consumeOwnedClick(event)) return;
    const target = event.target as HTMLElement;
    const imageSlot = target.closest<HTMLElement>(
      '[data-layout-role="occupied-columns"]'
    );
    if (imageSlot) {
      event.preventDefault();
      event.stopPropagation();
      const image = model.images.find(
        (candidate) => candidate.imageId === imageSlot.dataset.imageId
      );
      if (image) {
        onSelectImage(
          image.imagePosition,
          image.imageId,
          event.shiftKey || event.metaKey || event.ctrlKey
        );
      }
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const root = layoutRef.current;
    const textHit = root
      ? resolveStructuredDocumentTextAtPoint({
          root,
          editor,
          clientX: event.clientX,
          clientY: event.clientY,
        })
      : null;
    onEditText(textHit?.position, textHit?.fragmentId);
  };

  const handleLayoutPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (
      target.closest('[data-layout-role="occupied-columns"]')
      || target.closest('[data-layout-role="flow-image-hit-target"]')
    ) return;
    event.preventDefault();
    event.stopPropagation();
    const root = layoutRef.current;
    const textHit = root
      ? resolveStructuredDocumentTextAtPoint({
          root,
          editor,
          clientX: event.clientX,
          clientY: event.clientY,
        })
      : null;
    interactionIntentRef.current = {
      pointerId: event.pointerId,
      owner: 'text',
      phase: 'pressed',
      textPosition: textHit?.position ?? null,
    };
    onEditText(textHit?.position, textHit?.fragmentId);
  };

  const handleImageClick = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const imageId = event.currentTarget.dataset.imageId || '';
    if (consumeOwnedClick(event)) return;
    const image = model.images.find(
      (candidate) => candidate.imageId === imageId
    );
    if (image) {
      onSelectImage(
        image.imagePosition,
        image.imageId,
        event.shiftKey || event.metaKey || event.ctrlKey
      );
    }
  };

  const handleFlowImagePointerDown = (
    event: PointerEvent<HTMLDivElement>,
    image: StructuredFlowImageLayout
  ) => {
    event.preventDefault();
    event.stopPropagation();
    interactionIntentRef.current = {
      pointerId: event.pointerId,
      owner: 'image',
      phase: 'pressed',
      imageId: image.imageId,
    };
    onSelectImage(
      image.imagePosition,
      image.imageId,
      event.shiftKey || event.metaKey || event.ctrlKey,
      image.nodeType
    );
  };

  const handleFlowImageClick = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const imageId = event.currentTarget.dataset.imageId || '';
    if (consumeOwnedClick(event)) return;
    const image = model.flowImages.find(
      (candidate) => candidate.imageId === imageId
    );
    if (image) {
      onSelectImage(
        image.imagePosition,
        image.imageId,
        event.shiftKey || event.metaKey || event.ctrlKey,
        image.nodeType
      );
    }
  };

  const representativeImage = selectedImage || model.images[0];

  return (
    <div
      ref={layoutRef}
      className="document-spanning-layout"
      data-document-span-layout="true"
      data-page-id={pageId}
      lang={language}
      data-document-drop-cap={
        normalizedDropCap.enabled ? 'true' : 'false'
      }
      data-drop-cap-line-span={normalizedDropCap.lineSpan}
      data-span-count={representativeImage?.attributes.spanCount}
      data-span-start-column={representativeImage?.attributes.spanStartColumn}
      data-span-image-id={representativeImage?.imageId}
      data-structured-image-count={model.images.length}
      data-structured-flow-image-count={model.flowImages.length}
      data-interactive-image-count={model.images.length + model.flowImages.length}
      data-image-group-count={model.imageGroups.length}
      data-document-selection-from={editor.state.selection.from}
      data-document-selection-to={editor.state.selection.to}
      data-document-selection-kind={
        editor.state.selection instanceof NodeSelection
          ? 'node'
          : editor.state.selection instanceof TextSelection
            ? 'text'
            : 'other'
      }
      data-document-selection-text={editor.state.doc.textBetween(
        editor.state.selection.from,
        editor.state.selection.to,
        ' ',
        ' '
      )}
      data-document-selected-image-id={selectedImageId || undefined}
      data-column-count={columnCount}
      data-column-width-px={model.columnWidthPx}
      data-span-width-px={representativeImage?.spanWidthPx}
      data-rendered-image-width-px={
        representativeImage?.renderedImageWidthPx
      }
      data-rendered-image-height-px={
        representativeImage?.renderedImageHeightPx
      }
      data-image-region-height-px={representativeImage?.imageRegionHeightPx}
      data-layout-content-height-px={model.layoutContentHeightPx}
      data-layout-revision={revision}
      data-layout-overflowing={model.overflowing ? 'true' : 'false'}
      data-layout-coordinate-space="body"
      data-page-position-origin-offset-px={pagePositionOriginOffsetPx}
      data-layout-zoom={viewScale}
      data-selection-revision={selectionRevision}
      data-layout-available-width-px={model.availableWidthPx}
      data-layout-available-height-px={model.availableHeightPx}
      data-layout-render-count={layoutRenderCountRef.current}
      data-layout-model-build-count={modelBuildCountRef.current}
      data-last-layout-build-duration-ms={modelBuildDurationMsRef.current}
      data-total-layout-build-duration-ms={
        modelBuildTotalDurationMsRef.current
      }
      data-structured-measurement-count={
        structuredMeasurementCountRef.current
      }
      data-structured-measurement-duration-ms={
        structuredMeasurementDurationMsRef.current
      }
      data-total-structured-measurement-count={
        structuredMeasurementTotalCountRef.current
      }
      data-total-structured-measurement-duration-ms={
        structuredMeasurementTotalDurationMsRef.current
      }
      data-drag-pointermove-count={dragPointerMoveCountRef.current}
      data-drag-preview-frame-count={dragVisualFrameCountRef.current}
      data-drag-commit-count={dragCommitCountRef.current}
      data-layout-exclusions={JSON.stringify(model.exclusions)}
      data-layout-text-bands={JSON.stringify(model.textBands.map((band) => ({
        id: band.id,
        column: band.column,
        leftPx: band.leftPx,
        topPx: band.topPx,
        widthPx: band.widthPx,
        heightPx: band.heightPx,
      })))}
      data-image-top-px={representativeImage?.imageTopPx}
      data-image-left-px={representativeImage?.imageLeftPx}
      data-image-x-offset-px={representativeImage?.renderedXOffsetPx}
      data-image-y-max-px={representativeImage?.maximumImageYPx}
      data-vertical-anchor={representativeImage?.attributes.verticalAnchor}
      data-image-selected={selectedImage || selectedFlowImage ? 'true' : 'false'}
      data-image-resizing={resizeRef.current ? 'true' : 'false'}
      data-text-editing={textEditing ? 'true' : 'false'}
      data-active-edit-block-from={activeTextEditTarget?.blockFrom}
      data-active-edit-block-to={activeTextEditTarget?.blockTo}
      data-active-edit-block-indexes={
        activeTextEditTarget?.blockIndexes.join(',')
      }
      data-active-edit-fragment-ids={
        activeTextEditTarget?.fragmentIds.join('|')
      }
      data-active-edit-fragment-id={activeTextEditTarget?.primaryFragmentId || undefined}
      data-hidden-for-editing="false"
      style={style}
      onPointerDown={handleLayoutPointerDown}
      onPointerMove={handleImagePointerMove}
      onClick={handleClick}
    >
      {(['x', 'y'] as const).map((axis) => (
        <div
          key={`snap-guide-${axis}`}
          ref={(element) => setSnapGuideRef(axis, element)}
          className={`document-span-layout__snap-guide document-span-layout__snap-guide--${axis}`}
          data-document-export-exclude="true"
          data-snap-axis={axis}
          aria-hidden="true"
          style={{ display: 'none' }}
        />
      ))}
      <div className="document-span-layout__column-stacks">
        {Array.from({ length: columnCount }, (_, index) => index + 1).map(
          (column) => (
          <div
            key={`column-${column}`}
            className="document-span-layout__column-stack"
            data-layout-role="physical-column"
            data-column={column}
          >
            {model.textBands
              .filter((band) => band.column === column)
              .map((band) => (
              <div
                key={band.id}
                className="document-span-layout__text-column"
                data-layout-role="explicit-text-column"
                data-layout-region="band"
                data-page-id={pageId}
                data-region-id={band.id}
                data-document-region-id={band.id}
                data-document-from={band.documentFrom ?? undefined}
                data-document-to={band.documentTo ?? undefined}
                data-document-fragment-ids={band.fragments.map(
                  (fragment) => fragment.id
                ).join('|') || undefined}
                data-line-from={band.lineFrom ?? undefined}
                data-line-to={band.lineTo ?? undefined}
                data-column={column}
                data-band-left-px={band.leftPx}
                data-band-top-px={band.topPx}
                style={{
                  position: 'absolute',
                  left: `${
                    band.leftPx
                    - (column - 1) * (
                      model.columnWidthPx + model.columnGapPx
                    )
                  }px`,
                  top: `${band.topPx}px`,
                  width: `${band.widthPx}px`,
                  height: `${band.heightPx}px`,
                  userSelect: 'none',
                  pointerEvents: 'auto',
                }}
                onPointerDown={handleTextPointerDown}
                onPointerMove={handleTextPointerMove}
                onPointerUp={handleTextPointerUp}
                onPointerCancel={handleTextPointerCancel}
                dangerouslySetInnerHTML={{ __html: band.html }}
              />
            ))}
          </div>
        ))}
      </div>
      {model.images.map((image) => {
        const imagePrimary = selectedImageId === image.imageId;
        const imageSelected = selectedImageIds.length > 0
          ? selectedImageIds.includes(image.imageId)
          : imagePrimary;
        const frameGeometry = getStructuredImageFrameGeometry(image);
        return (
          <div
            key={image.imageId}
            ref={(element) => setImageSlotRef(image.imageId, element)}
            className="document-span-layout__image-slot"
            data-layout-role="occupied-columns"
            data-image-id={image.imageId}
            data-document-visible-image-id={image.imageId}
            data-document-image-position={image.imagePosition}
            data-image-group-id={image.groupId}
            data-image-group-kind={
              image.groupId
                ? model.imageGroups.find(
                    (group) => group.groupId === image.groupId
                  )?.kind
                : undefined
            }
            data-start-column={image.attributes.spanStartColumn}
            data-end-column={
              image.attributes.spanStartColumn
              + image.attributes.spanCount - 1
            }
            data-image-left-px={image.imageLeftPx}
            data-image-top-px={image.imageTopPx}
            data-image-x-offset-px={image.renderedXOffsetPx}
            data-image-selected={imageSelected ? 'true' : 'false'}
            data-horizontal-placement={image.attributes.horizontalPlacement}
            data-vertical-anchor={image.attributes.verticalAnchor}
            data-image-dragging={
              dragRef.current?.imageId === image.imageId
              && dragRef.current.dragStarted
                ? 'true'
                : 'false'
            }
            style={{
              left: `${image.imageLeftPx}px`,
              top: `${image.imageTopPx}px`,
              width: `${image.renderedImageWidthPx}px`,
              touchAction: 'none',
            }}
            onPointerDown={(event) => handleImagePointerDown(event, image)}
            onPointerMove={handleImagePointerMove}
            onPointerUp={handleImagePointerEnd}
            onPointerCancel={handleImagePointerCancel}
            onClick={handleImageClick}
          >
            <div
              className="document-span-layout__image-content"
              dangerouslySetInnerHTML={{ __html: image.imageHtml }}
            />
            <div
              className={`document-span-layout__image-transform-chrome ${
                imageSelected
                  ? 'document-span-layout__image-transform-chrome--selected'
                  : ''
              }`}
              data-document-editor-only="true"
              data-document-export-exclude="true"
              data-document-image-frame-chrome="true"
              style={{
                width: `${frameGeometry.widthPx}px`,
                height: `${frameGeometry.heightPx}px`,
              }}
            >
              {imagePrimary && (
                <button
                  type="button"
                  className="document-image__resize-handle"
                  aria-label="Resize image"
                  data-document-editor-only="true"
                  data-document-export-exclude="true"
                  style={{
                    width: `${18 / Math.min(1, Math.max(0.05, viewScale))}px`,
                    height: `${18 / Math.min(1, Math.max(0.05, viewScale))}px`,
                  }}
                  onPointerDown={(event) =>
                    handleResizePointerDown(event, image)}
                  onPointerMove={handleResizePointerMove}
                  onPointerUp={handleResizePointerUp}
                  onPointerCancel={handleResizePointerCancel}
                  onClick={handleResizeClick}
                />
              )}
            </div>
          </div>
        );
      })}
      {model.flowImages.map((image) => {
        const frame = flowImageFrames[image.imageId];
        if (!frame) return null;
        const framePreview = flowImageResizePreview[image.imageId] || frame;
        const imagePrimary = selectedImageId === image.imageId;
        const imageSelected = selectedImageIds.length > 0
          ? selectedImageIds.includes(image.imageId)
          : imagePrimary;
        return (
          <div
            key={`flow-hit-${image.imageId}`}
            className="document-span-layout__flow-image-hit-target"
            data-layout-role="flow-image-hit-target"
            data-image-id={image.imageId}
            data-document-visible-image-id={image.imageId}
            data-document-image-hit-target="true"
            data-document-editor-only="true"
            data-document-export-exclude="true"
            data-document-image-position={image.imagePosition}
            data-document-image-node-type={image.nodeType}
            data-image-selected={imageSelected ? 'true' : 'false'}
            style={{
              left: `${framePreview.leftPx}px`,
              top: `${framePreview.topPx}px`,
              width: `${framePreview.widthPx}px`,
              height: `${framePreview.heightPx}px`,
              zIndex: 1,
            }}
            onPointerDown={(event) => handleFlowImagePointerDown(event, image)}
            onClick={handleFlowImageClick}
          >
            <div
              className={`document-span-layout__image-transform-chrome ${
                imageSelected
                  ? 'document-span-layout__image-transform-chrome--selected'
                  : ''
              }`}
              data-document-editor-only="true"
              data-document-export-exclude="true"
              data-document-image-frame-chrome="true"
              style={{
                width: `${framePreview.widthPx}px`,
                height: `${framePreview.heightPx}px`,
              }}
            >
              {imagePrimary && image.nodeType === 'documentFlowImage' && (
                <button
                  type="button"
                  className="document-image__resize-handle"
                  aria-label="Resize image"
                  data-document-editor-only="true"
                  data-document-export-exclude="true"
                  style={{
                    width: `${18 / Math.min(1, Math.max(0.05, viewScale))}px`,
                    height: `${18 / Math.min(1, Math.max(0.05, viewScale))}px`,
                  }}
                  onPointerDown={(event) =>
                    handleFlowResizePointerDown(event, image)}
                  onPointerMove={handleFlowResizePointerMove}
                  onPointerUp={handleFlowResizePointerUp}
                  onPointerCancel={handleFlowResizePointerCancel}
                  onClick={handleResizeClick}
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};
