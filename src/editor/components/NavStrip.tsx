import React from 'react';
import { Square, Type, Image as ImageIcon } from 'lucide-react';

const NAV_ICON = 'w-5 h-5 stroke-[1.5]';

export type NavId = 'shapes' | 'insert' | 'assets';

export const NAV_ITEMS: Array<{ id: NavId; label: string; icon: React.ReactElement; description: string }> = [
  { id: 'shapes', label: 'Shapes', icon: <Square />, description: 'Quick geometric primitives' },
  { id: 'insert', label: 'Insert', icon: <Type />, description: 'Text, placeholders, and media tools' },
  { id: 'assets', label: 'Assets', icon: <ImageIcon />, description: 'Library and imports' },
];

interface NavStripProps {
  activeNav: NavId | null;
  onSelect: (id: NavId) => void;
}

export const NavStrip: React.FC<NavStripProps> = ({ activeNav, onSelect }) => (
  <div className="flex flex-col py-2">
    {NAV_ITEMS.map((item) => {
      const isActive = activeNav === item.id;
      return (
        <button
          key={item.id}
          onClick={() => onSelect(item.id)}
          data-testid={`nav-${item.id}`}
          className={`w-full border-l-2 px-2 py-3.5 text-center transition-all duration-200 ${
            isActive
              ? 'border-l-[color:var(--brand-primary)] bg-[color:var(--brand-primary)]/14 text-[color:var(--brand-primary)]'
              : 'border-l-transparent text-[color:var(--ui-panel-text)] hover:bg-[color:var(--ui-hover-soft)] hover:text-[color:var(--ui-text)]'
          }`}
        >
          <div className="flex flex-col items-center gap-1.5 text-center">
            {React.cloneElement(item.icon as React.ReactElement<any>, { className: `${NAV_ICON} shrink-0` })}
            <span className="text-[9px] uppercase tracking-widest leading-tight">{item.label}</span>
          </div>
        </button>
      );
    })}
  </div>
);
