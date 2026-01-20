import React from 'react';
import { shallow } from 'zustand/shallow';
import * as fabric from 'fabric';
import {
  Palette,
  Type,
  Image as ImageIcon,
  Sliders,
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
} from 'lucide-react';
import { useEditorStore, DEFAULT_CANVAS_BACKGROUND } from '../state/editorStore';
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
          className="text-[9px] uppercase tracking-widest text-slate-500 hover:text-slate-300 transition-colors"
          title="Clear palette"
        >
          Clear
        </button>
      </div>
      <p className="text-[10px] text-slate-500">Colors from your vision board</p>
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
    canvas,
  } = useEditorStore(
    (state) => ({
      setCanvasBackgroundColor: state.setCanvasBackgroundColor,
      gridEnabled: state.gridEnabled,
      setGridEnabled: state.setGridEnabled,
      snapEnabled: state.snapEnabled,
      setSnapEnabled: state.setSnapEnabled,
      canvas: state.canvas,
    }),
    shallow
  );
  const { canvasBackgroundColor } = useThemeStore(
    (state) => ({ canvasBackgroundColor: state.canvasBackgroundColor }),
    shallow
  );

  const canvasWidth = canvas ? Math.round(canvas.getWidth()) : 0;
  const canvasHeight = canvas ? Math.round(canvas.getHeight()) : 0;

  return (
    <div className="space-y-4">
      {/* Canvas Info Card */}
      <div className="rounded-xl border border-white/10 bg-gradient-to-br from-white/5 to-transparent p-4">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-[color:var(--brand-primary)]/20 flex items-center justify-center">
            <Layout className="w-5 h-5 text-[color:var(--brand-primary)]" />
          </div>
          <div>
            <h4 className="text-xs font-medium text-slate-200">Canvas Settings</h4>
            <p className="text-[10px] text-slate-400 uppercase tracking-widest">
              {canvasWidth} × {canvasHeight} px
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <ControlRow label="Background">
            <ColorPicker
              value={canvasBackgroundColor || DEFAULT_CANVAS_BACKGROUND}
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
                  : 'border-white/10 bg-white/5 text-slate-400 hover:bg-white/10'
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
                  : 'border-white/10 bg-white/5 text-slate-400 hover:bg-white/10'
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
          <Maximize2 className="w-5 h-5 text-slate-500" />
        </div>
        <p className="text-[11px] text-slate-400 mb-1">No object selected</p>
        <p className="text-[10px] text-slate-500">
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
  addColorToBrandKit: (color: string) => Promise<{ success: boolean; error?: string }>;
}

const ShapeProperties: React.FC<ShapePropertiesProps> = ({
  object,
  onUpdate,
  onCornerRadius,
  addColorToBrandKit,
}) => {
  const isRect = object.type === 'rect';
  const fillValue =
    typeof (object as any)?.fill === 'string'
      ? ((object as any).fill as string)
      : '#ffffff';

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-4">
      <SectionHeader title="Shape" icon={<Palette className="w-4 h-4" />} />

      <ControlRow label="Fill Color">
        <ColorPicker
          value={fillValue}
          onChange={(val) => onUpdate({ fill: val, tokenRole: null })}
          aria-label="Fill color"
        />
      </ControlRow>

      {/* Opacity Slider */}
      <div className="space-y-2">
        <ControlRow label="Opacity">
          <span className="text-[10px] text-slate-300">
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
            <span className="text-[10px] text-slate-300">
              {Math.round((object as fabric.Rect).rx ?? 0)}px
            </span>
          </ControlRow>
          <ControlSlider
            min={0}
            max={80}
            value={(object as fabric.Rect).rx ?? 0}
            onChange={onCornerRadius}
          />
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
}

const TextProperties: React.FC<TextPropertiesProps> = ({
  object,
  onUpdate,
  setTextShadow,
  setTextStroke,
  setTextCharSpacing,
}) => {
  const currentShadow = object.shadow as fabric.Shadow | null;
  const currentStroke = typeof object.stroke === 'string' ? object.stroke : '#000000';
  const currentStrokeWidth = object.strokeWidth || 0;
  const currentCharSpacing = object.charSpacing || 0;

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
          <span className="text-[10px] text-slate-300">
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
            className="h-8 text-[9px] uppercase tracking-widest text-slate-400 bg-white/10 hover:bg-white/20 rounded-lg transition-all duration-200 hover:scale-105 active:scale-95"
          >
            Neon
          </button>
          <button
            onClick={() => {
              onUpdate({ fill: 'transparent' });
              setTextStroke({ color: '#FFFFFF', width: 2 });
            }}
            className="h-8 text-[9px] uppercase tracking-widest text-slate-400 bg-white/10 hover:bg-white/20 rounded-lg transition-all duration-200 hover:scale-105 active:scale-95"
          >
            Outline
          </button>
          <button
            onClick={() => {
              setTextShadow({ color: 'rgba(0,0,0,0.5)', blur: 2, offsetX: 1, offsetY: 1 });
              setTextStroke({ color: '', width: 0 });
            }}
            className="h-8 text-[9px] uppercase tracking-widest text-slate-400 bg-white/10 hover:bg-white/20 rounded-lg transition-all duration-200 hover:scale-105 active:scale-95"
          >
            Elevated
          </button>
        </div>

        {/* Shadow Controls */}
        <details className="group">
          <summary className="flex items-center justify-between cursor-pointer text-[10px] uppercase tracking-widest text-slate-400 hover:text-slate-300 transition-colors">
            Shadow
            <span className="text-[9px] text-slate-500 group-open:hidden">+ Expand</span>
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
                <span className="text-[10px] text-slate-300">{Math.round(currentShadow?.blur || 0)}px</span>
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
                  <span className="text-[10px] text-slate-300">{Math.round(currentShadow?.offsetX || 0)}</span>
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
                  <span className="text-[10px] text-slate-300">{Math.round(currentShadow?.offsetY || 0)}</span>
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
          <summary className="flex items-center justify-between cursor-pointer text-[10px] uppercase tracking-widest text-slate-400 hover:text-slate-300 transition-colors">
            Stroke
            <span className="text-[9px] text-slate-500 group-open:hidden">+ Expand</span>
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
                <span className="text-[10px] text-slate-300">{Math.round(currentStrokeWidth)}px</span>
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

        {/* Letter Spacing */}
        <div className="space-y-2">
          <ControlRow label="Letter Spacing">
            <span className="text-[10px] text-slate-300">{Math.round(currentCharSpacing)}</span>
          </ControlRow>
          <ControlSlider
            min={-100}
            max={100}
            value={currentCharSpacing}
            onChange={setTextCharSpacing}
          />
        </div>
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
          <span className="text-[10px] text-slate-300">
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

      <div className="space-y-4">
        <div className="space-y-2">
          <ControlRow label="Brightness">
            <span className="text-[10px] text-slate-300">
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
            <span className="text-[10px] text-slate-300">
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
            <span className="text-[10px] text-slate-300">
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
    rect.set({ rx: value, ry: value });
    (rect as any).__baseRx = value * (rect.scaleX ?? 1);
    (rect as any).__baseRy = value * (rect.scaleY ?? 1);
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
        <span className="text-[11px] uppercase tracking-widest text-slate-300 font-medium">
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
          </>
        )}

        <SectionDivider />

        {/* Theme Hub - Always visible */}
        <div className="space-y-3">
          <SectionHeader title="Theme Hub" icon={<Sliders className="w-4 h-4" />} />
          <ThemeSidebar />
        </div>
      </div>
    </div>
  );
};
