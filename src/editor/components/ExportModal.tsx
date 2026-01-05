
import React, { useState } from 'react';
import { useEditorStore } from '../state/editorStore';
import { X } from 'lucide-react';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  format: 'jpeg' | 'png'; // To reuse for different formats if needed
}

export const ExportModal: React.FC<ExportModalProps> = ({ isOpen, onClose, format }) => {
  const [quality, setQuality] = useState(90);
  const { canvas } = useEditorStore();

  if (!isOpen) return null;

  const handleExport = () => {
    if (canvas) {
      const dataURL = canvas.toDataURL({
        format,
        quality: quality / 100,
        multiplier: 2,
      });
      const link = document.createElement('a');
      link.href = dataURL;
      link.download = `design.${format}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-[#140808] rounded-lg shadow-2xl w-full max-w-sm border border-[color:var(--border-subtle)] backdrop-blur-md text-slate-100">
        <header className="flex items-center justify-between p-4 border-b border-[color:var(--border-subtle)]">
          <h2 className="text-[11px] uppercase tracking-widest text-slate-200">Export as {format.toUpperCase()}</h2>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-white/10 transition-all duration-300 ease-in-out">
            <X className="w-5 h-5 stroke-[1.5] text-[color:var(--muted-icon)]" />
          </button>
        </header>
        <div className="p-6 space-y-4">
            {format === 'jpeg' && (
                <div className='space-y-2'>
                    <label className="text-[10px] uppercase tracking-widest text-slate-500">Quality ({quality}%)</label>
                    <input
                        type="range"
                        min="1"
                        max="100"
                        value={quality}
                        onChange={(e) => setQuality(parseInt(e.target.value))}
                        className="w-full accent-[color:var(--brand-primary)]"
                    />
                </div>
            )}
            <button
                onClick={handleExport}
                className="w-full px-4 py-2 bg-white/10 text-slate-100 rounded-lg hover:bg-white/20 transition-all duration-300 ease-in-out text-xs uppercase tracking-widest"
            >
                Download
            </button>
        </div>
      </div>
    </div>
  );
};
