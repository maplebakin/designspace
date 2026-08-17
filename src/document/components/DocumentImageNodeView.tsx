import {
  useEffect,
  useState,
  useRef,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  NodeViewWrapper,
  type ReactNodeViewProps,
} from '@tiptap/react';
import type {
  DocumentImageAttributes,
  DocumentImageExtensionOptions,
  DocumentImageNodeName,
} from '../extensions/DocumentImageExtension';
import {
  calculateDocumentImageHeight,
  calculateDocumentImageFrameHeight,
  calculateDocumentImageResizeWidth,
  clampDocumentImageWidth,
  getDocumentImageAspectRatio,
  selectDocumentImageById,
  normalizeDocumentImageAttributes,
} from '../extensions/DocumentImageExtension';

type ResizeSession = {
  pointerId: number;
  startClientX: number;
  startWidth: number;
  moved: boolean;
};

export const DocumentImageNodeView = ({
  node,
  editor,
  extension,
  selected,
  updateAttributes,
}: ReactNodeViewProps) => {
  const options = extension.options as DocumentImageExtensionOptions;
  const nodeType = node.type.name as DocumentImageNodeName;
  const attributes = normalizeDocumentImageAttributes(
    node.attrs as Partial<DocumentImageAttributes>,
    nodeType === 'documentInlineImage' ? 'inline' : 'float-left'
  );
  const source = options.resolveAssetSource(attributes.assetId);
  const multiSelected = options.isImageSelected?.(attributes.id) === true;
  const resizeSessionRef = useRef<ResizeSession | null>(null);
  const previewWidthRef = useRef<number | null>(null);
  const [previewWidth, setPreviewWidth] = useState<number | null>(null);
  const [sourceFailed, setSourceFailed] = useState(false);

  useEffect(() => {
    setSourceFailed(false);
  }, [source]);

  useEffect(() => {
    setPreviewWidth(null);
    previewWidthRef.current = null;
    resizeSessionRef.current = null;
  }, [attributes.widthPx]);

  const aspectRatio = getDocumentImageAspectRatio(attributes);
  const renderedWidth = previewWidth ?? attributes.widthPx;
  const renderedHeight = calculateDocumentImageFrameHeight(
    attributes,
    renderedWidth
  );
  const captionStyle = {
    ...(attributes.captionAlignment === 'inherit'
      ? {}
      : {
          '--document-caption-alignment': attributes.captionAlignment,
        }),
    ...(attributes.captionItalic === 'inherit'
      ? {}
      : {
          '--document-caption-font-style':
            attributes.captionItalic ? 'italic' : 'normal',
        }),
    ...(attributes.captionSpacingPx === 'inherit'
      ? {}
      : {
          '--document-caption-spacing':
            `${attributes.captionSpacingPx}px`,
        }),
  } as CSSProperties;

  const minimumWidthPx = Math.max(options.minWidthPx, 32);
  const maximumWidthPx = Math.max(
    minimumWidthPx,
    attributes.wrap === 'span-columns'
      ? Math.min(
          options.maxSpanWidthPx,
          options.getSpanWidthPx(attributes.spanCount)
        )
      : options.maxWidthPx
  );
  const normalizeWidth = (value: number) =>
    clampDocumentImageWidth(
      value,
      minimumWidthPx,
      maximumWidthPx,
      attributes.widthPx
    );

  const commitWidth = (requestedWidth: number) => {
    const widthPx = normalizeWidth(requestedWidth);
    const nextHeightPx = calculateDocumentImageHeight(widthPx, aspectRatio);
    const changed = widthPx !== attributes.widthPx
      || (
        attributes.cropMode !== 'fill'
        && nextHeightPx !== attributes.heightPx
      );
    if (!changed) {
      previewWidthRef.current = null;
      setPreviewWidth(null);
      return false;
    }
    updateAttributes(attributes.cropMode === 'fill'
      ? { widthPx }
      : { widthPx, heightPx: nextHeightPx });
    options.onCommittedImageLayout?.(attributes.id);
    previewWidthRef.current = null;
    setPreviewWidth(null);
    return true;
  };

  const handleResizeStart = (
    event: ReactPointerEvent<HTMLButtonElement>
  ) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeSessionRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startWidth: attributes.widthPx,
      moved: false,
    };
    previewWidthRef.current = attributes.widthPx;
    setPreviewWidth(attributes.widthPx);
  };

  const handleResizeMove = (
    event: ReactPointerEvent<HTMLButtonElement>
  ) => {
    const session = resizeSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    event.preventDefault();
    const nextWidth = calculateDocumentImageResizeWidth({
      startWidthPx: session.startWidth,
      pointerDeltaX: event.clientX - session.startClientX,
      viewScale: options.getViewScale(),
      minimumWidthPx,
      maximumWidthPx,
    });
    session.moved =
      session.moved || Math.abs(nextWidth - session.startWidth) > 0.5;
    previewWidthRef.current = nextWidth;
    setPreviewWidth(nextWidth);
  };

  const handleResizeEnd = (
    event: ReactPointerEvent<HTMLButtonElement>
  ) => {
    const session = resizeSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    resizeSessionRef.current = null;
    const committedWidth = previewWidthRef.current ?? attributes.widthPx;
    previewWidthRef.current = null;
    if (session.moved) {
      commitWidth(committedWidth);
    } else {
      setPreviewWidth(null);
    }
  };

  const handleResizeCancel = (
    event: ReactPointerEvent<HTMLButtonElement>
  ) => {
    const session = resizeSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    resizeSessionRef.current = null;
    previewWidthRef.current = null;
    setPreviewWidth(null);
  };

  const media = source && !sourceFailed ? (
    <img
      className="document-image__media"
      src={source}
      alt={attributes.altText}
      draggable={false}
      width={renderedWidth}
      height={renderedHeight}
      data-natural-width={attributes.naturalWidth}
      data-natural-height={attributes.naturalHeight}
      style={{
        objectFit: attributes.cropMode === 'fill' ? 'cover' : 'contain',
        objectPosition: `${attributes.cropFocalX * 100}% ${attributes.cropFocalY * 100}%`,
      }}
      onError={() => setSourceFailed(true)}
    />
  ) : (
    <span
      className="document-image__missing"
      role="img"
      aria-label={attributes.altText || 'Missing document image'}
    >
      Image unavailable
    </span>
  );

  const imageContent = (
    <>
      <div
        className="document-image__frame-container"
        style={{
          width: `${renderedWidth}px`,
          height: `${renderedHeight}px`,
        }}
      >
        <div
          className="document-image__frame"
          data-document-image-frame="true"
          data-document-visible-image-id={attributes.id}
          data-document-image-hit-target="true"
          data-crop-mode={attributes.cropMode}
          data-crop-focal-x={attributes.cropFocalX}
          data-crop-focal-y={attributes.cropFocalY}
          style={{
            width: `${renderedWidth}px`,
            height: `${renderedHeight}px`,
          }}
        >
          {media}
        </div>
        {selected && (
          <button
            type="button"
            className="document-image__resize-handle"
            aria-label="Resize image"
            data-document-editor-only="true"
            data-document-export-exclude="true"
            onPointerDown={handleResizeStart}
            onPointerMove={handleResizeMove}
            onPointerUp={handleResizeEnd}
            onPointerCancel={handleResizeCancel}
          />
        )}
      </div>
      {attributes.caption && (
        nodeType === 'documentInlineImage' ? (
          <span
            className="document-image__caption"
            data-caption-alignment={attributes.captionAlignment}
            data-caption-italic={String(attributes.captionItalic)}
            data-caption-spacing-px={attributes.captionSpacingPx}
            style={captionStyle}
          >
            {attributes.caption}
          </span>
        ) : (
          <figcaption
            className="document-image__caption"
            data-caption-alignment={attributes.captionAlignment}
            data-caption-italic={String(attributes.captionItalic)}
            data-caption-spacing-px={attributes.captionSpacingPx}
            style={captionStyle}
          >
            {attributes.caption}
          </figcaption>
        )
      )}
    </>
  );

  return (
    <NodeViewWrapper
      as={nodeType === 'documentInlineImage' ? 'span' : 'figure'}
      className={[
        'document-image',
        nodeType === 'documentInlineImage'
          ? 'document-image--inline'
          : 'document-image--flow',
        selected ? 'document-image--selected' : '',
        multiSelected ? 'document-image--multi-selected' : '',
      ].filter(Boolean).join(' ')}
      contentEditable={false}
      onClick={(event: ReactMouseEvent<HTMLElement>) => {
        event.preventDefault();
        event.stopPropagation();
        const requestedImageId = options.onSelectImage?.({
          editor,
          position: undefined,
          imageId: attributes.id,
          additive: event.shiftKey || event.metaKey || event.ctrlKey,
        });
        const selectionImageId = requestedImageId === undefined
          ? attributes.id
          : requestedImageId;
        if (
          selectionImageId
          && selectDocumentImageById(editor, selectionImageId, nodeType)
            !== null
        ) {
          editor.commands.focus();
        }
      }}
      data-document-image="true"
      data-image-id={attributes.id}
      data-image-selected={multiSelected || selected ? 'true' : 'false'}
      data-asset-id={attributes.assetId}
      data-wrap={attributes.wrap}
      data-coordinate-space={attributes.coordinateSpace}
      data-vertical-anchor={attributes.verticalAnchor}
      data-y-px={attributes.yPx}
      data-horizontal-placement={attributes.horizontalPlacement}
      data-x-offset-px={attributes.xOffsetPx}
      data-caption-alignment={attributes.captionAlignment}
      data-caption-italic={String(attributes.captionItalic)}
      data-caption-spacing-px={attributes.captionSpacingPx}
      data-crop-mode={attributes.cropMode}
      data-crop-focal-x={attributes.cropFocalX}
      data-crop-focal-y={attributes.cropFocalY}
      style={{
        width: `${renderedWidth}px`,
        '--document-image-width': `${renderedWidth}px`,
        '--document-image-height': `${renderedHeight}px`,
        '--document-image-wrap-padding-top':
          `${attributes.wrapPaddingTopPx}px`,
        '--document-image-wrap-padding-right':
          `${attributes.wrapPaddingRightPx}px`,
        '--document-image-wrap-padding-bottom':
          `${attributes.wrapPaddingBottomPx}px`,
        '--document-image-wrap-padding-left':
          `${attributes.wrapPaddingLeftPx}px`,
        ...captionStyle,
      } as CSSProperties}
    >
      {imageContent}
    </NodeViewWrapper>
  );
};
