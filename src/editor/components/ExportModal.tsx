import React, { useState } from 'react';
import { shallow } from 'zustand/shallow';
import { useEditorStore } from '../state/editorStore';
import { useThemeStore } from '../state/useThemeStore';
import { advancedExportManager, type AdvancedExportFormat } from '../export/advancedExportManager';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({ isOpen, onClose }) => {
  const isDev = import.meta.env.DEV;
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
  const handleExport = async (format: AdvancedExportFormat) => {
    if (!canvas) return;
    const background = canvasBackgroundColor || (canvas.backgroundColor ? String(canvas.backgroundColor) : null);
    await advancedExportManager.export(canvas, format, {
      includeBackground,
      backgroundColor: background,
      dpi: 300,
      fileName,
    });
    onClose();
  };

  if (!isOpen || !isDev) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div 
        className="w-full max-w-md rounded-xl border border-white/10 bg-[color:var(--ui-panel)] p-6 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.25)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-[color:var(--ui-text)]">Download</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-white/10 transition-colors"
            aria-label="Close"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-[color:var(--ui-panel-text)]" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        <div className="space-y-6">
          <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2">
            <span className="text-xs uppercase tracking-widest text-[color:var(--ui-panel-text)]">
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
              onClick={() => void handleExport('png')}
              disabled={!canvas}
              className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm uppercase tracking-widest text-[color:var(--ui-text)] hover:bg-white/10 transition-colors disabled:opacity-50"
            >
              Download PNG (2x)
            </button>
            <button
              type="button"
              onClick={() => void handleExport('svg')}
              disabled={!canvas}
              className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm uppercase tracking-widest text-[color:var(--ui-text)] hover:bg-white/10 transition-colors disabled:opacity-50"
            >
              Download SVG
            </button>
            <button
              type="button"
              onClick={() => void handleExport('pdf')}
              disabled={!canvas}
              className="w-full rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm uppercase tracking-widest text-[color:var(--ui-text)] hover:bg-white/10 transition-colors disabled:opacity-50"
            >
              Download PDF
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
