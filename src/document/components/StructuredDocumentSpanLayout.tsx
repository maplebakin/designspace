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
import { NodeSelection } from '@tiptap/pm/state';
import type {
  DocumentImageAttributes,
} from '../extensions/DocumentImageExtension';
import {
  calculateDocumentImageHeight,
  calculateDocumentImageDragY,
  calculateDocumentImageResizeWidth,
  calculateDocumentImageXOffset,
  clampDocumentImageXOffset,
  getDocumentImageAspectRatio,
  clampDocumentImageY,
  normalizeDocumentImageAttributes,
} from '../extensions/DocumentImageExtension';

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
};

export type StructuredTextBand = {
  id: string;
  column: number;
  topPx: number;
  leftPx: number;
  widthPx: number;
  heightPx: number;
  html: string;
};

export type MultiDocumentSpanLayoutModel = {
  images: StructuredImageLayout[];
  exclusions: DocumentImageRectangle[];
  collisionRectangles: DocumentImageRectangle[];
  textBands: StructuredTextBand[];
  columnWidthPx: number;
  availableWidthPx: number;
  availableHeightPx: number;
  layoutContentHeightPx: number;
  overflowing: boolean;
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

const serializeElements = (elements: Element[]) =>
  elements.map((element) => element.outerHTML).join('');

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

const createStructuredContentMeasurer = (): StructuredContentMeasurer => {
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
  document.body.append(host);

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

const cloneElementRange = (
  element: Element,
  from: number,
  to: number
): Element | null => {
  if (from >= to) return null;
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
  return clone?.nodeType === 1 ? clone as Element : null;
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

const allocateElementsToHeight = (
  elements: Element[],
  widthPx: number,
  maximumHeightPx: number,
  measure: StructuredContentMeasurer['measure']
): { allocated: Element[]; remaining: Element[] } => {
  if (maximumHeightPx <= 0) {
    return { allocated: [], remaining: elements };
  }
  const allocated: Element[] = [];
  for (let index = 0; index < elements.length; index += 1) {
    const element = elements[index];
    if (
      measure([...allocated, element], widthPx)
      <= Math.max(1, maximumHeightPx)
    ) {
      allocated.push(element);
      continue;
    }

    const split = splitElementToFit(
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
      };
    }
    if (allocated.length === 0) {
      return {
        allocated,
        remaining: elements.slice(index),
      };
    }
    return {
      allocated,
      remaining: elements.slice(index),
    };
  }
  return { allocated, remaining: [] };
};

export const buildDocumentSpanLayoutModel = (
  editor: Editor,
  columnCount: 1 | 2 | 3,
  columnGapPx = 24,
  availableWidthPx = 720,
  availableHeightPx = 720,
  attributeOverrides: Partial<DocumentImageAttributes> = {}
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
  const imageIndex = children.findIndex(
    (element) =>
      element.getAttribute('data-image-id') === spanAttributes.id
      && element.getAttribute('data-wrap') === 'span-columns'
  );
  if (imageIndex < 0) return null;

  const before = children.slice(0, imageIndex);
  const after = children.slice(imageIndex + 1);
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
  const renderedImageHeightPx = Math.max(
    1,
    renderedImageWidthPx / aspectRatio
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

  const measurer = createStructuredContentMeasurer();
  try {
    const caption = imageElement.querySelector('figcaption');
    const captionHeightPx = caption
      ? measurer.measure([caption], renderedImageWidthPx)
      : 0;
    const imageRegionHeightPx = renderedImageHeightPx
      + (captionHeightPx > 0 ? captionHeightPx + 5 : 0);
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
    segmentOrder.forEach((segment) => {
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
) => (
  left.leftPx < right.leftPx + right.widthPx
  && left.leftPx + left.widthPx > right.leftPx
  && left.topPx < right.topPx + right.heightPx
  && left.topPx + left.heightPx > right.topPx
);

export const moveRectangleWithoutCollisions = ({
  start,
  desiredLeftPx,
  desiredTopPx,
  obstacles,
}: {
  start: DocumentImageRectangle;
  desiredLeftPx: number;
  desiredTopPx: number;
  obstacles: DocumentImageRectangle[];
}) => {
  const deltaX = desiredLeftPx - start.leftPx;
  const deltaY = desiredTopPx - start.topPx;
  let travel = 1;
  obstacles.forEach((obstacle) => {
    if (rectanglesOverlap(start, obstacle)) return;
    const horizontallySeparated = (
      start.leftPx + start.widthPx <= obstacle.leftPx
      || start.leftPx >= obstacle.leftPx + obstacle.widthPx
    );
    const verticallySeparated = (
      start.topPx + start.heightPx <= obstacle.topPx
      || start.topPx >= obstacle.topPx + obstacle.heightPx
    );
    if (deltaX === 0 && horizontallySeparated) return;
    if (deltaY === 0 && verticallySeparated) return;
    const xEntry = deltaX > 0
      ? (obstacle.leftPx - (start.leftPx + start.widthPx)) / deltaX
      : deltaX < 0
        ? (
            obstacle.leftPx + obstacle.widthPx - start.leftPx
          ) / deltaX
        : Number.NEGATIVE_INFINITY;
    const xExit = deltaX > 0
      ? (
          obstacle.leftPx + obstacle.widthPx - start.leftPx
        ) / deltaX
      : deltaX < 0
        ? (
            obstacle.leftPx - (start.leftPx + start.widthPx)
          ) / deltaX
        : Number.POSITIVE_INFINITY;
    const yEntry = deltaY > 0
      ? (obstacle.topPx - (start.topPx + start.heightPx)) / deltaY
      : deltaY < 0
        ? (
            obstacle.topPx + obstacle.heightPx - start.topPx
          ) / deltaY
        : Number.NEGATIVE_INFINITY;
    const yExit = deltaY > 0
      ? (
          obstacle.topPx + obstacle.heightPx - start.topPx
        ) / deltaY
      : deltaY < 0
        ? (
            obstacle.topPx - (start.topPx + start.heightPx)
          ) / deltaY
        : Number.POSITIVE_INFINITY;
    const entry = Math.max(
      Math.min(xEntry, xExit),
      Math.min(yEntry, yExit)
    );
    const exit = Math.min(
      Math.max(xEntry, xExit),
      Math.max(yEntry, yExit)
    );
    if (entry <= exit && entry >= 0 && entry <= travel) {
      travel = entry;
    }
  });
  return {
    leftPx: start.leftPx + deltaX * travel,
    topPx: start.topPx + deltaY * travel,
  };
};

export const buildMultiDocumentSpanLayoutModel = (
  editor: Editor,
  columnCount: 1 | 2 | 3,
  columnGapPx = 24,
  availableWidthPx = 720,
  availableHeightPx = 720,
  attributeOverrides: Record<string, Partial<DocumentImageAttributes>> = {}
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
  const structuredIds = new Set(
    positionedNodes.map(({ attributes }) => attributes.id)
  );
  const textElements = children.filter((element) => !(
    element.getAttribute('data-wrap') === 'span-columns'
    && structuredIds.has(element.getAttribute('data-image-id') || '')
  ));
  const safeWidth = Math.max(1, availableWidthPx);
  const safeHeight = Math.max(1, availableHeightPx);
  const safeGap = Math.max(0, columnGapPx);
  const columnWidthPx = Math.max(
    1,
    (safeWidth - safeGap * (columnCount - 1)) / columnCount
  );
  const measurer = createStructuredContentMeasurer();
  try {
    const images = positionedNodes.flatMap((entry) => {
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
      const spanLeftPx =
        (startColumn - 1) * (columnWidthPx + safeGap);
      const spanWidthPx =
        columnWidthPx * spanCount + safeGap * (spanCount - 1);
      const renderedImageWidthPx = Math.min(
        spanWidthPx,
        attributes.widthPx
      );
      const aspectRatio = getDocumentImageAspectRatio(attributes);
      const renderedImageHeightPx =
        renderedImageWidthPx / Math.max(0.0001, aspectRatio);
      const caption = imageElement.querySelector('figcaption');
      const captionHeightPx = caption
        ? measurer.measure([caption], renderedImageWidthPx)
        : 0;
      const imageRegionHeightPx = renderedImageHeightPx
        + (captionHeightPx > 0 ? captionHeightPx + 5 : 0);
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
      const imageTopPx = attributes.verticalAnchor === 'page-position'
        ? clampDocumentImageY(
            attributes.yPx,
            safeHeight,
            imageRegionHeightPx,
            attributes.verticalSpacingPx
          )
        : clampDocumentImageY(
            flowTop,
            safeHeight,
            imageRegionHeightPx,
            attributes.verticalSpacingPx
          );
      imageElement.classList.add(
        'document-span-layout__image',
        'document-span-layout__image--structured'
      );
      imageElement.style.width = `${renderedImageWidthPx}px`;
      imageElement.style.maxWidth = `${renderedImageWidthPx}px`;
      imageElement.setAttribute('data-layout-role', 'spanning-image');
      imageElement.setAttribute(
        'data-rendered-width-px',
        String(renderedImageWidthPx)
      );
      imageElement.setAttribute(
        'data-rendered-height-px',
        String(renderedImageHeightPx)
      );
      const media = imageElement.querySelector<HTMLElement>(
        '.document-image__media'
      );
      if (media) {
        media.style.width = `${renderedImageWidthPx}px`;
        media.style.height = `${renderedImageHeightPx}px`;
      }
      return [{
        imageId: attributes.id,
        imagePosition: entry.position,
        attributes: {
          ...attributes,
          spanCount: spanCount as 1 | 2 | 3,
          spanStartColumn: startColumn as 1 | 2 | 3,
          xOffsetPx,
          yPx: imageTopPx,
        },
        imageHtml: imageElement.outerHTML,
        spanLeftPx,
        spanWidthPx,
        renderedImageWidthPx,
        renderedImageHeightPx,
        imageRegionHeightPx,
        imageLeftPx: spanLeftPx + xOffsetPx,
        imageTopPx,
        maximumXOffsetPx: Math.max(
          0,
          spanWidthPx - renderedImageWidthPx
        ),
        maximumImageYPx: Math.max(
          attributes.verticalSpacingPx,
          safeHeight
          - imageRegionHeightPx
          - attributes.verticalSpacingPx
        ),
      }];
    });
    const collisionRectangles = images.map((image) => ({
      imageId: image.imageId,
      leftPx: image.imageLeftPx,
      topPx: image.imageTopPx,
      widthPx: image.renderedImageWidthPx,
      heightPx: image.imageRegionHeightPx,
    }));
    const exclusions = images.map((image) => {
      const horizontalPadding = image.attributes.wrapPaddingPx;
      const verticalSpacing = image.attributes.verticalSpacingPx;
      const left = Math.max(0, image.imageLeftPx - horizontalPadding);
      const right = Math.min(
        safeWidth,
        image.imageLeftPx
        + image.renderedImageWidthPx
        + horizontalPadding
      );
      const top = Math.max(0, image.imageTopPx - verticalSpacing);
      const bottom = Math.min(
        safeHeight,
        image.imageTopPx
        + image.imageRegionHeightPx
        + verticalSpacing
      );
      return {
        imageId: image.imageId,
        leftPx: left,
        topPx: top,
        widthPx: Math.max(0, right - left),
        heightPx: Math.max(0, bottom - top),
      };
    });
    const candidateBands: Omit<StructuredTextBand, 'html'>[] = [];
    for (let column = 1; column <= columnCount; column += 1) {
      const columnLeftPx =
        (column - 1) * (columnWidthPx + safeGap);
      const intersecting = exclusions.filter((rectangle) => (
        rectangle.leftPx < columnLeftPx + columnWidthPx
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
          columnWidthPx,
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
    const textBands = candidateBands.map((band) => {
      const allocation = allocateElementsToHeight(
        remaining,
        band.widthPx,
        band.heightPx,
        measurer.measure
      );
      remaining = allocation.remaining;
      return {
        ...band,
        html: serializeElements(allocation.allocated),
      };
    });
    const overflowing = remaining.length > 0;
    if (overflowing && textBands.length > 0) {
      textBands[textBands.length - 1].html += serializeElements(remaining);
    }
    const overflowHeightPx = overflowing
      ? measurer.measure(remaining, columnWidthPx) / columnCount
      : 0;
    return {
      images,
      exclusions,
      collisionRectangles,
      textBands,
      columnWidthPx,
      availableWidthPx: safeWidth,
      availableHeightPx: safeHeight,
      layoutContentHeightPx: safeHeight + overflowHeightPx,
      overflowing,
    };
  } finally {
    measurer.dispose();
  }
};

type StructuredDocumentSpanLayoutProps = {
  editor: Editor;
  columnCount: 1 | 2 | 3;
  columnGapPx: number;
  availableWidthPx: number;
  availableHeightPx: number;
  revision: number;
  textEditing: boolean;
  viewScale: number;
  minimumImageWidthPx: number;
  onSelectImage: (position: number) => void;
  onCommitImagePosition: (
    position: number,
    imageId: string,
    xOffsetPx: number,
    yPx: number
  ) => boolean;
  onCommitImageSize: (
    position: number,
    widthPx: number,
    heightPx: number,
    xOffsetPx: number
  ) => void;
  onEditText: () => void;
};

const rectangleCollides = (
  rectangle: DocumentImageRectangle,
  obstacles: DocumentImageRectangle[]
) => obstacles.some((obstacle) => rectanglesOverlap(rectangle, obstacle));

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
  columnCount,
  columnGapPx,
  availableWidthPx,
  availableHeightPx,
  revision,
  textEditing,
  viewScale,
  minimumImageWidthPx,
  onSelectImage,
  onCommitImagePosition,
  onCommitImageSize,
  onEditText,
}: StructuredDocumentSpanLayoutProps) => {
  const [previewOverrides, setPreviewOverrides] = useState<
    Record<string, Partial<DocumentImageAttributes>>
  >({});
  const layoutRef = useRef<HTMLDivElement | null>(null);
  const model = useMemo(
    () => buildMultiDocumentSpanLayoutModel(
      editor,
      columnCount,
      columnGapPx,
      availableWidthPx,
      availableHeightPx,
      previewOverrides
    ),
    [
      availableHeightPx,
      availableWidthPx,
      columnCount,
      columnGapPx,
      editor,
      previewOverrides,
      revision,
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
    };
    const handlePointerCancel = (event: globalThis.PointerEvent) => {
      finishDragRef.current(event.pointerId, true);
      finishResizeRef.current(event.pointerId, true);
    };
    const handleMouseUp = () => {
      const drag = dragRef.current;
      if (drag) finishDragRef.current(drag.pointerId, false);
      const resize = resizeRef.current;
      if (resize) finishResizeRef.current(resize.pointerId, false);
    };
    const handleBlur = () => {
      const drag = dragRef.current;
      if (drag) finishDragRef.current(drag.pointerId, true);
      const resize = resizeRef.current;
      if (resize) finishResizeRef.current(resize.pointerId, true);
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
  const style = {
    '--document-span-column-count': columnCount,
    '--document-span-column-gap': `${columnGapPx}px`,
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

  const handleImagePointerDown = (
    event: PointerEvent<HTMLDivElement>,
    image: StructuredImageLayout
  ) => {
    if (resizeRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    onSelectImage(image.imagePosition);
    if (image.attributes.verticalAnchor !== 'page-position') return;
    const captureElement = layoutRef.current || event.currentTarget;
    captureElement.setPointerCapture?.(event.pointerId);
    const startRectangle = model.collisionRectangles.find(
      (rectangle) => rectangle.imageId === image.imageId
    );
    if (!startRectangle) return;
    dragRef.current = {
      pointerId: event.pointerId,
      imageId: image.imageId,
      position: image.imagePosition,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startImageX: image.imageLeftPx,
      startImageY: image.imageTopPx,
      spanLeftPx: image.spanLeftPx,
      maximumXOffsetPx: image.maximumXOffsetPx,
      startRectangle,
      obstacles: model.collisionRectangles.filter(
        (rectangle) => rectangle.imageId !== image.imageId
      ),
      captureElement,
      originalXOffsetPx: image.attributes.xOffsetPx,
      originalYPx: image.imageTopPx,
      latestPreviewPosition: {
        xOffsetPx: image.attributes.xOffsetPx,
        yPx: image.imageTopPx,
      },
      moved: false,
    };
    previewPositionRef.current = {
      xOffsetPx: image.attributes.xOffsetPx,
      yPx: image.imageTopPx,
    };
  };

  const handleResizePointerDown = (
    event: PointerEvent<HTMLButtonElement>,
    image: StructuredImageLayout
  ) => {
    event.preventDefault();
    event.stopPropagation();
    if (dragRef.current || resizeRef.current) return;
    onSelectImage(image.imagePosition);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const startWidth = image.renderedImageWidthPx;
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
      obstacles: model.collisionRectangles.filter(
        (rectangle) => rectangle.imageId !== image.imageId
      ),
      captureElement: event.currentTarget,
      moved: false,
    };
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
    const width = calculateDocumentImageResizeWidth({
      startWidthPx: resize.startWidth,
      pointerDeltaX: event.clientX - resize.startClientX,
      viewScale,
      minimumWidthPx: resize.minimumWidth,
      maximumWidthPx: resize.maximumWidth,
    });
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
        heightPx: calculateDocumentImageHeight(
          candidateWidth,
          resize.aspectRatio
        ) + resize.captionExtraHeightPx,
      };
    };
    const collisionSafeWidth = clampResizeWidthWithoutCollisions({
      startWidthPx: resize.startWidth,
      desiredWidthPx: width,
      buildRectangle,
      obstacles: resize.obstacles,
    });
    const heightPx = calculateDocumentImageHeight(
      collisionSafeWidth,
      resize.aspectRatio
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
    const desiredXOffset = clampDocumentImageXOffset(
      drag.startImageX
        + (event.clientX - drag.startClientX) / Math.max(viewScale, 0.01)
        - drag.spanLeftPx,
      drag.maximumXOffsetPx + drag.startRectangle.widthPx,
      drag.startRectangle.widthPx
    );
    const desiredY = calculateDocumentImageDragY({
      startY: drag.startImageY,
      pointerDeltaY: event.clientY - drag.startClientY,
      viewScale,
      availableHeightPx: model.availableHeightPx,
      imageRegionHeightPx: drag.startRectangle.heightPx,
      verticalSpacingPx: 0,
    });
    const next = moveRectangleWithoutCollisions({
      start: drag.startRectangle,
      desiredLeftPx: drag.spanLeftPx + desiredXOffset,
      desiredTopPx: desiredY,
      obstacles: drag.obstacles,
    });
    const xOffsetPx = clampDocumentImageXOffset(
      next.leftPx - drag.spanLeftPx,
      drag.maximumXOffsetPx + drag.startRectangle.widthPx,
      drag.startRectangle.widthPx
    );
    drag.moved = drag.moved
      || Math.abs(xOffsetPx - (
        drag.startImageX - drag.spanLeftPx
      )) > 0.5
      || Math.abs(next.topPx - drag.startImageY) > 0.5;
    previewPositionRef.current = { xOffsetPx, yPx: next.topPx };
    drag.latestPreviewPosition = { xOffsetPx, yPx: next.topPx };
    schedulePreview(drag.imageId, {
      horizontalPlacement: 'custom',
      xOffsetPx,
      yPx: next.topPx,
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
      if (image) onSelectImage(image.imagePosition);
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
    const image = model.images.find(
      (candidate) => candidate.imageId === event.currentTarget.dataset.imageId
    );
    if (image) onSelectImage(image.imagePosition);
  };

  const representativeImage = selectedImage || model.images[0];

  return (
    <div
      ref={layoutRef}
      className="document-spanning-layout"
      data-document-span-layout="true"
      data-span-count={representativeImage?.attributes.spanCount}
      data-span-start-column={representativeImage?.attributes.spanStartColumn}
      data-span-image-id={representativeImage?.imageId}
      data-structured-image-count={model.images.length}
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
      data-image-top-px={representativeImage?.imageTopPx}
      data-image-left-px={representativeImage?.imageLeftPx}
      data-image-x-offset-px={representativeImage?.attributes.xOffsetPx}
      data-image-y-max-px={representativeImage?.maximumImageYPx}
      data-vertical-anchor={representativeImage?.attributes.verticalAnchor}
      data-image-selected={selectedImage ? 'true' : 'false'}
      data-image-resizing={resizeRef.current ? 'true' : 'false'}
      data-text-editing={textEditing ? 'true' : 'false'}
      data-hidden-for-editing={textEditing ? 'true' : 'false'}
      style={style}
      onPointerDown={handleLayoutPointerDown}
      onPointerMove={handleImagePointerMove}
      onClick={handleClick}
    >
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
                data-column={column}
                data-band-left-px={band.leftPx}
                data-band-top-px={band.topPx}
                style={{
                  position: 'absolute',
                  left: `${
                    band.leftPx
                    - (column - 1) * (
                      model.columnWidthPx + columnGapPx
                    )
                  }px`,
                  top: `${band.topPx}px`,
                  width: `${band.widthPx}px`,
                  height: `${band.heightPx}px`,
                }}
                dangerouslySetInnerHTML={{ __html: band.html }}
              />
            ))}
          </div>
        ))}
      </div>
      {model.images.map((image) => {
        const imageSelected = selectedPosition === image.imagePosition;
        return (
          <div
            key={image.imageId}
            className="document-span-layout__image-slot"
            data-layout-role="occupied-columns"
            data-image-id={image.imageId}
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
            {imageSelected && (
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
