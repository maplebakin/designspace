import React, { useRef } from 'react';
import type { ScanReference } from '../types/documentProject';

type ScanReferenceLayerProps = {
  reference?: ScanReference;
  source?: string;
  adjustMode: boolean;
  zoom: number;
  onChange: (update: Partial<ScanReference>) => void;
};

export const ScanReferenceLayer: React.FC<ScanReferenceLayerProps> = ({
  reference,
  source,
  adjustMode,
  zoom,
  onChange,
}) => {
  const dragStart = useRef<{
    pointerX: number;
    pointerY: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);

  if (!reference || !source || !reference.visible) return null;

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!adjustMode) return;
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
    if (!dragStart.current || !adjustMode) return;
    const scale = zoom || 1;
    onChange({
      offsetXPx: dragStart.current.offsetX + (event.clientX - dragStart.current.pointerX) / scale,
      offsetYPx: dragStart.current.offsetY + (event.clientY - dragStart.current.pointerY) / scale,
    });
  };

  const stopDragging = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragStart.current = null;
  };

  return (
    <div
      className={`document-scan-reference ${adjustMode ? 'is-adjusting' : ''}`}
      data-document-export-exclude="true"
      data-reference-layer="true"
      data-testid="document-reference-layer"
      aria-hidden="true"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={stopDragging}
      onPointerCancel={stopDragging}
      style={{
        pointerEvents: adjustMode ? 'auto' : 'none',
        opacity: reference.opacity,
      }}
    >
      <img
        src={source}
        alt=""
        draggable={false}
        style={{
          objectFit: reference.fit === 'stretch' ? 'fill' : reference.fit,
          transform: `translate(${reference.offsetXPx}px, ${reference.offsetYPx}px) scale(${reference.scale})`,
        }}
      />
      {adjustMode && (
        <div className="document-reference-adjust-label">
          Drag the scan to align it
        </div>
      )}
    </div>
  );
};
