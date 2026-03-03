import React, { useState } from 'react';
import { shallow } from 'zustand/shallow';
import {
  clearAndResizeCanvas,
  fitCanvasToViewport,
  resizeCanvasAndScaleContent,
  resizeCanvasOnly,
  rotateCanvas,
} from '../fabric/canvasUtils';
import { useEditorStore, DEFAULT_CANVAS_BACKGROUND } from '../state/editorStore';
import { useThemeStore } from '../state/useThemeStore';
import { useCanvasStore } from '../state/useCanvasStore';
import { ChevronDown, Check, RotateCw, Settings2 } from 'lucide-react';
import { PopoverSurface } from './PopoverSurface';
import { PRINT_DPI } from '../utils/units';
import { CANVAS_SETTINGS_PRESETS, type CanvasPreset } from '../config/canvasPresets';

type PendingResize = {
  width: number;
  height: number;
  label: string;
};

type ResizeChoice = 'keep' | 'scale' | 'clear';

export const CanvasSettingsPopover: React.FC = () => {
  const {
    canvas,
    showGuides,
    toggleShowGuides,
    setCanvasBackgroundColor,
    setProjectPresetsOpen,
  } = useEditorStore(
    (state) => ({
      canvas: state.canvas,
      showGuides: state.showGuides,
      toggleShowGuides: state.toggleShowGuides,
      setCanvasBackgroundColor: state.setCanvasBackgroundColor,
      setProjectPresetsOpen: state.setProjectPresetsOpen,
    }),
    shallow
  );
  const { canvasBackgroundColor } = useThemeStore(
    (state) => ({ canvasBackgroundColor: state.canvasBackgroundColor }),
    shallow
  );
  const safeCanvasBackgroundColor =
    canvasBackgroundColor && canvasBackgroundColor.toLowerCase() !== 'transparent'
      ? canvasBackgroundColor
      : null;

  const [isOpen, setIsOpen] = useState(false);
  const [showCustomSize, setShowCustomSize] = useState(false);
  const [customWidth, setCustomWidth] = useState('8.5');
  const [customHeight, setCustomHeight] = useState('11');
  const [pendingResize, setPendingResize] = useState<PendingResize | null>(null);

  const { width: docWidth, height: docHeight } = useCanvasStore(
    (state) => ({ width: state.width, height: state.height }),
    shallow
  );

  const currentSize = `${Math.round(docWidth)} × ${Math.round(docHeight)} px`;

  const fitToViewport = () => {
    requestAnimationFrame(() => {
      const container = document.querySelector('.workspace');
      if (!container) return;
      const rect = container.getBoundingClientRect();
      fitCanvasToViewport(rect.width, rect.height);
    });
  };

  const hasDesignObjects = () => {
    if (!canvas) return false;
    return canvas.getObjects().some((obj) => !(obj as any).isGuide);
  };

  const applyResizeChoice = (choice: ResizeChoice, width: number, height: number) => {
    switch (choice) {
      case 'keep':
        resizeCanvasOnly(width, height);
        break;
      case 'scale':
        resizeCanvasAndScaleContent(width, height);
        break;
      case 'clear':
        clearAndResizeCanvas(width, height);
        break;
      default:
        break;
    }

    fitToViewport();
    setPendingResize(null);
    setShowCustomSize(false);
    setIsOpen(false);
  };

  const requestResize = (width: number, height: number, label: string) => {
    if (!canvas) return;
    if (!hasDesignObjects()) {
      applyResizeChoice('keep', width, height);
      return;
    }
    setPendingResize({ width, height, label });
  };

  const applyPreset = (preset: CanvasPreset) => {
    requestResize(preset.width, preset.height, preset.name);
  };

  const applyCustomSize = () => {
    const widthIn = parseFloat(customWidth);
    const heightIn = parseFloat(customHeight);
    if (isNaN(widthIn) || isNaN(heightIn) || widthIn <= 0 || heightIn <= 0) return;
    requestResize(Math.round(widthIn * PRINT_DPI), Math.round(heightIn * PRINT_DPI), 'Custom Size');
  };

  return (
    <>
      <div className="relative">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="group flex items-center gap-2 px-3 py-2 bg-white/5 text-[color:var(--ui-text)] rounded-full border border-[color:var(--border-subtle)] hover:bg-white/10 transition-all duration-300 ease-in-out text-[11px] uppercase tracking-widest"
        >
          <span>{currentSize}</span>
          <ChevronDown className={`icon-muted w-4 h-4 stroke-[1.5] transition-all duration-300 ease-in-out ${isOpen ? 'rotate-180' : ''}`} />
        </button>
        {isOpen && (
          <PopoverSurface className="absolute left-0 mt-2 w-72 z-20">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-[11px] uppercase tracking-widest text-[color:var(--ui-text)]">Canvas Size</h3>
                <button
                  onClick={() => {
                    rotateCanvas();
                    fitToViewport();
                  }}
                  className="flex items-center gap-1.5 px-2 py-1 text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)] bg-white/5 rounded-lg border border-transparent hover:border-[color:var(--brand-primary)] hover:text-[color:var(--ui-text)] transition-all duration-200"
                  title="Rotate canvas (swap width/height)"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                  Rotate
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {CANVAS_SETTINGS_PRESETS.map((preset) => (
                  <button
                    key={preset.name}
                    onClick={() => applyPreset(preset)}
                    className={`w-full text-left px-3 py-2 rounded-lg border transition-all duration-300 ease-in-out ${
                      preset.name === 'US Letter'
                        ? 'bg-[color:var(--brand-primary)]/20 border-[color:var(--brand-primary)]/50 hover:bg-[color:var(--brand-primary)]/30'
                        : 'bg-white/5 border-transparent hover:border-[color:var(--brand-primary)]'
                    }`}
                  >
                    <span className={`text-xs uppercase tracking-widest ${preset.name === 'US Letter' ? 'text-[color:var(--brand-primary)]' : 'text-[color:var(--ui-text)]'}`}>{preset.name}</span>
                    <p className="text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)]">{preset.description}</p>
                  </button>
                ))}
              </div>
              <div className="pt-2 space-y-2">
                {showCustomSize ? (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <label className="text-[9px] uppercase tracking-widest text-[color:var(--ui-panel-text)] block mb-1">Width (in)</label>
                        <input
                          type="number"
                          step="0.1"
                          min="1"
                          value={customWidth}
                          onChange={(event) => setCustomWidth(event.target.value)}
                          className="w-full px-2 py-1.5 text-xs bg-black/30 border border-white/10 rounded-lg text-[color:var(--ui-text)] focus:border-[color:var(--brand-primary)] outline-none"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="text-[9px] uppercase tracking-widest text-[color:var(--ui-panel-text)] block mb-1">Height (in)</label>
                        <input
                          type="number"
                          step="0.1"
                          min="1"
                          value={customHeight}
                          onChange={(event) => setCustomHeight(event.target.value)}
                          className="w-full px-2 py-1.5 text-xs bg-black/30 border border-white/10 rounded-lg text-[color:var(--ui-text)] focus:border-[color:var(--brand-primary)] outline-none"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setShowCustomSize(false)}
                        className="flex-1 px-3 py-1.5 text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)] bg-white/5 rounded-lg hover:bg-white/10"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={applyCustomSize}
                        className="flex-1 px-3 py-1.5 text-[10px] uppercase tracking-widest text-white bg-[color:var(--brand-primary)] rounded-lg hover:brightness-110"
                      >
                        Apply
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowCustomSize(true)}
                    className="w-full flex items-center justify-center gap-2 px-3 py-2 text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)] bg-white/5 rounded-lg border border-dashed border-white/20 hover:border-[color:var(--brand-primary)] hover:text-[color:var(--ui-text)] transition-all duration-200"
                  >
                    <Settings2 className="w-3.5 h-3.5" />
                    Custom Size
                  </button>
                )}
                <button
                  onClick={() => {
                    setProjectPresetsOpen(true);
                    setIsOpen(false);
                  }}
                  className="w-full px-3 py-1.5 text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)] hover:text-[color:var(--ui-text)] transition-colors"
                >
                  More Presets...
                </button>
              </div>
              <hr className="border-t border-white/10" />
              <div className="space-y-2">
                <h4 className="text-[10px] uppercase tracking-widest text-[color:var(--ui-text)]">Background</h4>
                <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                  <span className="text-[10px] uppercase tracking-widest text-[color:var(--ui-text)]">Fill Color</span>
                  <input
                    type="color"
                    value={safeCanvasBackgroundColor || DEFAULT_CANVAS_BACKGROUND}
                    onChange={(event) => setCanvasBackgroundColor(event.target.value)}
                    className="h-6 w-10 cursor-pointer rounded border border-white/10 bg-transparent"
                    aria-label="Canvas background color"
                  />
                </div>
              </div>
              <button
                onClick={() => {
                  toggleShowGuides();
                }}
                className="w-full flex items-center justify-between px-3 py-2 text-xs uppercase tracking-widest text-[color:var(--ui-text)] rounded-lg hover:bg-white/10"
              >
                <span>Show Bleed/Safety Guides</span>
                <div className={`w-5 h-5 flex items-center justify-center rounded-sm border-2 ${showGuides ? 'bg-[color:var(--brand-primary)] border-[color:var(--brand-primary)]' : 'border-[color:var(--ui-border)]'}`}>
                  {showGuides && <Check className="w-4 h-4 text-white" />}
                </div>
              </button>
            </div>
          </PopoverSurface>
        )}
      </div>
      {pendingResize && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-xl rounded-xl border border-[color:var(--ui-border)] bg-[color:var(--ui-panel)] p-5 shadow-[0_20px_40px_rgba(0,0,0,0.45)]">
            <h3 className="text-xs uppercase tracking-widest text-[color:var(--ui-text)]">Resize Canvas</h3>
            <p className="mt-2 text-[11px] uppercase tracking-widest text-[color:var(--ui-panel-text)]">
              {pendingResize.label}: {pendingResize.width} × {pendingResize.height} px
            </p>
            <p className="mt-2 text-[11px] text-[color:var(--ui-panel-text)]">
              Choose how existing content should be handled.
            </p>
            <div className="mt-4 grid gap-2">
              <button
                onClick={() => applyResizeChoice('keep', pendingResize.width, pendingResize.height)}
                className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-left text-[11px] uppercase tracking-widest text-[color:var(--ui-text)] hover:border-[color:var(--brand-primary)]"
              >
                Resize canvas only
              </button>
              <button
                onClick={() => applyResizeChoice('scale', pendingResize.width, pendingResize.height)}
                className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-left text-[11px] uppercase tracking-widest text-[color:var(--ui-text)] hover:border-[color:var(--brand-primary)]"
              >
                Resize and scale content
              </button>
              <button
                onClick={() => applyResizeChoice('clear', pendingResize.width, pendingResize.height)}
                className="w-full rounded-lg border border-rose-400/25 bg-rose-500/10 px-3 py-2 text-left text-[11px] uppercase tracking-widest text-rose-200 hover:border-rose-300/45"
              >
                Clear and start fresh
              </button>
            </div>
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setPendingResize(null)}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)] hover:bg-white/10"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
