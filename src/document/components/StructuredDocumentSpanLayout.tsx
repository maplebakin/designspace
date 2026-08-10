import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import type { Editor } from '@tiptap/core';
import {
  AllSelection,
  NodeSelection,
  TextSelection,
} from '@tiptap/pm/state';
import type {
  DocumentImageAttributes,
} from '../extensions/DocumentImageExtension';
import {
  calculateDocumentImageHeight,
  calculateDocumentImageFrameHeight,
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

export type StructuredImageLayout = {
  imageId: string;
  imagePosition: number;
  attributes: DocumentImageAttributes;
  imageHtml: string;
  spanLeftPx: number;
  spanWidthPx: number;
  renderedImageWidthPx: number;
  renderedImageHeightPx: number;
  imageRegionHeightPx: number;
  imageLeftPx: number;
  imageTopPx: number;
  maximumXOffsetPx: number;
  maximumImageYPx: number;
  groupId?: string;
};

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

export type MultiDocumentSpanLayoutModel = {
  images: StructuredImageLayout[];
  imageGroups: StructuredImageGroupLayout[];
  exclusions: DocumentImageRectangle[];
  collisionRectangles: DocumentImageRectangle[];
  collisionUnits: DocumentImageRectangle[];
  textBands: StructuredTextBand[];
  columnWidthPx: number;
  columnGapPx: number;
  availableWidthPx: number;
  availableHeightPx: number;
  layoutContentHeightPx: number;
  overflowing: boolean;
  unresolvedCollisionIds: readonly string[];
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

const DOCUMENT_TEXT_FROM_ATTRIBUTE = 'data-document-from';
const DOCUMENT_TEXT_TO_ATTRIBUTE = 'data-document-to';
const DOCUMENT_REGION_ATTRIBUTE = 'data-document-region-id';

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
  const entries: number[] = [];
  editor.state.doc.forEach((_node, position) => entries.push(position));

  children.forEach((element, index) => {
    const position = entries[index];
    if (position === undefined) return;
    const textLength = element.textContent?.length || 0;
    const from = position + 1;
    setDocumentTextRange(element, {
      from,
      to: from + textLength,
    });
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

const createStructuredContentMeasurer = (
  options: StructuredDocumentTypographyOptions = {}
): StructuredContentMeasurer => {
  if (typeof document === 'undefined' || !document.body) {
    return {
      measure: (elements, widthPx) => elements.reduce(
        (height, element) => height + estimateElementHeight(element, widthPx),
        0
      ),
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
      host.style.width = `${Math.max(1, widthPx)}px`;
      host.innerHTML = serializeElements(elements);
      const measuredHeight = Math.max(
        host.scrollHeight,
        host.getBoundingClientRect().height
      );
      return measuredHeight > 0
        ? measuredHeight
        : elements.reduce(
            (height, element) =>
              height + estimateElementHeight(element, widthPx),
            0
          );
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
  imageGroups: readonly DocumentImageGroup[] = []
): MultiDocumentSpanLayoutModel | null => {
  const positionedNodes: Array<{
    position: number;
    attributes: DocumentImageAttributes;
  }> = [];
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
  const dropCap = normalizeDocumentDropCap(
    typographyOptions.dropCap ?? false
  );
  markFirstEligibleDocumentDropCapParagraph(
    textElements,
    dropCap.enabled
  );
  const safeWidth = Math.max(1, availableWidthPx);
  const safeHeight = Math.max(1, availableHeightPx);
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
  const measurer = createStructuredContentMeasurer({
    ...typographyOptions,
    dropCap,
  });
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
      const imageTopPx = clampStructuredImageTop({
        value: attributes.verticalAnchor === 'page-position'
          ? attributes.yPx
          : flowTop,
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
    const resolvedRectangles = new Map<string, BodyRectangle>();
    const resolvedGroupLayouts = new Map<string, DocumentImageGroupLayout>();
    const structuredGroups: StructuredImageGroupLayout[] = [];

    units.forEach((unit) => {
      const requestedRectangle = unit.type === 'group'
        ? unit.layout.bounds
        : unit.rectangle;
      const overlapResolution = resolveInitialRectangleOverlaps({
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
        frame.style.width = `${renderedImageWidthPx}px`;
        frame.style.height = `${renderedImageHeightPx}px`;
      }
      const resolvedXOffsetPx = clampDocumentImageXOffset(
        resolvedRectangle.leftPx - image.spanLeftPx,
        image.spanWidthPx,
        renderedImageWidthPx
      );
      return [{
        imageId: image.imageId,
        imagePosition: image.imagePosition,
        attributes: {
          ...image.attributes,
          xOffsetPx: resolvedXOffsetPx,
          yPx: resolvedRectangle.topPx,
        },
        imageHtml: image.imageElement.outerHTML,
        spanLeftPx: image.spanLeftPx,
        spanWidthPx: image.spanWidthPx,
        renderedImageWidthPx,
        renderedImageHeightPx,
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
      'html' | 'documentFrom' | 'documentTo' | 'lineFrom' | 'lineTo'
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
    let skipColumn: number | null = null;
    let consumeBreakBeforeNextColumn = false;
    const textBands = candidateBands.map((band) => {
      if (skipColumn === band.column) {
        return {
          ...band,
          html: '',
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
      return {
        ...band,
        html: serializeElements(allocation.allocated),
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
      imageGroups: structuredGroups,
      exclusions,
      collisionRectangles,
      collisionUnits,
      textBands,
      columnWidthPx,
      columnGapPx: safeGap,
      availableWidthPx: safeWidth,
      availableHeightPx: safeHeight,
      layoutContentHeightPx: safeHeight + overflowHeightPx,
      overflowing,
      unresolvedCollisionIds: [...unresolvedCollisionIds].sort(),
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
  viewScale: number;
  minimumImageWidthPx: number;
  typographyStyle?: CSSProperties;
  dropCap?: DocumentDropCapSettings | boolean;
  language?: string;
  imageGroups?: readonly DocumentImageGroup[];
  selectedImageIds?: readonly string[];
  onSelectImage: (
    position: number,
    imageId: string,
    additive: boolean
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
  onEditText: (position?: number) => void;
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

const getTextOffsetWithinElement = (
  element: HTMLElement,
  node: Node,
  offset: number
) => {
  if (node.nodeType !== 3) {
    const range = element.ownerDocument.createRange();
    range.selectNodeContents(element);
    range.setEnd(node, Math.min(offset, node.childNodes.length));
    return range.toString().length;
  }
  const walker = element.ownerDocument.createTreeWalker(
    element,
    4 /* NodeFilter.SHOW_TEXT */
  );
  let current = walker.nextNode();
  let textOffset = 0;
  while (current) {
    if (current === node) {
      return textOffset + Math.min(
        Math.max(0, offset),
        current.textContent?.length || 0
      );
    }
    textOffset += current.textContent?.length || 0;
    current = walker.nextNode();
  }
  return textOffset;
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
  const range = getCaretRangeAtPoint(root.ownerDocument, clientX, clientY);
  if (range) {
    const sourceElement = findDocumentTextRangeElement(range.startContainer);
    const sourceRange = sourceElement
      ? readDocumentTextRange(sourceElement)
      : null;
    if (sourceElement && sourceRange) {
      const offset = getTextOffsetWithinElement(
        sourceElement,
        range.startContainer,
        range.startOffset
      );
      return clampStructuredDocumentPosition(
        editor,
        sourceRange.from + offset
      );
    }
  }

  const candidates = Array.from(root.querySelectorAll<HTMLElement>(
    `[${DOCUMENT_REGION_ATTRIBUTE}][${DOCUMENT_TEXT_FROM_ATTRIBUTE}][${DOCUMENT_TEXT_TO_ATTRIBUTE}]`
  )).filter((element) => (element.textContent || '').length > 0);
  if (candidates.length === 0) return null;
  const nearest = candidates
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
  const sourceRange = readDocumentTextRange(nearest.element);
  if (!sourceRange) return null;
  const position = clientY <= nearest.rect.top
    || (clientY <= nearest.rect.bottom && clientX <= nearest.rect.left)
    ? sourceRange.from
    : sourceRange.to;
  return clampStructuredDocumentPosition(editor, position);
};

const decorateStructuredTextHtml = ({
  html,
  selectionFrom,
  selectionTo,
  caretPosition,
}: {
  html: string;
  selectionFrom: number | null;
  selectionTo: number | null;
  caretPosition: number | null;
}) => {
  if (
    typeof document === 'undefined'
    || (
      selectionFrom === null
      && selectionTo === null
      && caretPosition === null
    )
  ) return html;
  const host = document.createElement('div');
  host.innerHTML = html;
  const textNodes: Text[] = [];
  const walker = document.createTreeWalker(host, 4 /* SHOW_TEXT */);
  let current = walker.nextNode();
  while (current) {
    textNodes.push(current as Text);
    current = walker.nextNode();
  }
  let caretInserted = false;
  const lowerSelection = Math.min(
    selectionFrom ?? Number.POSITIVE_INFINITY,
    selectionTo ?? Number.POSITIVE_INFINITY
  );
  const upperSelection = Math.max(
    selectionFrom ?? Number.NEGATIVE_INFINITY,
    selectionTo ?? Number.NEGATIVE_INFINITY
  );

  textNodes.forEach((textNode) => {
    const sourceElement = findDocumentTextRangeElement(textNode);
    const sourceRange = sourceElement
      ? readDocumentTextRange(sourceElement)
      : null;
    if (!sourceElement || !sourceRange) return;
    const text = textNode.textContent || '';
    const textStart = sourceRange.from + getTextOffsetWithinElement(
      sourceElement,
      textNode,
      0
    );
    const textEnd = textStart + text.length;
    const markerOffsets: number[] = [];
    if (
      caretPosition !== null
      && caretPosition >= textStart
      && caretPosition <= textEnd
    ) {
      markerOffsets.push(caretPosition - textStart);
    }
    const selectedStart = selectionFrom !== null && selectionTo !== null
      ? Math.max(textStart, lowerSelection)
      : textStart;
    const selectedEnd = selectionFrom !== null && selectionTo !== null
      ? Math.min(textEnd, upperSelection)
      : textStart;
    const boundaries = new Set([0, text.length, ...markerOffsets]);
    if (selectedStart < selectedEnd) {
      boundaries.add(selectedStart - textStart);
      boundaries.add(selectedEnd - textStart);
    }
    const orderedBoundaries = [...boundaries]
      .filter((value) => value >= 0 && value <= text.length)
      .sort((left, right) => left - right);
    const fragment = textNode.ownerDocument.createDocumentFragment();
    const appendCaret = () => {
      const caret = textNode.ownerDocument.createElement('span');
      caret.className = 'document-structured-caret';
      caret.setAttribute('data-document-editor-only', 'true');
      caret.setAttribute('data-document-export-exclude', 'true');
      caret.setAttribute('aria-hidden', 'true');
      fragment.appendChild(caret);
      caretInserted = true;
    };
    for (let index = 0; index < orderedBoundaries.length - 1; index += 1) {
      const from = orderedBoundaries[index];
      const to = orderedBoundaries[index + 1];
      if (markerOffsets.includes(from)) appendCaret();
      if (to > from) {
        const value = text.slice(from, to);
        const documentFrom = textStart + from;
        const documentTo = textStart + to;
        const selected = (
          selectionFrom !== null
          && selectionTo !== null
          && documentFrom < upperSelection
          && documentTo > lowerSelection
        );
        if (selected) {
          const highlight = textNode.ownerDocument.createElement('span');
          highlight.className = 'document-structured-selection-highlight';
          highlight.setAttribute('data-document-editor-only', 'true');
          highlight.setAttribute('data-document-export-exclude', 'true');
          highlight.textContent = value;
          fragment.appendChild(highlight);
        } else {
          fragment.appendChild(textNode.ownerDocument.createTextNode(value));
        }
      }
      if (index === orderedBoundaries.length - 2
        && markerOffsets.includes(to)) appendCaret();
    }
    textNode.replaceWith(fragment);
  });

  if (caretPosition !== null && !caretInserted) {
    const candidates = Array.from(host.querySelectorAll<HTMLElement>(
      `[${DOCUMENT_TEXT_FROM_ATTRIBUTE}][${DOCUMENT_TEXT_TO_ATTRIBUTE}]`
    ));
    const candidate = candidates.find((element) => {
      const range = readDocumentTextRange(element);
      return range && caretPosition >= range.from && caretPosition <= range.to;
    });
    if (candidate) {
      const caret = document.createElement('span');
      caret.className = 'document-structured-caret';
      caret.setAttribute('data-document-editor-only', 'true');
      caret.setAttribute('data-document-export-exclude', 'true');
      caret.setAttribute('aria-hidden', 'true');
      candidate.appendChild(caret);
    }
  }
  return host.innerHTML;
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
  viewScale,
  minimumImageWidthPx,
  typographyStyle,
  dropCap = false,
  language,
  imageGroups = [],
  selectedImageIds = [],
  onSelectImage,
  onCommitImagePosition,
  onCommitImageSize,
  onEditText,
}: StructuredDocumentSpanLayoutProps) => {
  const [previewOverrides, setPreviewOverrides] = useState<
    Record<string, Partial<DocumentImageAttributes>>
  >({});
  const [snapGuides, setSnapGuides] = useState<readonly DocumentSnapGuide[]>([]);
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const pointerSelectedImageIdRef = useRef<string | null>(null);
  const model = useMemo(
    () => buildMultiDocumentSpanLayoutModel(
      editor,
      columnCount,
      columnGapPx,
      availableWidthPx,
      availableHeightPx,
      previewOverrides,
      {
        typographyStyle,
        dropCap,
        language,
      },
      imageGroups
    ),
    [
      availableHeightPx,
      availableWidthPx,
      columnCount,
      columnGapPx,
      editor,
      dropCap,
      imageGroups,
      previewOverrides,
      revision,
      typographyStyle,
      language,
    ]
  );
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
    originalXOffsetPx: number;
    originalYPx: number;
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
  const finishDragRef = useRef<(
    pointerId: number,
    cancelled: boolean
  ) => void>(() => undefined);

  useEffect(() => {
    if (dragRef.current || resizeRef.current) return;
    setPreviewOverrides({});
  }, [revision]);

  useEffect(() => () => {
    if (previewFrameRef.current === null) return;
    if (typeof window.cancelAnimationFrame === 'function') {
      window.cancelAnimationFrame(previewFrameRef.current);
    } else {
      window.clearTimeout(previewFrameRef.current);
    }
  }, []);

  useEffect(() => {
    const handlePointerUp = (event: globalThis.PointerEvent) => {
      finishDragRef.current(event.pointerId, false);
      finishResizeRef.current(event.pointerId, false);
      finishTextSelectionRef.current(event.pointerId);
    };
    const handlePointerCancel = (event: globalThis.PointerEvent) => {
      finishDragRef.current(event.pointerId, true);
      finishResizeRef.current(event.pointerId, true);
      finishTextSelectionRef.current(event.pointerId);
    };
    const handleMouseUp = () => {
      const drag = dragRef.current;
      if (drag) finishDragRef.current(drag.pointerId, false);
      const resize = resizeRef.current;
      if (resize) finishResizeRef.current(resize.pointerId, false);
      const textSelection = textSelectionDragRef.current;
      if (textSelection) finishTextSelectionRef.current(textSelection.pointerId);
    };
    const handleBlur = () => {
      const drag = dragRef.current;
      if (drag) finishDragRef.current(drag.pointerId, true);
      const resize = resizeRef.current;
      if (resize) finishResizeRef.current(resize.pointerId, true);
      const textSelection = textSelectionDragRef.current;
      if (textSelection) finishTextSelectionRef.current(textSelection.pointerId);
    };
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  if (!model) return null;

  const selectedPosition = editor.state.selection instanceof NodeSelection
    ? editor.state.selection.from
    : null;
  const selectedImage = model.images.find(
    (image) => image.imagePosition === selectedPosition
  );
  const normalizedDropCap = normalizeDocumentDropCap(dropCap);
  const style = {
    ...getStructuredDocumentTypographyVariables(typographyStyle),
    '--document-span-column-count': columnCount,
    '--document-span-column-gap': `${model.columnGapPx}px`,
    '--document-span-column-width': `${model.columnWidthPx}px`,
    '--document-span-available-height': `${model.availableHeightPx}px`,
  } as CSSProperties;
  const activeTextSelection = (
    textEditing
    && editor.isFocused
    && !(
      editor.state.selection instanceof NodeSelection
      || editor.state.selection instanceof AllSelection
        && editor.state.selection.from === editor.state.selection.to
    )
  )
    ? editor.state.selection
    : null;
  const selectionFrom = activeTextSelection?.from ?? null;
  const selectionTo = activeTextSelection?.to ?? null;
  const caretPosition = activeTextSelection instanceof TextSelection
    && activeTextSelection.empty
    ? activeTextSelection.from
    : null;

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
    const position = resolveStructuredDocumentPositionAtPoint({
      root,
      editor,
      clientX: event.clientX,
      clientY: event.clientY,
    });
    if (position === null) {
      onEditText();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    onEditText();
    setStructuredTextSelection(position);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    textSelectionDragRef.current = {
      pointerId: event.pointerId,
      anchorPosition: position,
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
  };

  const handleTextPointerCancel = (
    event: PointerEvent<HTMLDivElement>
  ) => {
    event.preventDefault();
    event.stopPropagation();
    finishTextSelection(event.pointerId);
  };

  const handleImagePointerDown = (
    event: PointerEvent<HTMLDivElement>,
    image: StructuredImageLayout
  ) => {
    if (resizeRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    pointerSelectedImageIdRef.current = image.imageId;
    window.setTimeout(() => {
      if (pointerSelectedImageIdRef.current === image.imageId) {
        pointerSelectedImageIdRef.current = null;
      }
    }, 50);
    onSelectImage(
      image.imagePosition,
      image.imageId,
      event.shiftKey || event.metaKey || event.ctrlKey
    );
    if (image.attributes.verticalAnchor !== 'page-position') return;
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
    const captureElement = layoutRef.current || event.currentTarget;
    captureElement.setPointerCapture?.(event.pointerId);
    const startRectangle = group?.bounds
      ?? model.collisionRectangles.find(
        (rectangle) => rectangle.imageId === image.imageId
      );
    if (!startRectangle) return;
    const movingUnitId = group?.groupId ?? image.imageId;
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
      originalXOffsetPx: anchorImage.attributes.xOffsetPx,
      originalYPx: startRectangle.topPx,
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
    setSnapGuides([]);
  };

  const handleResizePointerDown = (
    event: PointerEvent<HTMLButtonElement>,
    image: StructuredImageLayout
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (dragRef.current || resizeRef.current) return;
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
  };

  const handleResizePointerCancel = (
    event: PointerEvent<HTMLButtonElement>
  ) => {
    event.preventDefault();
    event.stopPropagation();
    finishResize(event.pointerId, true);
  };

  const handleResizeClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const handleImagePointerMove = (
    event: PointerEvent<HTMLDivElement>
  ) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
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
      bounds: bodyRectangle(0, 0, model.availableWidthPx, model.availableHeightPx),
      columns: columnGeometry.columns,
      nearby: drag.obstacles.map(toBodyRectangle),
      thresholdPx: 8,
    });
    setSnapGuides(snapped.guides);
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
    schedulePreview(drag.imageId, {
      horizontalPlacement: 'custom',
      xOffsetPx,
      yPx: nextMovement.rectangle.topPx,
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
    dragRef.current = null;
    previewPositionRef.current = null;
    if (cancelled || !drag.moved) {
      clearPreview(drag.imageId);
      setSnapGuides([]);
      return;
    }
    const committed = onCommitImagePosition(
        drag.position,
        drag.imageId,
        preview.xOffsetPx,
        preview.yPx
    );
    if (!committed) {
      clearPreview(drag.imageId);
    }
    setSnapGuides([]);
  };
  finishDragRef.current = finishDrag;

  const handleImagePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    finishDrag(event.pointerId, false);
  };

  const handleImagePointerCancel = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    finishDrag(event.pointerId, true);
  };

  const handleClick = (event: MouseEvent<HTMLElement>) => {
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
    onEditText();
  };

  const handleLayoutPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-layout-role="occupied-columns"]')) return;
    event.preventDefault();
    event.stopPropagation();
    onEditText();
  };

  const handleImageClick = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const imageId = event.currentTarget.dataset.imageId || '';
    if (pointerSelectedImageIdRef.current === imageId) {
      pointerSelectedImageIdRef.current = null;
      return;
    }
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
      data-image-group-count={model.imageGroups.length}
      data-document-selection-from={editor.state.selection.from}
      data-document-selection-to={editor.state.selection.to}
      data-document-selection-text={editor.state.doc.textBetween(
        editor.state.selection.from,
        editor.state.selection.to,
        ' ',
        ' '
      )}
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
      data-layout-overflowing={model.overflowing ? 'true' : 'false'}
      data-layout-coordinate-space="body"
      data-layout-zoom={viewScale}
      data-selection-revision={selectionRevision}
      data-layout-available-width-px={model.availableWidthPx}
      data-layout-available-height-px={model.availableHeightPx}
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
      data-image-x-offset-px={representativeImage?.attributes.xOffsetPx}
      data-image-y-max-px={representativeImage?.maximumImageYPx}
      data-vertical-anchor={representativeImage?.attributes.verticalAnchor}
      data-image-selected={selectedImage ? 'true' : 'false'}
      data-image-resizing={resizeRef.current ? 'true' : 'false'}
      data-text-editing={textEditing ? 'true' : 'false'}
      data-hidden-for-editing="false"
      style={style}
      onPointerDown={handleLayoutPointerDown}
      onPointerMove={handleImagePointerMove}
      onClick={handleClick}
    >
      {snapGuides.map((guide, index) => (
        <div
          key={`${guide.axis}-${guide.positionPx}-${index}`}
          className={`document-span-layout__snap-guide document-span-layout__snap-guide--${guide.axis}`}
          data-document-export-exclude="true"
          data-snap-axis={guide.axis}
          data-snap-source={guide.source}
          style={guide.axis === 'x'
            ? { left: `${guide.positionPx}px` }
            : { top: `${guide.positionPx}px` }}
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
                dangerouslySetInnerHTML={{
                  __html: decorateStructuredTextHtml({
                    html: band.html,
                    selectionFrom,
                    selectionTo,
                    caretPosition,
                  }),
                }}
              />
            ))}
          </div>
        ))}
      </div>
      {model.images.map((image) => {
        const imagePrimary = selectedPosition === image.imagePosition;
        const imageSelected = selectedImageIds.length > 0
          ? selectedImageIds.includes(image.imageId)
          : imagePrimary;
        return (
          <div
            key={image.imageId}
            className="document-span-layout__image-slot"
            data-layout-role="occupied-columns"
            data-image-id={image.imageId}
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
            data-image-x-offset-px={image.attributes.xOffsetPx}
            data-image-selected={imageSelected ? 'true' : 'false'}
            data-horizontal-placement={image.attributes.horizontalPlacement}
            data-vertical-anchor={image.attributes.verticalAnchor}
            style={{
              left: `${image.imageLeftPx}px`,
              top: `${image.imageTopPx}px`,
              width: `${image.renderedImageWidthPx}px`,
              touchAction:
                image.attributes.verticalAnchor === 'page-position'
                  ? 'none'
                  : undefined,
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
        );
      })}
    </div>
  );
};
