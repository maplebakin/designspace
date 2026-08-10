import React from 'react';
import type * as fabric from 'fabric';
import { Minus, Plus, Expand, AlertTriangle, MousePointer2, Layers } from 'lucide-react';
import { shallow } from 'zustand/shallow';
import { useEditorStore } from '../state/editorStore';
import { useCanvasStore } from '../state/useCanvasStore';
import { SAFE_MARGIN_PX, formatInches, fromCanvasUnits, UnitMode } from '../utils/units';
import { zoomToCenter } from '../fabric/canvasUtils';
import { SaveStatusBadge } from './SaveStatusBadge';

export type StatusBarProps = {
  showZoomControls?: boolean;
};

export const StatusBar: React.FC<StatusBarProps> = ({
  showZoomControls = true,
}) => {
  const { zoom, unitMode, setUnitMode, canvas, bleedPx, resetViewCanvas, saveStatus, showSafeZones, setShowSafeZones, selectedLayerIds, layers } = useEditorStore(
    (state) => ({
      zoom: state.zoom,
      unitMode: state.unitMode,
      setUnitMode: state.setUnitMode,
      canvas: state.canvas,
      bleedPx: state.bleedPx,
      resetViewCanvas: state.resetViewCanvas,
      saveStatus: state.saveStatus,
      showSafeZones: state.showSafeZones,
      setShowSafeZones: state.setShowSafeZones,
      selectedLayerIds: state.selectedLayerIds,
      layers: state.layers,
    }),
    shallow
  );

  // Get document dimensions from the canvas store (not canvas element size)
  const { width: widthPx, height: heightPx } = useCanvasStore(
    (state) => ({ width: state.width, height: state.height }),
    shallow
  );

  // Get selection info
  const selectionCount = selectedLayerIds.length;
  const getSelectionLabel = () => {
    if (selectionCount === 0) return null;
    if (selectionCount === 1) {
      const layer = layers.find((l) => l.id === selectedLayerIds[0]);
      if (layer) {
        const typeLabel = layer.type === 'i-text' || layer.type === 'textbox' ? 'Text' :
                         layer.type === 'rect' ? 'Rectangle' :
                         layer.type === 'circle' ? 'Circle' :
                         layer.type === 'triangle' ? 'Triangle' :
                         layer.type === 'polygon' ? 'Star' :
                         layer.type === 'image' ? 'Image' :
                         layer.type === 'group' ? 'Group' : layer.type;
        return typeLabel;
      }
    }
    return `${selectionCount} objects`;
  };
  const selectionLabel = getSelectionLabel();
  const formatMeasurement = (value: number, mode: UnitMode) => {
    if (mode === 'in') {
      return formatInches(value);
    }
    const rounded = Number(value.toFixed(2));
    if (!Number.isFinite(rounded)) return '0';
    const formatted = rounded.toFixed(2).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
    return formatted;
  };

  const convertToUnitValue = (value: number) =>
    unitMode === 'px' ? value : (fromCanvasUnits(value, unitMode) as number);

  const handleZoom = (factor: number) => {
    if (canvas) {
      const newZoom = canvas.getZoom() * factor;
      zoomToCenter(newZoom);
    }
  };

  const zoomPresets = [0.25, 0.5, 1, 2];
  const setZoomLevel = (level: number) => {
    if (!canvas) return;
    zoomToCenter(level);
  };
  const isZoomActive = (level: number) => Math.abs(zoom - level) < 0.01;

  const dimensionLabel = unitMode === 'px'
    ? `${Math.round(widthPx)} x ${Math.round(heightPx)} px`
    : `${formatMeasurement(convertToUnitValue(widthPx), unitMode)} x ${formatMeasurement(convertToUnitValue(heightPx), unitMode)} ${unitMode}`;

  const safeLabel = unitMode === 'px'
    ? `${SAFE_MARGIN_PX}px`
    : `${formatMeasurement(convertToUnitValue(SAFE_MARGIN_PX), unitMode)}${unitMode}`;

  const canvasWidth = widthPx;
  const canvasHeight = heightPx;
  const isBackgroundCandidate = (obj: fabric.FabricObject) => {
    if ((obj as any).get?.('isGuide') || (obj as any).isGuide) return false;
    const bbox = obj.getBoundingRect();
    return bbox.width >= canvasWidth * 0.8 && bbox.height >= canvasHeight * 0.8;
  };
  const coversBleed = (obj: fabric.FabricObject) => {
    const bbox = obj.getBoundingRect();
    return (
      bbox.left <= bleedPx &&
      bbox.top <= bleedPx &&
      bbox.left + bbox.width >= canvasWidth - bleedPx &&
      bbox.top + bbox.height >= canvasHeight - bleedPx
    );
  };
  const hasBleedCoverage =
    canvas && canvasWidth > 0 && canvasHeight > 0
      ? canvas.getObjects().some((obj) => isBackgroundCandidate(obj) && coversBleed(obj))
      : true;
  const bleedWarning = unitMode === 'in' && canvas && canvasWidth > 0 && canvasHeight > 0 && !hasBleedCoverage;

  return (
    <footer data-testid="status-bar" className="design-space-statusbar bg-[color:var(--ui-panel)] backdrop-blur-[var(--ui-blur)] border-t border-[color:var(--ui-border)] h-12 flex items-center justify-between px-4 gap-4 z-10">
      <div className="flex items-center gap-4 text-[11px] uppercase tracking-widest text-[color:var(--ui-panel-text)]">
        {/* Selection Indicator */}
        {selectionLabel && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[color:var(--brand-primary)]/15 border border-[color:var(--brand-primary)]/30 text-[color:var(--brand-primary)]">
            <MousePointer2 className="w-3 h-3 stroke-[1.5]" />
            <span className="text-[10px] font-medium">{selectionLabel}</span>
          </div>
        )}
        <div className="flex items-center gap-1.5 text-[color:var(--ui-panel-text)]">
          <Layers className="w-3 h-3 stroke-[1.5]" />
          <span className="text-[10px]">{layers.length} layers</span>
        </div>
        <span>Canvas: {dimensionLabel}</span>
        <span>Safe: {safeLabel}</span>
        {bleedWarning && (
          <div className="flex items-center gap-1" style={{ color: 'var(--semantic-error)' }} title="Background artwork should extend into the bleed">
            <AlertTriangle className="w-4 h-4 stroke-[1.5]" />
            <span className="text-[10px] uppercase tracking-widest">Bleed</span>
          </div>
        )}
        <div className="flex items-center rounded-full overflow-hidden border border-[color:var(--border-subtle)] bg-[color:var(--ui-surface-soft)]">
          <button
            onClick={() => setUnitMode('px')}
            className={`px-3 py-1 text-[10px] uppercase tracking-widest transition-all duration-200 ${unitMode === 'px' ? 'bg-[color:var(--brand-primary)]/14 text-[color:var(--brand-primary)]' : 'text-[color:var(--ui-panel-text)] hover:text-[color:var(--brand-primary)]'}`}
          >
            PX
          </button>
          <button
            onClick={() => setUnitMode('in')}
            className={`px-3 py-1 text-[10px] uppercase tracking-widest transition-all duration-200 ${unitMode === 'in' ? 'bg-[color:var(--brand-primary)]/14 text-[color:var(--brand-primary)]' : 'text-[color:var(--ui-panel-text)] hover:text-[color:var(--brand-primary)]'}`}
          >
            IN
          </button>
        </div>
        <button
          onClick={() => setShowSafeZones(!showSafeZones)}
          className={`flex items-center gap-2 px-3 py-1 rounded-full text-[10px] uppercase tracking-widest transition-all duration-200 ${
            showSafeZones
              ? 'bg-[color:var(--brand-primary)]/14 text-[color:var(--brand-primary)] border border-[color:var(--brand-primary)]/28'
              : 'text-[color:var(--ui-panel-text)] hover:text-[color:var(--brand-primary)] border border-[color:var(--ui-border)]'
          }`}
          title={showSafeZones ? "Hide Safe Zones" : "Show Safe Zones"}
        >
          <span>Safe Zones</span>
        </button>
        <SaveStatusBadge status={saveStatus} compact />
      </div>
      {showZoomControls && <div className="flex items-center gap-3">
        <div className="hidden md:flex items-center gap-1 rounded-full border border-[color:var(--ui-border)] bg-[color:var(--ui-surface-soft)] px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)] shadow-[var(--ui-shadow-soft)]">
          {zoomPresets.map((level) => (
            <button
              key={level}
              onClick={() => setZoomLevel(level)}
              className={`rounded-full px-2.5 py-1 transition-all duration-200 ${
                isZoomActive(level) ? 'bg-[color:var(--brand-primary)]/14 text-[color:var(--brand-primary)]' : 'text-[color:var(--ui-panel-text)] hover:text-[color:var(--brand-primary)]'
              }`}
              aria-label={`Zoom ${Math.round(level * 100)}%`}
            >
              {Math.round(level * 100)}%
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1 rounded-full border border-[color:var(--ui-border)] bg-[color:var(--ui-surface-soft)] px-1 py-0.5 shadow-[var(--ui-shadow-soft)]">
          <button
            onClick={() => handleZoom(0.8)}
            className="rounded-full p-1.5 text-[color:var(--ui-panel-text)] transition-all duration-200 hover:text-[color:var(--brand-primary)] hover:bg-[color:var(--ui-hover-soft)]"
            aria-label="Zoom Out"
          >
            <Minus className="w-3.5 h-3.5 stroke-[1.5]" />
          </button>
          <span className="font-mono text-xs w-12 text-center text-[color:var(--ui-text)]">{Math.round(zoom * 100)}%</span>
          <button
            onClick={() => handleZoom(1.25)}
            className="rounded-full p-1.5 text-[color:var(--ui-panel-text)] transition-all duration-200 hover:text-[color:var(--brand-primary)] hover:bg-[color:var(--ui-hover-soft)]"
            aria-label="Zoom In"
          >
            <Plus className="w-3.5 h-3.5 stroke-[1.5]" />
          </button>
        </div>
        <button
          onClick={() => resetViewCanvas && resetViewCanvas()}
          className="flex items-center gap-2 p-1.5 rounded-full border border-[color:var(--ui-border)] bg-[color:var(--ui-surface-soft)] shadow-[var(--ui-shadow-soft)] text-[color:var(--ui-panel-text)] hover:text-[color:var(--brand-primary)] transition-all duration-200"
          aria-label="Fit to Screen"
        >
          <Expand className="w-3.5 h-3.5 stroke-[1.5]" />
        </button>
      </div>}
    </footer>
  );
};
