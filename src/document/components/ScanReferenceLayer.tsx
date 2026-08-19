import React, { useRef, useState } from 'react';
import type { ScanReference } from '../types/documentProject';

type ScanReferenceLayerProps = {
  reference?: ScanReference;
  source?: string;
  adjustMode: boolean;
  zoom: number;
  onChange: (update: Partial<ScanReference>) => void;
  onCommit?: (initial: Pick<ScanReference, 'offsetXPx' | 'offsetYPx'>) => void;
};

export const ScanReferenceLayer: React.FC<ScanReferenceLayerProps> = ({
  reference,
  source,
  adjustMode,
  zoom,
  onChange,
  onCommit,
}) => {
  const [loadedSource, setLoadedSource] = useState<string | null>(null);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const dragStart = useRef<{
    pointerX: number;
    pointerY: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  if (!reference || !source || !reference.visible) return null;
  const canAdjust = adjustMode && !reference.locked;
  const imageState = loadedSource === source
    ? 'loaded'
    : failedSource === source
      ? 'error'
      : 'loading';

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!canAdjust) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStart.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      offsetX: reference.offsetXPx,
      offsetY: reference.offsetYPx,
    };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStart.current || !canAdjust) return;
    const scale = zoom || 1;
    onChange({
      offsetXPx: dragStart.current.offsetX + (event.clientX - dragStart.current.pointerX) / scale,
      offsetYPx: dragStart.current.offsetY + (event.clientY - dragStart.current.pointerY) / scale,
    });
  };

  const stopDragging = (
    event: React.PointerEvent<HTMLDivElement>,
    completed = true
  ) => {
    const initial = dragStart.current;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (completed && initial) {
      onCommit?.({
        offsetXPx: initial.offsetX,
        offsetYPx: initial.offsetY,
      });
    }
    dragStart.current = null;
  };

  return (
    <div
      className={`document-scan-reference ${canAdjust ? 'is-adjusting' : ''}`}
      data-document-export-exclude="true"
      data-reference-layer="true"
      data-reference-diagnostic={imageState === 'error'
        ? 'REFERENCE_IMAGE_DECODE_FAILED'
        : imageState === 'loaded'
          ? 'REFERENCE_SOURCE_PRESENT'
          : 'REFERENCE_SOURCE_LOADING'}
      data-reference-image-state={imageState}
      data-reference-source-type={reference.sourceType}
      data-testid="document-reference-layer"
      aria-hidden="true"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={stopDragging}
      onPointerCancel={(event) => stopDragging(event, false)}
      style={{
        pointerEvents: canAdjust ? 'auto' : 'none',
        opacity: reference.opacity,
      }}
    >
      <img
        src={source}
        alt=""
        draggable={false}
        onError={() => setFailedSource(source)}
        onLoad={() => {
          setFailedSource(null);
          setLoadedSource(source);
        }}
        style={{
          objectFit: reference.fit === 'stretch' ? 'fill' : reference.fit,
          transform: `translate(${reference.offsetXPx}px, ${reference.offsetYPx}px) scale(${reference.scale})`,
        }}
      />
      {canAdjust && (
        <div className="document-reference-adjust-label">
          Drag the scan to align it
        </div>
      )}
    </div>
  );
};
