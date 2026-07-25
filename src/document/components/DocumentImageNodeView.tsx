import {
  useEffect,
  useState,
  useRef,
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
  normalizeDocumentImageAttributes,
} from '../extensions/DocumentImageExtension';

type ResizeSession = {
  pointerId: number;
  startClientX: number;
  startWidth: number;
};

export const DocumentImageNodeView = ({
  node,
  editor,
  extension,
  getPos,
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
  const resizeSessionRef = useRef<ResizeSession | null>(null);
  const [previewWidth, setPreviewWidth] = useState<number | null>(null);
  const [sourceFailed, setSourceFailed] = useState(false);

  useEffect(() => {
    setSourceFailed(false);
  }, [source]);

  useEffect(() => {
    setPreviewWidth(null);
  }, [attributes.widthPx]);

  const aspectRatio =
    attributes.naturalWidth > 0 && attributes.naturalHeight > 0
      ? attributes.naturalWidth / attributes.naturalHeight
      : attributes.widthPx / Math.max(1, attributes.heightPx);
  const renderedWidth = previewWidth ?? attributes.widthPx;
  const renderedHeight = Math.max(1, Math.round(renderedWidth / aspectRatio));

  const normalizeWidth = (value: number) =>
    Math.max(
      Math.max(options.minWidthPx, 32),
      Math.min(
        Math.max(
          attributes.wrap === 'span-columns'
            ? Math.min(
                options.maxSpanWidthPx,
                options.getSpanWidthPx(attributes.spanCount)
              )
            : options.maxWidthPx,
          Math.max(options.minWidthPx, 32)
        ),
        Number.isFinite(value) ? value : attributes.widthPx
      )
    );

  const commitWidth = (requestedWidth: number) => {
    const widthPx = normalizeWidth(requestedWidth);
    updateAttributes({
      widthPx,
      heightPx: Math.max(1, Math.round(widthPx / aspectRatio)),
    });
    setPreviewWidth(null);
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
    };
    setPreviewWidth(attributes.widthPx);
  };

  const handleResizeMove = (
    event: ReactPointerEvent<HTMLButtonElement>
  ) => {
    const session = resizeSessionRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    event.preventDefault();
    const scale = Math.max(0.05, options.getViewScale() || 1);
    const nextWidth = normalizeWidth(
      session.startWidth + (event.clientX - session.startClientX) / scale
    );
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
    commitWidth(previewWidth ?? attributes.widthPx);
  };

  const imageContent = (
    <>
      {source && !sourceFailed ? (
        <img
          className="document-image__media"
          src={source}
          alt={attributes.altText}
          draggable={false}
          width={renderedWidth}
          height={renderedHeight}
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
      )}
      {attributes.caption && (
        nodeType === 'documentInlineImage' ? (
          <span className="document-image__caption">
            {attributes.caption}
          </span>
        ) : (
          <figcaption className="document-image__caption">
            {attributes.caption}
          </figcaption>
        )
      )}
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
          onPointerCancel={handleResizeEnd}
        />
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
      ].filter(Boolean).join(' ')}
      contentEditable={false}
      onClick={(event: ReactMouseEvent<HTMLElement>) => {
        event.preventDefault();
        event.stopPropagation();
        const position = getPos();
        if (typeof position === 'number') {
          editor.commands.setNodeSelection(position);
          editor.commands.focus();
        }
      }}
      data-document-image="true"
      data-image-id={attributes.id}
      data-wrap={attributes.wrap}
      data-vertical-anchor={attributes.verticalAnchor}
      data-y-px={attributes.yPx}
      style={{
        width: `${renderedWidth}px`,
        '--document-image-width': `${renderedWidth}px`,
        '--document-image-height': `${renderedHeight}px`,
        '--document-image-wrap-padding': `${attributes.wrapPaddingPx}px`,
      }}
    >
      {imageContent}
    </NodeViewWrapper>
  );
};
