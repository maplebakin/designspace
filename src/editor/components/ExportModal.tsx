import React, { useState } from 'react';
import { shallow } from 'zustand/shallow';
import { useEditorStore } from '../state/editorStore';
import { useThemeStore } from '../state/useThemeStore';
import { serializeToSVG } from '../utils/serializeToSVG';
import { renderCanvasToPngBlob } from '../utils/renderToPng';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({ isOpen, onClose }) => {
  const { canvas } = useEditorStore(
    (state) => ({
      canvas: state.canvas,
    }),
    shallow
  );
  const { canvasBackgroundColor } = useThemeStore(
    (state) => ({ canvasBackgroundColor: state.canvasBackgroundColor }),
    shallow
  );

  const [includeBackground, setIncludeBackground] = useState(true);
  const fileName = 'design-space-export';

  const triggerDownload = (blob: Blob, extension: string) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${fileName}.${extension}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleDownloadPng = async () => {
    if (!canvas) return;
    const background = canvasBackgroundColor || (canvas.backgroundColor ? String(canvas.backgroundColor) : null);
    const blob = await renderCanvasToPngBlob(canvas, {
      scale: 2,
      includeBackground,
      backgroundColor: background,
    });
    triggerDownload(blob, 'png');
    onClose();
  };

  const handleDownloadSvg = () => {
    if (!canvas) return;
    const background = canvasBackgroundColor || (canvas.backgroundColor ? String(canvas.backgroundColor) : null);
    const svg = serializeToSVG(canvas.getObjects(), {
      width: canvas.getWidth(),
      height: canvas.getHeight(),
      includeBackground,
      backgroundColor: background,
    });
    const blob = new Blob([svg], { type: 'image/svg+xml' });
    triggerDownload(blob, 'svg');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div 
        className="w-full max-w-md rounded-xl border border-white/10 bg-[color:var(--ui-panel)] p-6 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-slate-200">Download</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-white/10 transition-colors"
            aria-label="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-slate-400" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        <div className="space-y-6">
          <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2">
            <span className="text-xs uppercase tracking-widest text-slate-300">
              Include Background Color
            </span>
            <button
              type="button"
              onClick={() => setIncludeBackground((prev) => !prev)}
              className={`h-6 w-11 rounded-full border transition-colors ${
                includeBackground
                  ? 'border-[color:var(--brand-primary)] bg-[color:var(--brand-primary)]/50'
                  : 'border-white/10 bg-black/30'
              }`}
              aria-pressed={includeBackground}
            >
              <span
                className={`block h-5 w-5 rounded-full bg-white transition-transform ${
                  includeBackground ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <div className="grid gap-3">
            <button
              type="button"
              onClick={handleDownloadPng}
              disabled={!canvas}
              className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm uppercase tracking-widest text-slate-200 hover:bg-white/10 transition-colors disabled:opacity-50"
            >
              Download PNG (2x)
            </button>
            <button
              type="button"
              onClick={handleDownloadSvg}
              disabled={!canvas}
              className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm uppercase tracking-widest text-slate-200 hover:bg-white/10 transition-colors disabled:opacity-50"
            >
              Download SVG
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
