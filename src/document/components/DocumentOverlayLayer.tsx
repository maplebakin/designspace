import React, { useRef } from 'react';
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
  onSelect: (id: string | null) => void;
  onChange: (id: string, update: Partial<DocumentOverlayImage>) => void;
};

type Interaction = {
  id: string;
  mode: 'move' | 'resize';
  pointerX: number;
  pointerY: number;
  xPx: number;
  yPx: number;
  widthPx: number;
  heightPx: number;
};

export const DocumentOverlayLayer: React.FC<DocumentOverlayLayerProps> = ({
  placement,
  objects,
  assetSources,
  selectedId,
  zoom,
  onSelect,
  onChange,
}) => {
  const interaction = useRef<Interaction | null>(null);

  const beginInteraction = (
    event: React.PointerEvent<HTMLElement>,
    object: DocumentOverlayImage,
    mode: Interaction['mode']
  ) => {
    if (object.locked) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    onSelect(object.id);
    interaction.current = {
      id: object.id,
      mode,
      pointerX: event.clientX,
      pointerY: event.clientY,
      xPx: object.xPx,
      yPx: object.yPx,
      widthPx: object.widthPx,
      heightPx: object.heightPx,
    };
  };

  const moveInteraction = (event: React.PointerEvent<HTMLElement>) => {
    const active = interaction.current;
    if (!active) return;
    const viewScale = zoom || 1;
    const deltaX = (event.clientX - active.pointerX) / viewScale;
    const deltaY = (event.clientY - active.pointerY) / viewScale;
    if (active.mode === 'move') {
      onChange(active.id, {
        xPx: Math.max(0, active.xPx + deltaX),
        yPx: Math.max(0, active.yPx + deltaY),
      });
      return;
    }
    const ratio = active.heightPx / Math.max(1, active.widthPx);
    const widthPx = Math.max(48, active.widthPx + deltaX);
    onChange(active.id, {
      widthPx,
      heightPx: widthPx * ratio,
    });
  };

  const endInteraction = (event: React.PointerEvent<HTMLElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    interaction.current = null;
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
            className={`document-overlay-image ${selected ? 'is-selected' : ''}`}
            data-document-overlay-id={object.id}
            data-testid="document-overlay-image"
            data-caption-alignment={captionAlignment}
            data-caption-italic={String(captionItalic)}
            data-caption-spacing-px={captionSpacingPx}
            style={{
              left: object.xPx,
              top: object.yPx,
              width: object.widthPx,
              ...captionStyle,
            } as React.CSSProperties}
            onPointerDown={(event) => beginInteraction(event, object, 'move')}
            onPointerMove={moveInteraction}
            onPointerUp={endInteraction}
            onPointerCancel={endInteraction}
          >
            <img
              src={source}
              alt={object.altText}
              draggable={false}
              style={{
                width: object.widthPx,
                height: object.heightPx,
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
                onPointerCancel={endInteraction}
              />
            )}
          </figure>
        );
      })}
    </div>
  );
};
