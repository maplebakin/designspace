import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  moveRectangleWithoutCollisions,
  pagePoint,
  pageRectangle,
  resizeRectangleWithoutCollisions,
  viewportDelta,
  viewportDeltaToLayoutDelta,
  type CollisionObstacle,
  type PageRectangle,
} from '../layout';
import type {
  DocumentOverlayImage,
  DocumentOverlayPlacement,
} from '../types/documentProject';

type DocumentOverlayLayerProps = {
  placement: DocumentOverlayPlacement;
  objects: DocumentOverlayImage[];
  assetSources: Record<string, string>;
  selectedId: string | null;
  zoom: number;
  pageWidthPx: number;
  pageHeightPx: number;
  onSelect: (id: string | null) => void;
  onChange: (id: string, update: Partial<DocumentOverlayImage>) => void;
};

type OverlayPreview = Pick<
  DocumentOverlayImage,
  'xPx' | 'yPx' | 'widthPx' | 'heightPx'
>;

type Interaction = {
  id: string;
  mode: 'move' | 'resize';
  pointerId: number;
  pointerX: number;
  pointerY: number;
  start: OverlayPreview;
  latest: OverlayPreview;
  captionExtraHeightPx: number;
  startRectangle: PageRectangle;
  obstacles: CollisionObstacle<'page'>[];
  captureElement: HTMLElement;
  moved: boolean;
};

const samePreview = (left: OverlayPreview, right: OverlayPreview) => (
  Math.abs(left.xPx - right.xPx) < 0.01
  && Math.abs(left.yPx - right.yPx) < 0.01
  && Math.abs(left.widthPx - right.widthPx) < 0.01
  && Math.abs(left.heightPx - right.heightPx) < 0.01
);

/**
 * Page overlays use committed, unzoomed page-space coordinates. Pointer
 * movement is held locally as a preview and only reaches the document store
 * once the interaction completes.
 */
export const DocumentOverlayLayer: React.FC<DocumentOverlayLayerProps> = ({
  placement,
  objects,
  assetSources,
  selectedId,
  zoom,
  pageWidthPx,
  pageHeightPx,
  onSelect,
  onChange,
}) => {
  const interaction = useRef<Interaction | null>(null);
  const figureRefs = useRef(new Map<string, HTMLElement>());
  const [preview, setPreview] = useState<{
    id: string;
    geometry: OverlayPreview;
  } | null>(null);
  const pageBounds = pageRectangle(0, 0, pageWidthPx, pageHeightPx);

  const measureCaptionExtraHeight = useCallback((
    id: string,
    fallbackImageHeightPx: number
  ) => {
    const figure = figureRefs.current.get(id);
    if (!figure) return 0;
    const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
    const figureHeightPx = figure.getBoundingClientRect().height / scale;
    return Math.max(0, figureHeightPx - fallbackImageHeightPx);
  }, [zoom]);

  const occupiedRectangle = useCallback((
    object: DocumentOverlayImage
  ) => pageRectangle(
    object.xPx,
    object.yPx,
    object.widthPx,
    object.heightPx + measureCaptionExtraHeight(
      object.id,
      object.heightPx
    )
  ), [measureCaptionExtraHeight]);

  const finishInteraction = useCallback((
    pointerId: number,
    cancelled: boolean
  ) => {
    const active = interaction.current;
    if (!active || active.pointerId !== pointerId) return;
    if (active.captureElement.hasPointerCapture?.(pointerId)) {
      active.captureElement.releasePointerCapture?.(pointerId);
    }
    interaction.current = null;
    setPreview(null);
    if (cancelled || !active.moved) return;
    if (active.mode === 'move') {
      onChange(active.id, {
        xPx: active.latest.xPx,
        yPx: active.latest.yPx,
      });
      return;
    }
    onChange(active.id, {
      widthPx: active.latest.widthPx,
      heightPx: active.latest.heightPx,
    });
  }, [onChange]);

  const finishInteractionRef = useRef(finishInteraction);
  finishInteractionRef.current = finishInteraction;

  useEffect(() => {
    const handlePointerUp = (event: globalThis.PointerEvent) => {
      finishInteractionRef.current(event.pointerId, false);
    };
    const handlePointerCancel = (event: globalThis.PointerEvent) => {
      finishInteractionRef.current(event.pointerId, true);
    };
    const handleBlur = () => {
      const active = interaction.current;
      if (active) finishInteractionRef.current(active.pointerId, true);
    };
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  useEffect(() => {
    if (!interaction.current) setPreview(null);
  }, [objects]);

  const beginInteraction = (
    event: React.PointerEvent<HTMLElement>,
    object: DocumentOverlayImage,
    mode: Interaction['mode']
  ) => {
    if (object.locked) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    onSelect(object.id);
    const start = {
      xPx: object.xPx,
      yPx: object.yPx,
      widthPx: object.widthPx,
      heightPx: object.heightPx,
    };
    const captionExtraHeightPx = measureCaptionExtraHeight(
      object.id,
      object.heightPx
    );
    interaction.current = {
      id: object.id,
      mode,
      pointerId: event.pointerId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      start,
      latest: start,
      captionExtraHeightPx,
      startRectangle: pageRectangle(
        object.xPx,
        object.yPx,
        object.widthPx,
        object.heightPx + captionExtraHeightPx
      ),
      obstacles: objects
        .filter((candidate) => (
          candidate.id !== object.id
          && candidate.placement === placement
        ))
        .map((candidate) => ({
          id: candidate.id,
          rectangle: occupiedRectangle(candidate),
        })),
      captureElement: event.currentTarget,
      moved: false,
    };
  };

  const moveInteraction = (event: React.PointerEvent<HTMLElement>) => {
    const active = interaction.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const delta = viewportDeltaToLayoutDelta(
      viewportDelta(
        event.clientX - active.pointerX,
        event.clientY - active.pointerY
      ),
      zoom,
      'page'
    );
    let geometry: OverlayPreview;
    if (active.mode === 'move') {
      const result = moveRectangleWithoutCollisions({
        start: active.startRectangle,
        desiredOrigin: pagePoint(
          active.start.xPx + delta.xPx,
          active.start.yPx + delta.yPx
        ),
        obstacles: active.obstacles,
        bounds: pageBounds,
      });
      geometry = {
        ...active.start,
        xPx: result.rectangle.leftPx,
        yPx: result.rectangle.topPx,
      };
    } else {
      const aspectRatio =
        active.start.heightPx / Math.max(1, active.start.widthPx);
      const desiredWidthPx = Math.max(48, active.start.widthPx + delta.xPx);
      const desiredImageHeightPx = desiredWidthPx * aspectRatio;
      const result = resizeRectangleWithoutCollisions({
        start: active.startRectangle,
        desiredWidthPx,
        desiredHeightPx:
          desiredImageHeightPx + active.captionExtraHeightPx,
        obstacles: active.obstacles,
        bounds: pageBounds,
        minimumWidthPx: Math.min(48, pageBounds.widthPx),
        minimumHeightPx: Math.min(
          1 + active.captionExtraHeightPx,
          pageBounds.heightPx
        ),
      });
      geometry = {
        ...active.start,
        widthPx: result.rectangle.widthPx,
        heightPx: Math.max(
          1,
          result.rectangle.heightPx - active.captionExtraHeightPx
        ),
      };
    }
    active.latest = geometry;
    active.moved = active.moved || !samePreview(geometry, active.start);
    setPreview({ id: active.id, geometry });
  };

  const endInteraction = (event: React.PointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    finishInteraction(event.pointerId, false);
  };

  const cancelInteraction = (event: React.PointerEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    finishInteraction(event.pointerId, true);
  };

  return (
    <div
      className={`document-overlay-layer document-overlay-${placement}`}
      data-testid={`document-overlay-layer-${placement}`}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onSelect(null);
      }}
    >
      {objects.filter((object) => object.placement === placement).map((object) => {
        const source = assetSources[object.assetId];
        if (!source) return null;
        const selected = object.id === selectedId;
        const rendered = preview?.id === object.id
          ? { ...object, ...preview.geometry }
          : object;
        const captionAlignment =
          object.captionAlignment === 'inherit'
          || object.captionAlignment === 'left'
          || object.captionAlignment === 'center'
          || object.captionAlignment === 'right'
            ? object.captionAlignment
            : 'inherit';
        const captionItalic =
          typeof object.captionItalic === 'boolean'
          || object.captionItalic === 'inherit'
            ? object.captionItalic
            : 'inherit';
        const captionSpacingPx =
          object.captionSpacingPx === 'inherit'
            ? 'inherit'
            : Number.isFinite(object.captionSpacingPx)
              ? Math.min(96, Math.max(0, Number(object.captionSpacingPx)))
              : 'inherit';
        const captionStyle = {
          ...(captionAlignment === 'inherit'
            ? {}
            : { '--document-caption-alignment': captionAlignment }),
          ...(captionItalic === 'inherit'
            ? {}
            : {
                '--document-caption-font-style':
                  captionItalic ? 'italic' : 'normal',
              }),
          ...(captionSpacingPx === 'inherit'
            ? {}
            : {
                '--document-caption-spacing': `${captionSpacingPx}px`,
              }),
        } as React.CSSProperties;
        return (
          <figure
            key={object.id}
            ref={(element) => {
              if (element) {
                figureRefs.current.set(object.id, element);
              } else {
                figureRefs.current.delete(object.id);
              }
            }}
            className={`document-overlay-image ${selected ? 'is-selected' : ''}`}
            data-document-overlay-id={object.id}
            data-testid="document-overlay-image"
            data-caption-alignment={captionAlignment}
            data-caption-italic={String(captionItalic)}
            data-caption-spacing-px={captionSpacingPx}
            data-previewing={preview?.id === object.id ? 'true' : 'false'}
            style={{
              left: rendered.xPx,
              top: rendered.yPx,
              width: rendered.widthPx,
              ...captionStyle,
            } as React.CSSProperties}
            onPointerDown={(event) => beginInteraction(event, object, 'move')}
            onPointerMove={moveInteraction}
            onPointerUp={endInteraction}
            onPointerCancel={cancelInteraction}
          >
            <img
              src={source}
              alt={object.altText}
              draggable={false}
              style={{
                width: rendered.widthPx,
                height: rendered.heightPx,
              }}
            />
            {object.caption && (
              <figcaption
                data-caption-alignment={captionAlignment}
                data-caption-italic={String(captionItalic)}
                data-caption-spacing-px={captionSpacingPx}
              >
                {object.caption}
              </figcaption>
            )}
            {selected && !object.locked && (
              <button
                type="button"
                className="document-overlay-resize"
                data-document-export-exclude="true"
                aria-label="Resize overlay image"
                onPointerDown={(event) => beginInteraction(event, object, 'resize')}
                onPointerMove={moveInteraction}
                onPointerUp={endInteraction}
                onPointerCancel={cancelInteraction}
              />
            )}
          </figure>
        );
      })}
    </div>
  );
};
