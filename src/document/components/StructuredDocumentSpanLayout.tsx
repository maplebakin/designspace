import {
  useMemo,
  type CSSProperties,
  type MouseEvent,
} from 'react';
import type { Editor } from '@tiptap/core';
import type {
  DocumentImageAttributes,
} from '../extensions/DocumentImageExtension';
import {
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
  availableHeightPx: number;
  overflowing: boolean;
  columns: Array<{
    column: number;
    occupied: boolean;
    topHtml: string;
    bottomHtml: string;
  }>;
};

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
      allocated.push(element);
      return {
        allocated,
        remaining: elements.slice(index + 1),
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
  availableHeightPx = 720
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
  const spanAttributes = attributes as DocumentImageAttributes;
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
    const imageGapHeightPx = Math.min(
      safeAvailableHeight,
      imageRegionHeightPx + spanAttributes.verticalSpacingPx * 2
    );
    const maximumImageTopPx = Math.max(
      0,
      safeAvailableHeight - imageGapHeightPx
    );
    const precedingFullColumns = startColumn - 1;
    const preAnchorHeightPx = measurer.measure(before, columnWidthPx);
    const imageTopPx = Math.min(
      maximumImageTopPx,
      Math.max(
        0,
        (
          preAnchorHeightPx
          - precedingFullColumns * safeAvailableHeight
        ) / spanCount
      )
    );
    const occupiedColumns = Array.from(
      { length: spanCount },
      (_, index) => startColumn + index
    );
    const precedingColumns = Array.from(
      { length: startColumn - 1 },
      (_, index) => index + 1
    );
    const followingColumns = Array.from(
      { length: columnCount - (startColumn + spanCount - 1) },
      (_, index) => startColumn + spanCount + index
    );
    const columns = Array.from({ length: columnCount }, (_, index) => ({
      column: index + 1,
      occupied: occupiedColumns.includes(index + 1),
      topHtml: '',
      bottomHtml: '',
    }));
    const segmentOrder = [
      ...precedingColumns.map((column) => ({
        column,
        region: 'top' as const,
        heightPx: safeAvailableHeight,
      })),
      ...occupiedColumns.map((column) => ({
        column,
        region: 'top' as const,
        heightPx: imageTopPx,
      })),
      ...followingColumns.map((column) => ({
        column,
        region: 'top' as const,
        heightPx: safeAvailableHeight,
      })),
      ...occupiedColumns.map((column) => ({
        column,
        region: 'bottom' as const,
        heightPx: maximumImageTopPx - imageTopPx,
      })),
    ];
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
      availableHeightPx: safeAvailableHeight,
      overflowing,
      columns,
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
  hidden: boolean;
  onSelectImage: (position: number) => void;
  onEditText: () => void;
};

export const StructuredDocumentSpanLayout = ({
  editor,
  columnCount,
  columnGapPx,
  availableWidthPx,
  availableHeightPx,
  revision,
  hidden,
  onSelectImage,
  onEditText,
}: StructuredDocumentSpanLayoutProps) => {
  const model = useMemo(
    () => buildDocumentSpanLayoutModel(
      editor,
      columnCount,
      columnGapPx,
      availableWidthPx,
      availableHeightPx
    ),
    [
      availableHeightPx,
      availableWidthPx,
      columnCount,
      columnGapPx,
      editor,
      revision,
    ]
  );
  if (!model) return null;

  const style = {
    '--document-span-column-count': columnCount,
    '--document-span-column-gap': `${columnGapPx}px`,
    '--document-span-column-width': `${model.columnWidthPx}px`,
    '--document-span-count': model.attributes.spanCount,
    '--document-span-start-column': model.attributes.spanStartColumn,
    '--document-span-vertical-spacing':
      `${model.attributes.verticalSpacingPx}px`,
    '--document-span-image-region-height': `${model.imageRegionHeightPx}px`,
    '--document-span-exclusion-height':
      `${
        Math.min(
          model.availableHeightPx,
          model.imageRegionHeightPx
            + model.attributes.verticalSpacingPx * 2
        )
      }px`,
    '--document-span-width': `${model.spanWidthPx}px`,
    '--document-span-image-top': `${model.imageTopPx}px`,
    '--document-span-available-height': `${model.availableHeightPx}px`,
  } as CSSProperties;

  const handleClick = (event: MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('[data-layout-role="spanning-image"]')) {
      event.preventDefault();
      event.stopPropagation();
      onSelectImage(model.imagePosition);
      return;
    }
    onEditText();
  };

  return (
    <div
      className="document-spanning-layout"
      data-document-span-layout="true"
      data-span-count={model.attributes.spanCount}
      data-span-start-column={model.attributes.spanStartColumn}
      data-span-image-id={model.imageId}
      data-column-count={columnCount}
      data-column-width-px={model.columnWidthPx}
      data-span-width-px={model.spanWidthPx}
      data-layout-content-height-px={model.layoutContentHeightPx}
      data-layout-overflowing={model.overflowing ? 'true' : 'false'}
      data-image-top-px={model.imageTopPx}
      data-hidden-for-editing={hidden ? 'true' : 'false'}
      style={style}
      onClick={handleClick}
    >
      <div className="document-span-layout__column-stacks">
        {model.columns.map((column) => (
          <div
            key={`column-${column.column}`}
            className={[
              'document-span-layout__column-stack',
              column.occupied
                ? 'document-span-layout__column-stack--occupied'
                : 'document-span-layout__column-stack--continuing',
            ].join(' ')}
            data-layout-role="physical-column"
            data-column={column.column}
            data-occupied={column.occupied ? 'true' : 'false'}
          >
            <div
              className="document-span-layout__text-column document-span-layout__segment--top"
              data-layout-role="explicit-text-column"
              data-layout-region="above"
              data-column={column.column}
            >
              {column.occupied ? (
                <div dangerouslySetInnerHTML={{ __html: column.topHtml }} />
              ) : (
                <div
                  data-layout-role="continuing-column"
                  data-column={column.column}
                  dangerouslySetInnerHTML={{ __html: column.topHtml }}
                />
              )}
            </div>
            {column.occupied && (
              <div
                className="document-span-layout__exclusion"
                data-layout-role="image-exclusion"
                aria-hidden="true"
              />
            )}
            <div
              className="document-span-layout__text-column document-span-layout__segment--bottom"
              data-layout-role="explicit-text-column"
              data-layout-region="below"
              data-column={column.column}
              dangerouslySetInnerHTML={{ __html: column.bottomHtml }}
            />
          </div>
        ))}
      </div>
      <div
        className="document-span-layout__image-slot"
        data-layout-role="occupied-columns"
        data-start-column={model.attributes.spanStartColumn}
        data-end-column={
          model.attributes.spanStartColumn + model.attributes.spanCount - 1
        }
        style={{
          left: `calc((${
            model.attributes.spanStartColumn - 1
          }) * (var(--document-span-column-width) + var(--document-span-column-gap)))`,
          top:
            'calc(var(--document-span-image-top) + var(--document-span-vertical-spacing))',
          width: `${model.spanWidthPx}px`,
        }}
        dangerouslySetInnerHTML={{ __html: model.imageHtml }}
      />
    </div>
  );
};
