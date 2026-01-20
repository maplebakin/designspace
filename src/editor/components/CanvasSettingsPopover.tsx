
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { shallow } from 'zustand/shallow';
import { resizeCanvas, rotateCanvas } from '../fabric/canvasUtils';
import { useEditorStore, DEFAULT_CANVAS_BACKGROUND } from '../state/editorStore';
import { useThemeStore } from '../state/useThemeStore';
import { ChevronDown, Check, RotateCw } from 'lucide-react';
import { PopoverSurface } from './PopoverSurface';

type CanvasPreset = {
  name: string;
  description: string;
  width: number; // Always in pixels
  height: number; // Always in pixels
};

const presets: CanvasPreset[] = [
    { name: 'US Letter', description: '8.5" × 11"', width: 8.5 * 300, height: 11 * 300 },
    { name: 'A4', description: '210 × 297 mm', width: 2480, height: 3508 },
    { name: 'A5 Grimoire', description: '5.8" × 8.3"', width: 1740, height: 2490 },
    { name: 'Ritual Card', description: '5" × 7"', width: 1500, height: 2100 },
    { name: 'Instagram Square', description: '1080 × 1080 px', width: 1080, height: 1080 },
];

const confirmClearMessage =
  'Changing the canvas size will clear your current design. Are you sure you want to proceed?';

export const CanvasSettingsPopover: React.FC = () => {
  const {
    canvas,
    requestLayerSync,
    showGuides,
    toggleShowGuides,
    setCanvasBackgroundColor,
  } = useEditorStore(
    (state) => ({
      canvas: state.canvas,
      requestLayerSync: state.requestLayerSync,
      showGuides: state.showGuides,
      toggleShowGuides: state.toggleShowGuides,
      setCanvasBackgroundColor: state.setCanvasBackgroundColor,
    }),
    shallow
  );
  const { canvasBackgroundColor } = useThemeStore(
    (state) => ({ canvasBackgroundColor: state.canvasBackgroundColor }),
    shallow
  );
  const [isOpen, setIsOpen] = useState(false);
  const [currentSize, setCurrentSize] = useState('');
  const lastSizeRef = useRef<{ width: number; height: number } | null>(null);

  const updateSize = useCallback(() => {
    if (!canvas) return;
    const width = Math.round(canvas.getWidth());
    const height = Math.round(canvas.getHeight());
    const lastSize = lastSizeRef.current;
    if (lastSize && lastSize.width === width && lastSize.height === height) return;
    lastSizeRef.current = { width, height };
    setCurrentSize(`${width} × ${height} px`);
  }, [canvas]);

  useEffect(() => {
    if (!canvas) return;
    updateSize();
    canvas.on('object:modified', updateSize);
    canvas.on('after:render', updateSize);
    return () => {
      canvas.off('object:modified', updateSize);
      canvas.off('after:render', updateSize);
    };
  }, [canvas, updateSize]);

  const applyPreset = (preset: CanvasPreset) => {
    if (!canvas) return;
    if (canvas.getObjects().length > 0) {
      const proceed = window.confirm(confirmClearMessage);
      if (!proceed) return;
    }

    canvas.discardActiveObject();
    canvas.clear();

    requestLayerSync();
    resizeCanvas(preset.width, preset.height);
    updateSize();
    
    setIsOpen(false);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="group flex items-center gap-2 px-3 py-2 bg-white/5 text-slate-200 rounded-full border border-[color:var(--border-subtle)] hover:bg-white/10 transition-all duration-300 ease-in-out text-[11px] uppercase tracking-widest"
      >
        <span>{currentSize}</span>
        <ChevronDown className={`icon-muted w-4 h-4 stroke-[1.5] transition-all duration-300 ease-in-out ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      {isOpen && (
         <PopoverSurface className="absolute left-0 mt-2 w-72 z-20">
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <h3 className="text-[11px] uppercase tracking-widest text-slate-200">Canvas Size</h3>
                    <button
                        onClick={() => {
                            rotateCanvas();
                            updateSize();
                        }}
                        className="flex items-center gap-1.5 px-2 py-1 text-[10px] uppercase tracking-widest text-slate-300 bg-white/5 rounded-lg border border-transparent hover:border-[color:var(--brand-primary)] hover:text-slate-100 transition-all duration-200"
                        title="Rotate canvas (swap width/height)"
                    >
                        <RotateCw className="w-3.5 h-3.5" />
                        Rotate
                    </button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                    {presets.map(p => (
                        <button
                            key={p.name}
                            onClick={() => applyPreset(p)}
                            className="w-full text-left px-3 py-2 bg-white/5 rounded-lg border border-transparent hover:border-[color:var(--brand-primary)] transition-all duration-300 ease-in-out"
                        >
                            <span className="text-xs uppercase tracking-widest text-slate-200">{p.name}</span>
                            <p className="text-[10px] uppercase tracking-widest text-slate-300">{p.description}</p>
                        </button>
                    ))}
                </div>
                <hr className="border-t border-white/10" />
                <div className="space-y-2">
                    <h4 className="text-[10px] uppercase tracking-widest text-slate-200">Background</h4>
                    <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                        <span className="text-[10px] uppercase tracking-widest text-slate-200">Fill Color</span>
                        <input
                            type="color"
                            value={canvasBackgroundColor || DEFAULT_CANVAS_BACKGROUND}
                            onChange={(e) => setCanvasBackgroundColor(e.target.value)}
                            className="h-6 w-10 cursor-pointer rounded border border-white/10 bg-transparent"
                            aria-label="Canvas background color"
                        />
                    </div>
                </div>
                <button
                    onClick={() => {
                        toggleShowGuides();
                    }}
                    className="w-full flex items-center justify-between px-3 py-2 text-xs uppercase tracking-widest text-slate-200 rounded-lg hover:bg-white/10"
                >
                    <span>Show Bleed/Safety Guides</span>
                    <div className={`w-5 h-5 flex items-center justify-center rounded-sm border-2 ${showGuides ? 'bg-[color:var(--brand-primary)] border-[color:var(--brand-primary)]' : 'border-slate-500'}`}>
                        {showGuides && <Check className="w-4 h-4 text-white" />}
                    </div>
                </button>
            </div>
        </PopoverSurface>
    )}
    </div>
  );
};
