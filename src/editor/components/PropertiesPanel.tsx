import React, { useState } from 'react';
import { shallow } from 'zustand/shallow';
import * as fabric from 'fabric';
import {
  Palette,
  Type,
  Image as ImageIcon,
  Layout,
  Sparkles,
  RotateCcw,
  Plus,
  Grid3X3,
  Move,
  Maximize2,
  AlignHorizontalJustifyStart,
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignVerticalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  MoveHorizontal,
  MoveVertical,
  Scaling,
} from 'lucide-react';
import { useEditorStore, DEFAULT_CANVAS_BACKGROUND } from '../state/editorStore';
import { useCanvasStore } from '../state/useCanvasStore';
import { useVisionPalette, useThemeStore } from '../state/useThemeStore';
import { ThemeSidebar } from './ThemeSidebar';
import {
  SectionHeader,
  SectionDivider,
  ControlRow,
  ControlSlider,
  ColorPicker,
  ControlInput,
  ControlSelect,
  IconButton,
  FontPicker,
  TextAlignControl,
} from './Tooltip';

// Vision Palette Section - quick color picks from vision board
interface VisionPaletteProps {
  onColorSelect: (color: string) => void;
  disabled?: boolean;
}

const VisionPaletteSection: React.FC<VisionPaletteProps> = ({ onColorSelect, disabled }) => {
  const visionPalette = useVisionPalette();
  const clearVisionPalette = useThemeStore((state) => state.clearVisionPalette);

  if (visionPalette.length === 0) return null;

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <SectionHeader title="Vision Palette" icon={<Palette className="w-4 h-4" />} />
        <button
          onClick={clearVisionPalette}
          className="text-[9px] uppercase tracking-widest text-[color:var(--ui-panel-text)]/60 hover:text-[color:var(--ui-panel-text)] transition-colors"
          title="Clear palette"
        >
          Clear
        </button>
      </div>
      <p className="text-[10px] text-[color:var(--ui-panel-text)]/60">Colors from your vision board</p>
      <div className="flex flex-wrap gap-2">
        {visionPalette.map((color, idx) => (
          <button
            key={`${color}-${idx}`}
            onClick={() => !disabled && onColorSelect(color)}
            disabled={disabled}
            className={`
              w-7 h-7 rounded-lg border-2 border-white/20 shadow-sm
              transition-all duration-200
              ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:scale-110 hover:border-white/40 cursor-pointer'}
            `}
            style={{ backgroundColor: color }}
            title={`Apply ${color.toUpperCase()}`}
          />
        ))}
      </div>
    </div>
  );
};

// Canvas Empty State - shown when nothing selected
const CanvasEmptyState: React.FC = () => {
  const {
    setCanvasBackgroundColor,
    gridEnabled,
    setGridEnabled,
    snapEnabled,
    setSnapEnabled,
  } = useEditorStore(
    (state) => ({
      setCanvasBackgroundColor: state.setCanvasBackgroundColor,
      gridEnabled: state.gridEnabled,
      setGridEnabled: state.setGridEnabled,
      snapEnabled: state.snapEnabled,
      setSnapEnabled: state.setSnapEnabled,
    }),
    shallow
  );
  const { canvasBackgroundColor } = useThemeStore(
    (state) => ({ canvasBackgroundColor: state.canvasBackgroundColor }),
    shallow
  );
  const safeCanvasBackgroundColor =
    canvasBackgroundColor && canvasBackgroundColor.toLowerCase() !== 'transparent'
      ? canvasBackgroundColor
      : null;

  // Get document dimensions from the canvas store
  const { width: canvasWidth, height: canvasHeight } = useCanvasStore(
    (state) => ({ width: state.width, height: state.height }),
    shallow
  );

  return (
    <div className="space-y-4">
      {/* Canvas Info Card */}
      <div className="rounded-xl border border-white/10 bg-gradient-to-br from-white/5 to-transparent p-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-[color:var(--brand-primary)]/20 flex items-center justify-center">
            <Layout className="w-5 h-5 text-[color:var(--brand-primary)]" />
          </div>
          <div>
            <h4 className="text-xs font-medium text-[color:var(--ui-text)]">Canvas Settings</h4>
            <p className="text-[10px] text-[color:var(--ui-panel-text)] uppercase tracking-widest">
              {canvasWidth} × {canvasHeight} px
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <ControlRow label="Background">
            <ColorPicker
              value={safeCanvasBackgroundColor || DEFAULT_CANVAS_BACKGROUND}
              onChange={setCanvasBackgroundColor}
              aria-label="Canvas background color"
            />
          </ControlRow>

          <SectionDivider />

          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setGridEnabled(!gridEnabled)}
              className={`flex items-center justify-center gap-2 h-8 rounded-lg border text-[10px] uppercase tracking-widest transition-all duration-200 ${
                gridEnabled
                  ? 'border-[color:var(--brand-primary)] bg-[color:var(--brand-primary)]/10 text-[color:var(--brand-primary)]'
                  : 'border-white/10 bg-white/5 text-[color:var(--ui-panel-text)] hover:bg-white/10'
              }`}
            >
              <Grid3X3 className="w-3.5 h-3.5" />
              Grid
            </button>
            <button
              onClick={() => setSnapEnabled(!snapEnabled)}
              className={`flex items-center justify-center gap-2 h-8 rounded-lg border text-[10px] uppercase tracking-widest transition-all duration-200 ${
                snapEnabled
                  ? 'border-[color:var(--brand-primary)] bg-[color:var(--brand-primary)]/10 text-[color:var(--brand-primary)]'
                  : 'border-white/10 bg-white/5 text-[color:var(--ui-panel-text)] hover:bg-white/10'
              }`}
            >
              <Move className="w-3.5 h-3.5" />
              Snap
            </button>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="rounded-xl border border-dashed border-white/10 p-4 text-center">
        <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-3">
          <Maximize2 className="w-5 h-5 text-[color:var(--ui-panel-text)]/60" />
        </div>
        <p className="text-[11px] text-[color:var(--ui-panel-text)] mb-1">No object selected</p>
        <p className="text-[10px] text-[color:var(--ui-panel-text)]/60">
          Click an object on the canvas to edit its properties
        </p>
      </div>
    </div>
  );
};

// Shape Properties Section
interface ShapePropertiesProps {
  object: fabric.Object;
  onUpdate: (updates: Record<string, any>) => void;
  onCornerRadius: (value: number) => void;
  onCornerRadiusXY: (rxValue: number, ryValue: number) => void;
  addColorToBrandKit: (color: string) => Promise<{ success: boolean; error?: string }>;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const hexToRgb = (hex: string) => {
  const normalized = hex.replace('#', '').trim();
  if (normalized.length === 3) {
    const r = parseInt(normalized[0] + normalized[0], 16);
    const g = parseInt(normalized[1] + normalized[1], 16);
    const b = parseInt(normalized[2] + normalized[2], 16);
    return { r, g, b };
  }
  if (normalized.length === 6) {
    const r = parseInt(normalized.slice(0, 2), 16);
    const g = parseInt(normalized.slice(2, 4), 16);
    const b = parseInt(normalized.slice(4, 6), 16);
    return { r, g, b };
  }
  return null;
};

const parseFillColor = (fill: unknown, fallback = '#f1f0ee') => {
  if (typeof fill !== 'string') {
    return { hex: fallback, alpha: 1 };
  }
  const trimmed = fill.trim();
  if (trimmed.toLowerCase() === 'transparent') {
    return { hex: fallback, alpha: 0 };
  }
  if (trimmed.startsWith('#')) {
    if (trimmed.length === 4) {
      const hex = `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
      return { hex, alpha: 1 };
    }
    if (trimmed.length === 7) {
      return { hex: trimmed, alpha: 1 };
    }
    if (trimmed.length === 9) {
      const alpha = parseInt(trimmed.slice(7, 9), 16) / 255;
      return { hex: trimmed.slice(0, 7), alpha: clamp(alpha, 0, 1) };
    }
  }
  const match = trimmed.match(/rgba?\(([^)]+)\)/i);
  if (match) {
    const parts = match[1].split(',').map((part) => parseFloat(part.trim()));
    if (parts.length >= 3) {
      const r = clamp(parts[0], 0, 255);
      const g = clamp(parts[1], 0, 255);
      const b = clamp(parts[2], 0, 255);
      const alpha = parts.length >= 4 ? clamp(parts[3], 0, 1) : 1;
      const hex = `#${Math.round(r).toString(16).padStart(2, '0')}${Math.round(g).toString(16).padStart(2, '0')}${Math.round(b).toString(16).padStart(2, '0')}`;
      return { hex, alpha };
    }
  }
  return { hex: fallback, alpha: 1 };
};

const getFillKindLabel = (fill: unknown) => {
  if (typeof fill === 'string') return null;
  if (!fill) return 'None';
  const anyFill = fill as any;
  if (anyFill?.source || anyFill?.repeat) return 'Pattern';
  if (anyFill?.colorStops || anyFill?.coords || anyFill?.type === 'linear' || anyFill?.type === 'radial') {
    return 'Gradient';
  }
  return 'Fill';
};

const applyFillAlpha = (hex: string, alpha: number) => {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const normalizedAlpha = clamp(alpha, 0, 1);
  if (normalizedAlpha >= 1) return hex;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${normalizedAlpha})`;
};

const getStrokeStyleFromDash = (dash?: number[] | null): 'solid' | 'dashed' | 'dotted' => {
  if (!dash || dash.length === 0) return 'solid';
  if (dash.length >= 2 && dash[0] <= 3 && dash[1] >= 3) return 'dotted';
  return 'dashed';
};

const getDashFromStrokeStyle = (style: 'solid' | 'dashed' | 'dotted'): number[] | null => {
  if (style === 'dashed') return [12, 8];
  if (style === 'dotted') return [2, 6];
  return null;
};

const getGradientStops = (fill: unknown) => {
  const fallback = { from: '#111827', to: '#6366f1', angle: 0 };
  if (!fill || typeof fill !== 'object') return fallback;
  const anyFill = fill as any;
  if (!Array.isArray(anyFill.colorStops)) return fallback;
  const first = anyFill.colorStops.find((s: any) => typeof s?.color === 'string');
  const last = [...anyFill.colorStops].reverse().find((s: any) => typeof s?.color === 'string');
  return {
    from: first?.color || fallback.from,
    to: last?.color || fallback.to,
    angle: 0,
  };
};

const ShapeProperties: React.FC<ShapePropertiesProps> = ({
  object,
  onUpdate,
  onCornerRadius,
  onCornerRadiusXY,
  addColorToBrandKit,
}) => {
  const isRect = object.type === 'rect';
  const rawFill = (object as any)?.fill;
  const fillIsString = typeof rawFill === 'string';
  const fillKindLabel = getFillKindLabel(rawFill);
  const { hex: fillValue, alpha: fillOpacity } = parseFillColor(rawFill, '#f1f0ee');
  const strokeValue =
    typeof (object as any)?.stroke === 'string'
      ? ((object as any).stroke as string)
      : '#686664'; // Default stroke color from palette
  const strokeWidthValue = (object as any)?.strokeWidth ?? 2;
  const strokeStyle = getStrokeStyleFromDash((object as any)?.strokeDashArray as number[] | undefined);
  const currentShadow = object.shadow as fabric.Shadow | null;
  const gradientDefaults = getGradientStops(rawFill);
  const isGradientFill = !!rawFill && typeof rawFill === 'object' && Array.isArray((rawFill as any)?.colorStops);
  const rectScaleX = Math.abs((object as fabric.Rect).scaleX ?? 1) || 1;
  const rectScaleY = Math.abs((object as fabric.Rect).scaleY ?? 1) || 1;
  const rectCornerRadiusPx = isRect
    ? Math.round(Math.max(((object as fabric.Rect).rx ?? 0) * rectScaleX, ((object as fabric.Rect).ry ?? 0) * rectScaleY))
    : 0;
  const rectCornerRadiusXPx = isRect
    ? Math.round(((object as fabric.Rect).rx ?? 0) * rectScaleX)
    : 0;
  const rectCornerRadiusYPx = isRect
    ? Math.round(((object as fabric.Rect).ry ?? 0) * rectScaleY)
    : 0;
  const [isCornerRadiusLinked, setIsCornerRadiusLinked] = useState(
    !isRect || Math.abs(rectCornerRadiusXPx - rectCornerRadiusYPx) <= 1
  );

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-4">
      <SectionHeader title="Shape" icon={<Palette className="w-4 h-4" />} />

      <ControlRow label="Fill Color">
        <div className="flex items-start gap-2">
          <ColorPicker
            value={fillValue}
            onChange={(val) => onUpdate({ fill: applyFillAlpha(val, fillOpacity), tokenRole: null })}
            aria-label="Fill color"
          />
          {fillKindLabel && (
            <span className="h-6 px-2 inline-flex items-center rounded-full border border-white/15 bg-white/5 text-[9px] uppercase tracking-widest text-[color:var(--ui-panel-text)]">
              {fillKindLabel}
            </span>
          )}
        </div>
      </ControlRow>

      <div className="space-y-2">
        <ControlRow label="Fill Opacity">
          <span className="text-[10px] text-[color:var(--ui-panel-text)]">
            {fillIsString ? `${Math.round(fillOpacity * 100)}%` : '—'}
          </span>
        </ControlRow>
        <ControlSlider
          min={0}
          max={1}
          step={0.01}
          value={fillOpacity}
          disabled={!fillIsString}
          onChange={(val) => {
            if (!fillIsString) return;
            onUpdate({ fill: applyFillAlpha(fillValue, val), tokenRole: null });
          }}
        />
      </div>

      <ControlRow label="Stroke Color">
        <ColorPicker
          value={strokeValue}
          onChange={(val) => onUpdate({ stroke: val })}
          aria-label="Stroke color"
        />
      </ControlRow>

      <div className="space-y-2">
        <ControlRow label="Stroke Width">
          <span className="text-[10px] text-[color:var(--ui-panel-text)]">
            {Math.round(strokeWidthValue)}px
          </span>
        </ControlRow>
        <ControlSlider
          min={0}
          max={20}
          value={strokeWidthValue}
          onChange={(val) => onUpdate({ strokeWidth: val })}
        />
      </div>

      <ControlRow label="Border Style">
        <ControlSelect
          value={strokeStyle}
          onChange={(e) => {
            const style = e.target.value as 'solid' | 'dashed' | 'dotted';
            const dash = getDashFromStrokeStyle(style);
            onUpdate({ strokeDashArray: dash || undefined });
          }}
          className="w-36"
        >
          <option value="solid">Solid</option>
          <option value="dashed">Dashed</option>
          <option value="dotted">Dotted</option>
        </ControlSelect>
      </ControlRow>

      <div className="space-y-2">
        <ControlRow label="Fill Mode">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onUpdate({ fill: applyFillAlpha(fillValue, fillOpacity), tokenRole: null })}
              className={`h-7 px-2 rounded-lg border text-[9px] uppercase tracking-widest ${!isGradientFill ? 'border-[color:var(--brand-primary)] bg-[color:var(--brand-primary)]/10 text-[color:var(--brand-primary)]' : 'border-white/10 bg-white/5 text-[color:var(--ui-panel-text)] hover:bg-white/10'}`}
            >
              Solid
            </button>
            <button
              type="button"
              onClick={() => {
                const grad = new fabric.Gradient({
                  type: 'linear',
                  gradientUnits: 'pixels',
                  coords: { x1: 0, y1: 0, x2: Number((object as any).width || 100), y2: 0 },
                  colorStops: [
                    { offset: 0, color: gradientDefaults.from },
                    { offset: 1, color: gradientDefaults.to },
                  ],
                });
                onUpdate({ fill: grad, tokenRole: null });
              }}
              className={`h-7 px-2 rounded-lg border text-[9px] uppercase tracking-widest ${isGradientFill ? 'border-[color:var(--brand-primary)] bg-[color:var(--brand-primary)]/10 text-[color:var(--brand-primary)]' : 'border-white/10 bg-white/5 text-[color:var(--ui-panel-text)] hover:bg-white/10'}`}
            >
              Gradient
            </button>
          </div>
        </ControlRow>
        {isGradientFill && (
          <div className="grid grid-cols-2 gap-3">
            <ControlRow label="From" vertical>
              <ColorPicker
                value={gradientDefaults.from}
                onChange={(val) => {
                  const grad = new fabric.Gradient({
                    type: 'linear',
                    gradientUnits: 'pixels',
                    coords: { x1: 0, y1: 0, x2: Number((object as any).width || 100), y2: 0 },
                    colorStops: [
                      { offset: 0, color: val },
                      { offset: 1, color: gradientDefaults.to },
                    ],
                  });
                  onUpdate({ fill: grad, tokenRole: null });
                }}
                aria-label="Gradient from color"
              />
            </ControlRow>
            <ControlRow label="To" vertical>
              <ColorPicker
                value={gradientDefaults.to}
                onChange={(val) => {
                  const grad = new fabric.Gradient({
                    type: 'linear',
                    gradientUnits: 'pixels',
                    coords: { x1: 0, y1: 0, x2: Number((object as any).width || 100), y2: 0 },
                    colorStops: [
                      { offset: 0, color: gradientDefaults.from },
                      { offset: 1, color: val },
                    ],
                  });
                  onUpdate({ fill: grad, tokenRole: null });
                }}
                aria-label="Gradient to color"
              />
            </ControlRow>
          </div>
        )}
      </div>

      <details className="group">
        <summary className="flex items-center justify-between cursor-pointer text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)] hover:text-[color:var(--ui-panel-text)] transition-colors">
          Drop Shadow
          <span className="text-[9px] text-[color:var(--ui-panel-text)]/60 group-open:hidden">+ Expand</span>
        </summary>
        <div className="mt-3 space-y-3 pl-2 border-l border-white/10">
          <ControlRow label="Color">
            <ColorPicker
              value={typeof currentShadow?.color === 'string' ? currentShadow.color : '#000000'}
              onChange={(val) => onUpdate({ shadow: new fabric.Shadow({ color: val, blur: currentShadow?.blur || 0, offsetX: currentShadow?.offsetX || 0, offsetY: currentShadow?.offsetY || 0 }) })}
              aria-label="Shape shadow color"
            />
          </ControlRow>
          <div className="space-y-2">
            <ControlRow label="Blur"><span className="text-[10px] text-[color:var(--ui-panel-text)]">{Math.round(currentShadow?.blur || 0)}px</span></ControlRow>
            <ControlSlider min={0} max={40} value={currentShadow?.blur || 0} onChange={(val) => onUpdate({ shadow: new fabric.Shadow({ color: (currentShadow?.color as string) || '#000000', blur: val, offsetX: currentShadow?.offsetX || 0, offsetY: currentShadow?.offsetY || 0 }) })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <ControlRow label="Offset X"><span className="text-[10px] text-[color:var(--ui-panel-text)]">{Math.round(currentShadow?.offsetX || 0)}</span></ControlRow>
              <ControlSlider min={-30} max={30} value={currentShadow?.offsetX || 0} onChange={(val) => onUpdate({ shadow: new fabric.Shadow({ color: (currentShadow?.color as string) || '#000000', blur: currentShadow?.blur || 0, offsetX: val, offsetY: currentShadow?.offsetY || 0 }) })} />
            </div>
            <div className="space-y-2">
              <ControlRow label="Offset Y"><span className="text-[10px] text-[color:var(--ui-panel-text)]">{Math.round(currentShadow?.offsetY || 0)}</span></ControlRow>
              <ControlSlider min={-30} max={30} value={currentShadow?.offsetY || 0} onChange={(val) => onUpdate({ shadow: new fabric.Shadow({ color: (currentShadow?.color as string) || '#000000', blur: currentShadow?.blur || 0, offsetX: currentShadow?.offsetX || 0, offsetY: val }) })} />
            </div>
          </div>
        </div>
      </details>

      {/* Opacity Slider */}
      <div className="space-y-2">
        <ControlRow label="Opacity">
          <span className="text-[10px] text-[color:var(--ui-panel-text)]">
            {Math.round(((object as any).opacity ?? 1) * 100)}%
          </span>
        </ControlRow>
        <ControlSlider
          min={0}
          max={1}
          step={0.01}
          value={(object as any).opacity ?? 1}
          onChange={(val) => onUpdate({ opacity: val })}
        />
      </div>

      {isRect && (
        <div className="space-y-2">
          <ControlRow label="Corner Radius">
            <span className="text-[10px] text-[color:var(--ui-panel-text)]">
              {isCornerRadiusLinked ? `${rectCornerRadiusPx}px` : `${rectCornerRadiusXPx}px × ${rectCornerRadiusYPx}px`}
            </span>
          </ControlRow>
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={() => setIsCornerRadiusLinked((prev) => !prev)}
              className="h-6 px-2 inline-flex items-center rounded-full border border-white/15 bg-white/5 text-[9px] uppercase tracking-widest text-[color:var(--ui-panel-text)] hover:bg-white/10"
            >
              {isCornerRadiusLinked ? 'Linked' : 'Independent'}
            </button>
          </div>
          {isCornerRadiusLinked ? (
            <ControlSlider
              min={0}
              max={80}
              value={rectCornerRadiusPx}
              onChange={onCornerRadius}
            />
          ) : (
            <div className="space-y-3">
              <div className="space-y-1">
                <ControlRow label="Radius X">
                  <span className="text-[10px] text-[color:var(--ui-panel-text)]">{rectCornerRadiusXPx}px</span>
                </ControlRow>
                <ControlSlider
                  min={0}
                  max={80}
                  value={rectCornerRadiusXPx}
                  onChange={(val) => onCornerRadiusXY(val, rectCornerRadiusYPx)}
                />
              </div>
              <div className="space-y-1">
                <ControlRow label="Radius Y">
                  <span className="text-[10px] text-[color:var(--ui-panel-text)]">{rectCornerRadiusYPx}px</span>
                </ControlRow>
                <ControlSlider
                  min={0}
                  max={80}
                  value={rectCornerRadiusYPx}
                  onChange={(val) => onCornerRadiusXY(rectCornerRadiusXPx, val)}
                />
              </div>
            </div>
          )}
        </div>
      )}

      <button
        onClick={() => {
          if (object.fill && typeof object.fill === 'string') {
            void addColorToBrandKit(object.fill);
          }
        }}
        className="w-full h-8 flex items-center justify-center gap-2 bg-white/10 text-[color:var(--ui-panel-text)] rounded-lg hover:bg-white/20 transition-all duration-200 text-[10px] uppercase tracking-widest"
      >
        <Plus className="w-3.5 h-3.5" />
        Add to Brand Kit
      </button>
    </div>
  );
};

// Text Properties Section
interface TextPropertiesProps {
  object: fabric.Text;
  onUpdate: (updates: Record<string, any>) => void;
  setTextShadow: (opts: any) => void;
  setTextStroke: (opts: any) => void;
  setTextCharSpacing: (val: number) => void;
  setTextLineHeight: (val: number) => void;
}

const TextProperties: React.FC<TextPropertiesProps> = ({
  object,
  onUpdate,
  setTextShadow,
  setTextStroke,
  setTextCharSpacing,
  setTextLineHeight,
}) => {
  const currentShadow = object.shadow as fabric.Shadow | null;
  const currentStroke = typeof object.stroke === 'string' ? object.stroke : '#000000';
  const currentStrokeWidth = object.strokeWidth || 0;
  const currentCharSpacing = object.charSpacing || 0;
  const currentLineHeight = (object as fabric.Textbox).lineHeight || 1;

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-4">
      <SectionHeader title="Typography" icon={<Type className="w-4 h-4" />} />

      {/* Font Settings */}
      <div className="space-y-3">
        <ControlRow label="Font Family" vertical>
          <FontPicker
            value={(object as any).fontFamily || 'Inter, sans-serif'}
            onChange={(val) => onUpdate({ fontFamily: val })}
          />
        </ControlRow>

        <div className="grid grid-cols-2 gap-3">
          <ControlRow label="Size" vertical>
            <ControlInput
              type="number"
              min={6}
              max={300}
              value={(object as any).fontSize || 16}
              onChange={(e) => onUpdate({ fontSize: Number(e.target.value) })}
              className="w-full"
            />
          </ControlRow>
          <ControlRow label="Weight" vertical>
            <ControlSelect
              value={(object as any).fontWeight || 'normal'}
              onChange={(e) => onUpdate({ fontWeight: e.target.value })}
              className="w-full"
            >
              <option value="lighter">Light</option>
              <option value="normal">Normal</option>
              <option value="bold">Bold</option>
            </ControlSelect>
          </ControlRow>
        </div>
      </div>

      {/* Text Alignment */}
      <ControlRow label="Alignment" vertical>
        <TextAlignControl
          value={(object as any).textAlign || 'left'}
          onChange={(val) => onUpdate({ textAlign: val })}
        />
      </ControlRow>

      {/* Opacity Slider */}
      <div className="space-y-2">
        <ControlRow label="Opacity">
          <span className="text-[10px] text-[color:var(--ui-panel-text)]">
            {Math.round(((object as any).opacity ?? 1) * 100)}%
          </span>
        </ControlRow>
        <ControlSlider
          min={0}
          max={1}
          step={0.01}
          value={(object as any).opacity ?? 1}
          onChange={(val) => onUpdate({ opacity: val })}
        />
      </div>

      <SectionDivider />

      {/* Text Effects */}
      <div className="space-y-3">
        <SectionHeader title="Effects" icon={<Sparkles className="w-4 h-4" />} />

        {/* Quick Style Presets */}
        <div className="grid grid-cols-3 gap-2">
          <button
            onClick={() => {
              setTextShadow({ color: '#00FFFF', blur: 10, offsetX: 0, offsetY: 0 });
              setTextStroke({ color: '#00FFFF', width: 0 });
            }}
            className="h-8 text-[9px] uppercase tracking-widest text-[color:var(--ui-panel-text)] bg-white/10 hover:bg-white/20 rounded-lg transition-all duration-200 hover:scale-105 active:scale-95"
          >
            Neon
          </button>
          <button
            onClick={() => {
              onUpdate({ fill: 'transparent' });
              setTextStroke({ color: '#FFFFFF', width: 2 });
            }}
            className="h-8 text-[9px] uppercase tracking-widest text-[color:var(--ui-panel-text)] bg-white/10 hover:bg-white/20 rounded-lg transition-all duration-200 hover:scale-105 active:scale-95"
          >
            Outline
          </button>
          <button
            onClick={() => {
              setTextShadow({ color: 'rgba(0,0,0,0.5)', blur: 2, offsetX: 1, offsetY: 1 });
              setTextStroke({ color: '', width: 0 });
            }}
            className="h-8 text-[9px] uppercase tracking-widest text-[color:var(--ui-panel-text)] bg-white/10 hover:bg-white/20 rounded-lg transition-all duration-200 hover:scale-105 active:scale-95"
          >
            Elevated
          </button>
        </div>

        {/* Line Height */}
        <div className="space-y-2">
          <ControlRow label="Line Height">
            <span className="text-[10px] text-[color:var(--ui-panel-text)]">{currentLineHeight.toFixed(2)}</span>
          </ControlRow>
          <ControlSlider
            min={0.5}
            max={3}
            step={0.01}
            value={currentLineHeight}
            onChange={setTextLineHeight}
          />
        </div>

        {/* Letter Spacing */}
        <div className="space-y-2">
          <ControlRow label="Letter Spacing">
            <span className="text-[10px] text-[color:var(--ui-panel-text)]">{Math.round(currentCharSpacing)}</span>
          </ControlRow>
          <ControlSlider
            min={-100}
            max={500}
            value={currentCharSpacing}
            onChange={setTextCharSpacing}
          />
        </div>

        {/* Shadow Controls */}
        <details className="group">
          <summary className="flex items-center justify-between cursor-pointer text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)] hover:text-[color:var(--ui-panel-text)] transition-colors">
            Shadow
            <span className="text-[9px] text-[color:var(--ui-panel-text)]/60 group-open:hidden">+ Expand</span>
          </summary>
          <div className="mt-3 space-y-3 pl-2 border-l border-white/10">
            <ControlRow label="Color">
              <ColorPicker
                value={currentShadow?.color || '#000000'}
                onChange={(val) => setTextShadow({ color: val })}
                aria-label="Shadow color"
              />
            </ControlRow>
            <div className="space-y-2">
              <ControlRow label="Blur">
                <span className="text-[10px] text-[color:var(--ui-panel-text)]">{Math.round(currentShadow?.blur || 0)}px</span>
              </ControlRow>
              <ControlSlider
                min={0}
                max={20}
                value={currentShadow?.blur || 0}
                onChange={(val) => setTextShadow({ blur: val })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <ControlRow label="Offset X">
                  <span className="text-[10px] text-[color:var(--ui-panel-text)]">{Math.round(currentShadow?.offsetX || 0)}</span>
                </ControlRow>
                <ControlSlider
                  min={-20}
                  max={20}
                  value={currentShadow?.offsetX || 0}
                  onChange={(val) => setTextShadow({ offsetX: val })}
                />
              </div>
              <div className="space-y-2">
                <ControlRow label="Offset Y">
                  <span className="text-[10px] text-[color:var(--ui-panel-text)]">{Math.round(currentShadow?.offsetY || 0)}</span>
                </ControlRow>
                <ControlSlider
                  min={-20}
                  max={20}
                  value={currentShadow?.offsetY || 0}
                  onChange={(val) => setTextShadow({ offsetY: val })}
                />
              </div>
            </div>
          </div>
        </details>

        {/* Stroke Controls */}
        <details className="group">
          <summary className="flex items-center justify-between cursor-pointer text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)] hover:text-[color:var(--ui-panel-text)] transition-colors">
            Stroke
            <span className="text-[9px] text-[color:var(--ui-panel-text)]/60 group-open:hidden">+ Expand</span>
          </summary>
          <div className="mt-3 space-y-3 pl-2 border-l border-white/10">
            <ControlRow label="Color">
              <ColorPicker
                value={currentStroke || '#000000'}
                onChange={(val) => setTextStroke({ color: val })}
                aria-label="Stroke color"
              />
            </ControlRow>
            <div className="space-y-2">
              <ControlRow label="Width">
                <span className="text-[10px] text-[color:var(--ui-panel-text)]">{Math.round(currentStrokeWidth)}px</span>
              </ControlRow>
              <ControlSlider
                min={0}
                max={10}
                value={currentStrokeWidth}
                onChange={(val) => setTextStroke({ width: val })}
              />
            </div>
          </div>
        </details>
      </div>
    </div>
  );
};

// Image Properties Section
interface ImagePropertiesProps {
  object: fabric.Image;
  onUpdate: (updates: Partial<fabric.Object>) => void;
  setImageAdjustments: (opts: any) => void;
  resetImageAdjustments: () => void;
}

const ImageProperties: React.FC<ImagePropertiesProps> = ({
  object,
  onUpdate,
  setImageAdjustments,
  resetImageAdjustments,
}) => {
  const currentAdjustments = (object as any).adjustments || {
    brightness: 0,
    contrast: 0,
    saturation: 0,
  };

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-4">
      <SectionHeader title="Image Adjustments" icon={<ImageIcon className="w-4 h-4" />}>
        <IconButton
          label="Reset"
          onClick={resetImageAdjustments}
          tooltipSide="left"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </IconButton>
      </SectionHeader>

      {/* Opacity Slider */}
      <div className="space-y-2">
        <ControlRow label="Opacity">
          <span className="text-[10px] text-[color:var(--ui-panel-text)]">
            {Math.round(((object as any).opacity ?? 1) * 100)}%
          </span>
        </ControlRow>
        <ControlSlider
          min={0}
          max={1}
          step={0.01}
          value={(object as any).opacity ?? 1}
          onChange={(val) => onUpdate({ opacity: val })}
        />
      </div>

      <details className="group">
        <summary className="flex items-center justify-between cursor-pointer text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)] hover:text-[color:var(--ui-panel-text)] transition-colors">
          Drop Shadow
          <span className="text-[9px] text-[color:var(--ui-panel-text)]/60 group-open:hidden">+ Expand</span>
        </summary>
        <div className="mt-3 space-y-3 pl-2 border-l border-white/10">
          <ControlRow label="Color">
            <ColorPicker
              value={typeof (object.shadow as any)?.color === 'string' ? (object.shadow as any).color : '#000000'}
              onChange={(val) => onUpdate({ shadow: new fabric.Shadow({ color: val, blur: (object.shadow as any)?.blur || 0, offsetX: (object.shadow as any)?.offsetX || 0, offsetY: (object.shadow as any)?.offsetY || 0 }) })}
              aria-label="Image shadow color"
            />
          </ControlRow>
          <div className="space-y-2">
            <ControlRow label="Blur"><span className="text-[10px] text-[color:var(--ui-panel-text)]">{Math.round((object.shadow as any)?.blur || 0)}px</span></ControlRow>
            <ControlSlider min={0} max={40} value={(object.shadow as any)?.blur || 0} onChange={(val) => onUpdate({ shadow: new fabric.Shadow({ color: ((object.shadow as any)?.color as string) || '#000000', blur: val, offsetX: (object.shadow as any)?.offsetX || 0, offsetY: (object.shadow as any)?.offsetY || 0 }) })} />
          </div>
        </div>
      </details>

      <div className="space-y-4">
        <div className="space-y-2">
          <ControlRow label="Brightness">
            <span className="text-[10px] text-[color:var(--ui-panel-text)]">
              {Math.round(currentAdjustments.brightness * 100)}%
            </span>
          </ControlRow>
          <ControlSlider
            min={-1}
            max={1}
            step={0.01}
            value={currentAdjustments.brightness}
            onChange={(val) => setImageAdjustments({ brightness: val })}
          />
        </div>

        <div className="space-y-2">
          <ControlRow label="Contrast">
            <span className="text-[10px] text-[color:var(--ui-panel-text)]">
              {Math.round(currentAdjustments.contrast * 100)}%
            </span>
          </ControlRow>
          <ControlSlider
            min={-1}
            max={1}
            step={0.01}
            value={currentAdjustments.contrast}
            onChange={(val) => setImageAdjustments({ contrast: val })}
          />
        </div>

        <div className="space-y-2">
          <ControlRow label="Saturation">
            <span className="text-[10px] text-[color:var(--ui-panel-text)]">
              {Math.round(currentAdjustments.saturation * 100)}%
            </span>
          </ControlRow>
          <ControlSlider
            min={-1}
            max={1}
            step={0.01}
            value={currentAdjustments.saturation}
            onChange={(val) => setImageAdjustments({ saturation: val })}
          />
        </div>
      </div>
    </div>
  );
};

// Transform Controls Section - Position, Size, Rotation
interface TransformControlsProps {
  object: fabric.Object;
  onUpdate: (updates: Record<string, any>) => void;
}

const TransformControls: React.FC<TransformControlsProps> = ({ object, onUpdate }) => {
  const left = Math.round(object.left ?? 0);
  const top = Math.round(object.top ?? 0);
  const width = Math.round((object.width ?? 0) * (object.scaleX ?? 1));
  const height = Math.round((object.height ?? 0) * (object.scaleY ?? 1));
  const angle = Math.round(object.angle ?? 0);

  const handlePositionChange = (axis: 'left' | 'top', value: number) => {
    if (!Number.isFinite(value)) return;
    onUpdate({ [axis]: value });
  };

  const handleSizeChange = (dimension: 'width' | 'height', value: number) => {
    if (!Number.isFinite(value) || value <= 0) return;

    if (dimension === 'width') {
      const newScaleX = value / (object.width ?? 1);
      onUpdate({ scaleX: newScaleX });
    } else {
      const newScaleY = value / (object.height ?? 1);
      onUpdate({ scaleY: newScaleY });
    }
  };

  const handleRotationChange = (value: number) => {
    if (!Number.isFinite(value)) return;
    // Normalize to 0-360
    const normalized = ((value % 360) + 360) % 360;
    onUpdate({ angle: normalized });
  };

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-4">
      <SectionHeader title="Transform" icon={<Move className="w-4 h-4" />} />

      {/* Position */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)]">
            <MoveHorizontal className="w-3 h-3" /> X
          </label>
          <ControlInput
            type="number"
            value={left}
            onChange={(e) => handlePositionChange('left', Number(e.target.value))}
            className="w-full"
          />
        </div>
        <div className="space-y-1">
          <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)]">
            <MoveVertical className="w-3 h-3" /> Y
          </label>
          <ControlInput
            type="number"
            value={top}
            onChange={(e) => handlePositionChange('top', Number(e.target.value))}
            className="w-full"
          />
        </div>
      </div>

      {/* Size */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)]">
            <Scaling className="w-3 h-3" /> W
          </label>
          <ControlInput
            type="number"
            min={1}
            value={width}
            onChange={(e) => handleSizeChange('width', Number(e.target.value))}
            className="w-full"
          />
        </div>
        <div className="space-y-1">
          <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)]">
            <Scaling className="w-3 h-3" /> H
          </label>
          <ControlInput
            type="number"
            min={1}
            value={height}
            onChange={(e) => handleSizeChange('height', Number(e.target.value))}
            className="w-full"
          />
        </div>
      </div>

      {/* Rotation */}
      <div className="space-y-2">
        <ControlRow label="Rotation">
          <div className="flex items-center gap-2">
            <ControlInput
              type="number"
              min={0}
              max={360}
              value={angle}
              onChange={(e) => handleRotationChange(Number(e.target.value))}
              className="w-16"
            />
            <span className="text-[10px] text-[color:var(--ui-panel-text)]">°</span>
          </div>
        </ControlRow>
        <div className="flex gap-1">
          {[0, 45, 90, 180, 270].map((preset) => (
            <button
              key={preset}
              onClick={() => handleRotationChange(preset)}
              className={`flex-1 h-6 text-[9px] rounded border transition-all duration-200 ${
                angle === preset
                  ? 'border-[color:var(--brand-primary)] bg-[color:var(--brand-primary)]/10 text-[color:var(--brand-primary)]'
                  : 'border-white/10 bg-white/5 text-[color:var(--ui-panel-text)] hover:bg-white/10'
              }`}
            >
              {preset}°
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

// Main Properties Panel
export const PropertiesPanel: React.FC = () => {
  const {
    selectedObjectId,
    layersById,
    canvas,
    saveState,
    requestLayerSync,
    setTextShadow,
    setTextStroke,
    setTextCharSpacing,
    setTextLineHeight,
    setImageAdjustments,
    resetImageAdjustments,
    alignSelectedObjects,
  } = useEditorStore(
    (state) => ({
      selectedObjectId: state.selectedObjectId,
      layersById: state.layersById,
      canvas: state.canvas,
      saveState: state.saveState,
      requestLayerSync: state.requestLayerSync,
      setTextShadow: state.setTextShadow,
      setTextStroke: state.setTextStroke,
      setTextCharSpacing: state.setTextCharSpacing,
      setTextLineHeight: state.setTextLineHeight,
      setImageAdjustments: state.setImageAdjustments,
      resetImageAdjustments: state.resetImageAdjustments,
      alignSelectedObjects: state.alignSelectedObjects,
    }),
    shallow
  );
  const { addColorToBrandKit } = useThemeStore(
    (state) => ({ addColorToBrandKit: state.addColorToBrandKit }),
    shallow
  );

  const selectedObject =
    selectedObjectId && layersById[selectedObjectId]
      ? layersById[selectedObjectId]
      : canvas?.getActiveObject() ?? null;
  const hasSelection = !!selectedObject;

  const isText = selectedObject?.type === 'i-text' || selectedObject?.type === 'textbox';
  const isImage = selectedObject?.type === 'image';
  const isShape =
    selectedObject?.type === 'rect' ||
    selectedObject?.type === 'circle' ||
    selectedObject?.type === 'triangle' ||
    selectedObject?.type === 'polygon';

  const updateSelectedObject = (updates: Record<string, any>) => {
    if (!selectedObject || !canvas) return;
    selectedObject.set(updates);
    selectedObject.setCoords();
    canvas.requestRenderAll();
    requestLayerSync();
    saveState();
  };

  const handleCornerRadius = (value: number) => {
    if (!selectedObject || selectedObject.type !== 'rect' || !canvas) return;
    const rect = selectedObject as fabric.Rect;

    const scaleX = Math.abs(rect.scaleX ?? 1) || 1;
    const scaleY = Math.abs(rect.scaleY ?? 1) || 1;
    const width = Math.abs(rect.width ?? 0);
    const height = Math.abs(rect.height ?? 0);

    const maxVisibleRadius = Math.max(0, Math.min((width * scaleX) / 2, (height * scaleY) / 2));
    const clampedVisibleRadius = Math.max(0, Math.min(value, maxVisibleRadius));

    const nextRx = clampedVisibleRadius / scaleX;
    const nextRy = clampedVisibleRadius / scaleY;

    rect.set({ rx: nextRx, ry: nextRy });
    (rect as any).__baseRx = clampedVisibleRadius;
    (rect as any).__baseRy = clampedVisibleRadius;
    rect.setCoords();
    canvas.requestRenderAll();
    requestLayerSync();
    saveState();
  };

  const handleCornerRadiusXY = (rxValue: number, ryValue: number) => {
    if (!selectedObject || selectedObject.type !== 'rect' || !canvas) return;
    const rect = selectedObject as fabric.Rect;

    const scaleX = Math.abs(rect.scaleX ?? 1) || 1;
    const scaleY = Math.abs(rect.scaleY ?? 1) || 1;
    const width = Math.abs(rect.width ?? 0);
    const height = Math.abs(rect.height ?? 0);

    const maxVisibleRadiusX = Math.max(0, Math.min(rxValue, (width * scaleX) / 2));
    const maxVisibleRadiusY = Math.max(0, Math.min(ryValue, (height * scaleY) / 2));

    const nextRx = maxVisibleRadiusX / scaleX;
    const nextRy = maxVisibleRadiusY / scaleY;

    rect.set({ rx: nextRx, ry: nextRy });
    (rect as any).__baseRx = maxVisibleRadiusX;
    (rect as any).__baseRy = maxVisibleRadiusY;
    rect.setCoords();
    canvas.requestRenderAll();
    requestLayerSync();
    saveState();
  };

  const getObjectTypeLabel = () => {
    if (!selectedObject) return 'None';
    switch (selectedObject.type) {
      case 'i-text':
      case 'textbox':
        return 'Text';
      case 'rect':
        return 'Rectangle';
      case 'circle':
        return 'Circle';
      case 'triangle':
        return 'Triangle';
      case 'polygon':
        return 'Polygon';
      case 'image':
        return 'Image';
      case 'group':
        return 'Group';
      default:
        return selectedObject.type || 'Object';
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[color:var(--border-subtle)] px-4 py-3">
        <span className="text-[11px] uppercase tracking-widest text-[color:var(--ui-panel-text)] font-medium">
          Properties
        </span>
        {selectedObject && (
          <span className="text-[10px] uppercase tracking-widest text-[color:var(--brand-primary)] bg-[color:var(--brand-primary)]/10 px-2 py-0.5 rounded-full">
            {getObjectTypeLabel()}
          </span>
        )}
      </div>

      <div className="border-b border-[color:var(--border-subtle)] px-4 py-3">
        <div className="grid grid-cols-6 gap-2">
          <IconButton
            label="Align Left"
            onClick={() => alignSelectedObjects('left')}
            disabled={!hasSelection}
          >
            <AlignHorizontalJustifyStart className="w-3.5 h-3.5" />
          </IconButton>
          <IconButton
            label="Align Center"
            onClick={() => alignSelectedObjects('center')}
            disabled={!hasSelection}
          >
            <AlignHorizontalJustifyCenter className="w-3.5 h-3.5" />
          </IconButton>
          <IconButton
            label="Align Right"
            onClick={() => alignSelectedObjects('right')}
            disabled={!hasSelection}
          >
            <AlignHorizontalJustifyEnd className="w-3.5 h-3.5" />
          </IconButton>
          <IconButton
            label="Align Top"
            onClick={() => alignSelectedObjects('top')}
            disabled={!hasSelection}
          >
            <AlignVerticalJustifyStart className="w-3.5 h-3.5" />
          </IconButton>
          <IconButton
            label="Align Middle"
            onClick={() => alignSelectedObjects('middle')}
            disabled={!hasSelection}
          >
            <AlignVerticalJustifyCenter className="w-3.5 h-3.5" />
          </IconButton>
          <IconButton
            label="Align Bottom"
            onClick={() => alignSelectedObjects('bottom')}
            disabled={!hasSelection}
          >
            <AlignVerticalJustifyEnd className="w-3.5 h-3.5" />
          </IconButton>
        </div>
      </div>

      {/* Content */}
      <div className="relative flex-1 overflow-y-auto p-4 space-y-4">
        {/* Vision Palette - Always visible when colors exist */}
        <VisionPaletteSection
          onColorSelect={(color) => {
            if (selectedObject && (isShape || isText)) {
              updateSelectedObject({ fill: color, tokenRole: null });
            }
          }}
          disabled={!selectedObject || isImage}
        />

        {/* Empty State or Object Properties */}
        {!selectedObject ? (
          <CanvasEmptyState />
        ) : (
          <>
            {isShape && (
              <ShapeProperties
                object={selectedObject}
                onUpdate={updateSelectedObject}
                onCornerRadius={handleCornerRadius}
                onCornerRadiusXY={handleCornerRadiusXY}
                addColorToBrandKit={addColorToBrandKit}
              />
            )}

            {isText && (
              <TextProperties
                object={selectedObject as fabric.Text}
                onUpdate={updateSelectedObject}
                setTextShadow={setTextShadow}
                setTextStroke={setTextStroke}
                setTextCharSpacing={setTextCharSpacing}
                setTextLineHeight={setTextLineHeight}
              />
            )}

            {isImage && (
              <ImageProperties
                object={selectedObject as fabric.Image}
                onUpdate={updateSelectedObject}
                setImageAdjustments={setImageAdjustments}
                resetImageAdjustments={resetImageAdjustments}
              />
            )}

            {/* Transform Controls - Position, Size, Rotation */}
            <TransformControls
              object={selectedObject}
              onUpdate={updateSelectedObject}
            />
          </>
        )}

        <SectionDivider />

        {/* Palette Hub - Always visible */}
        <div className="space-y-3">
          <SectionHeader title="Color Palettes" icon={<Palette className="w-4 h-4" />} />
          <ThemeSidebar />
        </div>
      </div>
    </div>
  );
};
