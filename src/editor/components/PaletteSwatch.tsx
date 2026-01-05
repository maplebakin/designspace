
import React from 'react';
import { BrandCollection } from '../state/editorStore';

interface PaletteSwatchProps {
  collection: BrandCollection;
  isActive: boolean;
  onClick: () => void;
}

export const PaletteSwatch: React.FC<PaletteSwatchProps> = ({ collection, isActive, onClick }) => {
  // Extract the three main brand colors for the preview
  const primary = collection.swatches['Brand']?.['Primary'] || '#333';
  const secondary = collection.swatches['Brand']?.['Secondary'] || '#666';
  const accent = collection.swatches['Brand']?.['Accent'] || '#999';

  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3 rounded-lg transition-all duration-300 ease-in-out ${isActive ? 'bg-white/15 ring-2 ring-[color:var(--brand-primary)]' : 'bg-white/5 hover:bg-white/10'}`}
    >
      <p className="text-xs uppercase tracking-widest text-slate-300 truncate">{collection.name}</p>
      <div className="flex h-8 mt-2 rounded-md overflow-hidden">
        <div className="w-1/2 h-full" style={{ backgroundColor: primary }}></div>
        <div className="w-1/4 h-full" style={{ backgroundColor: secondary }}></div>
        <div className="w-1/4 h-full" style={{ backgroundColor: accent }}></div>
      </div>
    </button>
  );
};
