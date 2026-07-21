import React from 'react';
import { Maximize2, Minus, Plus } from 'lucide-react';

type DocumentZoomControlsProps = {
  zoom: number;
  fitMode: boolean;
  onZoomChange: (zoom: number) => void;
  onFitPage: () => void;
};

export const DocumentZoomControls: React.FC<DocumentZoomControlsProps> = ({
  zoom,
  fitMode,
  onZoomChange,
  onFitPage,
}) => (
  <div
    className="document-zoom-controls"
    data-document-export-exclude="true"
    data-document-editor-ui="true"
    data-testid="document-zoom-controls"
  >
    <button
      type="button"
      onClick={() => onZoomChange(zoom - 0.1)}
      aria-label="Zoom out"
    >
      <Minus size={16} aria-hidden="true" />
    </button>
    <span data-testid="document-zoom-indicator">
      {Math.round(zoom * 100)}%
    </span>
    <button
      type="button"
      onClick={() => onZoomChange(zoom + 0.1)}
      aria-label="Zoom in"
    >
      <Plus size={16} aria-hidden="true" />
    </button>
    <span className="document-zoom-controls__divider" aria-hidden="true" />
    <button
      type="button"
      className={fitMode ? 'is-selected' : ''}
      aria-pressed={fitMode}
      onClick={onFitPage}
    >
      <Maximize2 size={15} aria-hidden="true" />
      Fit page
    </button>
  </div>
);
