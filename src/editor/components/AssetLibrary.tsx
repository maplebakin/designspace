
import React from 'react';
import { Search } from 'lucide-react';

const placeholderImages = [
  'https://images.unsplash.com/photo-1620712943543-285f7266c888?w=100&q=80',
  'https://images.unsplash.com/photo-1599305445671-ac291c95aaa9?w=100&q=80',
  'https://images.unsplash.com/photo-1582818728532-1b3c4d3675cc?w=100&q=80',
  'https://images.unsplash.com/photo-1618335829737-25c4144342a2?w=100&q=80',
  'https://images.unsplash.com/photo-1579546929518-9e396f3a8034?w=100&q=80',
  'https://images.unsplash.com/photo-1558591710-4b4a1ae0f04d?w=100&q=80',
  'https://images.unsplash.com/photo-1528459801416-a9e53bbf4e17?w=100&q=80',
  'https://images.unsplash.com/photo-1550684376-efcbd6e3f031?w=100&q=80',
];

export const AssetLibrary: React.FC = () => {
  const handleDragStart = (e: React.DragEvent<HTMLImageElement>, imageUrl: string) => {
    e.dataTransfer.setData('text/plain', imageUrl);
  };

  return (
    <div className="p-4">
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 stroke-[1.5] text-slate-400" />
        <input
          type="text"
          placeholder="Search assets..."
          className="w-full pl-10 pr-4 py-2 text-sm bg-white/10 border border-white/10 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-[color:var(--brand-primary)]"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        {placeholderImages.map((url, index) => (
          <img
            key={index}
            src={url}
            alt={`Asset ${index + 1}`}
            draggable="true"
            onDragStart={(e) => handleDragStart(e, url)}
            className="w-full h-full object-cover rounded-lg cursor-grab active:cursor-grabbing border border-white/10 hover:border-[color:var(--brand-primary)] transition-all duration-300 ease-in-out"
            crossOrigin="anonymous"
          />
        ))}
      </div>
    </div>
  );
};
