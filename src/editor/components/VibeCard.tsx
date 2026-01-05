
import React from 'react';
import { BrandCollection } from '../state/editorStore';

interface VibeCardProps {
  collection: BrandCollection;
  isActive: boolean;
  onClick: () => void;
}

export const VibeCard: React.FC<VibeCardProps> = ({ collection, isActive, onClick }) => {
  // Extract the three main brand colors for the preview
  const primary = collection.themeData.brand?.primary?.value || '#333';
  const accent = collection.themeData.brand?.accent?.value || '#999';
  const background = collection.themeData.surfaces?.background?.value || '#f8fafc';

  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3 rounded-lg transition-all duration-300 ease-in-out ${isActive ? 'bg-white/15 ring-2 ring-[color:var(--brand-primary)]' : 'bg-white/5 hover:bg-white/10'}`}
    >
      <p className="text-xs uppercase tracking-widest text-slate-300 truncate">{collection.name}</p>
      <div className="flex h-10 mt-2 rounded-md overflow-hidden border border-white/10">
        <div className="w-1/2 h-full" style={{ backgroundColor: primary }}></div>
        <div className="w-1/4 h-full" style={{ backgroundColor: accent }}></div>
        <div className="w-1/4 h-full" style={{ backgroundColor: background }}></div>
      </div>
    </button>
  );
};
