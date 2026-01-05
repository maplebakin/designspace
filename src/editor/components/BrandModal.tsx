
import React, { useState } from 'react';
import { useEditorStore } from '../state/editorStore';
import { X, Plus, Trash2, CheckCircle } from 'lucide-react';

interface BrandModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const DEFAULT_COLORS = ['#000000', '#FFFFFF', '#FF5733', '#33FF57', '#3357FF'];

export const BrandModal: React.FC<BrandModalProps> = ({ isOpen, onClose }) => {
  const { palettes, activePaletteId, addPalette, deletePalette, setActivePaletteId } = useEditorStore();
  const [newPaletteName, setNewPaletteName] = useState('');
  const [newPaletteColors, setNewPaletteColors] = useState<string[]>(DEFAULT_COLORS);

  if (!isOpen) return null;

  const handleColorChange = (index: number, color: string) => {
    const updatedColors = [...newPaletteColors];
    updatedColors[index] = color;
    setNewPaletteColors(updatedColors);
  };

  const handleAddNewPalette = (e: React.FormEvent) => {
    e.preventDefault();
    if (newPaletteName.trim() === '') {
      alert('Please enter a palette name.');
      return;
    }
    addPalette({ name: newPaletteName, colors: newPaletteColors });
    setNewPaletteName('');
    setNewPaletteColors(DEFAULT_COLORS);
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-[#140808] rounded-lg shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col border border-[color:var(--border-subtle)] backdrop-blur-md text-slate-100">
        <header className="flex items-center justify-between p-4 border-b border-[color:var(--border-subtle)]">
          <h2 className="text-[11px] uppercase tracking-widest text-slate-200">Brand Vault</h2>
          <button onClick={onClose} className="p-2 rounded-full hover:bg-white/10 transition-all duration-300 ease-in-out">
            <X className="w-5 h-5 stroke-[1.5] text-[color:var(--muted-icon)]" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          {/* Existing Palettes */}
          <section>
            <h3 className="text-sm uppercase tracking-widest text-slate-300 mb-4">Your Palettes</h3>
            <div className="space-y-4">
              {palettes.map((palette) => (
                <div key={palette.id} className="border border-[color:var(--border-subtle)] rounded-lg p-4 flex items-center justify-between bg-white/5">
                  <div>
                    <p className="text-xs uppercase tracking-widest text-slate-200">{palette.name}</p>
                    <div className="flex gap-2 mt-2">
                      {palette.colors.map((color, idx) => (
                        <div key={idx} className="w-8 h-8 rounded-full border border-white/20" style={{ backgroundColor: color }} />
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {palette.id === activePaletteId ? (
                        <span className="flex items-center gap-2 text-xs uppercase tracking-widest text-emerald-300">
                            <CheckCircle className="w-5 h-5 stroke-[1.5]" />
                            Active
                        </span>
                    ) : (
                        <button onClick={() => setActivePaletteId(palette.id)} className="text-xs uppercase tracking-widest px-3 py-1 rounded-md bg-white/10 hover:bg-white/20 transition-all duration-300 ease-in-out">
                            Set Active
                        </button>
                    )}
                    <button onClick={() => deletePalette(palette.id)} className="p-2 text-slate-400 hover:text-red-300 hover:bg-red-500/10 transition-all duration-300 ease-in-out rounded-full" aria-label="Delete Palette">
                      <Trash2 className="w-4 h-4 stroke-[1.5]" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Add New Palette Form */}
          <section>
             <hr className="my-6 border-[color:var(--border-subtle)]"/>
            <h3 className="text-sm uppercase tracking-widest text-slate-300 mb-4">Create New Palette</h3>
            <form onSubmit={handleAddNewPalette} className="space-y-4">
              <input
                type="text"
                value={newPaletteName}
                onChange={(e) => setNewPaletteName(e.target.value)}
                placeholder="New Palette Name"
                className="w-full p-2 text-sm bg-white/10 border border-white/10 rounded-lg text-slate-100 placeholder-slate-500"
              />
              <div className="flex items-center gap-4">
                <p className="text-[10px] uppercase tracking-widest text-slate-500">Colors:</p>
                {newPaletteColors.map((color, idx) => (
                  <input
                    key={idx}
                    type="color"
                    value={color}
                    onChange={(e) => handleColorChange(idx, e.target.value)}
                    className="w-10 h-10 rounded-full border border-white/20 cursor-pointer"
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
              <button type="submit" className="group w-full flex items-center justify-center gap-2 px-4 py-2 bg-white/10 text-slate-100 rounded-lg hover:bg-white/20 transition-all duration-300 ease-in-out text-xs uppercase tracking-widest">
                <Plus className="w-5 h-5 stroke-[1.5] text-[color:var(--muted-icon)] group-hover:text-[color:var(--brand-primary)] transition-all duration-300 ease-in-out"/>
                Add New Palette
              </button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
};
