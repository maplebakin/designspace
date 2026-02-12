import React, { useState, useRef, useCallback, useEffect } from 'react';

interface TooltipProps {
  content: string;
  children: React.ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  delay?: number;
}

export const Tooltip: React.FC<TooltipProps> = ({
  content,
  children,
  side = 'bottom',
  delay = 400,
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const timeoutRef = useRef<number | null>(null);
  const triggerRef = useRef<HTMLDivElement>(null);

  const showTooltip = useCallback(() => {
    timeoutRef.current = window.setTimeout(() => {
      setIsVisible(true);
    }, delay);
  }, [delay]);

  const hideTooltip = useCallback(() => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setIsVisible(false);
  }, []);

  const positionClasses = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
    left: 'right-full top-1/2 -translate-y-1/2 mr-2',
    right: 'left-full top-1/2 -translate-y-1/2 ml-2',
  };

  const arrowClasses = {
    top: 'top-full left-1/2 -translate-x-1/2 border-l-transparent border-r-transparent border-b-transparent border-t-[color:var(--ui-panel)]',
    bottom: 'bottom-full left-1/2 -translate-x-1/2 border-l-transparent border-r-transparent border-t-transparent border-b-[color:var(--ui-panel)]',
    left: 'left-full top-1/2 -translate-y-1/2 border-t-transparent border-b-transparent border-r-transparent border-l-[color:var(--ui-panel)]',
    right: 'right-full top-1/2 -translate-y-1/2 border-t-transparent border-b-transparent border-l-transparent border-r-[color:var(--ui-panel)]',
  };

  return (
    <div
      ref={triggerRef}
      className="relative inline-flex"
      onMouseEnter={showTooltip}
      onMouseLeave={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
    >
      {children}
      {isVisible && (
        <div
          role="tooltip"
          className={`absolute z-[100] pointer-events-none ${positionClasses[side]}`}
        >
          <div className="relative px-2.5 py-1.5 rounded-lg bg-[color:var(--ui-panel)] border border-[color:var(--ui-border)] shadow-lg backdrop-blur-sm">
            <span className="text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)] whitespace-nowrap font-medium">
              {content}
            </span>
            <div
              className={`absolute w-0 h-0 border-4 ${arrowClasses[side]}`}
            />
          </div>
        </div>
      )}
    </div>
  );
};

// Icon button wrapper with built-in tooltip
interface IconButtonProps {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  isActive?: boolean;
  className?: string;
  children: React.ReactNode;
  tooltipSide?: 'top' | 'bottom' | 'left' | 'right';
}

export const IconButton: React.FC<IconButtonProps> = ({
  label,
  onClick,
  disabled,
  isActive,
  className = '',
  children,
  tooltipSide = 'bottom',
}) => {
  return (
    <Tooltip content={label} side={tooltipSide}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className={`
          inline-flex h-8 w-8 items-center justify-center rounded-lg
          transition-all duration-200 ease-out
          ${isActive
            ? 'bg-white/20 text-[color:var(--ui-panel-text)] shadow-[0_0_12px_rgba(255,255,255,0.15)]'
            : 'text-[color:var(--ui-panel-text)] hover:bg-white/10 hover:scale-105 active:scale-95'
          }
          disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100 disabled:hover:bg-transparent
          ${className}
        `}
      >
        {children}
      </button>
    </Tooltip>
  );
};

// Section header for properties panel
interface SectionHeaderProps {
  title: string;
  icon?: React.ReactNode;
  children?: React.ReactNode;
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({ title, icon, children }) => (
  <div className="flex items-center justify-between mb-3">
    <div className="flex items-center gap-2">
      {icon && <span className="text-[color:var(--muted-icon)]">{icon}</span>}
      <span className="text-[10px] uppercase tracking-widest font-medium text-slate-400">{title}</span>
    </div>
    {children}
  </div>
);

// Divider for visual separation
export const SectionDivider: React.FC = () => (
  <div className="h-px bg-white/10 my-4" />
);

// Control row with consistent height (32px)
interface ControlRowProps {
  label: string;
  children: React.ReactNode;
  vertical?: boolean;
}

export const ControlRow: React.FC<ControlRowProps> = ({ label, children, vertical = false }) => (
  <div className={`${vertical ? 'space-y-2' : 'flex items-center justify-between min-h-[32px]'}`}>
    <span className="text-[10px] uppercase tracking-widest text-slate-400">{label}</span>
    <div className={vertical ? 'mt-1' : ''}>{children}</div>
  </div>
);

// Consistent input styling
export const ControlInput: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = (props) => (
  <input
    {...props}
    className={`
      h-8 rounded-lg border border-white/10 bg-black/30 px-3
      text-xs text-slate-200 placeholder:text-slate-500
      focus:outline-none focus:ring-1 focus:ring-[color:var(--brand-primary)]
      transition-all duration-200
      ${props.className || ''}
    `}
  />
);

// Consistent select styling
export const ControlSelect: React.FC<React.SelectHTMLAttributes<HTMLSelectElement>> = (props) => (
  <select
    {...props}
    className={`
      h-8 rounded-lg border border-white/10 bg-black/30 px-3
      text-xs text-slate-200 appearance-none cursor-pointer
      focus:outline-none focus:ring-1 focus:ring-[color:var(--brand-primary)]
      transition-all duration-200
      ${props.className || ''}
    `}
  />
);

import { useRecentColors } from '../hooks/useRecentColors';

// Color picker with consistent styling
interface ColorPickerProps {
  value: string;
  onChange: (value: string) => void;
  'aria-label'?: string;
}

export const ColorPicker: React.FC<ColorPickerProps> = ({ value, onChange, 'aria-label': ariaLabel }) => {
  const { recentColors, addColor } = useRecentColors();

  const handleColorChange = (newColor: string) => {
    onChange(newColor);
    addColor(newColor);
  };

  const handleRecentColorClick = (color: string) => {
    onChange(color);
    addColor(color); // Ensure the clicked color becomes the most recent
  };

  return (
    <div className="relative">
      <input
        type="color"
        value={value}
        onChange={(e) => handleColorChange(e.target.value)}
        aria-label={ariaLabel}
        className="h-8 w-12 cursor-pointer rounded-lg border border-white/10 bg-transparent transition-all duration-200 hover:border-white/20"
      />

      {/* Recent Colors */}
      {recentColors.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {recentColors.map((color, index) => (
            <button
              key={index}
              type="button"
              onClick={() => handleRecentColorClick(color)}
              className="w-5 h-5 rounded border border-white/20 hover:scale-110 transition-transform"
              style={{ backgroundColor: color }}
              aria-label={`Use recent color ${color}`}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// System font stacks
const SYSTEM_FONTS = [
  { name: 'Standard Sans', value: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' },
  { name: 'Modern Serif', value: 'Charter, "Bitstream Charter", "Sitka Text", Cambria, serif' },
  { name: 'Monospace', value: '"SF Mono", "Roboto Mono", "Cascadia Code", "Source Code Pro", monospace' },
  { name: 'Handwriting', value: '"Comic Sans MS", "Marker Felt", cursive' },
];

// Font picker with previews
interface FontPickerProps {
  value: string;
  onChange: (value: string) => void;
  'aria-label'?: string;
}

export const FontPicker: React.FC<FontPickerProps> = ({ value, onChange, 'aria-label': ariaLabel }) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedFont = SYSTEM_FONTS.find(font => font.value === value) || SYSTEM_FONTS[0];

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-label={ariaLabel}
        className="w-full h-8 rounded-lg border border-white/10 bg-black/30 px-3 text-xs text-slate-200 flex items-center justify-between"
      >
        <span style={{ fontFamily: selectedFont.value }}>{selectedFont.name}</span>
        <span className={`ml-2 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}>▼</span>
      </button>

      {isOpen && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-white/10 bg-[color:var(--ui-panel)] shadow-lg max-h-60 overflow-y-auto">
          <div className="max-h-48 overflow-y-auto">
            {SYSTEM_FONTS.map((font, index) => (
              <button
                key={index}
                type="button"
                onClick={() => {
                  onChange(font.value);
                  setIsOpen(false);
                }}
                className={`w-full px-3 py-2 text-left text-xs hover:bg-white/10 ${
                  value === font.value ? 'bg-white/10' : ''
                }`}
                style={{ fontFamily: font.value }}
              >
                {font.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

import { AlignLeft, AlignCenter, AlignRight, AlignJustify } from 'lucide-react';

// Text alignment control
interface TextAlignControlProps {
  value: string;
  onChange: (value: string) => void;
}

export const TextAlignControl: React.FC<TextAlignControlProps> = ({ value, onChange }) => {
  const alignments = [
    { key: 'left', label: 'Left', icon: AlignLeft },
    { key: 'center', label: 'Center', icon: AlignCenter },
    { key: 'right', label: 'Right', icon: AlignRight },
    { key: 'justify', label: 'Justify', icon: AlignJustify },
  ];

  return (
    <div className="grid grid-cols-4 gap-1">
      {alignments.map((align) => {
        const IconComponent = align.icon;
        return (
          <button
            key={align.key}
            type="button"
            onClick={() => onChange(align.key)}
            className={`h-8 flex items-center justify-center rounded-lg border transition-all duration-200 ${
              value === align.key
                ? 'border-[color:var(--brand-primary)] bg-[color:var(--brand-primary)]/10 text-[color:var(--brand-primary)]'
                : 'border-white/10 bg-white/5 text-slate-400 hover:bg-white/10'
            }`}
            aria-label={align.label}
          >
            <IconComponent className="w-4 h-4" />
          </button>
        );
      })}
    </div>
  );
};

// Slider with consistent styling
interface SliderProps {
  min: number;
  max: number;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  disabled?: boolean;
}

export const ControlSlider: React.FC<SliderProps> = ({ min, max, value, onChange, step = 1, disabled = false }) => (
  <input
    type="range"
    min={min}
    max={max}
    step={step}
    value={value}
    onChange={(e) => onChange(Number(e.target.value))}
    disabled={disabled}
    className={`w-full h-1.5 accent-[color:var(--brand-primary)] rounded-full appearance-none bg-white/10 ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
  />
);
