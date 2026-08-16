import React, { useState, useEffect } from 'react';
import { shallow } from 'zustand/shallow';
import { useEditorStore } from '../state/editorStore';
import { useThemeStore } from '../state/useThemeStore';
import { Palette, Type, Plus, Trash2 } from 'lucide-react';
import * as objectFactories from '../fabric/objectFactories';

interface BrandKitData {
  colors: string[];
  typography: {
    heading: {
      fontFamily: string;
      fontSize: number;
      fontWeight: string;
    };
    body: {
      fontFamily: string;
      fontSize: number;
      fontWeight: string;
    };
  };
  logoAssets: string[];
}

export const BrandKit: React.FC = () => {
  const fallbackBrandKit: BrandKitData = {
    colors: ['#1f2933', '#3b82f6', '#ef4444', '#10b981', '#f59e0b'],
    typography: {
      heading: { fontFamily: 'Arial', fontSize: 32, fontWeight: 'bold' },
      body: { fontFamily: 'Arial', fontSize: 16, fontWeight: 'normal' },
    },
    logoAssets: [],
  };
  const [newColor, setNewColor] = useState('#3b82f6');
  const { brandKit, brandKitLoading, loadBrandKit, saveBrandKit, addColorToBrandKit } = useThemeStore(
    (state) => ({
      brandKit: state.brandKit,
      brandKitLoading: state.brandKitLoading,
      loadBrandKit: state.loadBrandKit,
      saveBrandKit: state.saveBrandKit,
      addColorToBrandKit: state.addColorToBrandKit,
    }),
    shallow
  );
  const activeBrandKit = brandKit ?? fallbackBrandKit;
  
  const {
    canvas,
    selectedObjectId,
    layersById,
    setObjectFill,
    addIText,
  } = useEditorStore(
    (state) => ({
      canvas: state.canvas,
      selectedObjectId: state.selectedObjectId,
      layersById: state.layersById,
      setObjectFill: state.setObjectFill,
      addIText: (text: string, fontSize: number, fontWeight: string, role: 'heading' | 'subheading' | 'body') => {
        if (state.canvas) {
          objectFactories.addIText(state.canvas, { text, fontSize, fontWeight, role });
        }
      },
    }),
    shallow
  );

  useEffect(() => {
    void loadBrandKit();
  }, [loadBrandKit]);

  const handleColorChange = (color: string) => {
    if (!canvas || !selectedObjectId || !layersById[selectedObjectId]) return;
    setObjectFill(color);
  };

  const handleAddColor = () => {
    if (!newColor || activeBrandKit.colors.includes(newColor)) return;

    const updatedColors = [...activeBrandKit.colors, newColor];
    const updatedBrandKit = { ...activeBrandKit, colors: updatedColors };
    void saveBrandKit(updatedBrandKit);
  };

  const handleRemoveColor = (colorToRemove: string) => {
    const updatedColors = activeBrandKit.colors.filter(color => color !== colorToRemove);
    const updatedBrandKit = { ...activeBrandKit, colors: updatedColors };
    void saveBrandKit(updatedBrandKit);
  };

  const handleAddHeading = () => {
    addIText('Brand Heading', activeBrandKit.typography.heading.fontSize, activeBrandKit.typography.heading.fontWeight, 'heading');
  };

  const handleAddBody = () => {
    addIText('Brand Body Text', activeBrandKit.typography.body.fontSize, activeBrandKit.typography.body.fontWeight, 'body');
  };

  const handleAddToBrandKit = () => {
    if (!canvas) return;
    
    const selectedObject = selectedObjectId ? layersById[selectedObjectId] : null;
    if (selectedObject && selectedObject.fill) {
      const color = selectedObject.fill as string;
      void addColorToBrandKit(color);
    }
  };

  if (brandKitLoading) {
    return (
      <div className="p-4 bg-[color:var(--ui-panel-opaque)] text-[color:var(--ui-panel-text)] backdrop-blur-[var(--ui-blur)] border border-[color:var(--ui-border)] rounded-xl transition-all duration-300 ease-in-out h-full flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[color:var(--brand-primary)]"></div>
      </div>
    );
  }

  return (
    <div className="p-4 bg-[color:var(--ui-panel-opaque)] text-[color:var(--ui-panel-text)] backdrop-blur-[var(--ui-blur)] border border-[color:var(--ui-border)] rounded-xl transition-all duration-300 ease-in-out h-full flex flex-col">
      <div className="mb-4">
        <h3 className="text-[11px] uppercase tracking-widest text-[color:var(--ui-panel-text)] mb-3 flex items-center gap-2">
          <Palette className="w-4 h-4" />
          Brand Kit
        </h3>
      </div>

      {/* Color Swatches */}
      <div className="mb-6">
        <h4 className="text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)] mb-2">Brand Colors</h4>
        <div className="flex flex-wrap gap-2 mb-3">
          {activeBrandKit.colors.map((color, index) => (
            <div key={index} className="relative group">
              <button
                onClick={() => handleColorChange(color)}
                className="w-8 h-8 rounded-full border-2 border-white/20 shadow-md hover:scale-110 transition-transform"
                style={{ backgroundColor: color }}
                title={`Apply ${color}`}
              />
              <button
                onClick={() => handleRemoveColor(color)}
                className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                title="Remove color"
              >
                <Trash2 className="w-3 h-3 text-white" />
              </button>
            </div>
          ))}
        </div>
        
        <div className="flex gap-2">
          <input
            type="color"
            value={newColor}
            onChange={(e) => setNewColor(e.target.value)}
            className="w-10 h-10 cursor-pointer rounded border border-white/10 bg-transparent"
          />
          <button
            onClick={handleAddColor}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-white/5 text-[color:var(--ui-panel-text)] rounded-lg hover:bg-white/10 transition-all duration-300 ease-in-out text-xs uppercase tracking-widest"
          >
            <Plus className="w-4 h-4" />
            Add Color
          </button>
        </div>
      </div>

      {/* Typography Styles */}
      <div className="mb-6">
        <h4 className="text-[10px] uppercase tracking-widest text-[color:var(--ui-panel-text)] mb-2">Typography</h4>
        <div className="space-y-2">
          <button
            onClick={handleAddHeading}
            className="w-full flex items-center justify-between px-3 py-2 bg-white/5 text-[color:var(--ui-panel-text)] rounded-lg hover:bg-white/10 transition-all duration-300 ease-in-out text-xs uppercase tracking-widest"
          >
            <span>Add Heading</span>
            <Type className="w-4 h-4" />
          </button>
          <button
            onClick={handleAddBody}
            className="w-full flex items-center justify-between px-3 py-2 bg-white/5 text-[color:var(--ui-panel-text)] rounded-lg hover:bg-white/10 transition-all duration-300 ease-in-out text-xs uppercase tracking-widest"
          >
            <span>Add Body Text</span>
            <Type className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Add to Brand Kit Button */}
      <div className="mt-auto pt-4 border-t border-white/10">
        <button
          onClick={handleAddToBrandKit}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-[color:var(--brand-primary)] text-white rounded-lg hover:opacity-90 transition-opacity text-xs uppercase tracking-widest"
        >
          <Plus className="w-4 h-4" />
          Add Selected Color to Brand Kit
        </button>
      </div>
    </div>
  );
};
