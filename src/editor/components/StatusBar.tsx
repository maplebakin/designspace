import React from 'react';
import type * as fabric from 'fabric';
import { Minus, Plus, Expand, AlertTriangle } from 'lucide-react';
import { shallow } from 'zustand/shallow';
import { useEditorStore } from '../state/editorStore';
import { SAFE_MARGIN_PX, canvasDimensionsInInches, formatInches, safeMarginInches } from '../utils/units';

export const StatusBar: React.FC = () => {
  const { zoom, unitMode, setUnitMode, canvas, bleedPx, resetViewCanvas } = useEditorStore(
    (state) => ({
      zoom: state.zoom,
      unitMode: state.unitMode,
      setUnitMode: state.setUnitMode,
      canvas: state.canvas,
      bleedPx: state.bleedPx,
      resetViewCanvas: state.resetViewCanvas,
    }),
    shallow
  );

  const widthPx = canvas?.getWidth ? canvas.getWidth() : canvas?.width || 0;
  const heightPx = canvas?.getHeight ? canvas.getHeight() : canvas?.height || 0;
  const { width: widthIn, height: heightIn } = canvasDimensionsInInches(widthPx, heightPx);
  const safeMarginIn = safeMarginInches();

  const handleZoom = (factor: number) => {
    if (canvas) {
      const newZoom = canvas.getZoom() * factor;
      canvas.setZoom(newZoom);
      canvas.requestRenderAll();
      useEditorStore.getState().setZoom(newZoom);
    }
  };

  const zoomPresets = [0.25, 0.5, 1, 2];
  const setZoomLevel = (level: number) => {
    if (!canvas) return;
    canvas.setZoom(level);
    canvas.requestRenderAll();
    useEditorStore.getState().setZoom(level);
  };
  const isZoomActive = (level: number) => Math.abs(zoom - level) < 0.01;

  const dimensionLabel = unitMode === 'px'
    ? `${Math.round(widthPx)} x ${Math.round(heightPx)} px`
    : `${formatInches(widthIn)} x ${formatInches(heightIn)} in`;

  const safeLabel = unitMode === 'px'
    ? `${SAFE_MARGIN_PX}px`
    : `${formatInches(safeMarginIn)}in`;

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
    <footer className="bg-[color:var(--ui-panel)] backdrop-blur-[var(--ui-blur)] border-t border-[color:var(--ui-border)] h-12 flex items-center justify-between px-4 gap-4 z-10">
      <div className="flex items-center gap-4 text-[11px] uppercase tracking-widest text-slate-300">
        <span>Canvas: {dimensionLabel}</span>
        <span>Safe: {safeLabel}</span>
        {bleedWarning && (
          <div className="flex items-center gap-1 text-rose-300" title="Background artwork should extend into the bleed">
            <AlertTriangle className="w-4 h-4 stroke-[1.5]" />
            <span className="text-[10px] uppercase tracking-widest">Bleed</span>
          </div>
        )}
        <div className="flex items-center rounded-full overflow-hidden border border-[color:var(--border-subtle)]">
          <button
            onClick={() => setUnitMode('px')}
            className={`px-4 py-1 text-[11px] uppercase tracking-widest transition-all duration-300 ease-in-out ${unitMode === 'px' ? 'bg-white/10 text-slate-100' : 'text-slate-400 hover:text-[color:var(--brand-primary)]'}`}
          >
            PX
          </button>
          <button
            onClick={() => setUnitMode('in')}
            className={`px-4 py-1 text-[11px] uppercase tracking-widest transition-all duration-300 ease-in-out ${unitMode === 'in' ? 'bg-white/10 text-slate-100' : 'text-slate-400 hover:text-[color:var(--brand-primary)]'}`}
          >
            IN
          </button>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="hidden md:flex items-center gap-2 rounded-full border border-[color:var(--border-subtle)] bg-white/10 px-3 py-1 text-[10px] uppercase tracking-widest text-slate-300 shadow-[0_0_24px_rgba(0,0,0,0.25)]">
          {zoomPresets.map((level) => (
            <button
              key={level}
              onClick={() => setZoomLevel(level)}
              className={`rounded-full px-2 py-1 transition-all duration-300 ease-in-out ${
                isZoomActive(level) ? 'bg-white/15 text-slate-100' : 'text-slate-400 hover:text-[color:var(--brand-primary)]'
              }`}
              aria-label={`Zoom ${Math.round(level * 100)}%`}
            >
              {Math.round(level * 100)}%
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 rounded-full border border-[color:var(--border-subtle)] bg-white/10 px-2 py-1 shadow-[0_0_24px_rgba(0,0,0,0.25)]">
          <button
            onClick={() => handleZoom(0.8)}
            className="rounded-full p-2 text-slate-200 transition-all duration-300 ease-in-out hover:bg-white/10"
            aria-label="Zoom Out"
          >
            <Minus className="icon-muted w-4 h-4 stroke-[1.5]" />
          </button>
          <span className="text-sm font-semibold w-16 text-center text-slate-100">{Math.round(zoom * 100)}%</span>
          <button
            onClick={() => handleZoom(1.25)}
            className="rounded-full p-2 text-slate-200 transition-all duration-300 ease-in-out hover:bg-white/10"
            aria-label="Zoom In"
          >
            <Plus className="icon-muted w-4 h-4 stroke-[1.5]" />
          </button>
        </div>
        <button
          onClick={() => resetViewCanvas && resetViewCanvas()} // Use resetViewCanvas
          className="flex items-center gap-2 p-2 rounded-full bg-white/10 shadow-[0_0_18px_var(--brand-accent)] transition-all duration-300 ease-in-out"
          aria-label="Fit to Screen"
        >
          <Expand className="icon-muted w-4 h-4 stroke-[1.5]" />
        </button>
      </div>
    </footer>
  );
};
